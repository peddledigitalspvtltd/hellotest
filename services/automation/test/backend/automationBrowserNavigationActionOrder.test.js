const test = require('node:test');
const assert = require('node:assert/strict');
const { browserActionOrderFeedback, browserCurrentActionPolicy } = require('../../backend/lib/automationBrowserActionOrder');
const execution = (action = 'Navigate http://localhost:8080/auth', extra = {}) => ({ required: true, step_id: 'current',
  source_obligations: [{ id: 'current', source: 'section', action, expected_result: 'The sign-in form is displayed' }], ...extra });
const inspect = (name = 'browser_fill', active = execution()) => browserActionOrderFeedback({ request: { name, arguments: { locator: '#private-field', value: 'private-literal-input' } }, execution: active });

test('a pure authored URL-navigation section cannot borrow later form interactions from the global brief', () => {
  for (const tool of ['browser_fill', 'browser_click', 'browser_press_key', 'browser_select_option', 'browser_check', 'browser_uncheck', 'browser_hover']) {
    const feedback = inspect(tool, execution(undefined, { action: 'Enter @r.email and sign in', expected_result: 'Submit the form', future_actions: [{ step_id: 'later', action: 'Enter @r.email' }] }));
    assert.equal(feedback.code, 'AUTOMATION_BROWSER_ACTION_OUT_OF_ORDER', tool);
    assert.equal(feedback.remaining_contract, 'complete_current_authored_navigation_and_checks');
    assert.equal(feedback.action_outcome, 'not_attempted');
    assert.equal(feedback.retry_safe, true);
    assert.doesNotMatch(JSON.stringify(feedback), /localhost|private-field|private-literal|@r\.email/);
  }
});

test('navigation, snapshots and native read-only expected-result checks remain available', () => {
  for (const tool of ['browser_navigate', 'browser_snapshot', 'browser_assert', 'browser_validate_locator', 'browser_wait_for', 'browser_screenshot']) assert.equal(inspect(tool), null, tool);
});

test('the exported navigation policy narrows discovery without exposing targets, URLs or granting missing tools', () => {
  const policy = browserCurrentActionPolicy(execution());
  assert.equal(policy.kind, 'navigation_only');
  assert.equal(policy.scope, 'current_pinned_actions');
  assert.equal(policy.source, 'original_source_obligations');
  assert.equal(policy.interactive_actions_allowed, false);
  assert.deepEqual(policy.allowed_tools, ['browser_navigate', 'browser_snapshot', 'browser_assert', 'browser_validate_locator', 'browser_wait_for', 'browser_screenshot']);
  const discovered = [{ name: 'browser_fill' }, { name: 'browser_assert' }, { name: 'browser_click' }];
  assert.deepEqual(discovered.filter(tool => policy.allowed_tools.includes(tool.name)), [discovered[1]]);
  assert.doesNotMatch(JSON.stringify(policy), /localhost|auth|private|email|password/);
  assert.equal(Object.isFrozen(policy), true); assert.equal(Object.isFrozen(policy.allowed_tools), true);
});

test('unknown and compound instructions never produce a narrower advertised action policy', () => {
  for (const action of ['Navigate https://app.test and enter the email', 'Open the sign-in screen', 'Navigate @r.url', 'メールを入力する', '']) {
    assert.equal(browserCurrentActionPolicy(execution(action)), undefined, action);
  }
  assert.equal(browserCurrentActionPolicy(execution(undefined, { required: false })), undefined);
  assert.equal(browserCurrentActionPolicy(execution(undefined, { source_obligations: undefined })), undefined);
  const active = execution(); active.source_obligations.push({ action: 'Enter @r.email' });
  assert.equal(browserCurrentActionPolicy(active), undefined);
});

test('only a narrowly recognized explicit HTTP URL action activates this safeguard', () => {
  for (const action of ['Navigate http://localhost:8080/auth', 'Navigate to https://app.test/sign-in?tenant=one&next=/home#form',
    'Please go to "https://app.test/sign-in?next=/home".', 'Open `https://app.test/`', "Visit 'https://app.test/sign-in'!", '  PLEASE NAVIGATE TO https://app.test/  ']) assert.ok(inspect('browser_fill', execution(action)), action);
  for (const action of ['Navigate to /auth', 'Navigate @r.url', 'Open the sign-in form', 'Click the sign-in link', 'Navigate javascript:alert(1)',
    'Navigate http://user:private-secret@app.test/', 'Navigate mailto:synthetic@example.test', 'Navigate http://', 'Navigate "https://app.test /login"',
    '<p>Navigate https://app.test/</p>', 'Aller à https://app.test/', 'https://app.test/', '', 'x'.repeat(20_001)]) assert.equal(inspect('browser_fill', execution(action)), null, action.slice(0, 80));
});

test('compound or conditional navigation retains the ordinary actor and reviewer path', () => {
  for (const action of ['Navigate http://localhost:8080/auth and enter @r.email', 'Open https://app.test then click Continue',
    'Visit https://app.test; enter a value', 'Navigate https://app.test\nEnter the value', 'Before entering data, navigate https://app.test',
    'Navigate https://app.test and verify the page', 'Go to https://app.test after choosing the tenant', 'Open "https://app.test/ and click Continue"']) assert.equal(inspect('browser_fill', execution(action)), null, action);
});

test('every nonempty original obligation must be navigation-only; projected prose cannot create this boundary', () => {
  const active = execution();
  active.source_obligations.push({ id: 'manual:linked:nav', source: 'manual_step', action: 'Visit https://app.test/login', expected_result: 'The login form is shown' });
  assert.ok(inspect('browser_fill', active));
  active.source_obligations.push({ id: 'check-only', action: '', expected_result: 'The email field is visible' });
  assert.ok(inspect('browser_fill', active));
  active.source_obligations[1].action = 'Enter @r.email';
  assert.equal(inspect('browser_fill', active), null);
  assert.equal(inspect('browser_fill', execution(undefined, { source_obligations: undefined })), null);
  assert.equal(inspect('browser_fill', execution(undefined, { source_obligations: [{ action: undefined }] })), null);
  assert.equal(inspect('browser_fill', execution(undefined, { source_obligations: [] })), null);
  assert.equal(inspect('browser_fill', execution(undefined, { required: false })), null);
});

test('URL bytes classify the action only and never enter executable navigation or authorization feedback', () => {
  const active = execution('Navigate "https://app.test/path.?next=%2Fprivate%3Fand%3Dsubmit&code=private-query#opaque".');
  const before = structuredClone(active);
  const feedback = inspect('browser_fill', active);
  assert.ok(feedback);
  assert.deepEqual(active, before);
  assert.equal(feedback.url, undefined);
  assert.doesNotMatch(JSON.stringify(feedback), /private-query|code=|app\.test|opaque/);
});

test('the browser actor blocks a later fill during navigation, then checks and saves the current goal without replay', async () => {
  const { runAutomationBrowserAgent } = require('../../backend/lib/automationBrowserAgent');
  const calls = [], saves = [], observations = [];
  const receipt = value => ({ content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', url: 'http://localhost:8080/auth', ...value }) }] });
  const page = () => receipt({ observation_id: 'login-page', title: 'Sign in', scope: 'body', accessibility: '- textbox "Email"', elements: [
    { tag: 'input', attributes: { id: 'email', type: 'email' }, role: 'textbox', accessible_name: 'Email', displayed: true, disabled: false, locators_validated: true, locator_candidates: ['#email'] }
  ] });
  const source = execution();
  Object.assign(source, { action: source.source_obligations[0].action, expected_result: source.source_obligations[0].expected_result,
    semantic_review_required: true, obligations: source.source_obligations });
  let actors = 0, reviews = 0;
  const result = await runAutomationBrowserAgent({ prompt: 'Global case brief: navigate, then enter the configured credentials and submit.', execution: source,
    actorMode: true, startUrl: 'http://localhost:8080/auth', parse: JSON.parse,
    browser: { tools: ['browser_navigate', 'browser_snapshot', 'browser_fill', 'browser_assert'].map(name => ({ name, inputSchema: { type: 'object' } })),
      call: async (name, args) => { calls.push({ name, args }); return name === 'browser_snapshot' ? page() : receipt(name === 'browser_assert' ? { assertion_outcome: 'satisfied' } : { action_outcome: 'completed' }); } },
    onObservation: value => observations.push(value), onPartialBuild: async value => { saves.push(value); return { generation_complete: true }; },
    complete: async prompt => {
      if (prompt.includes('"phase":"semantic_review"')) {
        reviews++;
        const review = JSON.parse(prompt.split('\n').at(-1));
        return JSON.stringify({ decision: 'accept', obligations: review.obligations.map(row => ({ id: row.id, action_operations: [1], assertion_operations: [2] })), issues: [] });
      }
      actors++;
      if (actors === 1) return JSON.stringify({ stage: 'act', step_id: 'current', section_complete: false, tool_calls: [{ name: 'browser_fill', arguments: { locator: '#email', value: '@r.email' } }] });
      assert.equal(calls.filter(row => row.name === 'browser_fill').length, 0);
      assert.match(prompt, /complete_current_authored_navigation_and_checks/);
      assert.match(prompt, /AUTOMATION_BROWSER_ACTION_OUT_OF_ORDER/);
      return JSON.stringify({ stage: 'act', step_id: 'current', section_complete: true, tool_calls: [{ name: 'browser_assert', arguments: { assertion: 'visible', locator: '#email' } }] });
    }
  });
  assert.equal(actors, 2); assert.equal(reviews, 1); assert.equal(saves.length, 1);
  assert.equal(calls.filter(row => row.name === 'browser_navigate').length, 1);
  assert.equal(calls.filter(row => row.name === 'browser_fill').length, 0);
  assert.equal(calls.filter(row => row.name === 'browser_assert').length, 1);
  assert.match(result.steps[0].automation_code, /\.goto\(/);
  assert.match(result.steps[0].automation_code, /toBeVisible/);
  assert.doesNotMatch(result.steps[0].automation_code, /\.fill\(|r\.email/);
  assert.ok(observations.some(row => row.tool === 'automation_action_order_feedback' && row.mcp_call === false));
});
