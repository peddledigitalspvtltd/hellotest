const db = require("../db");
const { expandSuiteSelection, loadSuiteContexts } = require("./suiteExecutionContext.service");
const { preserveFrozenRunParameters, canonicalLegacyData } = require("../utils/frozenRunParameterCompatibility");
const { normalizeParameterKey } = require("../utils/stepParameterResolution");

const PARAMETER = /(?<![A-Za-z0-9_])@(?:(t|s|r)\.)?(\[(?:\\.|[^\]\\\r\n])+\]|[A-Za-z][A-Za-z0-9_-]*)/gi;
const tokenFor = name => {
  const raw = name.slice(2);
  return `@${name.slice(0, 2)}${/^[a-z][a-z0-9_-]*$/i.test(raw) ? raw : `[${raw.replace(/\\/g, "\\\\").replace(/\]/g, "\\]")}]`}`;
};

function collectCaseParameterNames(item, steps = []) {
  const names = new Set(Object.keys(item.parameter_values || {}).map(key => normalizeParameterKey(key)));
  const addText = (text, gherkin = false) => {
    let source = String(text || "");
    if (gherkin) source = source.split("\n").filter(line => !/^\s*[@#]/.test(line)).join("\n")
      .replace(/<([A-Za-z][A-Za-z0-9_.-]*)>/g, (_, name) => `@${name}`);
    for (const match of source.matchAll(PARAMETER)) {
      if (!match[1] && /^[tsr]$/i.test(match[2]) && source[(match.index || 0) + match[0].length] === ".") continue;
      names.add(normalizeParameterKey(match[0]));
    }
  };
  const gherkin = item.authoring_mode === "gherkin";
  addText(item.title, gherkin); addText(item.gherkin_document, true);
  for (const step of steps) {
    addText(step.action, gherkin); addText(step.expected_result, gherkin); addText(step.automation_code);
    const api = step.api_request || {};
    addText(api.url); addText(api.body);
    for (const row of api.headers || []) { addText(row.key); addText(row.value); }
    for (const row of api.validations || []) { addText(row.target); addText(row.expected); }
    // Captures supply output after a step; they are not required input columns.
  }
  names.delete("");
  return [...names];
}

const parsed = (value, fallback = {}) => {
  if (value == null || value === "") return fallback;
  try { return typeof value === "string" ? JSON.parse(value) : value; } catch { return fallback; }
};
const rowsFor = data => data ? data.mode === "key_value" ? 1 : Math.max(1, (data.rows || []).length) : 1;
const dataKeys = data => !data ? [] : data.mode === "key_value" ? (data.rows || []).map(row => row.key) : data.columns || [];

async function buildRunParameterPlan(input) {
  const { project_id, app_type_id, execution_id } = input;
  const has = key => Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined;
  const app = await db.prepare("SELECT id FROM app_types WHERE id = ? AND project_id = ?").get(app_type_id, project_id);
  if (!app) throw Object.assign(new Error("Select an application in this project."), { statusCode: 400 });
  const execution = execution_id ? await db.prepare("SELECT * FROM executions WHERE id = ? AND project_id = ? AND app_type_id = ?")
    .get(execution_id, project_id, app_type_id) : null;
  if (execution_id && !execution) throw Object.assign(new Error("The run is unavailable in this application."), { statusCode: 404 });
  const [existingCases, existingSteps, existingSuites] = execution ? await Promise.all([
    db.prepare("SELECT * FROM execution_case_snapshots WHERE execution_id = ? ORDER BY sort_order, test_case_id").all(execution_id),
    db.prepare("SELECT * FROM execution_step_snapshots WHERE execution_id = ? ORDER BY test_case_id, step_order").all(execution_id),
    db.prepare("SELECT suite_id FROM execution_suites WHERE execution_id = ?").all(execution_id)
  ]) : [[], [], []];
  const existingById = new Map(existingCases.map(item => [item.test_case_id, item]));
  const oldSuiteIds = new Set(existingSuites.map(item => item.suite_id));
  const requestedSuites = [...new Set(input.suite_ids || [])];
  const suiteIds = execution
    ? !has("suite_ids") ? [...oldSuiteIds] : [...new Set([
      ...requestedSuites.filter(id => oldSuiteIds.has(id)),
      ...await expandSuiteSelection(requestedSuites.filter(id => !oldSuiteIds.has(id)), app_type_id)
    ])]
    : await expandSuiteSelection(requestedSuites, app_type_id);
  const direct = [...new Set(has("test_case_ids") ? input.test_case_ids || [] : execution
    ? execution.direct_test_case_ids == null ? existingCases.filter(item => !oldSuiteIds.has(item.suite_id)).map(item => item.test_case_id) : parsed(execution.direct_test_case_ids, []) : [])];
  const addedSuiteIds = execution ? suiteIds.filter(id => !oldSuiteIds.has(id)) : suiteIds;
  const addedDirectIds = execution ? direct.filter(id => !existingById.has(id)) : direct;
  // Existing suites keep their saved membership. Only newly selected suites and
  // direct cases query current authoring, matching updateExecution's merge.
  const liveCases = await db.prepare(`SELECT DISTINCT c.* FROM test_cases c
    WHERE COALESCE(c.app_type_id, (SELECT app_type_id FROM test_suites WHERE id = c.suite_id)) = ? AND (c.id IN (SELECT jsonb_array_elements_text(?::jsonb))
      OR c.id IN (SELECT test_case_id FROM suite_test_cases WHERE suite_id IN (SELECT jsonb_array_elements_text(?::jsonb)))) ORDER BY c.id`)
    .all(app_type_id, addedDirectIds, addedSuiteIds);
  if (addedDirectIds.some(id => !liveCases.some(item => item.id === id))) throw Object.assign(new Error("All cases must belong to the selected application."), { statusCode: 400 });
  const allIds = [...new Set([...existingById.keys(), ...liveCases.map(item => item.id)])];
  const [liveSteps, mappings, linkedData] = await Promise.all([
    db.prepare("SELECT * FROM test_steps WHERE test_case_id IN (SELECT jsonb_array_elements_text(?::jsonb)) ORDER BY test_case_id, step_order").all(liveCases.map(item => item.id)),
    db.prepare(`SELECT mapping.suite_id, mapping.test_case_id FROM suite_test_cases mapping JOIN test_suites suite ON suite.id = mapping.suite_id
      WHERE mapping.test_case_id IN (SELECT jsonb_array_elements_text(?::jsonb)) AND suite.app_type_id = ? ORDER BY mapping.sort_order, suite.created_at DESC, suite.id`).all(allIds, app_type_id),
    db.prepare(`SELECT mapping.test_case_id, row_to_json(data) AS data_set
      FROM test_case_data_sets mapping JOIN test_data_sets data ON data.id = mapping.test_data_set_id
      WHERE mapping.test_case_id IN (SELECT jsonb_array_elements_text(?::jsonb)) AND data.project_id = ?
        AND (data.app_type_id IS NULL OR data.app_type_id = ?) ORDER BY mapping.sort_order, mapping.test_data_set_id`).all(allIds, project_id, app_type_id)
  ]);
  const suitesByCase = new Map();
  for (const row of mappings) { if (!suitesByCase.has(row.test_case_id)) suitesByCase.set(row.test_case_id, []); suitesByCase.get(row.test_case_id).push(row.suite_id); }
  const retainedSuiteIds = suiteIds.filter(id => oldSuiteIds.has(id));
  const retained = existingCases.filter(item => retainedSuiteIds.includes(item.suite_id) || direct.includes(item.test_case_id)
    || (suitesByCase.get(item.test_case_id) || []).some(id => retainedSuiteIds.includes(id)));
  const desired = new Map();
  for (const item of liveCases) {
    const memberships = suitesByCase.get(item.id) || [];
    const suiteId = addedSuiteIds.find(id => memberships.includes(id)) || memberships[0] || null;
    desired.set(item.id, { test_case_id: item.id, test_case_title: item.title, suite_id: suiteId,
      parameter_values: parsed(item.parameter_values), authoring_mode: item.authoring_mode, gherkin_document: item.gherkin_document });
  }
  for (const item of retained) desired.set(item.test_case_id, { ...item,
    suite_id: suiteIds.includes(item.suite_id) ? item.suite_id : (suitesByCase.get(item.test_case_id) || []).find(id => retainedSuiteIds.includes(id)) || item.suite_id });
  // A previously frozen case entering through a new suite still retains its
  // existing step/data snapshots; the edit changes only its suite association.
  for (const [id, item] of desired) if (existingById.has(id)) {
    const saved = existingById.get(id);
    desired.set(id, { ...saved, suite_id: suiteIds.includes(saved.suite_id) ? saved.suite_id : item.suite_id });
  }
  const contexts = await loadSuiteContexts([...addedSuiteIds, ...[...desired.values()].filter(item => !existingById.has(item.test_case_id)).map(item => item.suite_id)]);
  const dataChanged = Boolean(execution && has("test_data_set_id") && (input.test_data_set_id || null) !== (execution.test_data_set_id || null));
  const selectedResources = {};
  for (const [table, field] of [["test_environments", "test_environment_id"], ["test_configurations", "test_configuration_id"], ["test_data_sets", "test_data_set_id"]]) {
    const id = has(field) ? input[field] || null : execution?.[field] || null;
    if (!id) { selectedResources[field] = null; continue; }
    if (execution && id === execution[field]) {
      selectedResources[field] = parsed(execution[field.replace(/_id$/, "_snapshot")], null);
      continue;
    }
    const resource = await db.prepare(`SELECT * FROM ${table} WHERE id = ? AND project_id = ? AND (app_type_id IS NULL OR app_type_id = ?)`)
      .get(id, project_id, app_type_id);
    if (!resource) throw Object.assign(new Error("A selected context resource is unavailable in this application."), { statusCode: 400 });
    selectedResources[field] = resource;
  }
  const stepsByCase = new Map();
  for (const step of [...liveSteps.filter(item => !existingById.has(item.test_case_id)), ...existingSteps]) {
    if (!stepsByCase.has(step.test_case_id)) stepsByCase.set(step.test_case_id, []);
    stepsByCase.get(step.test_case_id).push(step);
  }
  const effective = [...desired.values()].map(item => {
    const frozen = existingById.has(item.test_case_id);
    const inheritedData = contexts.get(item.suite_id)?.dataSet || linkedData.find(row => row.test_case_id === item.test_case_id)?.data_set || null;
    return { ...item,
      suite_parameter_values: frozen ? parsed(item.suite_parameter_values) : contexts.get(item.suite_id)?.parameters || {},
      test_data_set_snapshot: frozen && !dataChanged ? parsed(item.test_data_set_snapshot, null) : selectedResources.test_data_set_id || inheritedData
    };
  });
  const envelope = preserveFrozenRunParameters({ parameter_scope_default: execution?.parameter_scope_default || "r", case_snapshots: effective,
    step_snapshots: effective.flatMap(item => stepsByCase.get(item.test_case_id) || []) });
  const effectiveSteps = new Map();
  for (const step of envelope.step_snapshots) { if (!effectiveSteps.has(step.test_case_id)) effectiveSteps.set(step.test_case_id, []); effectiveSteps.get(step.test_case_id).push(step); }
  const declarations = new Map();
  const register = (key, caseId, fallback = "r") => {
    const name = normalizeParameterKey(key, fallback);
    if (!name) return;
    if (!declarations.has(name)) declarations.set(name, new Set());
    if (caseId) declarations.get(name).add(caseId);
  };
  let expectedInstances = 0;
  for (const item of envelope.case_snapshots) {
    const steps = effectiveSteps.get(item.test_case_id) || [];
    const frozen = existingById.has(item.test_case_id);
    const authored = { ...item, title: item.test_case_title, authoring_mode: frozen ? steps.some(step => /^\s*(Given|When|Then|And|But)\b/i.test(step.action || "")) ? "gherkin" : "structured" : item.authoring_mode };
    for (const name of collectCaseParameterNames(authored, steps)) register(name, item.test_case_id);
    for (const key of Object.keys(item.suite_parameter_values || {})) register(key, item.test_case_id, "s");
    for (const key of dataKeys(item.test_data_set_snapshot)) register(key, item.test_case_id);
    expectedInstances += rowsFor(item.test_data_set_snapshot);
  }
  for (const suiteId of addedSuiteIds) for (const key of Object.keys(contexts.get(suiteId)?.parameters || {})) register(key, null, "s");
  for (const key of Object.keys(parsed(execution?.parameter_values))) register(key);
  for (const [field, resource] of Object.entries(selectedResources)) {
    const data = field === "test_data_set_id" && execution?.parameter_scope_default === "t" ? canonicalLegacyData(resource) : resource;
    for (const key of field === "test_data_set_id" ? dataKeys(data) : (data?.variables || []).map(row => row.key)) register(key);
  }
  return { expected_instance_count: expectedInstances, case_count: effective.length, suite_count: suiteIds.length, suite_ids: suiteIds,
    parameters: [...declarations].sort(([a], [b]) => a.localeCompare(b)).map(([name, ids]) => ({ name, token: tokenFor(name), scope: name[0], case_count: ids.size })) };
}

module.exports = { buildRunParameterPlan, collectCaseParameterNames, tokenFor };
