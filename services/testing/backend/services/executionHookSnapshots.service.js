const invalid = (message) => Object.assign(new Error(message), { statusCode: 400 });
const db = require("@hellotest/platform/backend/src/db");
const { loadSteps } = require("./executionSnapshot.repository");
const { getOptionalEvidenceAccess } = require("@hellotest/platform/backend/services/optionalEvidenceAccess.service");
const { materializeParameterValues } = require("@hellotest/platform/backend/src/utils/testDataGenerators");
const { normalizeParameterLayer } = require("@hellotest/platform/backend/src/utils/stepParameterResolution");
const { redactSharedStepData, regenerateSharedStepData } = require("./sharedStepDataSnapshot.service");

const parse = (value, fallback) => {
  if (typeof value !== "string") return value || fallback;
  try { return JSON.parse(value); } catch { return fallback; }
};
const hookArray = value => {
  const hooks = parse(value, []);
  return Array.isArray(hooks) ? hooks.filter(hook => hook && typeof hook === "object" && !Array.isArray(hook)) : [];
};

function redactExecutionHooks(value) {
  return hookArray(value).map(hook => ({ ...hook, steps: Array.isArray(hook.steps) ? hook.steps.map(redactSharedStepData) : [] }));
}

// Reruns reuse frozen source code and regenerate data from the frozen templates.
function regenerateExecutionHooks(value) {
  const caseValues = new Map();
  return hookArray(value).map(hook => ({ ...hook, steps: regenerateSharedStepData(Array.isArray(hook.steps) ? hook.steps : []).map(step => {
    const templates = normalizeParameterLayer(parse(step.source_case_parameter_templates || step.source_case_parameters, {}), "t");
    const key = `${step.test_case_id || step.id}:${JSON.stringify(templates)}`;
    if (!caseValues.has(key)) caseValues.set(key, materializeParameterValues(templates));
    return { ...step, source_case_parameter_templates: templates, source_case_parameters: caseValues.get(key) };
  }) }));
}

/** Freeze hook code at run creation; hooks do not need to be regular run members. */
async function snapshotExecutionHooks(hooks, { projectId, appTypeId, userId }) {
  if (hooks == null) return [];
  if (!Array.isArray(hooks)) throw invalid("Execution hooks must be a list.");
  if (!hooks.length) return [];
  if (hooks.length > 20) throw invalid("A run supports up to 20 setup and teardown hooks.");
  const access = userId ? await getOptionalEvidenceAccess({ id: userId }, projectId, ["testcase.view", "suite.view"]) : {};
  const result = [];
  const usedIds = new Set();
  for (const [index, hook] of hooks.entries()) {
    if (!hook || typeof hook !== "object" || Array.isArray(hook)) throw invalid("Each execution hook must select a saved case or suite.");
    if (hook.scope !== "test" || !["pre", "post"].includes(hook.phase)) throw invalid("Use Before Test or After Test hooks. Run and suite hooks require coordinated scheduling and are not available in this execution mode.");
    if (!access["testcase.view"]) throw invalid("Test case view permission is required to resolve execution hooks.");
    const kind = hook.target_kind || "test";
    const targetId = typeof hook.target_id === "string" ? hook.target_id.trim() : "";
    if (!targetId) throw invalid("Select a saved case or suite as the hook source.");
    const id = typeof hook.id === "string" && hook.id.trim() ? hook.id.trim() : `hook-${index + 1}`;
    if (usedIds.has(id)) throw invalid("Each execution hook must have a unique identifier.");
    usedIds.add(id);
    const failBehavior = hook.fail_behavior || (hook.phase === "post" ? "continue" : "fail-run");
    if (!["fail-run", "mark-blocked", "continue"].includes(failBehavior)) throw invalid("Choose a supported hook failure behavior.");
    let ids;
    if (kind === "suite") {
      if (!access["suite.view"]) throw invalid("Suite view permission is required for suite hook sources.");
      ids = [...new Set((await db.prepare(`WITH RECURSIVE selected AS (
        SELECT s.id, s.app_type_id FROM test_suites s JOIN app_types a ON a.id = s.app_type_id
        WHERE s.id = ? AND a.project_id = ? AND s.app_type_id = ?
        UNION SELECT child.id, child.app_type_id FROM test_suites child JOIN selected parent ON child.parent_id = parent.id
          WHERE child.app_type_id = parent.app_type_id
      ) SELECT stc.test_case_id AS id FROM selected s JOIN suite_test_cases stc ON stc.suite_id = s.id
        ORDER BY CASE WHEN s.id = ? THEN 0 ELSE 1 END, s.id, stc.sort_order, stc.test_case_id`)
        .all(targetId, projectId, appTypeId, targetId)).map((row) => row.id))];
    } else if (kind === "test") ids = [targetId];
    else throw invalid("Select a saved case or suite as the hook source.");
    if (!ids.length || ids.length > 100) throw invalid("Hook source must contain between 1 and 100 cases.");
    const cases = [];
    for (const id of ids) {
      const row = await db.prepare(`SELECT tc.id, tc.title, tc.parameter_values FROM test_cases tc JOIN app_types a ON a.id = tc.app_type_id
        WHERE tc.id = ? AND a.project_id = ? AND tc.app_type_id = ?`).get(id, projectId, appTypeId);
      if (!row) throw invalid("Hook source must belong to the current project and application.");
      cases.push(row);
    }
    const byCase = await loadSteps(ids);
    const steps = cases.flatMap((source) => {
      const templates = normalizeParameterLayer(parse(source.parameter_values, {}), "t");
      const parameters = materializeParameterValues(templates);
      const sourceSteps = byCase.get(source.id) || [];
      if (!sourceSteps.length) throw invalid(`Hook source ${source.title || source.id} has no executable steps.`);
      return sourceSteps.map(step => ({ ...step, source_case_parameter_templates: templates, source_case_parameters: parameters }));
    });
    if (steps.length > 500 || steps.some((step) => step.step_type === "api" ? !step.api_request : !String(step.automation_code || "").trim())) throw invalid(`Hook ${hook.name || targetId} contains missing automation. Build and review the source case first.`);
    result.push({ ...hook, id, target_id: targetId, target_kind: kind, fail_behavior: failBehavior, execution_order: index + 1,
      steps: steps.map((step, stepIndex) => ({ ...step, order: stepIndex + 1 })) });
  }
  return result;
}
module.exports = { snapshotExecutionHooks, redactExecutionHooks, regenerateExecutionHooks };
