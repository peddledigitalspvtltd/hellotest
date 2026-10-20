const test = require('node:test');
const assert = require('node:assert/strict');
const { captureBrowserBatchState, browserBatchBoundary } = require('../../backend/lib/automationBrowserBatchState');

const control = (id, label = id, extra = {}) => ({ tag: 'input', role: 'textbox', label, attributes: { id, type: 'text' }, locator_candidates: [`#${id}`], displayed: true, ...extra });
const snapshot = (elements, extra = {}) => ({ url: 'https://app.test/auth', scope: 'body', elements, ...extra });
const state = (elements, extra) => captureBrowserBatchState(snapshot(elements, extra));
const nextFill = [{ name: 'browser_fill', arguments: { locator: '#email', value: 'private-value' } }];
const decide = (before, after, extra = {}) => browserBatchBoundary({ tool: 'browser_click', before, after, remainingTools: nextFill, ...extra });

test('same-URL signup controls pause stale follow-up input after a fresh snapshot', () => {
  const before = state([control('email'), control('password'), control('signup', 'Sign up', { tag: 'button', role: 'button' })]);
  assert.deepEqual(decide(before, captureBrowserBatchState({ url: before.url })), { pause: false, needs_snapshot: true, reason: 'inspect_after_interaction' });
  const after = state([control('full-name', 'Full name'), control('email'), control('password')]);
  assert.deepEqual(decide(before, after, { inspected: true }), { pause: true, needs_snapshot: false, reason: 'controls_changed' });
});

test('a click with unchanged complete controls continues after inspection instead of always ending the batch', () => {
  const current = state([control('email')]);
  assert.deepEqual(decide(current, current, { inspected: true }), { pause: false, needs_snapshot: false });
});

test('ordinary fills stay batched while navigation or focused-target changes invalidate later mutations', () => {
  const before = state([control('email')]);
  assert.deepEqual(decide(before, { url: before.url }, { tool: 'browser_fill' }), { pause: false, needs_snapshot: false });
  assert.equal(decide(before, { url: 'https://app.test/signup' }, { tool: 'browser_fill' }).reason, 'page_changed');
  assert.equal(decide({ ...before, target_id: 'tab-one' }, { ...before, target_id: 'tab-two' }, { tool: 'browser_fill' }).reason, 'target_changed');
  assert.equal(decide(before, before, { tool: 'browser_navigate' }).reason, 'inspect_after_navigation');
});

test('same-URL navigation may continue only after fresh complete controls confirm the same interface', () => {
  const before = state([control('email'), control('password')]);
  assert.deepEqual(decide(before, { url: before.url }, { tool: 'browser_navigate' }), { pause: false, needs_snapshot: true, reason: 'inspect_after_navigation' });
  assert.deepEqual(decide(before, state([control('email'), control('password')]), { tool: 'browser_navigate', inspected: true }), { pause: false, needs_snapshot: false });
  assert.equal(decide(before, state([control('full-name'), control('email')]), { tool: 'browser_navigate', inspected: true }).reason, 'controls_changed');
  assert.equal(decide(before, state([control('email'), control('password')], { partial: true }), { tool: 'browser_navigate', inspected: true }).reason, 'page_state_unavailable');
  assert.equal(decide(before, { url: before.url }, { tool: 'browser_navigate', inspected: true }).reason, 'page_state_unavailable');
});

test('different-URL or unknown initial navigation pauses queued mutations without declaring stale evidence safe', () => {
  const before = state([control('email')]);
  assert.equal(decide(before, state([control('email')], { url: 'https://app.test/signup' }), { tool: 'browser_navigate', inspected: true }).reason, 'page_changed');
  assert.equal(decide({}, before, { tool: 'browser_navigate' }).reason, 'navigation_action');
  assert.equal(decide({}, before, { tool: 'browser_navigate', inspected: true }).reason, 'navigation_action');
});

test('selection, checkbox, hover and key interactions re-observe before dependent mutations', () => {
  const before = state([control('country'), control('postal', 'Postal code', { disabled: true })]);
  const after = state([control('country'), control('postal', 'Postal code', { disabled: false })]);
  for (const tool of ['browser_select_option', 'browser_check', 'browser_uncheck', 'browser_hover', 'browser_press_key']) {
    assert.equal(decide(before, after, { tool }).needs_snapshot, true, tool);
    assert.equal(decide(before, after, { tool, inspected: true }).reason, 'controls_changed', tool);
  }
});

test('control changes after the first sixty entries remain detectable', () => {
  const controls = Array.from({ length: 90 }, (_, index) => control(`field-${index}`));
  const before = state(controls);
  const after = state(controls.map((entry, index) => index === 80 ? { ...entry, disabled: true } : entry));
  assert.equal(decide(before, after, { inspected: true }).reason, 'controls_changed');
});

test('native accessible-role and accessible-name changes invalidate same-URL custom controls', () => {
  const button = { tag: 'div', accessible_role: 'button', accessible_name: 'Choose account', attributes: {},
    locator_candidates: ['#account'], displayed: true, disabled: false };
  const before = state([button]);
  assert.equal(decide(before, state([{ ...button, accessible_name: 'Delete account' }]), { inspected: true }).reason, 'controls_changed');
  assert.equal(decide(before, state([{ ...button, accessible_role: 'link' }]), { inspected: true }).reason, 'controls_changed');
  assert.equal(decide(before, state([{ ...button, accessible_name_truncated: true }]), { inspected: true }).reason, 'page_state_unavailable');
});

test('dependent select choice values, labels and availability invalidate queued work while input selection alone does not', () => {
  const select = { tag: 'select', accessible_role: 'combobox', accessible_name: 'Region', attributes: { id: 'region' },
    locator_candidates: ['#region'], displayed: true, disabled: false, options_truncated: false,
    options: [{ label: 'Select region', value: '', selected: true, disabled: false }, { label: 'North', value: 'north', selected: false, disabled: false }] };
  const before = state([select]);
  const options = [...select.options];
  for (const replacement of [{ ...options[1], value: 'south' }, { ...options[1], label: 'South' }, { ...options[1], disabled: true }]) {
    assert.equal(decide(before, state([{ ...select, options: [options[0], replacement] }]), { tool: 'browser_select_option', inspected: true }).reason, 'controls_changed');
  }
  assert.deepEqual(decide(before, state([{ ...select, options: options.map(option => ({ ...option, selected: !option.selected })) }]),
    { tool: 'browser_select_option', inspected: true }), { pause: false, needs_snapshot: false });
  assert.doesNotMatch(JSON.stringify(before), /North|north|Region|#region/);
});

test('incomplete select options cannot establish that dependent choices remained unchanged', () => {
  const select = control('region', 'Region', { tag: 'select', role: 'combobox',
    options: [{ label: 'North', value: 'north', disabled: false }] });
  const before = state([select]);
  for (const extra of [{ options: undefined }, { options_truncated: true },
    { options: [{ label: 'North', value_excerpt: 'north', value_truncated: true }] },
    { options: [{ label: 'North', value: 'north', label_truncated: true }] }]) {
    assert.equal(decide(before, state([{ ...select, ...extra }]), { inspected: true }).reason, 'page_state_unavailable');
  }
});

test('changed link destinations and disclosure associations pause queued interactions on the same controls', () => {
  const link = control('next', 'Continue', { tag: 'a', role: 'link', attributes: { id: 'next', href: 'https://app.test/preview' } });
  const before = state([link]);
  assert.equal(decide(before, state([{ ...link, attributes: { ...link.attributes, href: 'https://app.test/confirm' } }]), { inspected: true }).reason, 'controls_changed');
  const prefix = 'https://app.test/preview?context=' + 'x'.repeat(220);
  const longLink = { ...link, attributes: { ...link.attributes, href: prefix + '&operation=preview' } };
  assert.equal(decide(state([longLink]), state([{ ...longLink, attributes: { ...longLink.attributes, href: prefix + '&operation=confirm' } }]), { inspected: true }).reason, 'controls_changed',
    'a fully observed destination suffix must not be silently omitted from its fingerprint');
  const disclosure = control('menu', 'Options', { tag: 'button', role: 'button', attributes: { id: 'menu', 'aria-controls': 'account-menu', 'aria-expanded': 'false' } });
  assert.equal(decide(state([disclosure]), state([{ ...disclosure, attributes: { ...disclosure.attributes, 'aria-controls': 'danger-menu' } }]), { inspected: true }).reason, 'controls_changed');
});

test('unknown, partial, scoped or truncated inspection cannot prove that stale controls stayed unchanged', () => {
  const before = state([control('email')]);
  for (const extra of [{ partial: true }, { truncated: true }, { elements_truncated: true }, { fields_truncated: true }, { scope: '#form' }]) {
    const after = state([control('email')], extra);
    assert.equal(decide(before, after, { inspected: true }).reason, 'page_state_unavailable', JSON.stringify(extra));
  }
  assert.equal(decide(before, captureBrowserBatchState(null), { inspected: true }).reason, 'page_state_unavailable');
});

test('input values, result text and raw control labels are not copied into batch-state metadata', () => {
  const before = state([control('email', 'Private field'), { tag: 'output', role: 'status', text: 'private-result-before' }]);
  const after = state([control('email', 'Private field', { value: 'secret-input', attributes: { id: 'email', type: 'text', value: 'secret-input' } }), { tag: 'output', role: 'status', text: 'private-result-after' }]);
  assert.equal(before.controls_fingerprint, after.controls_fingerprint);
  assert.doesNotMatch(JSON.stringify(after), /secret-input|Private field|private-result/);
});

test('a final action or page-level read-only tail needs no batch-boundary snapshot', () => {
  const before = state([control('email')]);
  for (const remainingTools of [[], ['browser_snapshot', 'browser_assert', 'browser_screenshot']]) {
    assert.deepEqual(decide(before, {}, { remainingTools }), { pause: false, needs_snapshot: false });
  }
  assert.deepEqual(decide(before, {}, { tool: 'browser_assert' }), { pause: false, needs_snapshot: false });
});

test('same-URL screen transitions invalidate queued assertions and other reads against old targets', () => {
  const before = state([control('email'), control('signup', 'Sign up', { tag: 'button', role: 'button' })]);
  const after = state([control('full-name', 'Full name'), control('email'), control('create', 'Sign Up', { tag: 'button', role: 'button' })]);
  for (const name of ['browser_assert', 'browser_validate_locator', 'browser_wait_for', 'browser_snapshot']) {
    const remainingTools = [{ name, arguments: { locator: 'ref:old-page:2', ...(name === 'browser_assert' ? { assertion: 'visible' } : {}) } }];
    assert.equal(decide(before, { url: before.url }, { remainingTools }).needs_snapshot, true, name);
    assert.equal(decide(before, after, { remainingTools, inspected: true }).reason, 'controls_changed', name);
    assert.deepEqual(decide(before, before, { remainingTools, inspected: true }), { pause: false, needs_snapshot: false }, name);
  }
});

test('URL/title assertions and unscoped evidence remain available immediately after navigation', () => {
  const before = state([control('email')]);
  const remainingTools = [
    { name: 'browser_assert', arguments: { assertion: 'url', value: 'https://app.test/signup' } },
    { name: 'browser_assert', arguments: { assertion: 'title', value: 'Signup' } },
    { name: 'browser_snapshot', arguments: {} },
    { name: 'browser_screenshot', arguments: {} }
  ];
  assert.deepEqual(decide(before, { url: 'https://app.test/signup' }, { tool: 'browser_navigate', remainingTools }), { pause: false, needs_snapshot: false });
  const targetRead = { name: 'browser_assert', arguments: { assertion: 'visible', locator: '#email' } };
  assert.equal(decide(before, { url: 'https://app.test/signup' }, { tool: 'browser_navigate', remainingTools: [...remainingTools, targetRead] }).reason, 'page_changed');
  assert.deepEqual(decide(before, { url: before.url }, { tool: 'browser_fill', remainingTools: [targetRead] }), { pause: false, needs_snapshot: false });
});
