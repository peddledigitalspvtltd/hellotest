const test = require('node:test');
const assert = require('node:assert/strict');
const { browserActionOrderFeedback } = require('../../backend/lib/automationBrowserActionOrder');

const result = value => ({ content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', ...value }) }] });
const target = (extras = {}) => ({ tag: 'button', accessible_name: 'Private signup label', attributes: { type: 'submit' },
  locators_validated: true, locator_candidates: ['#private-submit-target'], ...extras });
const snapshot = (elements = [target()]) => ({ tool: 'browser_snapshot', result: result({ observation_id: 'page', elements }) });
const execution = (action = 'Enter @r.valid_email in the email field', extras = {}) => ({ required: true, step_id: 'current',
  source_obligations: [{ id: 'current', source: 'section', action, expected_result: 'The email is accepted and the user can proceed to the next step.' }],
  future_actions: [{ step_id: 'later', action: 'Submit the signup form' }], ...extras });
const request = { name: 'browser_click', arguments: { locator: '#private-submit-target' } };
const inspect = (extras = {}) => browserActionOrderFeedback({ request, snapshot: snapshot(), execution: execution(), ...extras });

test('current data entry cannot execute an explicitly later native submission to satisfy its outcome', () => {
  const feedback = inspect();
  assert.equal(feedback.code, 'AUTOMATION_BROWSER_ACTION_OUT_OF_ORDER');assert.equal(feedback.step_id, 'current');
  assert.equal(feedback.action_outcome, 'not_attempted');assert.equal(feedback.retry_safe, true);
  assert.equal(feedback.issue_kind, 'expectation_mismatch');
  assert.doesNotMatch(JSON.stringify(feedback), /private-submit-target|Private signup label|valid_email|email|signup/);
  assert.match(feedback.message, /report the ordering conflict/);
});

test('the boundary applies to native input submit controls and normalized type casing', () => {
  for (const element of [target({ tag: 'input' }), target({ attributes: { type: 'SUBMIT' } })])
    assert.equal(inspect({ snapshot: snapshot([element]) }).code, 'AUTOMATION_BROWSER_ACTION_OUT_OF_ORDER');
});

test('current source actions, not projected task text or expected prose, own mutation authority', () => {
  assert.ok(inspect({ execution: execution('Enter @r.email', { action: 'Click submit', expected_result: 'Submit the form' }) }));
  const current = execution();current.source_obligations[0].expected_result = 'Submit the form to continue';
  assert.ok(inspect({ execution: current }));
  assert.equal(inspect({ execution: { ...current, source_obligations: undefined } }), null);
});

test('current submit, click, press, continuation and mixed actions retain the existing execution path', () => {
  for (const action of ['Submit the signup form', 'Click the button', 'Press Enter', 'Enter the email then submit the form',
    'Enter the email and click Next', 'Enter an email and proceed to the next step', 'Fill the field, then blur it',
    'Enter the value and verify the status', 'Open the signup form', 'Check the email field', 'Enter the details page',
    'Enter the field before submitting', 'Enter @r.value and invoke the workflow', 'Enter @r.value; invoke the workflow'])
    assert.equal(inspect({ execution: execution(action) }), null, action);
});

test('unknown languages and unrecognized action forms remain subject to the ordinary semantic review', () => {
  for (const action of ['Saisir le courriel', 'メールアドレスを入力してください', 'Введите адрес электронной почты',
    'The email address should be entered', '', 'Populate the 中文 field'])
    assert.equal(inspect({ execution: execution(action) }), null, action);
});

test('parameter names and quoted test data do not become additional authored actions', () => {
  for (const action of ['Enter @r.[click submit] in the field', 'Fill the field with "click submit"',
    'Type `press enter` into the field', 'Enter ‘submit’ in the field', 'Enter params["r.click submit"] in the field'])
    assert.ok(inspect({ execution: execution(action) }), action);
  assert.ok(inspect({ execution: execution("Enter the user's address into the field") }));
});

test('every nonempty current linked action must be narrowly entry-only before the boundary applies', () => {
  const current = execution();current.source_obligations.push({ id: 'manual', action: 'Enter the same address into the field', expected_result: 'The address remains' });
  assert.ok(inspect({ execution: current }));
  current.source_obligations[1].action = 'Enter the address then submit';
  assert.equal(inspect({ execution: current }), null);
  current.source_obligations[1].action = '';
  assert.ok(inspect({ execution: current }));
});

test('only an explicitly later host-authored submit action enables this narrow ordering boundary', () => {
  for (const future_actions of [[], [{ step_id: 'current', action: 'Submit the form' }], [{ step_id: 'later', action: 'Enter "submit" in a field' }],
    [{ step_id: 'later', action: 'Check the result', expected_result: 'Submit the form' }], [{ action: 'Submit the form' }],
    [{ step_id: 'later', action: 'Envoyer le formulaire' }]])
    assert.equal(inspect({ execution: execution(undefined, { future_actions }) }), null);
  assert.ok(inspect({ execution: execution(undefined, { future_actions: [{ step_id: 'later', action: 'Please submit the form' }] }) }));
});

test('current unique validated native targets are required; labels and default button behavior do not authorize inference', () => {
  for (const elements of [[], [target(), target()], [target({ locators_validated: false })], [target({ locator_candidates: ['#other'] })],
    [target({ tag: 'div', accessible_role: 'button' })], [target({ attributes: {} })], [target({ attributes: { type: 'button' } })],
    [target({ truncated_attributes: ['type'] })]]) assert.equal(inspect({ snapshot: snapshot(elements) }), null);
});

test('read-only, keyboard, unsupported snapshots and nonrequired executions are untouched', () => {
  for (const name of ['browser_assert', 'browser_snapshot', 'browser_fill', 'browser_press_key', 'browser_navigate'])
    assert.equal(inspect({ request: { ...request, name } }), null, name);
  assert.equal(inspect({ snapshot: { ...snapshot(), mcp_call: false } }), null);
  assert.equal(inspect({ snapshot: { ...snapshot(), result: { ...snapshot().result, isError: true } } }), null);
  assert.equal(inspect({ snapshot: { tool: 'browser_assert', result: snapshot().result } }), null);
  assert.equal(inspect({ execution: execution(undefined, { required: false }) }), null);
});
