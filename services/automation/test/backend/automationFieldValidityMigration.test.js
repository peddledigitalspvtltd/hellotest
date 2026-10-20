const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { parseExpressionAt } = require('acorn');
const { fieldValidationStateSource, legacyFieldValidationStateSource } = require('../../backend/lib/automationFieldValidity');
const { compileRecordedProgram } = require('../../backend/lib/automationRecordedProgram');
const { deriveProgramTools } = require('../../backend/lib/automationProgramTools');
const { prepareVerificationSections } = require('../../backend/lib/automationVerificationPipeline');
const { createRetainedAssertionContract, pendingFinalAssertions } = require('../../backend/lib/automationRetainedAssertions');
const { preserveGeneratedAssertions } = require('../../backend/lib/automationGeneratedProgram');
const operations = [
  { name: 'browser_fill', arguments: { locator: '#password-input', value: '@r.password' } },
  { name: 'browser_assert', arguments: { assertion: 'value', locator: '#password-input', value: '@r.password' } },
  { name: 'browser_assert', arguments: { assertion: 'field_valid', locator: '#password-input' } }
];
const current = compileRecordedProgram(operations).source;
const legacy = current.replace(fieldValidationStateSource, legacyFieldValidationStateSource);
const step = source => ({ id: 'password', step_type: 'web', automation_code: source });
const derive = source => deriveProgramTools({ payload: { steps: [{ ...step(source), step_id: 'password' }] }, execution: { required: true, step_id: 'password' } });
const resolver = { resolve: (_name, args) => ({ ...args, ...(args.value === '@r.password' ? { value: 'private-frozen-password' } : {}) }) };

test('the exact earlier field reader becomes the same retained typed requirement without rewriting or running saved source', () => {
  const syntax = value => Array.isArray(value) ? value.map(syntax) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).filter(([key]) => !['start', 'end', 'loc', 'raw'].includes(key)).map(([key, item]) => [key, syntax(item)])) : value;
  assert.equal(createHash('sha256').update(JSON.stringify(syntax(parseExpressionAt(legacyFieldValidationStateSource, 0, { ecmaVersion: 'latest' })))).digest('hex'),
    '1da102a49f539bd10ffe8a0bbd98b011c2eb156bdf991d841e13317b657ea5b2', 'the previously shipped reader remains an exact pinned version');
  assert.notEqual(legacy, current);
  assert.deepEqual(derive(legacy), operations);
  const saved = step(legacy), contract = createRetainedAssertionContract({ step: saved });
  assert.equal(contract.status, 'available');
  assert.deepEqual(contract.final_assertions.map(row => row.operation), operations.slice(1));
  assert.deepEqual(pendingFinalAssertions({ contract, operations }), []);
  assert.equal(saved.automation_code, legacy, 'inspection leaves the saved source intact');
  assert.doesNotThrow(() => preserveGeneratedAssertions(legacy, current));
  assert.throws(() => preserveGeneratedAssertions(legacy, compileRecordedProgram(operations.slice(0, 2)).source), { code: 'AUTOMATION_GENERATED_ASSERTION_NOT_PRESERVED' });
  assert.throws(() => preserveGeneratedAssertions(legacy, compileRecordedProgram([operations[0], operations[2]]).source), { code: 'AUTOMATION_GENERATED_ASSERTION_NOT_PRESERVED' });
});

test('isolated verification keeps its exact source contract; legacy normalization is restricted to retained requirement extraction', () => {
  assert.throws(() => prepareVerificationSections([step(legacy)], resolver), { code: 'AUTOMATION_VERIFICATION_UNSUPPORTED' });
  assert.deepEqual(prepareVerificationSections([step(current)], resolver).sections[0].operations, operations);
  const requirements = prepareVerificationSections([step(legacy)], resolver, { allowLegacyFieldValidationRequirements: true });
  assert.deepEqual(requirements.sections[0].operations, operations);
  assert.equal(requirements.sections[0].automation_code, legacy);
});

test('changed native callback, subject, polarity and poll timeout cannot use the reader compatibility path', () => {
  for (const mutated of [
    legacy.replace("if (matches.length !== 1) return null;", 'if (matches.length !== 1) return true;'),
    legacy.replace("if (invalid && invalid !== 'false') return false;", "if (invalid && invalid !== 'false') return true;"),
    legacy.replace('}).toBe(true);', '}).toBe(false);'),
    legacy.replace('{ timeout: 8000 }', '{ timeout: 100 }')
  ]) {
    assert.notEqual(mutated, legacy);
    assert.equal(derive(mutated), null);
    assert.equal(createRetainedAssertionContract({ step: step(mutated) }).status, 'unavailable');
    assert.throws(() => prepareVerificationSections([step(mutated)], resolver, { allowLegacyFieldValidationRequirements: true }), { code: 'AUTOMATION_VERIFICATION_UNSUPPORTED' });
    assert.throws(() => preserveGeneratedAssertions(legacy, mutated), { code: 'AUTOMATION_GENERATED_ASSERTION_NOT_PRESERVED' });
  }
  const changedTarget = current.replace('object1.evaluate(', 'page.locator("#unrelated-input").evaluate(');
  assert.notEqual(changedTarget, current);
  assert.throws(() => preserveGeneratedAssertions(legacy, changedTarget), { code: 'AUTOMATION_GENERATED_ASSERTION_NOT_PRESERVED' });
});
