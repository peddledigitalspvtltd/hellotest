const test = require('node:test');
const assert = require('node:assert/strict');
const { compileRecordedProgram } = require('../../backend/lib/automationRecordedProgram');
const { deriveProgramTools } = require('../../backend/lib/automationProgramTools');
const { prepareVerificationSections } = require('../../backend/lib/automationVerificationPipeline');
const { preserveGeneratedAssertions, assertionContracts } = require('../../backend/lib/automationGeneratedProgram');
const { fieldValidationStateSource } = require('../../backend/lib/automationFieldValidity');
const op = (name, args) => ({ name, arguments: args });
const check = (assertion, locator, value) => op('browser_assert', { assertion, locator, ...(value === undefined ? {} : { value }) });
const derive = source => deriveProgramTools({ payload: { steps: [{ step_id: 'one', automation_code: source }] }, execution: { required: true, step_id: 'one' } });
const prepare = source => prepareVerificationSections([{ id: 'one', step_type: 'web', automation_code: source }], { resolve: (_name, args) => args });

test('repeated fields share lazy locators and one exact reader without dropping actions, values or checkpoints', () => {
  const operations = ['#email', '#password'].flatMap((locator, index) => [
    op('browser_fill', { locator, value: `params["t.field${index}"]` }),
    check('value', locator, `params["t.field${index}"]`),
    check('field_valid', locator)
  ]);
  const compact = compileRecordedProgram(operations), inline = compileRecordedProgram(operations, { layout: 'inline' });
  assert.equal(compact.operation_count, 6); assert.equal(compact.assertion_count, 4);
  assert.equal(compact.source.split('function readFieldValidationState').length - 1, 1);
  assert.equal(compact.source.split('page.locator("#email")').length - 1, 1);
  assert.equal(compact.source.split('page.locator("#password")').length - 1, 1);
  assert.equal(compact.source.split('.evaluate(readFieldValidity)').length - 1, 2);
  assert.ok(compact.source.length < inline.source.length * 0.6, 'two readers need less than 60% of the previous source');
  assert.deepEqual(derive(compact.source), derive(inline.source));
  for (const source of [compact.source, inline.source]) {
    assert.deepEqual(prepare(source).sections[0].operations, operations);
    assert.equal(prepare(source).sections[0].automation_code, source, 'verification leaves saved code unchanged');
  }
  assert.doesNotThrow(() => preserveGeneratedAssertions(inline.source, compact.source));
  assert.doesNotThrow(() => preserveGeneratedAssertions(compact.source, inline.source));
  assert.deepEqual(assertionContracts(compact.source), assertionContracts(inline.source));
});

test('compact normalized-text polls round-trip aliases without changing visibility, text or expected-value semantics', () => {
  const operations = [check('visible', '#status'), check('text', '#status', 'Ready'), check('text_contains', '#status', '@r.status')];
  const compact = compileRecordedProgram(operations), inline = compileRecordedProgram(operations, { layout: 'inline' });
  assert.deepEqual(derive(compact.source), operations);
  assert.deepEqual(prepare(compact.source).sections[0].operations, prepare(inline.source).sections[0].operations);
  assert.equal(compact.source.split('page.locator("#status")').length - 1, 1);
  assert.equal(compact.source.split('isVisible()').length - 1, 2);
  assert.ok(compact.source.length < inline.source.length);
});

test('helper, timeout, subject, polarity and added work mutations cannot masquerade as compact compiler output', () => {
  const operations = [check('field_valid', '#email'), check('field_valid', '#password')];
  const source = compileRecordedProgram(operations).source;
  for (const modified of [
    source.replace('return true;', 'return false;'),
    source.replace('readFieldValidity = function', 'readFieldValidity = async function'),
    source.replace('timeout: 8000', 'timeout: 1'),
    source.replace('.toBe(true)', '.toBe(false)'),
    source.replace(fieldValidationStateSource, '() => true')
  ]) {
    assert.equal(derive(modified), null);
    assert.throws(() => prepare(modified), { code: 'AUTOMATION_VERIFICATION_UNSUPPORTED' });
    assert.throws(() => preserveGeneratedAssertions(source, modified), { code: 'AUTOMATION_GENERATED_ASSERTION_NOT_PRESERVED' });
  }
  assert.throws(() => prepare(source + '\nawait readFieldValidity();'), { code: 'AUTOMATION_VERIFICATION_UNSUPPORTED' });
  const changedSubject = source.replace('page.locator("#email").evaluate(', 'page.locator("#other").evaluate(');
  assert.notEqual(changedSubject, source);
  assert.throws(() => preserveGeneratedAssertions(source, changedSubject), { code: 'AUTOMATION_GENERATED_ASSERTION_NOT_PRESERVED' });
  assert.throws(() => prepare(source.replace('const readFieldValidity', 'const renamedReader').replaceAll('evaluate(readFieldValidity)', 'evaluate(renamedReader)')),
    { code: 'AUTOMATION_VERIFICATION_UNSUPPORTED' }, 'equivalent arbitrary helper layouts are outside the exact compiler contract');
});

test('native matchers do not acquire polling, sleeps or pre-action checks', () => {
  const operations = [op('browser_fill', { locator: '#email', value: '@t.email' }), check('value', '#email', '@t.email'), check('visible', '#message')];
  const result = compileRecordedProgram(operations);
  assert.doesNotMatch(result.source, /expect\.poll|waitForTimeout|\.evaluate\(|\.isVisible\(/);
  assert.deepEqual(derive(result.source), operations);
  assert.equal(result.source.split('await ').length - 1, operations.length);
  assert.equal(compileRecordedProgram(operations, { layout: 'unknown' }), null);
});
