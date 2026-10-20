const test = require('node:test');
const assert = require('node:assert/strict');
const { compactBrowserModelContext } = require('../../backend/lib/automationBrowserModelContext');

const target = index => ({ ref: `ref:abc123abc123:${index + 1}`, role: 'textbox', tag: 'input', name: `Field ${index}`,
  visible: true, disabled: false, in_viewport: true,
  text: index % 3 ? '' : 'Retain exact text bytes', text_truncated: index % 3 === 0,
  field_relationships: { evidence_scope: 'current_snapshot_targets_only', description_refs: [], error_refs: [], relationship_refs_incomplete: false } });
const context = (count = 27) => ({ active_step_id: 'current', current_snapshot: { observation_id: 'observed-page', url: 'https://app.test/login',
  scope: 'body', accessibility: '- main\n  - textbox "Email"', targets: Array.from({ length: count }, (_, index) => target(index)) },
  navigation_policy: { grounding_required: true }, pending_contract: { next_required: 'perform_remaining_goal_and_browser_assert' } });
function decode(current) {
  const decoded = structuredClone(current), snapshot = decoded?.current_snapshot;
  if (!snapshot?.target_defaults) return decoded;
  for (const row of snapshot.targets) for (const [key, value] of Object.entries(snapshot.target_defaults)) {
    if (!Object.hasOwn(row, key)) row[key] = value;
  }
  delete snapshot.target_defaults; delete snapshot.target_defaults_policy;
  return decoded;
}
function freeze(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}

test('common observed booleans compact losslessly while retaining every target, reference, string and relationship', () => {
  const original = freeze(context()), projected = compactBrowserModelContext(original);
  assert.deepEqual(projected.current_snapshot.target_defaults, { visible: true, disabled: false, in_viewport: true });
  assert.equal(projected.current_snapshot.targets.length, 27);
  assert.deepEqual(decode(projected), original);
  assert.ok(JSON.stringify(projected).length < JSON.stringify(original).length - 600);
  assert.ok(projected.current_snapshot.target_defaults_policy.length <= 220);
  assert.match(projected.current_snapshot.target_defaults_policy, /Other omitted fields remain unknown/);
  assert.match(projected.current_snapshot.target_defaults_policy, /not completed assertions/);
  assert.notEqual(projected, original); assert.notEqual(projected.current_snapshot, original.current_snapshot);
});

test('different boolean states remain explicit and the most frequent state determines each default', () => {
  const original = context();
  original.current_snapshot.targets[0].visible = false;
  original.current_snapshot.targets[1].disabled = true;
  original.current_snapshot.targets[2].in_viewport = false;
  const projected = compactBrowserModelContext(original);
  assert.equal(projected.current_snapshot.targets[0].visible, false);
  assert.equal(projected.current_snapshot.targets[1].disabled, true);
  assert.equal(projected.current_snapshot.targets[2].in_viewport, false);
  assert.deepEqual(decode(projected), original);
  original.current_snapshot.targets.forEach((row, index) => { row.visible = index < 20 ? false : true; });
  const reversed = compactBrowserModelContext(original);
  assert.equal(reversed.current_snapshot.target_defaults.visible, false);
  assert.equal(reversed.current_snapshot.targets[26].visible, true);
  assert.deepEqual(decode(reversed), original);
});

test('missing or nonboolean fields never inherit an observed value from another target', () => {
  for (const unknown of [undefined, null, 'false', 0, {}, []]) {
    const original = context();
    if (unknown === undefined) delete original.current_snapshot.targets[0].disabled;
    else original.current_snapshot.targets[0].disabled = unknown;
    const projected = compactBrowserModelContext(original);
    assert.equal(Object.hasOwn(projected.current_snapshot.target_defaults, 'disabled'), false);
    for (let index = 0; index < original.current_snapshot.targets.length; index++) {
      assert.equal(Object.hasOwn(projected.current_snapshot.targets[index], 'disabled'), Object.hasOwn(original.current_snapshot.targets[index], 'disabled'));
      assert.deepEqual(projected.current_snapshot.targets[index].disabled, original.current_snapshot.targets[index].disabled);
    }
    assert.deepEqual(decode(projected), original);
  }
});

test('empty, malformed and tiny target lists stay unchanged without an unearned legend', () => {
  for (const original of [undefined, null, {}, { current_snapshot: null }, { current_snapshot: { targets: [] } },
    { current_snapshot: { targets: [null, { visible: true }] } }, context(1)]) {
    assert.deepEqual(compactBrowserModelContext(original), original);
  }
});

test('existing legends cannot be overwritten and repeated packing is idempotent', () => {
  const first = compactBrowserModelContext(context());
  assert.deepEqual(compactBrowserModelContext(first), first);
  for (const extra of [{ target_defaults: { visible: 'unknown external meaning' } }, { target_defaults_policy: 'Existing metadata' }]) {
    const original = context(); Object.assign(original.current_snapshot, extra);
    assert.deepEqual(compactBrowserModelContext(original), original);
  }
});

test('privacy projection is preserved and no raw attributes, locators, values or new target facts appear', () => {
  const original = context();
  original.current_snapshot.targets[0].text = '[private parameter value]';
  original.current_snapshot.targets[0].visible_text = '[redacted] Dismiss';
  original.current_snapshot.targets[0].visible_text_truncated = false;
  const before = structuredClone(original), projected = compactBrowserModelContext(original);
  assert.deepEqual(original, before);
  assert.deepEqual(decode(projected), original);
  for (const [index, row] of projected.current_snapshot.targets.entries()) {
    assert.ok(Object.keys(row).every(key => Object.hasOwn(original.current_snapshot.targets[index], key)));
  }
  assert.doesNotMatch(JSON.stringify(projected), /"(?:attributes|locator_candidates|value|values|automation_code)":/);
  assert.equal(projected.current_snapshot.targets[0].text, '[private parameter value]');
  projected.current_snapshot.targets[0].field_relationships.error_refs.push('detached-only');
  assert.deepEqual(original.current_snapshot.targets[0].field_relationships.error_refs, []);
});
