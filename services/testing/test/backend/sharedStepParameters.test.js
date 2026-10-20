const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSharedParameterValues, sharedSensitiveParameterNames, publicSharedParameterValues, mergeSharedParameterValues, referencedSharedParameterNames, sharedDefaultsFromCase } = require('../../backend/domain/sharedStepParameters');

test('shared parameter aliases canonicalize and explicit blanks survive', () => {
  assert.deepEqual(normalizeSharedParameterValues({ '@T.[First Name]': '', tenant: 'one', count: 0, nil: null }), { 't.first name': '', 'r.tenant': 'one', 'r.count': '0', 'r.nil': '' });
  for (const value of [null, undefined, [], 'invalid']) assert.deepEqual(normalizeSharedParameterValues(value), {});
});

test('public group defaults hide private linked keys and aliases without hiding editable metadata', () => {
  const values = { '@r.Password': 'private', alias: 'private', username: 'user', empty: '' };
  const data = { mode: 'key_value', rows: [{ key: 'password', is_secret: true }, { key: 'username', is_secret: false }] };
  const names = sharedSensitiveParameterNames(data, values);
  assert.deepEqual(names, ['r.alias', 'r.password']);
  assert.deepEqual(publicSharedParameterValues(values, names), { 'r.username': 'user', 'r.empty': '' });
  assert.deepEqual(sharedSensitiveParameterNames({ mode: 'key_value', sensitive_parameter_names: ['@r.Password'] }, values), names);
});

test('omitted private defaults survive saves and deliberate empty or replacement is honored', () => {
  const input = { previousValues: { password: 'stored', username: 'old' }, previousSensitiveNames: ['r.password'], nextSensitiveNames: ['r.password'] };
  assert.deepEqual(mergeSharedParameterValues({ ...input, values: { username: 'new' } }), { 'r.username': 'new', 'r.password': 'stored' });
  assert.equal(mergeSharedParameterValues({ ...input, values: { password: '' } })['r.password'], '');
  assert.equal(mergeSharedParameterValues({ ...input, values: { '@R.Password': 'replacement' } })['r.password'], 'replacement');
  assert.deepEqual(mergeSharedParameterValues(input), { 'r.password': 'stored', 'r.username': 'old' });
});

test('changing the linked private policy cannot implicitly publish a hidden fallback', () => {
  const input = { previousValues: { password: 'stored' }, previousSensitiveNames: ['r.password'], nextSensitiveNames: [] };
  for (const values of [undefined, {}, { password: 'new-public' }]) assert.throws(() => mergeSharedParameterValues({ ...input, values }), { statusCode: 409, code: 'SHARED_PARAMETER_PRIVACY_CONFLICT' });
  assert.deepEqual(mergeSharedParameterValues({ ...input, values: { password: '' } }), { 'r.password': '' });
  assert.deepEqual(mergeSharedParameterValues({ ...input, previousValues: { password: '' } }), { 'r.password': '' });
});

test('an explicit definition-and-parameters save prunes omitted private defaults only after their last reference is removed', () => {
  const input = { previousValues: { 'r.private': 'stored', 'r.public': 'value' }, values: { 'r.public': 'value' }, previousSensitiveNames: ['r.private'], nextSensitiveNames: ['r.private'] };
  assert.equal(mergeSharedParameterValues(input)['r.private'], 'stored', 'Metadata-only saves retain the hidden default');
  const referenced = referencedSharedParameterNames({ steps: [{ automation_code: 'await page.getByLabel("Input").fill(params["r.private"]);' }] });
  assert.equal(mergeSharedParameterValues({ ...input, referencedNames: referenced })['r.private'], 'stored');
  assert.deepEqual(mergeSharedParameterValues({ ...input, referencedNames: new Set(['r.public']) }), { 'r.public': 'value' });
  assert.ok(referencedSharedParameterNames({ steps: [], authoring_mode: 'gherkin', gherkin_document: 'Feature: Reuse\nScenario: Input\nGiven I use @r.private' }).has('r.private'));
});

test('case conversion copies only referenced explicit public defaults and keeps intentional blanks', () => {
  const row = { parameter_values: { 't.email': 'user@example.test', 't.blank': '', 't.private': 'secret', 't.alias': 'secret', 't.password': 'credential', 't.unused': 'ignore', 't.api': 'payload' }, test_data_options: { private_parameter_names: ['t.private'] } };
  const steps = [{ action: 'Use @t.email and @t.blank and @t.private', automation_code: 'await page.getByLabel("Password").fill(params["t.password"]); await page.getByLabel("Alias").fill(params["t.alias"]);', api_request: JSON.stringify({ method: 'POST', url: 'https://example.test', body: '@t.api' }) }];
  assert.deepEqual(sharedDefaultsFromCase(row, steps), { 't.email': 'user@example.test', 't.blank': '', 't.api': 'payload' });
});
