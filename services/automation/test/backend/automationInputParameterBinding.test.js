const test = require('node:test');
const assert = require('node:assert/strict');
const { createAutomationInputParameterBinding } = require('../../backend/lib/automationInputParameterBinding');
const { buildAutomationParameterBindings } = require('../../backend/lib/automationParameterBindings');
const { createBrowserParameterResolver } = require('../../backend/lib/automationBrowserParameters');
const { recordBrowserOperation } = require('../../backend/lib/automationBrowserRecording');
const { stampObservation, markPageTransition } = require('../../backend/lib/automationActionReconciliation');
const { compileRecordedProgram } = require('../../backend/lib/automationRecordedProgram');

const value = 'synthetic@example.test';
const fill = (input = value, locator = '#email') => ({ name: 'browser_fill', arguments: { locator, value: input } });
const check = (input = value, locator = '#email') => ({ name: 'browser_assert', arguments: { assertion: 'value', locator, value: input } });
const receipt = data => ({ content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', ...data }) }] });
const snapshot = (extra = {}) => ({ tool: 'browser_snapshot', result: receipt({ observation_id: 'synthetic-page', elements: [
  { tag: 'input', attributes: { type: 'email' }, locators_validated: true, locator_candidates: ['#email', 'getByLabel("Email")'] },
  { tag: 'input', attributes: { type: 'text' }, locators_validated: true, locator_candidates: ['#other'] }
], ...extra }) });
function confirmed(request, extra = {}) {
  const observation = { tool: request.name, execution_step_id: 'current', result: receipt({ action_outcome: 'completed' }), ...extra };
  recordBrowserOperation(observation, request); stampObservation(observation, request); return observation;
}
function fixture({ action = 'Enter @r.email', expected = 'Input retains @r.email', values = {}, privateNames = [] } = {}) {
  const obligations = [{ id: 'current', source: 'section', action, expected_result: expected }];
  const resolver = createBrowserParameterResolver({ caseValues: { 'r.email': value, ...values }, privateParameterNames: privateNames });
  const bindings = buildAutomationParameterBindings({ obligations, referencedParameterNames: resolver.referencedParameterNames });
  const input = { stepId: 'current', obligations, bindings, parameterValues: resolver.promptValues, privateParameterNames: resolver.privateParameterNames };
  return { input, bindings, resolver, policy: createAutomationInputParameterBinding(input) };
}

test('a unique original active action binding parameterizes literal fill without a global reverse-value guess', () => {
  const { policy } = fixture({ values: { 'r.unrelated': value } });
  const request = fill(), original = structuredClone(request);
  assert.equal(policy.canonicalize(request, { snapshot: snapshot() }).arguments.value, '@r.email');
  assert.deepEqual(request, original);
  const unrelated = fixture({ action: 'Enter a fixed literal', expected: 'Input retains a fixed literal' });
  assert.equal(unrelated.policy.canonicalize(request, { snapshot: snapshot() }), request, 'unreferenced matching data grants no binding');
});

test('modified reviewed public data keeps the same reusable symbolic input and never records its literal', () => {
  const next = 'modified@example.test', state = fixture({ values: { 'r.email': next } });
  const request = state.policy.canonicalize(fill(next), { snapshot: snapshot() });
  assert.equal(request.arguments.value, '@r.email');
  const source = compileRecordedProgram([request]).source;
  assert.match(source, /@r\.email/); assert.doesNotMatch(source, /modified@example\.test/);
  const old = fill(value); assert.equal(state.policy.canonicalize(old, { snapshot: snapshot() }), old);
});

test('input content assertions bind only to an explicit expected-result parameter and the same field latest confirmed fill', () => {
  const { policy } = fixture(), page = snapshot();
  const bound = policy.canonicalize(fill(), { snapshot: page });
  const observation = confirmed(bound);
  assert.equal(policy.canonicalize(check(value, 'getByLabel("Email")'), { snapshot: page, observations: [observation] }).arguments.value, '@r.email');
  for (const observations of [[], [structuredClone(observation)], [confirmed(bound, { execution_step_id: 'other' })],
    [confirmed(fill('@r.email', '#other'))], [confirmed(fill('@r.email'), { result: receipt({ action_outcome: 'unknown' }) })],
    [observation, confirmed(fill('later-literal'))]]) {
    const request = check(); assert.equal(policy.canonicalize(request, { snapshot: page, observations }), request);
  }
  const source = compileRecordedProgram([bound, policy.canonicalize(check(), { snapshot: page, observations: [observation] })]).source;
  assert.match(source, /toHaveValue\("@r\.email"\)/); assert.doesNotMatch(source, /synthetic@example\.test/);
});

test('implicit outcome prose and independently literal expectations do not acquire variable oracle authority', () => {
  for (const expected of ['The email is entered without errors.', `Input retains "${value}".`, 'Input retains @r.other']) {
    const { policy } = fixture({ expected, values: { 'r.other': value } });
    const request = check();
    assert.equal(policy.canonicalize(request, { snapshot: snapshot(), observations: [confirmed(fill('@r.email'))] }), request);
  }
});

test('business, status, text and unrelated checks remain byte exact', () => {
  const { policy } = fixture();
  for (const assertion of ['text', 'text_contains', 'text_content', 'url', 'title', 'count', 'field_valid']) {
    const request = { name: 'browser_assert', arguments: { assertion, locator: '#email', value } };
    assert.equal(policy.canonicalize(request, { snapshot: snapshot(), observations: [confirmed(fill('@r.email'))] }), request);
  }
  for (const request of [fill('@r.email'), fill('params["r.email"]'), fill(value, '#unobserved')]) {
    assert.equal(policy.canonicalize(request, { snapshot: snapshot() }), request);
  }
});

test('private bindings and ambiguous active public bindings are never inferred from literal values', () => {
  const secret = fixture({ privateNames: ['r.email'] }), request = fill();
  assert.equal(secret.policy.canonicalize(request, { snapshot: snapshot() }), request);
  const ambiguous = fixture({ action: 'Enter @r.email and @r.confirmation', expected: 'Both values are retained', values: { 'r.confirmation': value } });
  assert.equal(ambiguous.policy.canonicalize(request, { snapshot: snapshot() }), request);
  const blanks = fixture({ values: { 'r.email': '' } });
  assert.equal(blanks.policy.canonicalize(fill(''), { snapshot: snapshot() }).arguments.value, '@r.email');
  const doubleBlank = fixture({ action: 'Enter @r.email and @r.confirmation', values: { 'r.email': '', 'r.confirmation': '' } });
  const empty = fill(''); assert.equal(doubleBlank.policy.canonicalize(empty, { snapshot: snapshot() }), empty);
});

test('the policy uses frozen public values and preserves token-like text inside an inserted value', () => {
  const { input, policy } = fixture({ values: { 'r.email': 'literal @r.other text', 'r.other': 'different' } });
  input.parameterValues['r.email'] = 'changed later'; input.bindings[0].action_parameters.length = 0;
  assert.equal(policy.canonicalize(fill('literal @r.other text'), { snapshot: snapshot() }).arguments.value, '@r.email');
  const changed = fill('changed later'); assert.equal(policy.canonicalize(changed, { snapshot: snapshot() }), changed);
});

test('navigation and host-confirmed rendered transitions invalidate earlier field binding associations', () => {
  const { policy } = fixture(), entered = confirmed(fill('@r.email'));
  const navigation = confirmed({ name: 'browser_navigate', arguments: { url: 'https://app.test/other' } });
  const transition = confirmed({ name: 'browser_click', arguments: { locator: '#next' } }); markPageTransition(transition);
  for (const observations of [[entered, navigation], [entered, transition]]) {
    const request = check(); assert.equal(policy.canonicalize(request, { snapshot: snapshot(), observations }), request);
  }
});

test('a literal fill needs exactly one currently observed native text-entry target', () => {
  const { policy } = fixture(), request = fill();
  for (const page of [null, { ...snapshot(), result: { isError: true } }, snapshot({ elements: [] }),
    snapshot({ elements: [{ tag: 'div', locators_validated: true, locator_candidates: ['#email'] }] }),
    snapshot({ elements: Array.from({ length: 2 }, () => ({ tag: 'input', locators_validated: true, locator_candidates: ['#email'] })) }),
    snapshot({ elements: [{ tag: 'input', locators_validated: false, locator_candidates: ['#email'] }] })]) {
    assert.equal(policy.canonicalize(request, { snapshot: page }), request);
  }
});

test('invalid or differently scoped provenance fails without including supplied values', () => {
  const { input } = fixture();
  for (const override of [{ stepId: 'other' }, { obligations: [] }, { bindings: [{ ...input.bindings[0], obligation_id: 'foreign' }] },
    { bindings: [{ ...input.bindings[0], action_parameters: ['r.unbound'] }] }, { privateParameterNames: [null] }]) {
    assert.throws(() => createAutomationInputParameterBinding({ ...input, ...override }), error => error.code === 'AUTOMATION_INPUT_PARAMETER_BINDING_INVALID'
      && error.nonRetryable && !error.message.includes(value));
  }
});
