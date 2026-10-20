const invalid = (message) => Object.assign(new Error(message), { statusCode: 400 });
const db = require("@hellotest/platform/backend/src/db");
const { loadSteps } = require("./executionSnapshot.repository");
const { getOptionalEvidenceAccess } = require("@hellotest/platform/backend/services/optionalEvidenceAccess.service");
const { materializeParameterValues, materializeDataSetSnapshot } = require("@hellotest/platform/backend/src/utils/testDataGenerators");
const { normalizeParameterLayer, normalizeParameterKey } = require("@hellotest/platform/backend/src/utils/stepParameterResolution");
const { effectiveLinkedDataOptions } = require("@hellotest/platform/backend/src/utils/linkedManualParameters");
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
  return hookArray(value).map(hook => ({ ...hook, steps: Array.isArray(hook.steps) ? hook.steps.map(step => {
    const shared = redactSharedStepData(step);
    const names = sourcePrivateNames(step.source_case_parameters,step.source_case_parameter_sensitive_names);
    const redact = values => Object.fromEntries(Object.entries(parse(values,{})).filter(([name]) => !names.has(normalizeParameterKey(name,'t'))));
    const {source_case_context:privateContext,...visibleShared}=shared;
    return {...visibleShared,source_case_parameters:redact(step.source_case_parameters),source_case_parameter_templates:redact(step.source_case_parameter_templates),source_case_parameter_sensitive_names:[...names].sort()};
  }) : [] }));
}

function sourcePrivateNames(values={},names=[]) {
  const entries=Object.entries(normalizeParameterLayer(parse(values,{}),'t'));
  const hidden=new Set((Array.isArray(names)?names:[]).map(name=>normalizeParameterKey(name,'t')));
  for(const [name]of entries)if(/password|secret|token|credential|api.?key|passcode|(?:^|[._ -])pin(?:$|[._ -])|otp|verification.?code|one.?time.?code/i.test(name))hidden.add(name);
  const privateValues=new Set(entries.filter(([name,value])=>hidden.has(name)&&value!=='').map(([,value])=>value));
  for(const [name,value]of entries)if(value!==''&&privateValues.has(value))hidden.add(name);
  return hidden;
}

// Reruns reuse frozen source code and regenerate data from the frozen templates.
function regenerateExecutionHooks(value) {
  const caseValues = new Map(), sourceContexts = new Map();
  return hookArray(value).map(hook => ({ ...hook, steps: regenerateSharedStepData(Array.isArray(hook.steps) ? hook.steps : []).map(step => {
    const templates = normalizeParameterLayer(parse(step.source_case_parameter_templates || step.source_case_parameters, {}), "t");
    const key = `${step.test_case_id || step.id}:${JSON.stringify(templates)}`;
    if (!caseValues.has(key)) caseValues.set(key, materializeParameterValues(templates));
    const context=step.source_case_context;
    if(context && !sourceContexts.has(step.test_case_id))sourceContexts.set(step.test_case_id,{...context,
      case_parameters:materializeParameterValues(context.case_parameter_templates || context.case_parameters),
      suite_parameters:materializeParameterValues(context.suite_parameter_templates || context.suite_parameters),
      data_set:materializeDataSetSnapshot(context.data_set)});
    return { ...step, source_case_parameter_templates: templates, source_case_parameters: context ? sourceContexts.get(step.test_case_id).case_parameters : caseValues.get(key),
      ...(context?{source_case_context:sourceContexts.get(step.test_case_id)}:{}) };
  }) }));
}

/** Freeze hook code at run creation; hooks do not need to be regular run members. */
async function snapshotExecutionHooks(hooks, { projectId, appTypeId, userId, ownerCaseId = null }) {
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
    const resolvedIds = new Set(), sourceOrder = new Map();
    // Shared source locks are compatible across runs. Acquire each selection
    // in deterministic order while preserving the configured execution order.
    for (const id of [...ids].sort()) {
      let row = await db.prepare(`SELECT tc.id, tc.title, tc.automated, tc.app_type_id, tc.parameter_values, tc.test_data_options, tc.execution_hooks FROM test_cases tc JOIN app_types a ON a.id = tc.app_type_id
        WHERE tc.id = ? AND a.project_id = ? AND tc.app_type_id = ? FOR SHARE OF tc,a`).get(id, projectId, appTypeId);
      if (!row) throw invalid("Hook source must belong to the current project and application.");
      // A manual source is an authoring reference. Execute its linked native
      // automation case, retaining that case's overrides and linked defaults.
      if (row.automated !== 'yes') {
        const linked = await db.prepare(`SELECT DISTINCT target.id, target.title, target.automated, target.app_type_id,
          target.parameter_values, target.test_data_options, target.execution_hooks
          FROM test_cases target JOIN app_types app ON app.id = target.app_type_id
          WHERE target.automated = 'yes' AND target.app_type_id = ? AND app.project_id = ?
            AND (target.manual_test_case_id = ? OR EXISTS (SELECT 1 FROM automation_case_links link
              WHERE link.automation_test_case_id = target.id AND link.manual_test_case_id = ?)) ORDER BY target.id`).all(appTypeId, projectId, id, id);
        if (linked.length > 1) throw invalid('This Before / After manual case has multiple linked automation cases. Select the intended automation case directly.');
        if (linked.length === 1) {
          row = await db.prepare(`SELECT tc.id, tc.title, tc.automated, tc.app_type_id, tc.parameter_values, tc.test_data_options, tc.execution_hooks
            FROM test_cases tc JOIN app_types a ON a.id = tc.app_type_id
            WHERE tc.id = ? AND a.project_id = ? AND tc.app_type_id = ? AND tc.automated = 'yes'
              AND (tc.manual_test_case_id = ? OR EXISTS (SELECT 1 FROM automation_case_links link WHERE link.automation_test_case_id = tc.id AND link.manual_test_case_id = ?))
            FOR SHARE OF tc,a`).get(linked[0].id, projectId, appTypeId, id, id);
          if (!row) throw invalid('The linked Before / After automation changed while this run was being created. Refresh the source selection.');
        }
      }
      if (ownerCaseId && row.id === ownerCaseId) throw Object.assign(invalid('A case cannot run itself through its Before / After sources.'),{code:'AUTOMATION_CASE_HOOK_CYCLE'});
      if (parse(row.execution_hooks, []).length) throw Object.assign(invalid('This Before / After source has its own setup or teardown cases. Select a source without nested hooks; nested hook scheduling is not supported.'),{code:'AUTOMATION_CASE_HOOK_NESTED_UNSUPPORTED'});
      sourceOrder.set(row.id,Math.min(sourceOrder.get(row.id) ?? Number.MAX_SAFE_INTEGER,ids.indexOf(id)));
      if (resolvedIds.has(row.id)) continue;
      resolvedIds.add(row.id);
      cases.push(row);
    }
    cases.sort((left,right)=>sourceOrder.get(left.id)-sourceOrder.get(right.id));
    const byCase = await loadSteps(cases.map(source => source.id));
    const sourceContexts=await require("./execution.service").freezeHookSourceData(cases,{projectId,appTypeId,userId});
    const steps = cases.flatMap((source) => {
      const context=sourceContexts.get(source.id);
      const templates = normalizeParameterLayer(context?.case_parameter_templates || parse(source.parameter_values, {}), "t");
      const parameters = context?.case_parameters || materializeParameterValues(templates);
      const options = context?.data_policy?.case || effectiveLinkedDataOptions(source);
      const sensitiveNames=[...sourcePrivateNames(parameters,options.private_parameter_names)].sort();
      const sourceSteps = byCase.get(source.id) || [];
      if (!sourceSteps.length) throw invalid(`Hook source ${source.title || source.id} has no executable steps.`);
      return sourceSteps.map(step => ({ ...step, source_case_parameter_templates: templates, source_case_parameters: parameters, source_case_test_data_options: options, source_case_parameter_sensitive_names:sensitiveNames, source_case_context:sourceContexts.get(source.id) }));
    });
    if (steps.length > 500 || steps.some((step) => step.step_type === "api" ? !step.api_request : !String(step.automation_code || "").trim())) throw invalid(`Hook ${hook.name || targetId} contains missing automation. Build and review the source case first.`);
    result.push({ ...hook, id, target_id: targetId, target_kind: kind, resolved_test_case_ids:cases.map(source => source.id), fail_behavior: failBehavior, execution_order: index + 1,
      steps: steps.map((step, stepIndex) => ({ ...step, order: stepIndex + 1 })) });
  }
  return result;
}
module.exports = { snapshotExecutionHooks, redactExecutionHooks, regenerateExecutionHooks };
