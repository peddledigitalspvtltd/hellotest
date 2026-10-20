const test = require('node:test');
const assert = require('node:assert/strict');
const { createBrowserBatchTargetResolver } = require('../../backend/lib/automationBrowserBatchTargets');
const { projectModelSnapshot, browserBatchTargetEvidence } = require('../../backend/lib/automationBrowserModelTargets');
let sequence = 0;
const control = { tag: 'button', accessible_role: 'button', accessible_name: 'Submit', attributes: { id: 'submit' }, locator_candidates: ['#submit'], locators_validated: true, displayed: true };
const result = (extra = {}) => ({ tag: 'p', accessible_role: 'alert', accessible_name: '', context_text: 'Registration result', text: 'Before', attributes: { id: 'result', 'data-testid': 'signup-result' }, locator_candidates: ['getByRole("alert")', 'getByTestId("signup-result")', '#result'], locators_validated: true, displayed: true, ...extra });
function observe(elements = [control, result()], page = {}, register = true) {
  const snapshot = { tool: 'browser_snapshot', result: { content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', observation_id: `snapshot-${++sequence}`, target_id: 'page-one', url: 'https://fixture.test/auth', scope: 'body', elements, ...page }) }] } };
  const model = register ? projectModelSnapshot(snapshot) : null;
  return { snapshot, model };
}
const request = (ref, extra = {}) => ({ name: 'browser_assert', occurrence: 3, arguments: { locator: ref, assertion: 'text_contains', value: '@r.expected_error', metadata: { preserve: true }, ...extra } });
const stale = fn => assert.throws(fn, error => error.code === 'AUTOMATION_BROWSER_TARGET_REF_STALE' && error.action_outcome === 'not_attempted');

test('same-batch result checks continue using an exact fresh stable alias without changing predicates or data', () => {
  const original = observe(), fresh = observe([control, result({ text: 'After', locator_candidates: ["getByTestId('signup-result')", '#result'] })]);
  const resolver = createBrowserBatchTargetResolver({ snapshot: original.snapshot });
  const proposed = request(original.model.targets[1].ref);
  stale(() => resolver.resolve(proposed, fresh.snapshot));
  const resolved = resolver.resolve(proposed, fresh.snapshot, { unchangedControls: true });
  assert.deepEqual(resolved, { ...proposed, arguments: { ...proposed.arguments, locator: "getByTestId('signup-result')" } });
  assert.equal(resolved.arguments.metadata, proposed.arguments.metadata);
  assert.equal(proposed.arguments.locator, original.model.targets[1].ref);
});

test('an unchanged single-ID control can continue after a fresh inspection', () => {
  const original = observe(), fresh = observe();
  const resolver = createBrowserBatchTargetResolver({ snapshot: original.snapshot });
  const proposed = { name: 'browser_click', arguments: { locator: original.model.targets[0].ref, button: 'left' } };
  assert.deepEqual(resolver.resolve(proposed, fresh.snapshot, { unchangedControls: true }), { ...proposed, arguments: { ...proposed.arguments, locator: '#submit' } });
});

test('stable-ID continuation retains the fresh host-preferred record scope', () => {
  const scoped = 'tr[data-row-id="record-a"] > button';
  const button = { ...control, locator_candidates: [scoped, '#submit'], record_scoped_locator: scoped, context_text: 'Record a' };
  const original = observe([button]), fresh = observe([button]);
  const resolver = createBrowserBatchTargetResolver({ snapshot: original.snapshot });
  assert.equal(resolver.resolve({ name: 'browser_click', arguments: { locator: original.model.targets[0].ref } }, fresh.snapshot, { unchangedControls: true }).arguments.locator, scoped);
});

test('normal current references and non-target tools retain their existing resolution', () => {
  const original = observe(), resolver = createBrowserBatchTargetResolver({ snapshot: original.snapshot });
  assert.equal(resolver.resolve(request(original.model.targets[1].ref), original.snapshot).arguments.locator, 'getByTestId("signup-result")');
  const navigation = { name: 'browser_navigate', arguments: { url: 'https://fixture.test/auth' } };
  assert.equal(resolver.resolve(navigation, null), navigation);
});

test('JSON copies and unregistered snapshots never gain authority from repeated continuation attempts', () => {
  const original = observe(), fresh = observe(), resolver = createBrowserBatchTargetResolver({ snapshot: original.snapshot });
  const proposed = request(original.model.targets[1].ref);
  for (const snapshot of [structuredClone(fresh.snapshot), observe(undefined, {}, false).snapshot]) {
    for (let i = 0; i < 2; i++) stale(() => resolver.resolve(proposed, snapshot, { unchangedControls: true }));
    assert.equal(browserBatchTargetEvidence(snapshot), null);
  }
  const copiedResolver = createBrowserBatchTargetResolver({ snapshot: structuredClone(original.snapshot) });
  stale(() => copiedResolver.resolve(proposed, fresh.snapshot, { unchangedControls: true }));
});

test('a resolver cannot import a reference from any previous model response or invented same-epoch target', () => {
  const previous = observe(), original = observe(), fresh = observe(), resolver = createBrowserBatchTargetResolver({ snapshot: original.snapshot });
  stale(() => resolver.resolve(request(previous.model.targets[1].ref), fresh.snapshot, { unchangedControls: true }));
  const invented = original.model.targets[1].ref.replace(/:2$/, ':99');
  stale(() => resolver.resolve(request(invented), fresh.snapshot, { unchangedControls: true }));
  assert.throws(() => resolver.resolve(request(invented), original.snapshot, { unchangedControls: true }), { code: 'AUTOMATION_BROWSER_TARGET_REF_INVALID' });
});

test('same-ID result target role, tag, name, row context and truncation changes remain stale', () => {
  const original = observe(), resolver = createBrowserBatchTargetResolver({ snapshot: original.snapshot }), proposed = request(original.model.targets[1].ref);
  for (const extra of [{ accessible_role: 'status' }, { tag: 'span' }, { accessible_name: 'Other result' }, { context_text: 'Different account row' }, { context_text_truncated: true }, { accessible_role_truncated: true }, { accessible_name_truncated: true }, { tag_truncated: true }, { attributes: { id: 'changed-id', 'data-testid': 'signup-result' } }, { truncated_attributes: ['id'] }]) {
    stale(() => resolver.resolve(proposed, observe([control, result(extra)]).snapshot, { unchangedControls: true }));
  }
});

test('changed stable IDs or ambiguous old/new aliases cannot retarget a queued operation', () => {
  const original = observe(), resolver = createBrowserBatchTargetResolver({ snapshot: original.snapshot }), proposed = request(original.model.targets[1].ref);
  const renamed = result({ attributes: { id: 'other', 'data-testid': 'other-result' }, locator_candidates: ['getByTestId("other-result")', '#other'] });
  stale(() => resolver.resolve(proposed, observe([control, renamed]).snapshot, { unchangedControls: true }));
  stale(() => resolver.resolve(proposed, observe([control, result(), result()]).snapshot, { unchangedControls: true }));
  const ambiguous = observe([control, result(), result()]);
  stale(() => createBrowserBatchTargetResolver({ snapshot: ambiguous.snapshot }).resolve(request(ambiguous.model.targets[1].ref), observe().snapshot, { unchangedControls: true }));
});

test('role/text, structural CSS and positional aliases do not become continuation contracts', () => {
  for (const locator of ['getByRole("alert")', 'getByText("Before", { exact: true })', 'main > p', '#result span', '#result:nth-child(2)', 'getByTestId("signup-result").first()', 'page.locator("#result")']) {
    const elements = [control, result({ locator_candidates: [locator] })], original = observe(elements), fresh = observe(elements);
    stale(() => createBrowserBatchTargetResolver({ snapshot: original.snapshot }).resolve(request(original.model.targets[1].ref), fresh.snapshot, { unchangedControls: true }));
  }
});

test('host unchanged-controls flag cannot override independently changed or incomplete page controls', () => {
  const original = observe(), resolver = createBrowserBatchTargetResolver({ snapshot: original.snapshot }), proposed = request(original.model.targets[1].ref);
  for (const extra of [{ disabled: true }, { accessible_name: 'Delete' }, { attributes: { id: 'other' }, locator_candidates: ['#other'] }]) {
    const fresh = observe([{ ...control, ...extra }, result()]);
    stale(() => resolver.resolve(proposed, fresh.snapshot, { unchangedControls: true }));
  }
  for (const page of [{ partial: true }, { elements_truncated: true }, { fields_truncated: true }, { scope: '#form' }, { url: 'https://fixture.test/other' }, { url_truncated: true }, { target_id: 'other-tab' }, { target_id: undefined }, { target_id_truncated: true }]) {
    stale(() => resolver.resolve(proposed, observe(undefined, page).snapshot, { unchangedControls: true }));
  }
});

test('older adapters without a stable page identity retain the safe stale-reference behavior', () => {
  const original = observe(undefined, { target_id: undefined }), fresh = observe(undefined, { target_id: undefined });
  stale(() => createBrowserBatchTargetResolver({ snapshot: original.snapshot }).resolve(request(original.model.targets[1].ref), fresh.snapshot, { unchangedControls: true }));
});

test('receipt replacement invalidates the original closure even if controls are later restored', () => {
  const original = observe(), fresh = observe(), resolver = createBrowserBatchTargetResolver({ snapshot: original.snapshot }), proposed = request(original.model.targets[1].ref);
  original.snapshot.result.content[0].text = fresh.snapshot.result.content[0].text;
  projectModelSnapshot(original.snapshot);
  stale(() => resolver.resolve(proposed, fresh.snapshot, { unchangedControls: true }));
});
