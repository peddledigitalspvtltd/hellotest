const test = require('node:test');
const assert = require('node:assert/strict');
const { progressEvent, createDiagnosticReporter, isCriticalAutomationError } = require('../../backend/lib/automationProgressDiagnostics');
const { reduceBrowserActions, operationDuration } = require('../../backend/lib/automationActivityReceipts');
const { reduceActivityProgress } = require('../../backend/lib/automationActivityProgress');

test('public action events have host correlation and timestamps without arguments, private messages or injected identities', () => {
  const original = { phase: 'automation.agent.action.failed', message: 'page contains PRIVATE', metadata: { phase_message: 'PRIVATE', arguments: 'PRIVATE' }, details: {
    test_case_id: 'case', active_step_id: 'step', action_id: 'action-one', tool: 'browser_assert', assertion: 'field_valid',
    error_code: 'BROWSER_ASSERTION_SUBJECT_UNSUPPORTED', action_outcome: 'not_attempted', arguments: { value: 'PRIVATE' },
    selector: '#PRIVATE', correlation: { activity_id: 'invented' }, occurred_at: 'injected', active_manual_step_ids: ['manual', 'manual', '<PRIVATE>']
  } };
  const event = progressEvent(original, { activityId: 'real-activity', caseId: 'real-case', context: { request_id: 'real-request', trace_id: 'real-trace', token: 'PRIVATE' }, now: 1000 });
  assert.equal(event.details.test_case_id, 'real-case');
  assert.deepEqual(event.details.correlation, { activity_id: 'real-activity', request_id: 'real-request', trace_id: 'real-trace' });
  assert.equal(event.details.occurred_at, '1970-01-01T00:00:01.000Z');
  assert.deepEqual(event.details.active_manual_step_ids, ['manual']);
  assert.equal(event.details.assertion, 'field_valid');
  assert.equal(event.details.error_code, 'BROWSER_ASSERTION_SUBJECT_UNSUPPORTED');
  assert.doesNotMatch(JSON.stringify(event), /PRIVATE|invented|injected|arguments|selector|token/);
  assert.equal(original.details.test_case_id, 'case');
});

test('non-action progress preserves existing domain facts and does not overwrite a model trace call ID', () => {
  const event = progressEvent({ phase: 'automation.agent.llm', details: { trace_id: 'model-call', duration_ms: 42, active_step_id: 'step' } },
    { activityId: 'activity', context: { trace_id: 'request-trace' }, now: 1000 });
  assert.equal(event.details.trace_id, 'model-call');
  assert.equal(event.details.correlation.trace_id, 'request-trace');
  assert.equal(event.details.duration_ms, 42);
});

test('bounded diagnostic outages are observable without raw errors, credentials or log flooding', () => {
  const messages = [], report = createDiagnosticReporter({ warn: message => messages.push(message) });
  const error = Object.assign(new Error('PRIVATE password=secret'), { statusCode: 503, code: 'ECONNRESET', config: { token: 'PRIVATE' } });
  for (let i = 0; i < 201; i++) report({ activityId: 'activity', operation: 'browser_screenshot_storage', error });
  assert.equal(messages.length, 3);
  assert.deepEqual(messages.map(message => JSON.parse(message).failed_writes), [1, 100, 200]);
  assert.equal(JSON.parse(messages[0]).activity_id, 'activity');
  assert.equal(JSON.parse(messages[0]).error_code, 'ECONNRESET');
  assert.doesNotMatch(messages.join(''), /PRIVATE|password|secret|token|config|stack/);
  assert.doesNotThrow(() => createDiagnosticReporter({ warn: () => { throw new Error('sink down'); } })({ error }));
});

test('only access, cancellation and lease failures are critical to optional diagnostics', () => {
  for (const error of [{ statusCode: 401 }, { statusCode: 403 }, { name: 'AbortError' }, { code: 'BATCH_LEASE_LOST' }, { code: 'BATCH_JOB_LEASE_LOST' }]) {
    assert.equal(isCriticalAutomationError(error), true);
  }
  for (const error of [null, new Error('storage failure'), { statusCode: 503 }]) assert.equal(isCriticalAutomationError(error), false);
});

test('operation receipts retain duration, typed errors and assertions while rejecting duplicate or conflicting completion', () => {
  const detail = { action_id: 'action', tool: 'browser_assert', assertion: 'field_valid', active_manual_step_ids: ['manual'] };
  let actions = reduceBrowserActions([], { phase: 'automation.agent.action.started', details: detail }, '2026-10-19T01:00:00.000Z');
  const initial = structuredClone(actions);
  actions = reduceBrowserActions(actions, { phase: 'automation.agent.action.failed', details: { ...detail, error_code: 'BROWSER_ASSERTION_NOT_SATISFIED', action_outcome: 'not_attempted' } }, '2026-10-19T01:00:00.251Z');
  assert.equal(initial[0].status, 'running');
  assert.equal(actions[0].duration_ms, 251);
  assert.equal(actions[0].assertion, 'field_valid');
  assert.equal(actions[0].error_code, 'BROWSER_ASSERTION_NOT_SATISFIED');
  assert.deepEqual(reduceBrowserActions(actions, { phase: 'automation.agent.action.completed', details: { ...detail, assertion_outcome: 'satisfied' } }, '2026-10-19T01:00:01.000Z'), actions);
  assert.strictEqual(reduceBrowserActions(actions, { phase: 'automation.agent.action.completed', details: { ...detail, tool: 'browser_click', action_outcome: 'completed' } }, '2026-10-19T01:00:01.000Z'), actions);
  assert.equal(operationDuration('invalid', 'invalid'), undefined);
  assert.equal(operationDuration('2026-10-19T01:00:01.000Z', '2026-10-19T01:00:00.000Z'), undefined);
});

test('indexed progress updates preserve untouched timestamps and input snapshots on large case plans', () => {
  const state = { step_progress: Array.from({ length: 1000 }, (_, i) => ({ test_case_id: 'case', step_id: `step-${i}`, status: 'queued', updated_at: 'original' })),
    manual_step_progress: Array.from({ length: 1000 }, (_, i) => ({ test_case_id: 'case', manual_step_id: `manual-${i}`, section_step_id: `step-${i}`, status: 'queued', instruction_status: 'unmapped', updated_at: 'original' })) };
  const event = progressEvent({ phase: 'automation.agent.action.started', details: { test_case_id: 'case', active_step_id: 'step-999', action_id: 'action', tool: 'browser_fill' } }, { activityId: 'activity', now: 1000 });
  const result = reduceActivityProgress(state, event);
  assert.equal(result.step_progress[999].browser_actions[0].started_at, event.details.occurred_at);
  assert.equal(result.step_progress[999].updated_at, event.details.occurred_at);
  assert.equal(result.step_progress[0].updated_at, 'original');
  assert.equal(state.step_progress[999].browser_actions, undefined);
  assert.equal(result.manual_step_progress[999].browser_actions.length, 0, 'uncovered manual work does not receive an action receipt');
});
