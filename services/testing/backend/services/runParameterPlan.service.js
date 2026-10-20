const { normalizeDataOptions, dataOptionsForCase, composeScopedTestData, sharedParameterNames, allowsDataParameter } = require("@hellotest/platform/backend/src/utils/scopedTestData");
const db = require("@hellotest/platform/backend/src/db");
const { expandSuiteSelection, loadSuiteContexts } = require("./suiteExecutionContext.service");
const { preserveFrozenRunParameters, canonicalLegacyData } = require("@hellotest/platform/backend/src/utils/frozenRunParameterCompatibility");
const { normalizeParameterKey } = require("@hellotest/platform/backend/src/utils/stepParameterResolution");
const { loadEffectiveCaseDataSets, frozenCaseDataSet, caseDataSetResource } = require('./effectiveCaseDataSets.service');

const { collectCaseParameterNames, tokenFor } = require("@hellotest/platform/backend/src/utils/parameterNames");

const parsed = (value, fallback = {}) => {
  if (value == null || value === "") return fallback;
  try { return typeof value === "string" ? JSON.parse(value) : value; } catch { return fallback; }
};
const rowsFor = data => data ? data.mode === "key_value" ? 1 : Math.max(1, (data.rows || []).length) : 1;
const dataKeys = data => !data ? [] : data.mode === "key_value" ? parsed(data.rows, []).map(row => row.key) : parsed(data.columns, []);

// Validation compares names, never parameter values. An explicitly blank cell
// is valid input; a missing column is not. Key/value data is one iteration.
function validateDataSetParameters(data, parameters = []) {
  if (!data) return null;
  const required = [...new Set(parameters.map(item => normalizeParameterKey(typeof item === "string" ? item : item.name)).filter(Boolean))].sort();
  const available = [...new Set(dataKeys(data).map(key => normalizeParameterKey(key)).filter(Boolean))].sort();
  const availableSet = new Set(available);
  const missing = required.filter(name => !availableSet.has(name));
  const rows = parsed(data.rows, []);
  const iterationCount = data.mode === "key_value" ? Number(rows.some(row => row?.key)) : rows.length;
  return { valid: !missing.length && iterationCount > 0, data_set_id: data.id || null,
    required_parameters: required, available_parameters: available, missing_parameters: missing,
    iteration_count: iterationCount, ...(!iterationCount ? { reason: "Add at least one data row before linking this data set." } : {}) };
}

function assertDataSetValidation(validation) {
  if (!validation || validation.valid) return;
  const missing = validation.missing_parameters;
  const message = missing.length
    ? `The selected data set is missing required parameters: ${missing.slice(0, 12).map(tokenFor).join(", ")}${missing.length > 12 ? ` and ${missing.length - 12} more` : ""}. Download the current template or adjust the override options.`
    : validation.reason;
  throw Object.assign(new Error(message), { statusCode: 422, code: missing.length ? "TEST_DATA_MISSING_PARAMETERS" : "TEST_DATA_EMPTY",
    missing_parameters: missing, data_set_validation: validation });
}

async function buildRunParameterPlan(input) {
  const { project_id, app_type_id, execution_id } = input;
  const dataScope = input.data_scope === "suite" ? "s" : "r";
  const has = key => Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined;
  const app = await db.prepare("SELECT id FROM app_types WHERE id = ? AND project_id = ?").get(app_type_id, project_id);
  if (!app) throw Object.assign(new Error("Select an application in this project."), { statusCode: 400 });
  const suiteContextId = input.suite_context_id || null;
  if (suiteContextId && dataScope !== "s") throw Object.assign(new Error("Suite context is only available for Suite data templates."), { statusCode: 400 });
  const suiteContext = suiteContextId ? await db.prepare("SELECT id, test_data_options FROM test_suites WHERE id = ? AND app_type_id = ?").get(suiteContextId, app_type_id) : null;
  if (suiteContextId && !suiteContext) throw Object.assign(new Error("The Suite context is unavailable in this application."), { statusCode: 404 });
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
  const liveCaseIds = new Set(liveCases.map(item => item.id));
  const linkedParameters=await require('./linkedManualParameters.service').resolveForCases(liveCases,{projectId:project_id});
  if (addedDirectIds.some(id => !liveCaseIds.has(id))) throw Object.assign(new Error("All cases must belong to the selected application."), { statusCode: 400 });
  const allIds = [...new Set([...existingById.keys(), ...liveCases.map(item => item.id)])];
  const [rawLiveSteps, mappings, linkedData] = await Promise.all([
    db.prepare("SELECT * FROM test_steps WHERE test_case_id IN (SELECT jsonb_array_elements_text(?::jsonb)) ORDER BY test_case_id, step_order").all(liveCases.map(item => item.id)),
    db.prepare(`SELECT mapping.suite_id, mapping.test_case_id FROM suite_test_cases mapping JOIN test_suites suite ON suite.id = mapping.suite_id
      WHERE mapping.test_case_id IN (SELECT jsonb_array_elements_text(?::jsonb)) AND suite.app_type_id = ? ORDER BY mapping.sort_order, suite.created_at DESC, suite.id`).all(allIds, app_type_id),
    loadEffectiveCaseDataSets({ testCaseIds: liveCases.filter(item => !existingById.has(item.id)).map(item => item.id), projectId: project_id, appTypeId: app_type_id })
  ]);
  const liveSteps = await require("./sharedStepDataSnapshot.service").freezeSharedStepData(rawLiveSteps.map(step => ({ ...step, app_type_id })), { materialize: false });
  const suitesByCase = new Map();
  for (const row of mappings) { if (!suitesByCase.has(row.test_case_id)) suitesByCase.set(row.test_case_id, []); suitesByCase.get(row.test_case_id).push(row.suite_id); }
  const retainedSuiteIds = suiteIds.filter(id => oldSuiteIds.has(id));
  const retained = existingCases.filter(item => retainedSuiteIds.includes(item.suite_id) || direct.includes(item.test_case_id)
    || (suitesByCase.get(item.test_case_id) || []).some(id => retainedSuiteIds.includes(id)));
  const desired = new Map();
  for (const item of liveCases) {
    const memberships = suitesByCase.get(item.id) || [];
    const suiteId = dataScope === "s" && direct.includes(item.id) ? suiteContextId
      : addedSuiteIds.find(id => memberships.includes(id)) || (dataScope === "s" ? null : memberships[0]) || null;
    desired.set(item.id, { test_case_id: item.id, test_case_title: item.title, suite_id: suiteId,
      parameter_values: linkedParameters.get(item.id)?.effective_parameter_values||parsed(item.parameter_values), test_data_options: require('@hellotest/platform/backend/src/utils/linkedManualParameters').effectiveLinkedDataOptions(item,linkedParameters.get(item.id)), authoring_mode: item.authoring_mode, gherkin_document: item.gherkin_document });
  }
  for (const item of retained) desired.set(item.test_case_id, { ...item,
    suite_id: suiteIds.includes(item.suite_id) ? item.suite_id : (suitesByCase.get(item.test_case_id) || []).find(id => retainedSuiteIds.includes(id)) || item.suite_id });
  // A previously frozen case entering through a new suite still retains its
  // existing step/data snapshots; the edit changes only its suite association.
  for (const [id, item] of desired) if (existingById.has(id)) {
    const saved = existingById.get(id);
    desired.set(id, { ...saved, suite_id: suiteIds.includes(saved.suite_id) ? saved.suite_id : item.suite_id });
  }
  const dataOptions = normalizeDataOptions(input.test_data_options ?? execution?.test_data_options ?? suiteContext?.test_data_options);
  const contextOverrides = new Map();
  if (suiteContextId) contextOverrides.set(suiteContextId, {
    ...(has("test_data_set_id") ? { test_data_set_id: input.test_data_set_id || null } : {}),
    ...(has("test_data_options") ? { test_data_options: dataOptions } : {}),
    ...(has("parameter_values") ? { parameter_values: input.parameter_values } : {})
  });
  const dataChanged = Boolean(execution && ((has("test_data_set_id") && (input.test_data_set_id || null) !== (execution.test_data_set_id || null))
    || JSON.stringify(dataOptions) !== JSON.stringify(normalizeDataOptions(execution.test_data_options))));
  const liveContextIds = [...new Set([...addedSuiteIds, suiteContextId,
    ...[...desired.values()].filter(item => !existingById.has(item.test_case_id) || dataChanged).map(item => item.suite_id)
  ].filter(Boolean))];
  const contexts = await loadSuiteContexts(liveContextIds, contextOverrides);
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
  const linkedDataByCase = new Map();
  for (const row of linkedData) linkedDataByCase.set(row.test_case_id, caseDataSetResource(row));
  const effective = [...desired.values()].map(item => {
    const caseOptions = normalizeDataOptions(item.test_data_options, parsed(item.test_data_options).shared_data_kind
      || ((stepsByCase.get(item.test_case_id) || []).some(step => step.automation_code || step.api_request) ? "sections" : "steps"));
    const frozen = existingById.has(item.test_case_id);
    const context = contexts.get(item.suite_id);
    const composed = frozen && !dataChanged ? null : composeScopedTestData({ hierarchical: true,
      caseData: frozen ? frozenCaseDataSet(item) : linkedDataByCase.get(item.test_case_id),
      caseOptions,
      suiteData: dataScope === "s" && !item.suite_id ? selectedResources.test_data_set_id : context?.dataSet,
      runData: dataScope === "r" ? selectedResources.test_data_set_id : null,
      suiteOptions: dataScope === "s" && !item.suite_id ? dataOptions : context?.dataOptions,
      runOptions: dataOptions, sharedNames: sharedParameterNames(stepsByCase.get(item.test_case_id) || [])
    });
    return { ...item,
      test_data_options: frozen && !dataChanged ? { ...item.test_data_options, shared_data_kind: caseOptions.shared_data_kind } : { ...normalizeDataOptions(item.test_data_options), shared_data_kind: caseOptions.shared_data_kind, runtime_policy: {
        version: 2, case: caseOptions, suite: dataOptionsForCase(dataScope === "s" && !item.suite_id ? dataOptions : context?.dataOptions, caseOptions), run: dataOptionsForCase(dataOptions, caseOptions)
      } },
      suite_parameter_values: frozen ? parsed(item.suite_parameter_values) : contexts.get(item.suite_id)?.parameters || {},
      test_data_set_snapshot: frozen && !dataChanged ? parsed(item.test_data_set_snapshot, null) : composed.snapshot
    };
  });
  const envelope = preserveFrozenRunParameters({ parameter_scope_default: execution?.parameter_scope_default || "r", case_snapshots: effective,
    step_snapshots: effective.flatMap(item => stepsByCase.get(item.test_case_id) || []) });
  const effectiveSteps = new Map();
  for (const step of envelope.step_snapshots) { if (!effectiveSteps.has(step.test_case_id)) effectiveSteps.set(step.test_case_id, []); effectiveSteps.get(step.test_case_id).push(step); }
  const declarations = new Map();
  const ownershipByCase = new Map();
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
    const layers = item.test_data_set_snapshot?.parameter_data_layers;
    const layerKeys = layer => (layer?.rows || []).flatMap(row => Object.keys(row));
    const caseDataKeys = layers ? layerKeys(layers.case) : frozen
      ? item.data_set_source === "test_case" ? dataKeys(item.test_data_set_snapshot) : [] : dataKeys(linkedDataByCase.get(item.test_case_id));
    const suiteDataKeys = layers ? layerKeys(layers.suite) : frozen
      ? item.data_set_source === "suite" ? dataKeys(item.test_data_set_snapshot) : [] : dataKeys(contexts.get(item.suite_id)?.dataSet);
    ownershipByCase.set(item.test_case_id, {
      caseNames: new Set([...Object.keys(parsed(item.parameter_values)), ...caseDataKeys].map(key => normalizeParameterKey(key))),
      suiteNames: new Set([...Object.keys(parsed(item.suite_parameter_values)).map(key => normalizeParameterKey(key, "s")), ...suiteDataKeys.map(key => normalizeParameterKey(key))]),
      sharedNames: sharedParameterNames(steps), caseOptions: normalizeDataOptions(item.test_data_options),
      ordinaryNames: new Set([...collectCaseParameterNames(authored, steps.filter(step => !step.reusable_group_id && step.group_kind !== "reusable")),
        ...caseDataKeys.map(key => normalizeParameterKey(key)), ...suiteDataKeys.map(key => normalizeParameterKey(key)),
        ...Object.keys(parsed(item.suite_parameter_values)).map(key => normalizeParameterKey(key, "s"))])
    });
    for (const name of collectCaseParameterNames(authored, steps)) register(name, item.test_case_id);
    for (const step of steps) for (const key of Object.keys(step.shared_parameter_values || {})) register(key, item.test_case_id);
    for (const key of Object.keys(item.suite_parameter_values || {})) register(key, item.test_case_id, "s");
    for (const key of dataKeys(item.test_data_set_snapshot)) register(key, item.test_case_id);
    expectedInstances += rowsFor(item.test_data_set_snapshot);
  }
  for (const suiteId of [...addedSuiteIds, suiteContextId].filter(Boolean)) for (const key of Object.keys(contexts.get(suiteId)?.parameters || {})) register(key, null, "s");
  for (const key of Object.keys(parsed(has("parameter_values") ? input.parameter_values : execution?.parameter_values))) register(key, null, dataScope);
  for (const [field, resource] of Object.entries(selectedResources)) {
    const data = field === "test_data_set_id" && execution?.parameter_scope_default === "t" ? canonicalLegacyData(resource) : resource;
    for (const key of field === "test_data_set_id" ? dataKeys(data) : (data?.variables || []).map(row => row.key)) register(key);
  }
  const sharedNames = sharedParameterNames(envelope.step_snapshots);
  const allowsDeclaration = (name, ids) => {
    if (!ids.size) return allowsDataParameter(name, dataScope, dataOptions, sharedNames);
    return [...ids].some(id => {
      const owner = ownershipByCase.get(id);
      const allowsTarget = isShared => {
        if (isShared && !dataOptionsForCase(dataOptions, owner?.caseOptions).override_shared_steps) return false;
        if (!dataOptions.override_test_case_data && (name.startsWith("t.") || owner?.caseNames.has(name))
          && !(isShared && owner?.caseOptions.override_shared_steps === false)) return false;
        return dataScope !== "r" || dataOptions.override_suite_data || !(name.startsWith("s.") || owner?.suiteNames.has(name));
      };
      return (owner?.ordinaryNames.has(name) && allowsTarget(false))
        || (owner?.sharedNames.has(name) && allowsTarget(true))
        || (!owner?.ordinaryNames.has(name) && !owner?.sharedNames.has(name) && allowsTarget(false));
    });
  };
  const parameters = [...declarations].filter(([name, ids]) => allowsDeclaration(name, ids)).sort(([a], [b]) => a.localeCompare(b)).map(([name, ids]) => ({ name, token: tokenFor(name), scope: name[0], case_count: ids.size }));
  const validationData = execution?.parameter_scope_default === "t" ? canonicalLegacyData(selectedResources.test_data_set_id) : selectedResources.test_data_set_id;
  return { shared_group_kinds: [...new Set(effective.map(item => normalizeDataOptions(item.test_data_options).shared_data_kind || "steps"))], expected_instance_count: expectedInstances, case_count: effective.length, suite_count: suiteIds.length, suite_ids: suiteIds,
    parameters, data_set_validation: validateDataSetParameters(validationData, parameters) };
}

async function assertRunDataSetCompatible(input) {
  const plan = await buildRunParameterPlan(input);
  assertDataSetValidation(plan.data_set_validation);
  return plan;
}

module.exports = { buildRunParameterPlan, assertRunDataSetCompatible, validateDataSetParameters, assertDataSetValidation, collectCaseParameterNames, tokenFor };
