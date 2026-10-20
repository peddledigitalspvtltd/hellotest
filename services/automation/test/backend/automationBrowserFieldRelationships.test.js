const test = require('node:test');
const assert = require('node:assert/strict');
const { projectModelSnapshot, resolveModelToolRequest } = require('../../backend/lib/automationBrowserModelTargets');
const { browserPromptContext } = require('../../backend/lib/automationBrowserContext');

const element = (name, attributes, extra = {}) => ({ tag: 'input', accessible_role: 'textbox', accessible_name: name, attributes,
  displayed: true, locators_validated: true, locator_candidates: [`#observed-${name.replace(/ /g, '-')}`], ...extra });
const snapshot = (elements, extra = {}) => ({ tool: 'browser_snapshot', result: { content: [{ type: 'text', text: JSON.stringify({
  source: 'playwright', observation_id: 'synthetic-snapshot', url: 'https://app.test/form', scope: 'body', elements, ...extra }) }] } });
const related = target => target.field_relationships;

test('compact current-snapshot relationships distinguish selected-field alerts from unrelated form feedback', () => {
  const observation = snapshot([
    element('Email', { id: 'private-structural-email', 'aria-describedby': 'private-structural-hint private-structural-error', value: 'never-expose-input-value' }),
    element('Password', { id: 'private-structural-password', 'aria-describedby': 'private-structural-password-error' }),
    element('Email hint', { id: 'private-structural-hint' }, { tag: 'p', accessible_role: 'note' }),
    element('Email error', { id: 'private-structural-error' }, { tag: 'span', accessible_role: 'alert', text: 'Email format needs review.' }),
    element('Password error', { id: 'private-structural-password-error' }, { tag: 'span', accessible_role: 'alert', text: 'Password is required.' }),
    element('Unrelated form alert', { id: 'private-structural-global-alert' }, { tag: 'div', accessible_role: 'alert', text: 'Another requirement is pending.' })
  ]);
  const current = browserPromptContext([observation], 'current', { compactModel: true }).current.current_snapshot;
  const [email, password, hint, emailError, passwordError, unrelated] = current.targets;
  assert.deepEqual(related(email), { evidence_scope: 'current_snapshot_targets_only', description_refs: [hint.ref, emailError.ref], error_refs: [emailError.ref], relationship_refs_incomplete: false });
  assert.deepEqual(related(password).error_refs, [passwordError.ref]);
  assert.ok(!related(email).error_refs.includes(passwordError.ref)); assert.ok(!related(email).error_refs.includes(unrelated.ref));
  assert.doesNotMatch(JSON.stringify(current), /private-structural|never-expose-input-value|#observed-|aria-describedby/);
  assert.equal(related(unrelated), undefined);
});

test('an already observed aria-errormessage association can reference a non-alert error target', () => {
  const [field, message] = projectModelSnapshot(snapshot([
    element('Input', { 'aria-errormessage': 'observed-message' }),
    element('Message', { id: 'observed-message' }, { tag: 'span', accessible_role: 'generic' })
  ])).targets;
  assert.deepEqual(related(field).description_refs, []); assert.deepEqual(related(field).error_refs, [message.ref]);
  assert.equal(related(field).relationship_refs_incomplete, false);
});

test('missing, private, ambiguous, omitted and clipped links remain incomplete snapshot evidence without structural verdicts', () => {
  const cases = [
    { attributes: { 'aria-describedby': 'not-in-bounded-snapshot' }, others: [] },
    { attributes: { 'aria-describedby': '[redacted_secret]' }, others: [] },
    { attributes: { 'aria-describedby': 'duplicate-id' }, others: [element('First', { id: 'duplicate-id' }), element('Second', { id: 'duplicate-id' })] },
    { attributes: { 'aria-describedby': 'unprojected-id' }, others: [element('Unprojected', { id: 'unprojected-id' }, { locators_validated: false })] },
    { attributes: { 'aria-describedby': 'clipped-id' }, others: [element('Clipped target', { id: 'clipped-id' }, { truncated_attributes: ['id'] })] },
    { attributes: { 'aria-describedby': 'clipped-association' }, extra: { truncated_attributes: ['aria-describedby'] }, others: [element('Clipped reference', { id: 'clipped-association' })] }
  ];
  for (const row of cases) {
    const field = projectModelSnapshot(snapshot([element('Input', row.attributes, row.extra), ...row.others])).targets[0];
    assert.deepEqual(related(field), { evidence_scope: 'current_snapshot_targets_only', description_refs: [], error_refs: [], relationship_refs_incomplete: true });
    assert.doesNotMatch(JSON.stringify(field), /not-in-bounded|redacted_secret|duplicate-id|unprojected-id|clipped-|unresolved|dangling|invalid/);
  }
  const partial = projectModelSnapshot(snapshot([element('Input', { 'aria-describedby': 'hint' }), element('Hint', { id: 'hint' })], { partial: true })).targets;
  assert.deepEqual(related(partial[0]).description_refs, [partial[1].ref]); assert.equal(related(partial[0]).relationship_refs_incomplete, true);
});

test('relationship token and total-edge allowances bound extra model context without exposing raw IDs', () => {
  const ids = Array.from({ length: 40 }, (_, index) => `private-id-${index}`);
  const fields = Array.from({ length: 3 }, (_, index) => element(`Input ${index}`, { 'aria-describedby': ids.join(' ') }));
  const messages = ids.map((id, index) => element(`Message ${index}`, { id }, { tag: 'span', accessible_role: 'alert' }));
  const page = projectModelSnapshot(snapshot([...fields, ...messages]));
  assert.deepEqual(page.targets.slice(0, 3).map(target => related(target).description_refs.length), [32, 32, 0]);
  assert.equal(page.targets.slice(0, 3).reduce((total, target) => total + related(target).error_refs.length, 0), 64);
  assert.ok(page.targets.slice(0, 3).every(target => related(target).relationship_refs_incomplete));
  const plain = projectModelSnapshot(snapshot([...fields.map(field => ({ ...field, attributes: {} })), ...messages]));
  assert.ok(Buffer.byteLength(JSON.stringify(page)) - Buffer.byteLength(JSON.stringify(plain)) < 8192);
  assert.doesNotMatch(JSON.stringify(page), /private-id-/);
  const dense = projectModelSnapshot(snapshot(Array.from({ length: 240 }, (_, index) => element(`Input ${index}`, { 'aria-describedby': 'not-sampled' }))));
  assert.equal(dense.targets.length, 120); assert.ok(Buffer.byteLength(JSON.stringify(dense)) < 64 * 1024);
});

test('relationship projections remain immutable evidence and cannot retarget tools or reuse an earlier snapshot', () => {
  const make = () => snapshot([element('Input', { 'aria-describedby': 'hint' }), element('Hint', { id: 'hint' })]);
  const current = make(), projected = projectModelSnapshot(current), field = projected.targets[0];
  const initial = structuredClone(related(field));
  related(field).description_refs.push('ref:000000000000:999');
  assert.deepEqual(related(projectModelSnapshot(current).targets[0]), initial);
  const request = { name: 'browser_assert', arguments: { assertion: 'visible', locator: initial.description_refs[0] } };
  assert.equal(resolveModelToolRequest(request, current).arguments.locator, '#observed-Hint');
  assert.throws(() => resolveModelToolRequest(request, make()), error => error.code === 'AUTOMATION_BROWSER_TARGET_REF_STALE');
});
