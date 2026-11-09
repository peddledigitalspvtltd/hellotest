const test = require('node:test');
const assert = require('node:assert/strict');
const { authoredTerminalAction, originalTerminalPlan, createAutomationTerminalActionGate } = require('../../backend/lib/automationTerminalActionGate');
const { projectModelSnapshot } = require('../../backend/lib/automationBrowserModelTargets');
const { recordBrowserOperation } = require('../../backend/lib/automationBrowserRecording');
const receipt = (value, isError = false) => ({ isError, content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', ...value }) }] });
const execution = action => ({ required: true, step_id: 'current', source_obligations: [{ action }, { action }] });
function fixture(action, name = 'Login', extra = {}) {
  const browser = {}, current = execution(action), gate = createAutomationTerminalActionGate({ browser, execution: current });
  const element = { tag: 'button', accessible_role: 'button', accessible_name: name, attributes: { type: 'submit', id: 'terminal' },
    displayed: true, locators_validated: true, locator_candidates: ['#terminal'], ...extra };
  const snapshot = { tool: 'browser_snapshot', result: receipt({ url: 'https://fixture.test/before', observation_id: 'fixture', elements: [element] }) };
  projectModelSnapshot(snapshot);
  const request = { name: 'browser_click', arguments: { locator: '#terminal' } };
  const complete = (id = 'native-action', overrides = {}) => {
    const observation = { tool: 'browser_click', execution_step_id: 'current', action_id: id, result: receipt({ action_outcome: 'completed', url: 'https://fixture.test/after' }), ...overrides };
    recordBrowserOperation(observation, request, { snapshot });
    gate.record(observation, request, snapshot);
    return observation;
  };
  return { browser, current, gate, snapshot, request, complete };
}

test('actual compound login, Save once, Search filter and Next have a final explicit terminal intent', () => {
  for (const [action, control] of [
    ['Enter @r.orangehrm_username in Username, enter @r.orangehrm_password in Password, then click Login.', 'login'],
    ['Click Save once.', 'save'], ['Filter Event Name by @r.employee_first_name and click Search.', 'search'],
    ['Verify Auto Generate Employee ID is checked, Create Login Details is unchecked and Initiate Preboarding is unchecked, then click Next.', 'next'],
    ['Click the "Save" button once', 'save'], ['Click `Log In`', 'login'], ['Click Login;verify the Dashboard is visible.', 'login']
  ]) assert.deepEqual(authoredTerminalAction(action), { control, occurrence: 1 }, action);
});

test('quotes, parameters, URLs, expectations and unknown high-level goals cannot supply terminal intent', () => {
  for (const action of ['Enter "click Save" in the field', 'Enter @r.[click Login] in Username',
    'Navigate to https://fixture.test/click/Login?then=Save', 'Click "Login then click Save"', 'Click Login and create an employee',
    'Create an employee', 'Verify Login is visible', 'Do not click Save', 'Click Login if ready', '"Click Login"',
    'Click Login then enter @r.filter in Search', 'Click Login and click Employee Management']) assert.equal(authoredTerminalAction(action), null, action);
  assert.equal(originalTerminalPlan({ ...execution('Create an employee'), action: 'Click Save', expected_result: 'Click Save' }), null);
  assert.equal(originalTerminalPlan({ ...execution('Click Save'), source_obligations: [{ action: 'Click Save' }, { action: 'Create employee' }] }), null);
});

test('explicit later mutations prevent premature locking and duplicate obligations do not add occurrences', () => {
  assert.deepEqual(originalTerminalPlan(execution('Click Login and enter @r.filter in Search then click Search')), { control: 'search', occurrence: 1 });
  const context = fixture('Click Login, enter @r.filter in Filter, then click Search');
  context.complete(); assert.equal(context.gate.policy(), null, 'Login is not the final authored mutation');
  const dropdown = fixture('Click "Login" then select the account option then enter @r.password in Password then click Submit');
  dropdown.complete(); assert.equal(dropdown.gate.policy(), null, 'opening a Login dropdown cannot close remaining authored selection, entry and submission');
  assert.deepEqual(originalTerminalPlan(execution('Click Login then enter @r.password in Password then click Login')), { control: 'login', occurrence: 2 });
  const twice = fixture('Click Login then enter @r.password in Password then click Login');
  twice.complete('first'); assert.equal(twice.gate.policy(), null);
  twice.complete('first'); assert.equal(twice.gate.policy(), null, 'one native action ID cannot count twice');
  twice.complete('second'); assert.equal(twice.gate.policy().completed_action_id, 'second');
});

test('confirmed native terminal receipt permanently closes mutations for this browser and section, regardless of new targets/occurrences', () => {
  for (const label of ['Login', 'Save', 'Search', 'Next', 'Submit']) {
    const context = fixture(`Click ${label}`, label);
    assert.equal(context.gate.policy(), null);
    context.complete();
    assert.equal(context.gate.policy().kind, 'post_terminal_verification_only');
    for (const name of ['browser_fill', 'browser_click', 'browser_navigate', 'browser_press_key', 'browser_select_option', 'browser_check', 'browser_uncheck', 'browser_hover']) {
      const feedback = context.gate.feedback({ name, arguments: { locator: '#different', value: '@r.password' }, occurrence: 2 });
      assert.equal(feedback.phase, 'post_terminal_verification_only'); assert.equal(feedback.action_outcome, 'not_attempted');
    }
    for (const name of ['browser_snapshot', 'browser_assert', 'browser_validate_locator', 'browser_screenshot']) assert.equal(context.gate.feedback({ name, arguments: {} }), null);
    assert.ok(createAutomationTerminalActionGate({ browser: context.browser, execution: context.current }).policy(), 'same browser and step retain the phase across attempts');
    assert.equal(createAutomationTerminalActionGate({ browser: {}, execution: context.current }).policy(), null, 'new session does not inherit an old browser phase');
    assert.equal(createAutomationTerminalActionGate({ browser: context.browser, execution: { ...context.current, step_id: 'next' } }).policy(), null);
  }
});

test('failed, unknown, copied or unregistered observations cannot close the phase', () => {
  for (const overrides of [
    { result: receipt({ action_outcome: 'unknown' }) }, { result: receipt({ action_outcome: 'completed' }, true) },
    { mcp_call: false }, { execution_step_id: 'other' }
  ]) { const context = fixture('Click Login'); context.complete('native-action', overrides); assert.equal(context.gate.policy(), null); }
  const context = fixture('Click Login');
  const unprotected = { tool: 'browser_click', execution_step_id: 'current', action_id: 'model-claim', result: receipt({ action_outcome: 'completed' }) };
  context.gate.record(unprotected, context.request, context.snapshot); assert.equal(context.gate.policy(), null);
  const copy = structuredClone(context.snapshot);
  const real = { tool: 'browser_click', execution_step_id: 'current', action_id: 'native-action', result: receipt({ action_outcome: 'completed' }) };
  recordBrowserOperation(real, context.request, { snapshot: context.snapshot });
  context.gate.record(real, context.request, copy); assert.equal(context.gate.policy(), null, 'copied snapshot is not registered native target evidence');
});

test('native observed terminal name, control type and complete target metadata must match original intent', () => {
  for (const [name, extra] of [ ['Login menu', {}], ['Employee Management', {}], ['Login', { tag: 'span', accessible_role: 'generic' }],
    ['Login', { tag: 'input', attributes: { type: 'text' } }],
    ['Login', { accessible_name_truncated: true }], ['Login', { displayed: false }], ['Login', { disabled: true }] ]) {
    const context = fixture('Click Login', name, extra); context.complete(); assert.equal(context.gate.policy(), null);
  }
});

test('after terminal completion only an already host-approved non-submit disclosure can be excepted', () => {
  const context = fixture('Click Save', 'Save'); context.complete();
  const disclosure = { tool: 'browser_snapshot', result: receipt({ url: 'https://fixture.test/after', observation_id: 'after', elements: [
    { tag: 'button', accessible_role: 'button', accessible_name: 'Details', attributes: { type: 'button', 'aria-expanded': 'false' }, displayed: true, locators_validated: true, locator_candidates: ['#details'] },
    { tag: 'button', accessible_role: 'button', accessible_name: 'Save', attributes: { type: 'submit', 'aria-expanded': 'false' }, displayed: true, locators_validated: true, locator_candidates: ['#save'] },
    { tag: 'a', accessible_role: 'link', accessible_name: 'Employee Management', attributes: { href: '/employees' }, displayed: true, locators_validated: true, locator_candidates: ['#employees'] }
  ] }) }; projectModelSnapshot(disclosure);
  const request = locator => ({ name: 'browser_click', arguments: { locator } });
  assert.ok(context.gate.feedback(request('#details'), { snapshot: disclosure }));
  assert.equal(context.gate.feedback(request('#details'), { snapshot: disclosure, approvedPrerequisite: true }), null);
  for (const locator of ['#save', '#employees']) assert.ok(context.gate.feedback(request(locator), { snapshot: disclosure, approvedPrerequisite: true }));
});
