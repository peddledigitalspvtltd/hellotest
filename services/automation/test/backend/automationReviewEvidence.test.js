const test = require('node:test');
const assert = require('node:assert/strict');
const { renderedTransition, canonicalReviewEvidence } = require('../../backend/lib/automationReviewEvidence');
const { recordBrowserOperation } = require('../../backend/lib/automationBrowserRecording');

const receipt = (value, isError = false) => ({ isError, content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', ...value }) }] });
const target = (id, role, name, attributes = {}) => ({ tag: role === 'textbox' ? 'input' : role === 'heading' ? 'h2' : 'button', accessible_role: role, accessible_name: name,
  text: role === 'textbox' ? '' : name, displayed: true, disabled: false, attributes, locators_validated: true, locator_candidates: [`#${id}`] });
function snapshot(elements, extra = {}) {
  return { tool: 'browser_snapshot', execution_step_id: 'section', result: receipt({ observation_id: 'observed', captured_at: '2026-10-17T00:00:00Z', scope: 'body',
    url: 'https://app.test/auth', title: 'Sign In · Application', elements, ...extra }) };
}
function operation(name, args) {
  const observation = { tool: name, execution_step_id: 'section', result: receipt(name === 'browser_assert' ? { assertion_outcome: 'satisfied' } : { action_outcome: 'completed' }) };
  recordBrowserOperation(observation, { name, arguments: args });return observation;
}
const before = () => snapshot([target('heading', 'heading', 'Sign in'), target('email', 'textbox', 'Email'), target('register', 'button', 'Create account')]);
const after = extra => snapshot([target('heading', 'heading', 'Create an account'), target('full-name', 'textbox', 'Full name'), target('email', 'textbox', 'Email'), target('register-submit', 'button', 'Create account', { type: 'submit' })], extra);

test('SPA rendered changes remain explicit when the address bar and document title stay unchanged', () => {
  const observations = [operation('browser_navigate', { url: 'https://app.test/' }), before(), operation('browser_click', { locator: '#register' }), after(), operation('browser_assert', { assertion: 'visible', locator: '#register-submit' })];
  const evidence = renderedTransition({ observations, stepId: 'section', snapshot: observations[3] });
  assert.equal(evidence.rendered_transition.baseline_available, true);assert.equal(evidence.rendered_transition.observed_change, true);
  assert.equal(evidence.rendered_transition.after.observed_after_latest_action, true);assert.equal(evidence.rendered_transition.absence_claims_supported, false,
    'nonpartial body snapshots still contain sampled targets and cannot establish page-wide absence');
  assert.ok(evidence.rendered_transition.added.some(row => row.name === 'Full name'));
  assert.ok(evidence.rendered_transition.removed.some(row => row.name === 'Create account' && row.input_type !== 'submit'));
  assert.ok(evidence.rendered_transition.state_changes.some(row => row.before.name === 'Sign in' && row.after.name === 'Create an account'));
  assert.equal(evidence.page_metadata_context.url_changed, false);assert.equal(evidence.page_metadata_context.title_changed, false);
  assert.equal(evidence.page_metadata_context.evidence_role, 'requested_subjects_only');assert.equal(evidence.rendered_transition.change_is_business_success, false);
});

test('a completed click on an unchanged wrong panel does not manufacture a rendered transition', () => {
  const observations = [before(), operation('browser_click', { locator: '#register' }), before(), operation('browser_assert', { assertion: 'visible', locator: '#heading' })];
  const { rendered_transition: evidence } = renderedTransition({ observations, stepId: 'section', snapshot: observations[2] });
  assert.equal(evidence.observed_change, false);assert.deepEqual(evidence.added, []);assert.deepEqual(evidence.removed, []);assert.deepEqual(evidence.state_changes, []);
  assert.equal(evidence.change_is_business_success, false);
});

test('partial, scoped, or old snapshots cannot establish absence or imply a complete post-action observation', () => {
  for (const extra of [{ partial: true }, { scope: '#main' }, { elements_truncated: true }, { fields_truncated: true }, { truncated: true }, { accessibility_truncated: true },
    { elements: [{ ...target('heading', 'heading', 'Truncated heading'), accessible_name_truncated: true }] },
    { elements: [target('heading', 'heading', 'x'.repeat(220))] }]) {
    const observations = [before(), operation('browser_click', { locator: '#register' }), after(extra)];
    const evidence = renderedTransition({ observations, stepId: 'section', snapshot: observations[2] }).rendered_transition;
    assert.equal(evidence.absence_claims_supported, false);
  }
  const observations = [before(), operation('browser_click', { locator: '#register' })];
  const evidence = renderedTransition({ observations, stepId: 'section', snapshot: observations[0] }).rendered_transition;
  assert.equal(evidence.after.observed_after_latest_action, false);assert.equal(evidence.absence_claims_supported, false);
  const noBaseline = [operation('browser_navigate', { url: 'https://app.test/' }), after()];
  const missing = renderedTransition({ observations: noBaseline, stepId: 'section', snapshot: noBaseline[1] }).rendered_transition;
  assert.equal(missing.baseline_available, false);assert.equal(missing.observed_change, false);assert.equal(missing.absence_claims_supported, false);
});

test('target differences remain bounded and disclose their sampling limits', () => {
  const many = snapshot(Array.from({ length: 160 }, (_, index) => target(`field-${index}`, 'textbox', `Field ${index}`)));
  const observations = [before(), operation('browser_click', { locator: '#register' }), many];
  const evidence = renderedTransition({ observations, stepId: 'section', snapshot: many }).rendered_transition;
  assert.equal(evidence.after.partial, true);assert.equal(evidence.after.target_count, 160);assert.equal(evidence.added.length, 24);assert.equal(evidence.changes_truncated, true);assert.equal(evidence.absence_claims_supported, false);
});

test('only exact duplicate predicates in the same observed action/failure/page epoch share rejected-review identity', () => {
  const initial = [before(), operation('browser_click', { locator: '#register' }), after(), operation('browser_assert', { assertion: 'visible', locator: '#register-submit' })];
  const check = () => operation('browser_assert', { assertion: 'visible', locator: '#register-submit' });
  const same = [...initial, after({ observation_id: 'new-id', captured_at: '2026-10-17T00:00:01Z' }), check()];
  assert.deepEqual(canonicalReviewEvidence({ observations: same, stepId: 'section' }), canonicalReviewEvidence({ observations: initial, stepId: 'section' }));
  for (const additions of [[operation('browser_assert', { assertion: 'visible', locator: '#full-name' })], [operation('browser_click', { locator: '#register-submit' }), check()],
    [{ tool: 'browser_assert', execution_step_id: 'section', result: receipt({ assertion_outcome: 'not_satisfied' }, true) }, check()], [before(), after(), check()]]) {
    assert.notDeepEqual(canonicalReviewEvidence({ observations: [...initial, ...additions], stepId: 'section' }), canonicalReviewEvidence({ observations: initial, stepId: 'section' }));
  }
});
