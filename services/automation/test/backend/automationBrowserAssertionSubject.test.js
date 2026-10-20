const test = require('node:test');
const assert = require('node:assert/strict');
const { browserAssertionSubjectFeedback, isNativeTextEntryControl } = require('../../backend/lib/automationBrowserAssertionSubject');

const schema = {
  type: 'object', additionalProperties: false,
  properties: { assertion: { enum: ['text', 'text_contains', 'text_content', 'text_content_contains', 'value', 'visible', 'checked'] }, locator: { type: 'string' }, value: { type: 'string' } },
  required: ['assertion'],
  allOf: [{ if: { properties: { assertion: { enum: ['text', 'text_contains', 'text_content', 'text_content_contains', 'value'] } }, required: ['assertion'] }, then: { required: ['locator', 'value'] } }]
};
const element = extra => ({ tag: 'input', attributes: { type: 'text' }, locators_validated: true, locator_candidates: ['#field'], ...extra });
const snapshot = elements => ({ tool: 'browser_snapshot', result: { content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', observation_id: 'current-page', elements }) }] } });
const request = (assertion = 'text', value = '@t.configured_value') => ({ name: 'browser_assert', arguments: { assertion, locator: '#field', value } });
const feedback = (extra = {}) => browserAssertionSubjectFeedback({ request: request(), snapshot: snapshot([element()]), inputSchema: schema, stepId: 'current', ...extra });

test('inner-text checks on current native text-entry controls receive a bounded correction without changing the request', () => {
  for (const tag of ['input', 'textarea']) for (const mode of ['text', 'text_contains']) {
    const original = request(mode), before = structuredClone(original), current = snapshot([element({ tag })]);
    const result = feedback({ request: original, snapshot: current });
    assert.equal(result.code, 'AUTOMATION_BROWSER_ASSERTION_SUBJECT_MISMATCH');
    assert.equal(result.action_outcome, 'not_attempted');assert.equal(result.retry_safe, true);
    assert.equal(result.assertion_subject, 'input_value');assert.equal(result.attempted_assertion, mode);
    assert.deepEqual(result.value_assertion_contract, { assertion: 'value', required_arguments: ['assertion', 'locator', 'value'] });
    assert.deepEqual(original, before);assert.doesNotMatch(JSON.stringify(result), /@t\.configured_value|#field|current-page/);
  }
});

test('explicit DOM text and other native assertions preserve their original semantics', () => {
  for (const mode of ['text_content', 'text_content_contains', 'value', 'visible', 'checked'])
    assert.equal(feedback({ request: request(mode), snapshot: snapshot([element({ tag: 'textarea', text: 'Initial/default DOM text' })]) }), null, mode);
  for (const mode of ['text', 'text_contains']) assert.equal(feedback({ request: request(mode, '') }).code, 'AUTOMATION_BROWSER_ASSERTION_SUBJECT_MISMATCH');
  assert.equal(feedback({ request: { name: 'browser_fill', arguments: { locator: '#field', value: '@t.configured_value' } } }), null);
});

test('native text-entry classification excludes checked, file, button and non-native value-like controls', () => {
  for (const type of ['checkbox', 'radio', 'file', 'button', 'submit', 'reset', 'image', 'hidden', 'range', 'color', 'unrecognized']) {
    const target = element({ attributes: { type } });assert.equal(isNativeTextEntryControl(target), false, type);
    assert.equal(feedback({ snapshot: snapshot([target]) }), null, type);
  }
  for (const tag of ['button', 'select', 'div', 'span']) assert.equal(feedback({ snapshot: snapshot([element({ tag, accessible_role: 'textbox' })]) }), null, tag);
  for (const type of ['text', 'email', 'password', 'search', 'tel', 'url', 'number', 'date', 'datetime-local', 'month', 'week', 'time'])
    assert.equal(isNativeTextEntryControl(element({ attributes: { type } })), true, type);
  assert.equal(isNativeTextEntryControl(element({ attributes: {} })), true);
  assert.equal(isNativeTextEntryControl(element({ truncated_attributes: ['type'] })), false);
});

test('missing, ambiguous, failed and unvalidated evidence does not synthesize a subject correction', () => {
  for (const current of [null, snapshot([]), snapshot([element({ locators_validated: false })]), snapshot([element(), element()]),
    snapshot([element({ locator_candidates: ['#other'] })]), { tool: 'browser_snapshot', result: { isError: true } }])
    assert.equal(feedback({ snapshot: current }), null);
});

test('required value arguments come from the unchanged discovered schema and unavailable modes are never invented', () => {
  const before = structuredClone(schema);feedback();assert.deepEqual(schema, before);
  const optional = structuredClone(schema);delete optional.allOf;optional.required = ['assertion'];
  assert.deepEqual(feedback({ inputSchema: optional }).value_assertion_contract, { assertion: 'value', required_arguments: ['assertion'] });
  const unavailable = structuredClone(schema);unavailable.properties.assertion.enum = ['text', 'text_contains'];
  assert.equal(feedback({ inputSchema: unavailable }).value_assertion_contract, undefined);
  assert.doesNotMatch(feedback({ inputSchema: unavailable }).message, /advertised value assertion/);
  assert.equal(feedback({ inputSchema: undefined }).value_assertion_contract, undefined);
});

test('literal or parameter-like expected values are never resolved or exposed by subject feedback', () => {
  for (const value of ['owned-private-literal', '@t.password', 'prefix @r.name remains literal', '  ']) {
    const result = feedback({ request: request('text_contains', value) });
    assert.equal(result.code, 'AUTOMATION_BROWSER_ASSERTION_SUBJECT_MISMATCH');
    assert.equal(Object.hasOwn(result, 'value'), false);assert.equal(JSON.stringify(result).includes(value), false);
  }
});
