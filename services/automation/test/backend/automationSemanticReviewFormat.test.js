const test = require('node:test');
const assert = require('node:assert/strict');
const { createAutomationSemanticReviewer } = require('../../backend/lib/automationSemanticReview');
const { recordBrowserOperation, recordedSectionRequests } = require('../../backend/lib/automationBrowserRecording');

const execution = { required: true, step_id: 'section', action: 'Save address', expected_result: 'Address saved is displayed' };
const result = value => ({ content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', ...value }) }] });
function operation(name, args) {
  const row = { tool: name, execution_step_id: execution.step_id, arguments: {},
    result: result(name === 'browser_assert' ? { assertion_outcome: 'satisfied' } : { action_outcome: 'completed' }) };
  recordBrowserOperation(row, { name, arguments: args });
  return row;
}
const snapshot = () => ({ tool: 'browser_snapshot', execution_step_id: execution.step_id,
  result: result({ observation_id: 'page', accessibility: '- status "Address saved"', elements: [] }) });
const observations = () => [snapshot(), operation('browser_click', { locator: '#save' }),
  operation('browser_assert', { assertion: 'text', locator: '#status', value: 'Address saved' }), snapshot()];
const mapping = id => ({ id, action_operations: [1], assertion_operations: [2] });
const accepted = () => ({ decision: 'accept', obligations: [mapping(execution.step_id)], issues: [] });
const rejected = () => ({ decision: 'reject', obligations: [{ id: execution.step_id, action_operations: [], assertion_operations: [] }],
  issues: [{ code: 'expected_result_not_covered', obligation_id: execution.step_id, message: 'The address outcome has not been established.' }] });
const packet = prompt => JSON.parse(prompt.slice(prompt.indexOf('\n\n') + 2));
const reviewer = (complete, options = {}) => createAutomationSemanticReviewer({ execution, complete, ...options });

test('response contract explicitly covers both decisions, every host identity and typed 1-based index sets without supplied positive coverage', async () => {
  const obligations = [{ id: 'section', source: 'section', action: execution.action, expected_result: execution.expected_result },
    { id: 'manual:case:step', source: 'manual', action: execution.action, expected_result: execution.expected_result }];
  const review = reviewer(async prompt => {
    const contract = packet(prompt).response_contract;
    assert.deepEqual(contract.decision, ['accept', 'reject']);
    assert.equal(contract.obligations.required_for, 'both decisions');
    assert.deepEqual(contract.obligations.required_ids, obligations.map(row => row.id));
    assert.equal(contract.obligations.index_base, 1);
    assert.deepEqual(contract.obligations.action_indexes, [1]);
    assert.deepEqual(contract.obligations.assertion_indexes, [2]);
    assert.equal(typeof contract.obligations.row.action_operations, 'string', 'contract does not choose positive mappings');
    assert.equal(typeof contract.obligations.row.assertion_operations, 'string');
    assert.deepEqual(contract.accept.issues, []);
    assert.match(contract.accept.rule, /every clause|Every requirement/);
    assert.match(contract.reject.rule, /one obligation row per required_id/);
    assert.match(contract.reject.rule, /Do not invent operations/);
    assert.ok(contract.issues.row.code.includes('action_not_supported'));
    return JSON.stringify({ ...accepted(), obligations: obligations.map(row => mapping(row.id)) });
  }, { execution: { ...execution, obligations } });
  assert.equal((await review.review({ observations: observations() })).accepted, true);
});

test('missing-obligations rejection gets one safe format correction with unchanged evidence and is cached as rejected', async () => {
  let calls = 0;
  const prompts = [], events = [], source = observations(), before = recordedSectionRequests(source, execution.step_id);
  const review = reviewer(async prompt => {
    calls++;prompts.push(packet(prompt));
    if (calls === 1) return JSON.stringify({ decision: 'reject', issues: rejected().issues, private_invalid_extra: 'secret-response-value' });
    const feedback = prompts[1].format_feedback;
    assert.equal(feedback.code, 'AUTOMATION_SEMANTIC_REVIEW_INVALID');
    assert.equal(feedback.field, 'obligations');
    assert.equal(feedback.required_decision, 'reject');
    assert.doesNotMatch(prompt, /secret-response-value|private_invalid_extra/);
    assert.deepEqual(prompts[1].confirmed_operations, prompts[0].confirmed_operations);
    assert.deepEqual(prompts[1].obligations, prompts[0].obligations);
    assert.deepEqual(prompts[1].current_page, prompts[0].current_page);
    return JSON.stringify(rejected());
  }, { onProgress: async event => events.push(event) });
  const outcome = await review.review({ observations: source });
  assert.equal(outcome.accepted, false);assert.equal(outcome.review_count, 2);assert.equal(calls, 2);
  assert.equal(outcome.feedback.code, 'AUTOMATION_SEMANTIC_REVIEW_REJECTED');
  assert.deepEqual(recordedSectionRequests(source, execution.step_id), before, 'format repair never adds or replays an action');
  assert.ok(events.some(event => event.phase === 'automation.agent.semantic.format.retry'));
  const repeated = await review.review({ observations: source });
  assert.equal(repeated.cached, true);assert.equal(repeated.accepted, false);assert.equal(calls, 2);
  assert.doesNotMatch(JSON.stringify(events), /secret-response-value|private_invalid_extra/);
});

test('an unparseable response can correct to model-authored supported mappings without host-filled coverage', async () => {
  let calls = 0;
  const review = reviewer(async prompt => {
    calls++;
    if (calls === 1) return '{"decision":';
    const data = packet(prompt);
    assert.equal(data.format_feedback.field, '$');
    assert.equal(data.format_feedback.required_decision, undefined);
    assert.equal(data.format_feedback.obligations, undefined);
    return JSON.stringify(accepted());
  });
  const outcome = await review.review({ observations: observations() });
  assert.equal(outcome.accepted, true);assert.equal(outcome.review_count, 2);
  assert.deepEqual(outcome.obligation_mappings, accepted().obligations);
});

test('typed invalid JSON from the completion parser gets the same single bounded format correction', async () => {
  let calls = 0;
  const review = reviewer(async prompt => {
    calls++;
    if (calls === 1) throw Object.assign(new Error('private-provider-fragment'), { code: 'AI_INVALID_JSON' });
    assert.equal(packet(prompt).format_feedback.field, '$');
    assert.doesNotMatch(prompt, /private-provider-fragment/);
    return JSON.stringify(rejected());
  });
  assert.equal((await review.review({ observations: observations() })).accepted, false);
  assert.equal(calls, 2);
});

test('twice-invalid responses stop with a typed failure without raw response diagnostics', async () => {
  for (const malformed of ['private-provider-fragment not JSON', JSON.stringify({ ...accepted(), obligations: [{ id: 'private-foreign-id', action_operations: [999], assertion_operations: [] }] })]) {
    let calls = 0;
    const review = reviewer(async prompt => {
      calls++;
      assert.doesNotMatch(prompt, /private-provider-fragment|private-foreign-id/);
      return malformed;
    });
    await assert.rejects(review.review({ observations: observations() }), failure => failure.code === 'AUTOMATION_SEMANTIC_REVIEW_INVALID'
      && failure.nonRetryable && !/private-provider-fragment|private-foreign-id/.test(failure.message));
    assert.equal(calls, 2);
  }
});

test('valid reject is final for unchanged evidence and does not trigger format correction', async () => {
  let calls = 0;
  const source = observations();
  const review = reviewer(async prompt => { calls++;assert.equal(packet(prompt).format_feedback, undefined);return JSON.stringify(rejected()); });
  assert.equal((await review.review({ observations: source })).review_count, 1);
  source.push(operation('browser_assert', { assertion: 'text', locator: '#status', value: 'Address saved' }), snapshot());
  const repeated = await review.review({ observations: source });
  assert.equal(repeated.cached, true);assert.equal(repeated.accepted, false);assert.equal(calls, 1);
});

test('format correction cannot change an existing rejection into acceptance', async () => {
  let calls = 0;
  const review = reviewer(async () => ++calls === 1 ? JSON.stringify({ decision: 'reject', issues: rejected().issues }) : JSON.stringify(accepted()));
  await assert.rejects(review.review({ observations: observations() }), { code: 'AUTOMATION_SEMANTIC_REVIEW_INVALID' });
  assert.equal(calls, 2);
});

test('format correction may conservatively reject a malformed acceptance with missing proof', async () => {
  let calls = 0;
  const review = reviewer(async prompt => {
    if (++calls === 1) return JSON.stringify({ decision: 'accept', issues: [] });
    assert.equal(packet(prompt).format_feedback.required_decision, undefined);
    return JSON.stringify(rejected());
  });
  const outcome = await review.review({ observations: observations() });
  assert.equal(outcome.accepted, false);assert.equal(outcome.review_count, 2);
});

test('a one-review ceiling never permits a format correction', async () => {
  let calls = 0;
  const review = reviewer(async () => { calls++;return '{}'; }, { maxReviews: 1 });
  await assert.rejects(review.review({ observations: observations() }), { code: 'AUTOMATION_SEMANTIC_REVIEW_INVALID' });
  assert.equal(calls, 1);
});

test('a changed-evidence review cannot use a third call for format correction', async () => {
  let calls = 0;
  const source = observations();
  const review = reviewer(async () => ++calls === 1 ? JSON.stringify(rejected()) : '{}');
  assert.equal((await review.review({ observations: source })).accepted, false);
  source.push(operation('browser_assert', { assertion: 'visible', locator: '#row' }), snapshot());
  await assert.rejects(review.review({ observations: source }), { code: 'AUTOMATION_SEMANTIC_REVIEW_INVALID' });
  assert.equal(calls, 2);
});

test('capacity, quota, authentication, output truncation and input-budget errors propagate unchanged without correction', async () => {
  for (const code of ['LLM_RATE_LIMITED', 'LLM_REQUEST_TOO_LARGE', 'LLM_QUOTA_EXCEEDED', 'LLM_AUTHENTICATION_FAILED',
    'LLM_RATE_LIMIT_REQUEST_TOO_LARGE', 'AI_OUTPUT_TRUNCATED', 'AI_INPUT_BUDGET_EXCEEDED']) {
    let calls = 0;
    const original = Object.assign(new Error('Safe provider diagnostic'), { code, statusCode: 502, nonRetryable: true, retryable: false, retryAfterMs: 2300 });
    const review = reviewer(async () => { calls++;throw original; });
    await assert.rejects(review.review({ observations: observations() }), failure => failure === original && failure.retryAfterMs === 2300);
    assert.equal(calls, 1, code);
  }
});

test('unknown transport failure remains a safe unavailable error with no format correction', async () => {
  let calls = 0;
  const review = reviewer(async () => { calls++;throw new Error('private-transport-fragment'); });
  await assert.rejects(review.review({ observations: observations() }), failure => failure.code === 'AUTOMATION_SEMANTIC_REVIEW_UNAVAILABLE'
    && !failure.message.includes('private-transport-fragment'));
  assert.equal(calls, 1);
});

test('cancellation, permission and shared budget failures during format correction propagate unchanged', async () => {
  for (const original of [Object.assign(new Error('Cancelled'), { name: 'AbortError' }), Object.assign(new Error('Access revoked'), { statusCode: 403 }),
    ...['AUTOMATION_BROWSER_MODEL_BUDGET_EXHAUSTED', 'AUTOMATION_BUILD_DEADLINE', 'AUTOMATION_SEMANTIC_REVIEW_DEADLINE'].map(code => Object.assign(new Error('Host budget reached'), { code, nonRetryable: true }))]) {
    let calls = 0;
    const review = reviewer(async () => { if (++calls === 1) return '{}';throw original; });
    await assert.rejects(review.review({ observations: observations() }), failure => failure === original);
    assert.equal(calls, 2);
  }
});

test('a deadline reached before correction stops before another model call', async () => {
  const originalNow = Date.now;
  let now = originalNow(), calls = 0;
  Date.now = () => now;
  try {
    const review = reviewer(async () => { calls++;return '{}'; }, { deadlineMs: now + 1000,
      onProgress: async event => { if (event.phase === 'automation.agent.semantic.format.retry') now += 1001; } });
    await assert.rejects(review.review({ observations: observations() }), { code: 'AUTOMATION_SEMANTIC_REVIEW_DEADLINE' });
    assert.equal(calls, 1);
  } finally { Date.now = originalNow; }
});

test('typed cancellation while parsing is preserved instead of converted into a format retry', async () => {
  let calls = 0;
  const original = Object.assign(new Error('Cancelled'), { name: 'AbortError' });
  const review = reviewer(async () => { calls++;return '{}'; }, { parse: () => { throw original; } });
  await assert.rejects(review.review({ observations: observations() }), failure => failure === original);
  assert.equal(calls, 1);
});
