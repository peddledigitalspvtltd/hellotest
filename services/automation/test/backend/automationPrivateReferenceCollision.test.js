const test = require('node:test');
const assert = require('node:assert/strict');
const { createBrowserParameterResolver } = require('../../backend/lib/automationBrowserParameters');
const { createAutomationActorContext } = require('../../backend/lib/automationActorContext');
const { createAutomationSemanticReviewer } = require('../../backend/lib/automationSemanticReview');
const { recordBrowserOperation } = require('../../backend/lib/automationBrowserRecording');

const unknownSecret = '@NotAConfiguredBinding987';
const collidingSecret = '@t.validref';
const resolver = () => createBrowserParameterResolver({ materialize: false, caseValues: {
  't.password': collidingSecret, 'r.secret': unknownSecret, 't.validref': 'Named binding value', 'r.literal': 'Keep @r.unconfigured literal text'
} });

test('literal privacy redacts reference-shaped private values while authored binding preservation requires a real known key', () => {
  const data = resolver();
  for (const secret of [unknownSecret, collidingSecret]) assert.equal(data.projectPrivateText(secret), '[private parameter value]');
  assert.equal(data.projectPrivateText(collidingSecret, { preserveReferences: true }), collidingSecret, 'the same bytes can be an explicitly authored known binding');
  assert.equal(data.projectPrivateText(unknownSecret, { preserveReferences: true }), '[private parameter value]', 'an unknown token is never a binding grant');
  assert.equal(data.projectPrivateText('@t.password', { preserveReferences: true }), '@t.password');
  assert.equal(data.projectText('Enter @t.password and @r.secret'), 'Enter @t.password and @r.secret');
  assert.equal(data.projectText('Enter @r.literal'), 'Enter Keep @r.unconfigured literal text', 'one-pass resolution must not rescan inserted token-like text');
  assert.equal(data.projectPrivateText('Keep @r.unconfigured literal text'), 'Keep @r.unconfigured literal text', 'non-secret literals remain byte exact');
});

test('private literals spanning token boundaries are redacted whole while valid authored binding names remain stable', () => {
  const phrase = 'private @t.validref phrase', partialToken = '@r.';
  const data = createBrowserParameterResolver({ materialize: false, caseValues: {
    't.password': phrase, 'r.secret': partialToken, 't.passcode': 'validref', 't.validref': 'Named value'
  } });
  for (const preserveReferences of [false, true]) {
    assert.equal(data.projectPrivateText(`Observed ${phrase}`, { preserveReferences }), 'Observed [private parameter value]');
    assert.equal(data.projectPrivateText(partialToken, { preserveReferences }), '[private parameter value]');
  }
  assert.equal(data.projectPrivateText('Enter @t.validref', { preserveReferences: true }), 'Enter @t.validref', 'a short private substring must not corrupt an authored key');
  assert.equal(data.projectPrivateText('Observed validref'), 'Observed [private parameter value]');
});

test('a token inside an inserted value cannot gain a private-redaction exemption or resolve again', () => {
  const data = createBrowserParameterResolver({ materialize: false, caseValues: {
    't.password': collidingSecret, 't.validref': 'MUST_NOT_RESOLVE_AGAIN', 't.inserted': `prefix ${collidingSecret} suffix`
  } });
  assert.equal(data.projectText('Enter @t.inserted'), 'Enter prefix [private parameter value] suffix');
  assert.equal(data.projectText('Enter @t.password'), 'Enter @t.password');
});

test('actor context keeps host binding references but masks identical private literal bytes in captures and selected data', () => {
  const data = resolver();
  const task = { case: { id: 'case' }, current_section: { id: 'current', action: 'Enter @t.password and @r.secret then @t.validref', expected_result: 'Both fields retain their values.' },
    build_context: { linked_manual_cases: [], parameter_data: { values: data.promptValues }, data_set: { id: 'data', mode: 'table', rows: [{ known: collidingSecret, unknown: unknownSecret }] } },
    captured_actions: [{ arguments: { value: collidingSecret } }, { arguments: { value: unknownSecret } }],
    captured_network: [{ response: { body: { known: collidingSecret, unknown: unknownSecret } } }] };
  const manager = createAutomationActorContext({ task, projectText: data.projectPrivateText, canonicalGoals: true });
  const selected = JSON.parse(manager.prompt);
  assert.equal(selected.required_obligations[0].action, task.current_section.action);
  assert.equal(selected.parameter_data.values['t.password'], '@t.password');assert.equal(selected.parameter_data.values['t.validref'], '@t.validref');
  const disclosed = manager.request({ captured_actions: { offset: 0, limit: 2 }, captured_network: { offset: 0, limit: 1 }, selected_context: ['data_set'] });
  assert.doesNotMatch(JSON.stringify(disclosed), new RegExp(`${unknownSecret}|@t\\.validref`));
  assert.equal(disclosed.data.captured_actions.items[0].arguments.value, '[private parameter value]');
  assert.equal(disclosed.data.selected_context.data_set.rows[0].unknown, '[private parameter value]');
  const parameters = manager.request({ parameter_names: ['t.password', 'r.secret', 't.validref'] });
  assert.deepEqual(parameters.data.parameter_values, { 't.password': '@t.password', 'r.secret': '@r.secret', 't.validref': 'Named binding value' });
});

test('semantic review preserves authored and recorded binding identity while page and reviewer-rationale evidence use literal privacy', async () => {
  const data = resolver(), receipt = value => ({ content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', ...value }) }] });
  const snapshot = { tool: 'browser_snapshot', execution_step_id: 'current', result: receipt({ observation_id: 'page', url: 'https://app.test', scope: 'body',
    body_text: `Captured ${collidingSecret} and ${unknownSecret}`, accessibility: `textbox ${collidingSecret}`,
    elements: [{ tag: 'input', attributes: { type: 'password' }, accessible_role: 'textbox', accessible_name: collidingSecret, locators_validated: true, locator_candidates: ['#private'] }] }) };
  const operation = (name, args) => { const row = { tool: name, execution_step_id: 'current', result: receipt(name === 'browser_assert' ? { assertion_outcome: 'satisfied' } : { action_outcome: 'completed' }) };
    recordBrowserOperation(row, { name, arguments: args });return row; };
  const observations = [snapshot, operation('browser_fill', { locator: '#private', value: '@t.password' }), snapshot,
    operation('browser_assert', { assertion: 'value', locator: '#private', value: '@t.password' })];
  const reviewer = createAutomationSemanticReviewer({ execution: { required: true, step_id: 'current', action: 'Enter @t.password, preserving @t.validref as a named binding', expected_result: 'The entered value is retained.' },
    projectText: data.projectText, projectPrivateText: data.projectPrivateText, complete: async prompt => {
      const packet = JSON.parse(prompt.split('\n').at(-1));
      assert.match(packet.obligations[0].action, /@t\.validref/);
      assert.equal(packet.confirmed_operations[0].arguments.value, '@t.password');assert.equal(packet.confirmed_operations[1].arguments.value, '@t.password');
      assert.doesNotMatch(JSON.stringify(packet.current_page), new RegExp(`${unknownSecret}|@t\\.validref`));
      assert.doesNotMatch(JSON.stringify(packet.confirmed_operations[0].observed_target), /@t\.validref/);
      return JSON.stringify({ decision: 'reject', obligations: [{ id: 'current', action_operations: [1], assertion_operations: [2] }],
        issues: [{ code: 'insufficient_evidence', obligation_id: 'current', message: `A private literal ${collidingSecret} or ${unknownSecret} cannot become review feedback.` }] });
    } });
  const result = await reviewer.review({ observations });
  assert.equal(result.accepted, false);assert.doesNotMatch(JSON.stringify(result.private_feedback), new RegExp(`${unknownSecret}|@t\\.validref`));
  assert.doesNotMatch(JSON.stringify(result.feedback), new RegExp(`${unknownSecret}|@t\\.validref`));
});
