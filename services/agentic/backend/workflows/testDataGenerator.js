const dataSets = require('@hellotest/testing/backend/services/testDataSet.service');
const syntheticData = require('@hellotest/ai/backend/services/aiTestDataGeneration.service');
const { normalizeParameterLayer, normalizeParameterKey } = require('@hellotest/platform/backend/src/utils/stepParameterResolution');
const { referenceKey, createBrowserParameterResolver } = require('@hellotest/automation/backend/lib/automationBrowserParameters');
const { fail } = require('./connections');
const TASK_DEFAULTS = require('../../shared/workflowNativeTasks.json');
const WORKSPACE_SPECIALIST = TASK_DEFAULTS['test-data-generator'].workspaceSpecialist;
const MAX_CASE_PARAMETERS = 100;
const assertActive = signal => { if (signal?.aborted) throw fail('Workflow cancelled.', 499); };

const SENSITIVE = /password|passwd|secret|token|credential|api.?key|authorization|cookie|session|csrf|xsrf|private.?key|passcode|(?:^|[._ -])pin(?:$|[._ -])|otp|verification.?code|one.?time.?code/i;
const PLACEHOLDER = /^\[\s*(?:missing|required)\s*:[^\]\r\n]*\]$/i;
const asObject = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const normalizeName = value => String(value || '').trim().replace(/^@/, '').replace(/^[tsr]\./i, '').toLowerCase();
const scopedName = value => `t.${String(value || '').trim().replace(/^@/, '').replace(/^t\./i, '')}`;

function validateNodeOptions(data = {}) {
  const source = data.testDataSource ?? 'synthetic';
  if (!['synthetic', 'dataset'].includes(source)) throw fail('Choose synthetic data or a linked Test Data Set.', 422);
  const id = data.testDataSetId;
  if (source === 'dataset' && (typeof id !== 'string' || !/^[\w-]{1,255}$/.test(id))) throw fail('Choose a Test Data Set for dataset mode.', 422);
  if (id != null && id !== '' && (typeof id !== 'string' || !/^[\w-]{1,255}$/.test(id))) throw fail('Choose a valid Test Data Set.', 422);
  return { source, dataSetId: source === 'dataset' ? id : null };
}

function promptGuidance(node = {}) {
  const data = node.data || {};
  const defaults = TASK_DEFAULTS['test-data-generator'];
  const skill = WORKSPACE_SPECIALIST.skills?.find(item => item.id === 'builtin-test-data-generator');
  return [
    ['Task', data.task ?? defaults.task], ['Instructions', data.instructions ?? defaults.instructions],
    ['Workspace specialist', WORKSPACE_SPECIALIST.prompt], ['Workspace specialist skill', skill?.instructions],
    ['Guardrails', data.guardrails ?? defaults.guardrails],
  ].filter(([, value]) => typeof value === 'string' && value.trim())
    .map(([label, value]) => `${label}:\n${value.trim()}`).join('\n\n');
}

async function loadDataSet({ run, node, user, access }) {
  const options = validateNodeOptions(node.data);
  if (!options.dataSetId) return null;
  await access(user, run.project_id, ['data.view']);
  const dataSet = await dataSets.getTestDataSet(options.dataSetId);
  if (dataSet.project_id !== run.project_id || dataSet.app_type_id && dataSet.app_type_id !== run.app_type_id) {
    throw fail('The selected Test Data Set must belong to the workflow project and selected application.', 403);
  }
  return dataSet;
}

function caseParameterReferences(draft, steps) {
  const values = normalizeParameterLayer(asObject(draft.parameter_values), 't');
  const resolver = createBrowserParameterResolver({ testCase: draft, caseValues: values, steps, materialize: false });
  const contract = resolver.buildData({ steps });
  const references = [...new Set([...(contract.parameter_references || []), ...(contract.missing_parameter_references || [])]
    .map(name => typeof name === 'string' && /^[tsr]\./i.test(name) ? name : referenceKey(name)).filter(name => name && (name.startsWith('t.') || !/^[tsr]\./i.test(name)))
    .map(name => name.startsWith('t.') ? name : `t.${name.slice(2)}`))];
  if (references.length > MAX_CASE_PARAMETERS) throw Object.assign(fail(`The selected case references more than ${MAX_CASE_PARAMETERS} Test Case parameters. Split the case before generating data.`, 422), { code: 'TEST_DATA_PARAMETER_LIMIT' });
  return references;
}

function caseParameterValues(draft) {
  return normalizeParameterLayer(asObject(draft.parameter_values), 't');
}

function fixtureRequired(name, evidence) {
  if (SENSITIVE.test(name)) return true;
  return /(?:log[ -]?in|sign[ -]?in|authenticate|credentials?)/i.test(evidence)
    && /(?:username|user|email|account|employee|customer)/i.test(name);
}
async function downstreamBindings({ run, node, user, access }) {
  const nodes = run.workflow_snapshot?.nodes || [], edges = run.workflow_snapshot?.edges || [];
  let candidates = nodes.filter(item => item.data?.kind === 'artifactTask' && item.data.artifactTask === 'automation-engineer');
  if (edges.length && node.id) {
    const reachable = new Set([node.id]), queue = [node.id];
    while (queue.length) {
      const source = queue.shift();
      for (const edge of edges.filter(edge => edge.source === source && edge.targetHandle !== 'continue')) {
        if (!reachable.has(edge.target)) { reachable.add(edge.target); queue.push(edge.target); }
      }
    }
    candidates = candidates.filter(item => reachable.has(item.id));
  } else if (candidates.length > 1) candidates = [];
  const automationInputs = require('./automationNodeInputs'), available = new Set();
  for (const candidate of candidates) {
    const options = automationInputs.validateNodeOptions(candidate.data);
    if (options.testEnvironmentId) {
      const environment = await automationInputs.selectedEnvironment({ run, node: candidate, user, access, options });
      for (const name of automationInputs.environmentParameterNames(environment)) {
        available.add(name);
        if (name.startsWith('r.')) available.add(`t.${name.slice(2)}`);
      }
    } else {
      for (const name of Object.keys(options.values)) available.add(name);
      if (String(candidate.data.automationUsername || '').trim()) available.add('t.username');
      if (options.credentialId) { available.add('t.username'); available.add('t.password'); }
    }
  }
  return available;
}

function matchingDatasetValue(dataSet, parameterName) {
  const key = normalizeName(parameterName);
  const rows = Array.isArray(dataSet.rows) ? dataSet.rows : [];
  if (dataSet.mode === 'key_value') {
    const matches = rows.filter(item => normalizeName(item?.key) === key);
    if (matches.length !== 1) return null;
    return { parameter_name: normalizeParameterKey(matches[0].key, 'r') };
  }
  if (!rows.length) return null;
  const columns = rows.map(item => Object.keys(asObject(item)).filter(name => normalizeName(name) === key));
  if (columns.some(names => names.length !== 1)) return null;
  const targets = new Set(columns.map(([name]) => normalizeParameterKey(name, 'r')));
  return targets.size === 1 ? { parameter_name: [...targets][0] } : null;
}

async function prepareCase({ run, node, user, access, story, packet, draft, caseIndex, steps, promptInstruction, signal }) {
  assertActive(signal);
  const { source, dataSetId } = validateNodeOptions(node.data);
  const references = caseParameterReferences(draft, steps);
  const existing = caseParameterValues(draft);
  const configured = await downstreamBindings({ run, node, user, access });
  assertActive(signal);
  const existingValue = reference => Object.hasOwn(existing, reference) && !PLACEHOLDER.test(String(existing[reference]));
  const evidence = [story.title, draft.title, draft.description, ...steps.flatMap(step => [step.action, step.expected_result])].filter(Boolean).join('\n').slice(0, 12000);
  if (source === 'dataset') {
    const dataSet = await loadDataSet({ run, node, user, access });
    assertActive(signal);
    const bindings = {}, privateNames = [], parameterSources = {};
    for (const reference of references) {
      const match = matchingDatasetValue(dataSet, reference);
      if (!match) continue;
      // Dataset values stay in the authorized data layer and never enter model
      // prompts or workflow output. The linked Test Data Set supplies them at
      // execution; the builder receives only the parameter reference.
      bindings[reference] = match.parameter_name;
      privateNames.push(match.parameter_name);
      parameterSources[reference] = { source: 'test_data_set', test_data_set_id: dataSet.id, parameter_name: match.parameter_name };
    }
    const missing = references.filter(reference => !Object.hasOwn(bindings, reference) && !existingValue(reference) && !configured.has(reference));
    return {
      status: missing.length ? 'needs_input' : 'ready', source, test_data_set_id: dataSet.id,
      test_data_set_name: dataSet.name,
      dataset_row_count: Array.isArray(dataSet.rows) ? dataSet.mode === 'key_value' ? Number(dataSet.rows.length > 0) : dataSet.rows.length : 0,
      parameter_values: {}, parameter_bindings: bindings, private_parameter_names: [...new Set(privateNames)],
      parameter_sources: parameterSources,
      ...(missing.length ? { missing_parameters: missing } : {}),
      existing_parameter_count: Object.keys(existing).length,
      requires_human_review: true,
    };
  }

  const parameters = {}, parameterSources = {}, missing = [], fallbacks = [];
  const configuredCalls = node.data.aiConfiguration?.agent_execution?.max_model_calls;
  const maxModelCalls = Number.isInteger(configuredCalls) ? Math.max(1, Math.min(8, configuredCalls)) : 4;
  let modelCalls = 0;
  const integrationId = node.data.llmIntegrationId || run.input_payload.integration_id || undefined;
  const unresolved = references.filter(reference => {
    const value = existing[reference];
    return value == null || PLACEHOLDER.test(String(value));
  });
  for (const reference of unresolved) {
    assertActive(signal);
    if (configured.has(reference)) { parameterSources[reference] = { source: 'automation_node' }; continue; }
    if (fixtureRequired(reference, evidence)) { if (!existingValue(reference)) missing.push(reference); continue; }
    const name = reference.slice(2);
    const relevantSteps = steps.filter(step => `${step.action || ''} ${step.expected_result || ''}`.toLowerCase().includes(name.toLowerCase()))
      .map(step => `${step.action || ''} => ${step.expected_result || ''}`).slice(0, 5).join('\n');
    const focusedContext = [
      `Story: ${story.title || story.id}`,
      `Test Case: ${draft.title}`,
      `Parameter: ${name}`,
      `Relevant case steps: ${relevantSteps || 'Use the selected case intent.'}`
    ].join('\n');
    const prompt = `Generate one safe fictional value for the case-owned parameter "${name}". It will be used only as test input and must not imply that a real account, record or fixture exists.`;
    let value, generationMode = 'llm';
    try {
      if (modelCalls >= maxModelCalls) throw Object.assign(new Error('The case model-call budget was reached.'), { code: 'TEST_DATA_MODEL_CALL_BUDGET' });
      modelCalls++;
      const generated = await syntheticData.preview({
        projectId: run.project_id, appTypeId: run.app_type_id, prompt, fieldContext: focusedContext,
        sampleCount: 2, promptInstruction: String(promptInstruction || promptGuidance(node)), integrationId, userId: user.id, signal,
        additionalContext: JSON.stringify({ scope: { project_id: run.project_id, app_type_id: run.app_type_id,
          sprint_id: run.input_payload.sprint_id, story_id: story.id, story_revision: packet.story_revision }, case: { client_id: draft.client_id,
          title: draft.title, steps: steps.map(step => ({ action: step.action, expected_result: step.expected_result })) } })
      });
      assertActive(signal);
      value = generated.suggestions?.[0]?.value;
      if (typeof value !== 'string' || !syntheticData._internals.isSafeSyntheticValue(value)) throw new Error('Generated value did not pass synthetic-data checks.');
    } catch (error) {
      assertActive(signal);
      if (error?.name === 'AbortError' || [401, 403, 499].includes(error?.statusCode) || error?.outcome_unknown) throw error;
      const deterministic = syntheticData._internals.deterministicValues({ prompt, fieldContext: focusedContext, count: 2 });
      value = deterministic.find(candidate => syntheticData._internals.isSafeSyntheticValue(candidate));
      generationMode = 'deterministic_fallback';
      fallbacks.push({ parameter: reference, reason: error?.code === 'TEST_DATA_MODEL_CALL_BUDGET'
        ? 'The case model-call budget was reached; a deterministic safe synthetic value was used.'
        : 'AI generation was unavailable; a deterministic safe synthetic value was used.' });
    }
    if (typeof value !== 'string' || !value) { missing.push(reference); continue; }
    parameters[reference] = value;
    parameterSources[reference] = { source: generationMode };
  }
  return {
    status: missing.length ? 'needs_input' : 'ready', source, parameter_values: parameters,
    private_parameter_names: [], parameter_sources: parameterSources,
    ...(missing.length ? { missing_parameters: missing } : {}),
    ...(fallbacks.length ? { deterministic_fallbacks: fallbacks } : {}),
    existing_parameter_count: Object.keys(existing).length,
    model_calls_attempted: modelCalls,
    requires_human_review: true,
  };
}

function automationDraftWithData(draft, testData) {
  const values = { ...asObject(draft.parameter_values), ...asObject(testData?.parameter_values) };
  const privateNames = [...new Set([...(draft.test_data_options?.private_parameter_names || []), ...(testData?.private_parameter_names || [])])];
  const bound = require('./automationNodeInputs').bindDraftParameters({ ...draft, parameter_values: values,
    test_data_options: { ...(draft.test_data_options || {}), private_parameter_names: privateNames } }, draft.steps || [], testData?.parameter_bindings);
  return { ...bound,
    ...(testData?.test_data_set_id ? { test_data_set_ids: [testData.test_data_set_id] } : {}) };
}

module.exports = { validateNodeOptions, promptGuidance, loadDataSet, caseParameterReferences, caseParameterValues, prepareCase, automationDraftWithData, _internals: { matchingDatasetValue, fixtureRequired, normalizeName, downstreamBindings } };
