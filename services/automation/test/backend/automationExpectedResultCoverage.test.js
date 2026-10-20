const test = require('node:test');
const assert = require('node:assert/strict');
const { explicitFieldValidationRequirement, nativeValueCoverageRequirements, nativeValueCoverageIssues } = require('../../backend/lib/automationExpectedResultCoverage');
const { maskParameterReferences, referencedParameterNames } = require('../../backend/lib/automationBrowserParameters');

const goal = (expected_result, id = 'current') => ({ id, expected_result });
const operation = (assertion, tag = 'input', locator = '#field', inputType = 'text') => ({ name: 'browser_assert', arguments: { assertion, locator, ...(assertion === 'value' ? { value: '@r.input' } : {}) },
  observed_target: { tag, input_type: tag === 'input' ? inputType : undefined, evidence: 'snapshot_before_operation' } });
const requirements = nativeValueCoverageRequirements([goal('The field value is entered without errors.')]);

test('the conservative classifier recognizes explicit English validation outcomes without interpreting quoted data', () => {
  for (const expected of ['The full value is entered without errors.', 'No validation error is shown.', 'The field remains valid.', 'The entered value is accepted.',
    'The entered value passes validation.', 'The input is error-free.', 'The data is entered without any validation errors.']) assert.equal(explicitFieldValidationRequirement(expected), true, expected);
  for (const expected of ['The configured value is entered.', 'The field value is "without errors".', "The field contains 'no error is shown'.", 'The value is `error-free`.',
    'The field displays “without errors”.', 'The value is @r.expected.', 'El valor se introduce sin errores.']) assert.equal(explicitFieldValidationRequirement(expected), false, expected);
  assert.equal(explicitFieldValidationRequirement("The user's input is entered without errors."), true, 'an apostrophe is not a quoted data span');
});

test('authored parameter keys are data rather than validation clauses', () => {
  for (const expected of ['Value equals @r.[no errors shown].', 'Value equals @[field is accepted].',
    'Value equals @t.[without errors].', 'Value equals params["r.no errors shown"].',
    "Value equals params['r.field is accepted'].", 'Value equals @r.[no errors shown\\] in value].'])
    assert.equal(explicitFieldValidationRequirement(expected), false, expected);
  assert.equal(explicitFieldValidationRequirement('Value equals @r.[no errors shown] without errors.'), true,
    'masking the reference must preserve the separate authored requirement');
});

test('reference masking shares resolution grammar and preserves non-reference text without reading values', () => {
  const tokens = ['@r.name', '@name', '@[field is accepted]', '@r.[no errors shown\\] in key]', 'params["r.without errors"]'];
  for (const token of tokens) {
    assert.equal(referencedParameterNames([{ expected_result: token }]).length, 1, token);
    assert.equal(maskParameterReferences(`before ${token} after`), `before ${' '.repeat(token.length)} after`, token);
  }
  const ordinary = 'literal user@example.test, invalid @r. and params[untrusted]';
  assert.equal(maskParameterReferences(ordinary), ordinary, 'email addresses and invalid partial references are not references');
  assert.equal(maskParameterReferences(null), null);
});

test('native content with only value, visibility or enabled predicates cannot discharge explicit validation', () => {
  for (const operations of [[operation('value')], [operation('value'), operation('value', 'input', '#other')],
    [operation('value'), operation('visible')], [operation('value'), operation('enabled')],
    [operation('value'), operation('value', 'select', '#selection')], [operation('value', 'select')]]) {
    const issues = nativeValueCoverageIssues({ requirements, operations });
    assert.equal(issues.length, 1);assert.equal(issues[0].obligation_id, 'current');assert.equal(issues[0].code, 'expected_result_not_covered');
    assert.doesNotMatch(JSON.stringify(issues), /@r\.input|#field|#other/);
  }
  assert.deepEqual(nativeValueCoverageIssues({ requirements: [], operations: [operation('value')] }), []);
});

test('independent status and declared-field predicates retain ordinary semantic assessment of their relevance', () => {
  for (const predicate of [operation('text', 'p'), operation('text_content', 'p'), operation('hidden', 'p'), operation('field_valid')])
    assert.deepEqual(nativeValueCoverageIssues({ requirements, operations: [operation('value'), predicate] }), []);
  assert.deepEqual(nativeValueCoverageIssues({ requirements, operations: [operation('value'), operation('enabled', 'button')] }), [], 'a non-control predicate remains subject to ordinary semantic review');
});

test('explicit no-field-error outcomes distinguish declared errors from native constraints', () => {
  for (const expected of ['Email field contains @r.email and no field errors are displayed.', 'No field error messages are displayed.',
    'No field-level errors should be visible.', 'No input errors are shown.', 'No inline errors are present.',
    'Validation errors are not displayed.', 'The input is entered without validation errors.', 'The entered input is error-free.']) {
    const strict = nativeValueCoverageRequirements([goal(expected)]);
    assert.equal(strict[0].validation_scope, 'declared_field_errors', expected);
    for (const native of ['valid', 'invalid']) {
      assert.equal(nativeValueCoverageIssues({ requirements: strict, operations: [operation('value'), operation(native)] }).length, 1, expected);
      assert.equal(nativeValueCoverageIssues({ requirements: strict, operations: [operation(native)] }).length, 1, expected);
    }
    assert.deepEqual(nativeValueCoverageIssues({ requirements: strict, operations: [operation('value'), operation('field_valid')] }), []);
  }
});

test('native-only validity requirements still allow the native predicate without inventing app or business proof', () => {
  for (const expected of ['The input is valid according to native constraints.', 'The field remains valid.', 'The entered value passes validation.']) {
    const native = nativeValueCoverageRequirements([goal(expected)]);
    assert.equal(native.length, 1); assert.equal(native[0].validation_scope, undefined);
    assert.deepEqual(nativeValueCoverageIssues({ requirements: native, operations: [operation('value'), operation('valid')] }), []);
  }
});

test('quoted literal data and reference names never create declared-error absence clauses', () => {
  for (const expected of ['The value equals "no field errors are displayed".', 'The value equals `field errors are not displayed`.',
    'The field displays “no field error messages are shown”.', 'Value equals @r.[no field errors are displayed].',
    'Value equals params["r.no field errors are displayed"].']) assert.deepEqual(nativeValueCoverageRequirements([goal(expected)]), [], expected);
  const fixedBusiness = nativeValueCoverageRequirements([goal('The server accepted the request and no field errors are displayed.')]);
  assert.equal(fixedBusiness[0].validation_scope, 'declared_field_errors');
  assert.equal(nativeValueCoverageIssues({ requirements: fixedBusiness, operations: [operation('value'), operation('valid')] }).length, 1);
});

test('each linked obligation must map its own non-content proof instead of borrowing another row’s status', () => {
  const operations = [operation('value'), operation('text_content', 'p')];
  const strict = nativeValueCoverageRequirements([goal('The entered value is retained.'), goal('The input is entered without errors.', 'manual')]);
  const issues = nativeValueCoverageIssues({ requirements: strict, operations, mappings: [
    { id: 'current', assertion_operations: [1, 2] }, { id: 'manual', assertion_operations: [1] }
  ] });
  assert.deepEqual(issues.map(issue => issue.obligation_id), ['manual']);
  assert.deepEqual(nativeValueCoverageIssues({ requirements: strict, operations, mappings: [
    { id: 'current', assertion_operations: [1] }, { id: 'manual', assertion_operations: [1, 2] }
  ] }), []);
});

test('mapped value checks on a select cannot disguise a native content-only proof', () => {
  const operations = [operation('value'), operation('value', 'select'), operation('text_content', 'p')];
  const issues = nativeValueCoverageIssues({ requirements, operations, mappings: [{ id: 'current', assertion_operations: [1, 2] }] });
  assert.equal(issues.length, 1);
  assert.deepEqual(nativeValueCoverageIssues({ requirements, operations, mappings: [{ id: 'current', assertion_operations: [1, 2, 3] }] }), []);
});

test('all native input value properties remain content-only without reinterpreting checked or validity states', () => {
  for (const inputType of ['checkbox', 'radio', 'hidden', 'range', 'file', 'color', 'button']) {
    const operations = [operation('value'), operation('value', 'input', '#other', inputType), operation('text_content', 'p')];
    assert.equal(nativeValueCoverageIssues({ requirements, operations: operations.slice(0, 2) }).length, 1, inputType);
    assert.equal(nativeValueCoverageIssues({ requirements, operations, mappings: [{ id: 'current', assertion_operations: [1, 2] }] }).length, 1, inputType);
  }
  for (const assertion of ['checked', 'visible', 'enabled'])
    assert.deepEqual(nativeValueCoverageIssues({ requirements, operations: [operation('value'), operation(assertion, 'input', '#other', 'checkbox')] }), [], assertion);
});
