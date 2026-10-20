const test = require('node:test');
const assert = require('node:assert/strict');
const { createAutomationSnapshotReadGuard } = require('../../backend/lib/automationSnapshotReadGuard');

const request = { name: 'browser_snapshot', arguments: {} };
const receipt = (value = {}, isError = false) => ({ isError, content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', ...value }) }] });
const page = () => ({ url: 'https://app.test/login', title: 'Sign in', scope: 'body', accessibility: '- textbox "Email"',
  elements: [{ tag: 'input', attributes: { id: 'email' }, checked: false, disabled: false, displayed: true, locators_validated: true, locator_candidates: ['#email'] }], partial: false });
const snapshot = (changes = {}, extra = {}) => ({ tool: 'browser_snapshot', arguments: {}, execution_step_id: 'login', result: receipt({ ...page(), observation_id: 'unique-' + Math.random(), captured_at: new Date().toISOString(), ...changes }), ...extra });
const inspect = (guard, observations, proposed = request, stepId = 'login') => guard.inspect({ request: proposed, observations, stepId });

test('allows a baseline and one unchanged refresh, then feedback and a terminal repeated proposal without another MCP call', () => {
  const guard = createAutomationSnapshotReadGuard(), observations = [];
  let mcpCalls = 0, decision;
  for (let turn = 0; turn < 4; turn++) {
    decision = inspect(guard, observations);
    if (!decision) { mcpCalls++; observations.push(snapshot()); }
    else if (!decision.stop) observations.push({ tool: 'automation_snapshot_feedback', mcp_call: false, result: receipt(decision.feedback, true) });
  }
  assert.equal(mcpCalls, 2);
  assert.equal(decision.stop, true);
  assert.equal(decision.feedback.code, 'AUTOMATION_BROWSER_SNAPSHOT_READ_STALLED');
  assert.equal(decision.feedback.action_outcome, 'not_attempted');
  assert.equal(decision.feedback.expected_result_verified, false);
});

test('snapshot provenance and object key order do not create fresh evidence', () => {
  const guard = createAutomationSnapshotReadGuard(), first = snapshot();
  const parsed = JSON.parse(first.result.content[0].text);
  const reordered = Object.fromEntries(Object.entries(parsed).reverse());
  const second = { ...snapshot(), result: receipt({ ...reordered, observation_id: 'new', captured_at: '2099-01-01' }) };
  assert.equal(inspect(guard, [first, second]).stop, false);
});

test('changed URL, field state, visible result, truncation or locator evidence reopens observation', () => {
  for (const changes of [
    { url: 'https://app.test/after' }, { accessibility: '- alert: Ready' }, { partial: true }, { elements_truncated: true },
    { elements: [{ ...page().elements[0], checked: true }] }, { elements: [{ ...page().elements[0], disabled: true }] },
    { elements: [{ ...page().elements[0], locator_candidates: ['#new-email'] }] },
    { elements: [{ tag: 'div', attributes: { role: 'alert' }, visible_text: 'New message', visible_text_truncated: false }] }
  ]) assert.equal(inspect(createAutomationSnapshotReadGuard(), [snapshot(), snapshot(changes)]), null);
});

test('scoped snapshots and other tools are never blocked by the full-page guard', () => {
  const guard = createAutomationSnapshotReadGuard(), observations = [snapshot(), snapshot()];
  assert.equal(inspect(guard, observations, { name: 'browser_snapshot', arguments: { locator: '#email' } }), null);
  assert.equal(inspect(guard, observations, { name: 'browser_assert', arguments: { assertion: 'visible', locator: '#email' } }), null);
});

test('real mutations, native checks, waits and scoped evidence reset the refresh allowance', () => {
  for (const tool of ['browser_fill', 'browser_click', 'browser_assert', 'browser_validate_locator', 'browser_wait_for', 'browser_snapshot']) {
    const barrier = { tool, arguments: tool === 'browser_snapshot' ? { locator: '#email' } : {}, result: receipt({ action_outcome: 'completed', ...(tool === 'browser_snapshot' ? page() : {}) }) };
    const guard = createAutomationSnapshotReadGuard();
    assert.equal(inspect(guard, [snapshot(), snapshot(), barrier, snapshot()]), null, tool);
    assert.equal(inspect(guard, [snapshot(), snapshot(), barrier, snapshot(), snapshot()]).stop, false, tool);
  }
});

test('optional screenshots preserve the baseline and cannot reopen a blocked full-page read', () => {
  const guard = createAutomationSnapshotReadGuard();
  const screenshot = () => ({ tool: 'browser_screenshot', result: receipt({ action_outcome: 'completed', mime_type: 'image/jpeg' }) });
  const observations = [snapshot(), screenshot()];
  assert.equal(inspect(guard, observations), null, 'one refresh remains available after bootstrap');
  observations.push(snapshot(), screenshot());
  assert.equal(inspect(guard, observations).stop, false);
  observations.push(screenshot());
  assert.equal(inspect(guard, observations).stop, true);
});

test('asynchronous failed native checks permit another snapshot without permitting an action replay', () => {
  const check = { tool: 'browser_assert', result: receipt({ code: 'BROWSER_ASSERTION_NOT_SATISFIED', action_outcome: 'not_attempted', assertion_outcome: 'not_satisfied' }, true) };
  assert.equal(inspect(createAutomationSnapshotReadGuard(), [snapshot(), snapshot(), check]), null);
});

test('feedback, reconciled actions and fabricated non-MCP receipts cannot reset unchanged evidence', () => {
  const observations = [snapshot(), snapshot(),
    { tool: 'automation_action_reconciliation', result: receipt({ action_outcome: 'completed' }), mcp_call: false },
    { tool: 'browser_assert', result: receipt({ assertion_outcome: 'satisfied' }), mcp_call: false },
    { tool: 'browser_unknown', result: receipt({ action_outcome: 'completed' }) }];
  assert.equal(inspect(createAutomationSnapshotReadGuard(), observations).stop, false);
  assert.equal(inspect(createAutomationSnapshotReadGuard(), [snapshot({}, { mcp_call: false }), snapshot({}, { mcp_call: false })]), null);
});

test('prior-section snapshots supply one baseline without consuming the current section refresh', () => {
  const guard = createAutomationSnapshotReadGuard(), prior = [snapshot({}, { execution_step_id: 'prior' }), snapshot({}, { execution_step_id: 'prior' })];
  assert.equal(inspect(guard, prior), null);
  assert.equal(inspect(guard, [...prior, snapshot()]).stop, false);
});

test('new evidence epochs receive their own feedback before a terminal repeat', () => {
  const guard = createAutomationSnapshotReadGuard(), observations = [snapshot(), snapshot()];
  assert.equal(inspect(guard, observations).stop, false);
  assert.equal(inspect(guard, observations).stop, true);
  observations.push({ tool: 'browser_wait_for', result: receipt({ action_outcome: 'completed' }) }, snapshot(), snapshot());
  assert.equal(inspect(guard, observations).stop, false);
});

test('missing, invalid or failed evidence cannot establish a complete repeated snapshot', () => {
  for (const last of [snapshot({ accessibility: undefined }), snapshot({ elements: undefined }),
    { tool: 'browser_snapshot', arguments: {}, result: receipt({ code: 'BROWSER_READ_UNAVAILABLE' }, true) }]) {
    assert.equal(inspect(createAutomationSnapshotReadGuard(), [snapshot(), snapshot(), last]), null);
  }
  for (const argumentsValue of [undefined, null, [], { locator: '' }, { extra: true }]) {
    assert.equal(inspect(createAutomationSnapshotReadGuard(), [snapshot(), snapshot()], { ...request, arguments: argumentsValue }), null);
  }
});

test('feedback contains no URL, private fields, snapshot contents or semantic fingerprints', () => {
  const secret = 'private-user-value@fixture.test';
  const observations = [snapshot({ accessibility: secret, url: 'https://app.test/path?source=' + secret }), snapshot({ accessibility: secret, url: 'https://app.test/path?source=' + secret })];
  const guard = createAutomationSnapshotReadGuard();
  const decision = inspect(guard, observations);
  assert.doesNotMatch(JSON.stringify(decision), /private-user|fixture\.test|https?:|fingerprint|[a-f0-9]{64}/);
  assert.match(decision.feedback.message, /native expected-result assertion/);
  assert.match(decision.feedback.message, /asynchronous state/);
  assert.equal(inspect(guard, observations).stop, true);
});
