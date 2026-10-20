const test = require('node:test');
const assert = require('node:assert/strict');
const { createAutomationSemanticReviewer } = require('../../backend/lib/automationSemanticReview');
const { recordBrowserOperation } = require('../../backend/lib/automationBrowserRecording');
const { reviewMetadataRequirements, pageState, canonicalReviewEvidence } = require('../../backend/lib/automationReviewEvidence');

const result = value => ({ content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', ...value }) }] });
const target = (tag, label, locator, type) => ({ tag, accessible_name: label, label, attributes: type ? { type } : {}, displayed: true,
  locators_validated: true, locator_candidates: [locator] });
const form = signup => [target('input', 'Email', '#email', 'email'), target('input', 'Password', '#password', 'password'),
  ...(signup ? [target('input', 'Full name', '#name', 'text')] : []), target('button', signup ? 'Sign up' : 'Sign in', '#submit', 'submit')];
function snapshot(signup, extra = {}) {
  return { tool: 'browser_snapshot', execution_step_id: 'section', result: result({ observation_id: 'page', scope: 'body',
    url: 'https://app.test/auth', title: 'Stale Sign In document title sentinel',
    accessibility: signup ? '- main\n  - textbox "Full name"\n  - textbox "Email"\n  - textbox "Password"\n  - button "Sign up"'
      : '- main\n  - textbox "Email"\n  - textbox "Password"\n  - button "Sign in"', elements: form(signup), ...extra }) };
}
function operation(name, args) {
  const observation = { tool: name, execution_step_id: 'section', result: result(name === 'browser_assert' ? { assertion_outcome: 'satisfied' } : { action_outcome: 'completed' }) };
  recordBrowserOperation(observation, { name, arguments: args });return observation;
}
const rawGoals = [{ id: 'section', source: 'section', action: 'Navigate to the application signup page.', expected_result: 'The application signup page is displayed.' },
  { id: 'manual:case:step', source: 'manual_step', action: 'Navigate to the application signup page.', expected_result: 'The application signup page is displayed.' }];
const execution = { required: true, step_id: 'section', obligations: rawGoals, source_obligations: rawGoals };
const verdict = ids => ({ decision: 'accept', obligations: ids.map(id => ({ id, action_operations: [1], assertion_operations: [2] })), issues: [] });
const packet = prompt => JSON.parse(prompt.slice(prompt.indexOf('\n\n') + 2));

test('same-route signup review uses actual rendered form without the stale document title that caused an initial-step false rejection', async () => {
  const observations = [snapshot(false), operation('browser_click', { locator: '#create-account' }), snapshot(true),
    operation('browser_assert', { assertion: 'visible', locator: '#submit' })];
  let calls = 0;
  const review = createAutomationSemanticReviewer({ execution, complete: async prompt => {
    calls++;const data = packet(prompt);
    // The historical failure pattern rejected a confirmed signup view using
    // incidental Sign In metadata on the shared /auth route. This fixture
    // models that contradictory reviewer cue, without a provider request.
    assert.doesNotMatch(prompt, /Stale Sign In document title sentinel/);
    assert.deepEqual(data.page_metadata_context.after, {});assert.deepEqual(data.obligations, rawGoals);
    assert.ok(data.current_page.targets.some(row => row.name === 'Full name'));
    assert.ok(data.current_page.targets.some(row => row.name === 'Sign up'));
    assert.equal(data.rendered_transition.observed_change, true);
    assert.ok(data.rendered_transition.added.some(row => row.name === 'Full name'));
    assert.deepEqual(data.confirmed_operations.map(row => row.name), ['browser_click', 'browser_assert']);
    assert.equal(data.confirmed_operations[1].arguments.assertion, 'visible');
    return JSON.stringify(verdict(rawGoals.map(row => row.id)));
  } });
  const outcome = await review.review({ observations });assert.equal(outcome.accepted, true);assert.equal(calls, 1);
  assert.deepEqual(outcome.obligation_mappings, verdict(rawGoals.map(row => row.id)).obligations);
  outcome.obligation_mappings[0].action_operations.push(99);
  const cached = await review.review({ observations });assert.equal(cached.cached, true);
  assert.deepEqual(cached.obligation_mappings[0].action_operations, [1], 'consumer changes cannot rewrite cached validated mappings');
});

test('only original authored clauses and successful predicates select document metadata subjects', () => {
  const goals = text => [{ action: 'Enter the supplied data', expected_result: text }];
  assert.deepEqual(reviewMetadataRequirements(goals('The signup page is displayed')), { url: false, title: false });
  assert.deepEqual(reviewMetadataRequirements(goals('The document title is @t.title')), { url: false, title: true });
  assert.deepEqual(reviewMetadataRequirements(goals('The URL matches params["t.target"]')), { url: true, title: false });
  assert.deepEqual(reviewMetadataRequirements(goals('The address bar shows @r.target')), { url: true, title: false });
  assert.deepEqual(reviewMetadataRequirements(goals('The page is displayed'), [{ name: 'browser_assert', arguments: { assertion: 'title_normalized', value: '@t.title' } }]), { url: false, title: true });
  assert.deepEqual(reviewMetadataRequirements(goals('The page is displayed'), [{ name: 'browser_assert', arguments: { assertion: 'url_contains', value: '@t.target' } }]), { url: true, title: false });
  for (const text of ['The text "document title and URL" is displayed', 'The text `<title>https://example.test</title>` is displayed',
    'The text @t.[document title URL] is displayed', 'The text params["t.document title URL"] is displayed']) {
    assert.deepEqual(reviewMetadataRequirements(goals(text)), { url: false, title: false }, text);
  }
  assert.deepEqual(reviewMetadataRequirements(goals('Le titre de la page correspond à la valeur attendue')), { url: true, title: true }, 'unknown language keeps contradictory metadata conservatively');
  assert.deepEqual(reviewMetadataRequirements(goals('页面标题符合预期')), { url: true, title: true });
});

test('inserted data cannot turn itself into a metadata requirement or hide the original explicit requirement', async () => {
  for (const explicit of [false, true]) {
    const raw = [{ id: 'section', source: 'section', action: 'Enter @t.message', expected_result: explicit ? 'The document title is @t.message' : 'The text @t.message is displayed' }];
    const projected = raw.map(row => ({ ...row, action: 'Enter document title URL', expected_result: explicit ? 'The document title is document title URL' : 'The text document title URL is displayed' }));
    const observations = [snapshot(true), operation('browser_fill', { locator: '#name', value: '@t.message' }),
      operation('browser_assert', { assertion: 'value', locator: '#name', value: '@t.message' }), snapshot(true)];
    const review = createAutomationSemanticReviewer({ execution: { required: true, step_id: 'section', obligations: projected, source_obligations: raw }, complete: async prompt => {
      const data = packet(prompt);assert.equal(Object.hasOwn(data.page_metadata_context.after, 'title'), explicit);
      assert.equal(Object.hasOwn(data.page_metadata_context.after, 'url'), false);
      return JSON.stringify(verdict(['section']));
    } });
    assert.equal((await review.review({ observations })).accepted, true);
  }
});

test('incidental metadata does not reopen rejected evidence, while explicit title or URL changes do', async () => {
  for (const subject of [null, 'title', 'url']) {
    let calls = 0;
    const raw = [{ id: 'section', source: 'section', action: 'Open the signup page', expected_result: subject ? `The ${subject} matches the supplied value` : 'The signup page is displayed' }];
    const observations = [snapshot(true), operation('browser_click', { locator: '#create-account' }), operation('browser_assert', { assertion: 'visible', locator: '#submit' }), snapshot(true)];
    const review = createAutomationSemanticReviewer({ execution: { required: true, step_id: 'section', obligations: raw, source_obligations: raw }, complete: async prompt => {
      calls++;const data = packet(prompt);
      if (subject) assert.equal(Object.hasOwn(data.page_metadata_context.after, subject), true);
      return JSON.stringify({ ...verdict(['section']), decision: 'reject', issues: [{ code: 'expected_result_not_covered', obligation_id: 'section', message: 'A required predicate is missing.' }] });
    } });
    await review.review({ observations });
    observations.push(snapshot(true, { observation_id: 'new', ...(subject === 'url' ? { url: 'https://app.test/signup' } : { title: 'Fresh document metadata' }) }));
    const outcome = await review.review({ observations });assert.equal(outcome.cached, !subject);assert.equal(calls, subject ? 2 : 1);
  }
});

test('explicit authentication URL/title requirements retain contradictory actual metadata and unchanged authored predicates', async () => {
  const raw = [{ id: 'section', source: 'section', action: 'Open the login page at https://app.test/login', expected_result: 'The URL is @t.login and the document title is @t.login_title' }];
  const observations = [snapshot(true), operation('browser_assert', { assertion: 'url', value: '@t.login' }), snapshot(true)];
  const review = createAutomationSemanticReviewer({ execution: { required: true, step_id: 'section', obligations: raw, source_obligations: raw }, complete: async prompt => {
    const data = packet(prompt);assert.equal(data.page_metadata_context.after.title, 'Stale Sign In document title sentinel');
    assert.equal(data.page_metadata_context.after.url, 'https://app.test/auth');assert.deepEqual(data.obligations, raw);
    assert.equal(data.confirmed_operations[0].arguments.assertion, 'url');assert.equal(data.confirmed_operations[0].arguments.value, '@t.login');
    return JSON.stringify({ decision: 'reject', obligations: [{ id: 'section', action_operations: [], assertion_operations: [1] }],
      issues: [{ code: 'expected_result_not_covered', obligation_id: 'section', message: 'The required title is not covered.' }] });
  } });
  const outcome = await review.review({ observations });assert.equal(outcome.accepted, false);assert.equal(outcome.obligation_mappings, undefined);
});

test('rendered fingerprints omit only unrequested metadata and preserve content outside compact excerpts', () => {
  const original = { observation_id: 'id', captured_at: 'then', title: 'Wrong title', title_truncated: true, url: 'https://app.test/auth', url_truncated: true, accessibility: 'current controls', elements: form(true) };
  assert.deepEqual(pageState(original, { title: false, url: false }), { accessibility: original.accessibility, elements: original.elements });
  assert.equal(pageState(original, { title: true, url: false }).title, original.title);
  const initial = [snapshot(true), operation('browser_assert', { assertion: 'visible', locator: '#submit' })];
  const changedMetadata = [...initial, snapshot(true, { title: 'Another document title', url: 'https://app.test/other' })];
  const fields = { title: false, url: false };
  assert.deepEqual(canonicalReviewEvidence({ observations: initial, stepId: 'section', metadataFields: fields }), canonicalReviewEvidence({ observations: changedMetadata, stepId: 'section', metadataFields: fields }));
  const changedRendered = [...initial, snapshot(true, { accessibility: 'a'.repeat(6000) + 'new actual outcome' })];
  assert.notDeepEqual(canonicalReviewEvidence({ observations: initial, stepId: 'section', metadataFields: fields }), canonicalReviewEvidence({ observations: changedRendered, stepId: 'section', metadataFields: fields }));
});
