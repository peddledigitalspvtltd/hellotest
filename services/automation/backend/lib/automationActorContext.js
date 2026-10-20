const { projectAutomationActorTask } = require('./automationActorPrompt');
const { buildAutomationGoalObligations } = require('./automationGoalObligations');
const { parameterReference } = require('./automationBrowserParameters');
const { nativeValueCoverageRequirements } = require('./automationExpectedResultCoverage');

const record = value => value && typeof value === 'object' && !Array.isArray(value);
const pick = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]));
const invalid = () => ({ code: 'AUTOMATION_ACTOR_CONTEXT_REQUEST_INVALID', message: 'Request only the advertised authorized task context, using exact source identities and bounded ranges. No browser action was performed.' });
const names = value => Array.isArray(value) && value.length <= 16 && value.every(name => typeof name === 'string' && name.length <= 200) && new Set(value).size === value.length;
const exactKeys = (value, keys) => record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const contextError = () => Object.assign(new Error('The authorized task snapshot could not be prepared for the current automation section.'), { code: 'AUTOMATION_ACTOR_CONTEXT_INVALID', statusCode: 422, nonRetryable: true });
const bounded = (value, fallback, max) => Number.isSafeInteger(value) && value > 0 ? Math.min(value, max) : fallback;
const reference = /^@(?:(?:t|s|r)\.)?(?:[A-Za-z][A-Za-z0-9_-]*|\[(?:\\.|[^\]\\\r\n])+\])$/i;
const stepIdentity = (caseId, stepId) => JSON.stringify([caseId, stepId]);
const selectionLists = new Set(['manual_steps', 'parameter_names', 'documents', 'selected_context']);
function contextRequestKey(value, key) {
  if (Array.isArray(value)) {
    const items = value.map(item => contextRequestKey(item));
    if (selectionLists.has(key)) items.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    return ['array', items];
  }
  if (record(value)) return ['object', Object.keys(value).sort().map(name => [name, contextRequestKey(value[name], name)])];
  // Keep invalid extra fields distinguishable too: an undefined field must not
  // disappear during JSON encoding and accidentally reuse a valid selection.
  return [typeof value, value];
}

function projectTaskStrings(value, projectText, path = []) {
  // These identities select the already-authorized source records. A private
  // value coinciding with an ID cannot rename a scope or cross case boundaries.
  // Captured payload IDs are ordinary evidence and receive privacy projection.
  const taskIdentity = ['case', 'current_section'].includes(path[0]) && path.length === 2 && ['id', 'group_id'].includes(path[1])
    || path[0] === 'build_context' && path[1] === 'generation_scope'
    || path[0] === 'build_context' && path[1] === 'linked_manual_cases' && (path.length === 4 && path[3] === 'id' || path.length === 6 && path[3] === 'steps' && ['id', 'group_id'].includes(path[5]));
  if (taskIdentity) return structuredClone(value);
  if (typeof value === 'string') {
    // Host parameter maps advertise symbolic bindings. Captured payloads and
    // page/document evidence can contain the same bytes as a private literal;
    // reference-shaped text alone is not authority to bypass redaction.
    if (path[0] === 'parameter_data' && path[1] === 'values' && reference.test(value)) return value;
    const authored = ['case', 'current_section', 'start_url', 'user_request'].includes(path[0])
      || path[0] === 'build_context' && path[1] === 'linked_manual_cases';
    const projected = projectText(value, { preserveReferences: authored });
    if (typeof projected !== 'string') throw contextError();
    return projected;
  }
  if (Array.isArray(value)) return value.map((item, index) => projectTaskStrings(item, projectText, [...path, index]));
  if (record(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, projectTaskStrings(item, projectText, [...path, key])]));
  return value;
}

/** Preserve complete active obligations. Other authorized task data stays in a
 * host snapshot and is disclosed on demand; page text cannot expand that scope.
 * This is context selection, never a new source loader or permission grant. */
function createAutomationActorContext({ task, obligations = [], parameterBindings, caseJourney, projectText = value => value, maxRequests = 3, maxResponseChars = 24_000, canonicalGoals = false } = {}) {
  if (!record(task) || typeof projectText !== 'function' || !Array.isArray(obligations)) throw contextError();
  let original, pinned;
  try {
    original = projectTaskStrings(structuredClone(projectAutomationActorTask(task)), projectText);
    const supplied = obligations.map(goal => {
      if (!record(goal) || !['section', 'manual_step'].includes(goal.source) || typeof goal.action !== 'string' || typeof goal.expected_result !== 'string') throw contextError();
      return { ...goal, action: projectTaskStrings(goal.action, projectText, ['current_section', 'action']), expected_result: projectTaskStrings(goal.expected_result, projectText, ['current_section', 'expected_result']) };
    });
    const activeIds = original.build_context.generation_scope?.active_manual_step_ids || [];
    if (!Array.isArray(activeIds)) throw contextError();
    pinned = buildAutomationGoalObligations({ section: original.current_section, manualCases: original.build_context.linked_manual_cases,
      activeManualStepIds: activeIds, requiredManualSteps: supplied.filter(goal => goal.source === 'manual_step') });
    const seen = new Set();
    for (const goal of supplied) {
      const authorized = pinned.find(item => item.id === goal.id);
      if (!authorized || seen.has(goal.id) || authorized.source !== goal.source || authorized.action !== goal.action || authorized.expected_result !== goal.expected_result
        || goal.source === 'manual_step' && (authorized.manual_test_case_id !== goal.manual_test_case_id || authorized.manual_step_id !== goal.manual_step_id)) throw contextError();
      seen.add(goal.id);
    }
  } catch { throw contextError(); }
  const canonical = canonicalGoals === true;
  const goalBytes = Buffer.byteLength(JSON.stringify(pinned), 'utf8');
  // Reserve room for operations and current browser evidence in the bounded
  // reviewer packet. Never perform a partial interpretation of an active goal.
  if (canonical && goalBytes > 48_000) throw Object.assign(new Error('The complete current manual requirements exceed the automation context allowance. Split the current section into smaller authored goals before building; no active requirement was truncated and no browser action was performed.'), {
    code: 'AUTOMATION_ACTOR_GOAL_INPUT_TOO_LARGE', statusCode: 422, nonRetryable: true,
    details: { step_id: original.current_section.id, obligation_count: pinned.length, active_goal_utf8_bytes: goalBytes, max_active_goal_utf8_bytes: 48_000 }
  });
  const responseLimit = bounded(maxResponseChars, 24_000, 24_000);
  const context = original.build_context;
  const cases = context.linked_manual_cases;
  const active = new Set(pinned.filter(goal => goal.source === 'manual_step').map(goal => stepIdentity(goal.manual_test_case_id, goal.manual_step_id)));
  const values = original.parameter_data?.values || {};
  const selected = structuredClone(original);
  if (parameterBindings !== undefined) {
    try {
      selected.obligation_parameter_bindings = require('./automationParameterBindings').validateAutomationParameterBindings({ bindings: parameterBindings, obligations: pinned, values });
    } catch { throw contextError(); }
  }
  const goalByManual = new Map(pinned.filter(goal => goal.source === 'manual_step').map(goal => [stepIdentity(goal.manual_test_case_id, goal.manual_step_id), goal]));
  const goalMetadata = (step, obligationId) => {
    const { action, expected_result, ...metadata } = step;
    return { ...metadata, obligation_id: obligationId };
  };
  if (canonical) {
    selected.required_obligations = structuredClone(pinned);
    selected.current_section = goalMetadata(selected.current_section, pinned.find(goal => goal.source === 'section').id);
  }
  selected.parameter_data = { ...pick(original.parameter_data, ['generated_at']),
    values: Object.fromEntries(Object.keys(values).map(name => {
      const scoped = parameterReference(name);
      if (!scoped) throw contextError();
      return [name, scoped];
    })),
    value_policy: 'Use these exact scoped references for browser inputs. For a native value check that verifies retained parameter input, preserve that input reference; separately authored fixed expected values remain fixed. The host resolves the fixed build values. Request parameter_names only when their projected values are needed to interpret the goal.' };
  selected.build_context.linked_manual_cases = cases.map(item => ({
    ...pick(item, ['id', 'display_id', 'title', 'priority', 'preconditions']),
    steps: item.steps.filter(step => active.has(stepIdentity(item.id, step.id))).map(step => canonical
      ? goalMetadata(step, goalByManual.get(stepIdentity(item.id, step.id)).id) : structuredClone(step))
  }));
  selected.available_context = {
    manual_steps: cases.map(item => ({ manual_test_case_id: item.id, title: item.title,
      steps: item.steps.map(step => ({ manual_step_id: step.id, ...pick(step, ['step_order', 'step_type']),
        ...(canonical && active.has(stepIdentity(item.id, step.id))
          ? { obligation_id: goalByManual.get(stepIdentity(item.id, step.id)).id }
          : { action_excerpt: String(step.action || '').slice(0, 100), action_truncated: String(step.action || '').length > 100 }) })) })),
    documents: [{ source: 'case', id: original.case.id, fields: ['gherkin_document'] },
      ...cases.map(item => ({ source: 'manual_case', id: item.id, fields: ['description', 'gherkin_document'] }))],
    parameter_names: Object.keys(values),
    captured_actions: Array.isArray(original.captured_actions) ? original.captured_actions.length : 0,
    captured_network: Array.isArray(original.captured_network) ? original.captured_network.length : 0,
    selected_context: ['environment', 'configuration', 'data_set'].filter(key => context[key]),
    request_limit: bounded(maxRequests, 3, 3), max_response_chars: responseLimit
  };
  if (caseJourney) {
    require('./automationCaseJourney').automationJourneyRequirements(caseJourney, original.current_section.id);
    selected.case_journey = caseJourney.context();
    selected.available_context.journey_steps = caseJourney.index();
  }
  delete selected.case.gherkin_document;
  delete selected.captured_actions;
  delete selected.captured_network;
  for (const key of ['environment', 'configuration', 'data_set']) if (context[key]) {
    selected.build_context[key] = { ...pick(context[key], ['id', 'name', 'base_url', 'browser', 'mobile_os', 'platform_version', 'mode', 'row_count']), additional_context_available: true };
  }
  let requests = 0;
  const responses = [];
  const disclosures = new Map();
  const request = input => {
    let key;
    try { key = JSON.stringify(contextRequestKey(input)); } catch { /* Non-JSON requests are invalid, never cache authority. */ }
    if (key && disclosures.has(key)) return structuredClone(disclosures.get(key));
    if (requests >= selected.available_context.request_limit) return { code: 'AUTOMATION_ACTOR_CONTEXT_BUDGET_EXHAUSTED', message: 'The task-context request allowance is exhausted. Continue with the supplied evidence or report the actual missing dependency. No browser action was performed.' };
    requests++;
    if (!key) return invalid();
    const allowed = ['manual_steps', 'parameter_names', 'documents', 'captured_actions', 'captured_network', 'selected_context', ...(caseJourney ? ['journey_steps'] : [])];
    if (!record(input) || !Object.keys(input).length || Object.keys(input).some(key => !allowed.includes(key))) return invalid();
    const data = {};
    if (input.journey_steps !== undefined) {
      try { data.journey_steps = caseJourney.select(input.journey_steps); } catch { return invalid(); }
    }
    if (input.manual_steps !== undefined) {
      if (!Array.isArray(input.manual_steps) || !input.manual_steps.length || input.manual_steps.length > 8) return invalid();
      const seen = new Set();
      data.manual_steps = [];
      for (const reference of input.manual_steps) {
        if (!exactKeys(reference, ['manual_test_case_id', 'manual_step_id']) || typeof reference.manual_test_case_id !== 'string' || typeof reference.manual_step_id !== 'string') return invalid();
        const identity = stepIdentity(reference.manual_test_case_id, reference.manual_step_id);
        const manualCase = cases.find(item => item.id === reference.manual_test_case_id);
        const step = manualCase?.steps.find(item => item.id === reference.manual_step_id);
        if (!step || seen.has(identity)) return invalid();
        seen.add(identity);
        data.manual_steps.push({ manual_test_case_id: manualCase.id, ...structuredClone(step) });
      }
    }
    if (input.parameter_names !== undefined) {
      if (!names(input.parameter_names) || !input.parameter_names.length || input.parameter_names.some(name => !Object.hasOwn(values, name))) return invalid();
      data.parameter_values = Object.fromEntries(input.parameter_names.map(name => [name, values[name]]));
    }
    if (input.documents !== undefined) {
      if (!Array.isArray(input.documents) || !input.documents.length || input.documents.length > 2) return invalid();
      data.documents = [];
      const seen = new Set();
      for (const reference of input.documents) {
        if (!exactKeys(reference, ['source', 'id', 'field'])) return invalid();
        const identity = JSON.stringify([reference.source, reference.id, reference.field]);
        if (seen.has(identity)) return invalid();
        seen.add(identity);
        const advertised = selected.available_context.documents.find(item => item.source === reference.source && item.id === reference.id && item.fields.includes(reference.field));
        if (!advertised) return invalid();
        const item = reference.source === 'case' ? original.case : cases.find(item => item.id === reference.id);
        data.documents.push({ ...reference, content: item[reference.field] ?? null });
      }
    }
    for (const key of ['captured_actions', 'captured_network']) if (input[key] !== undefined) {
      const range = input[key], rows = Array.isArray(original[key]) ? original[key] : [];
      if (!exactKeys(range, ['offset', 'limit']) || !Number.isSafeInteger(range.offset) || range.offset < 0 || range.offset > rows.length || !Number.isSafeInteger(range.limit) || range.limit < 1 || range.limit > 5) return invalid();
      data[key] = { offset: range.offset, total: rows.length, items: rows.slice(range.offset, range.offset + range.limit), next_offset: range.offset + range.limit < rows.length ? range.offset + range.limit : null };
    }
    if (input.selected_context !== undefined) {
      if (!names(input.selected_context) || !input.selected_context.length || input.selected_context.some(key => !selected.available_context.selected_context.includes(key))) return invalid();
      data.selected_context = Object.fromEntries(input.selected_context.map(key => [key, context[key]]));
    }
    const result = { kind: 'automation_actor_context', request_number: requests, data: structuredClone(data) };
    if (JSON.stringify(result).length > responseLimit) return { code: 'AUTOMATION_ACTOR_CONTEXT_TOO_LARGE', message: 'This context selection exceeds the response allowance. Request fewer exact records or a smaller capture range. No selected records were disclosed and no browser action was performed.' };
    disclosures.set(key, structuredClone(result));
    responses.push(structuredClone(result));
    return result;
  };
  const taskPrompt = JSON.stringify({ kind: 'automation_actor_task', ...selected });
  const compactGoalContract = (execution, suppliedPrompt) => {
    if (!canonical || execution?.required !== true || execution.step_id !== original.current_section.id
      || suppliedPrompt !== undefined && (typeof suppliedPrompt !== 'string' || !suppliedPrompt.includes(taskPrompt))
      || execution.action !== (original.current_section.action ?? '') || execution.expected_result !== (original.current_section.expected_result ?? '')
      || !Array.isArray(execution.obligations) || execution.obligations.length !== pinned.length) return null;
    const seen = new Set();
    for (const goal of execution.obligations) {
      const authorized = pinned.find(item => item.id === goal?.id);
      if (!authorized || seen.has(goal.id) || authorized.source !== goal.source || authorized.action !== goal.action || authorized.expected_result !== goal.expected_result
        || authorized.source === 'manual_step' && (authorized.manual_test_case_id !== goal.manual_test_case_id || authorized.manual_step_id !== goal.manual_step_id)) return null;
      seen.add(goal.id);
    }
    // Use the same original authored clauses as the reviewer. Parameter values
    // and privacy projections must not introduce or erase a validation oracle.
    // This is advance proof guidance, never a chosen target or a passing check.
    const sources = execution.source_obligations === undefined ? execution.obligations : execution.source_obligations;
    if (!Array.isArray(sources) || sources.length !== pinned.length) return null;
    const sourceIds = new Set();
    for (const source of sources) {
      const authorized = pinned.find(goal => goal.id === source?.id);
      if (!authorized || sourceIds.has(source.id) || source.source !== authorized.source
        || typeof source.action !== 'string' || typeof source.expected_result !== 'string'
        || source.action.length > 20_000 || source.expected_result.length > 20_000
        || authorized.source === 'manual_step' && (source.manual_test_case_id !== authorized.manual_test_case_id || source.manual_step_id !== authorized.manual_step_id)) return null;
      sourceIds.add(source.id);
    }
    const requirements = nativeValueCoverageRequirements(sources);
    return { requirements_source: 'automation_actor_task.required_obligations', required_obligation_ids: pinned.map(goal => goal.id),
      ...(requirements.length ? { assertion_evidence_contract: requirements } : {}) };
  };
  return { prompt: taskPrompt, request,
    additionalContext: () => structuredClone(responses),
    compactGoalContract,
    measurements: { original_task_chars: JSON.stringify(original).length, selected_task_chars: JSON.stringify(selected).length,
      original_task_utf8_bytes: Buffer.byteLength(JSON.stringify(original), 'utf8'), selected_task_utf8_bytes: Buffer.byteLength(JSON.stringify(selected), 'utf8'),
      active_manual_steps: active.size,
      active_goal_utf8_bytes: goalBytes, active_obligation_count: pinned.length, goal_packing: canonical ? 'canonical_obligations' : 'embedded_specs',
      ...(parameterBindings !== undefined ? { parameter_binding_count: selected.obligation_parameter_bindings.length,
        parameter_binding_reference_count: selected.obligation_parameter_bindings.reduce((count, row) => count + row.action_parameters.length + row.expected_result_parameters.length, 0) } : {}),
      available_manual_steps: cases.reduce((count, item) => count + item.steps.length, 0), token_measurement: 'provider_usage_is_authoritative' } };
}

module.exports = { createAutomationActorContext };
