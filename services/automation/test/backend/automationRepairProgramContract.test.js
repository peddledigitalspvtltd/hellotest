const test = require('node:test');
const assert = require('node:assert/strict');
const { compileRecordedProgram } = require('../../backend/lib/automationRecordedProgram');
const { nativeProgramPatch, nativeLocatorPatch, nativeRepairProgramSummary } = require('../../backend/lib/automationRepairProgramContract');

const operations = locator => [
  { name: 'browser_fill', arguments: { locator, value: '@r.password' } },
  { name: 'browser_assert', arguments: { assertion: 'value', locator, value: '@r.password' } },
  { name: 'browser_assert', arguments: { assertion: 'field_valid', locator } }
];
const source = rows => { const compiled = compileRecordedProgram(rows); assert.ok(compiled); return compiled.source; };
const section = code => ({ id: 'password-step', step_type: 'web', automation_code: code });

test('native locator repair reuses the engineer contract and rebinds input and both protected oracles together', () => {
  const step = section(source(operations('#old')));
  const result = nativeLocatorPatch({ step, newLocator: '#password-input' });
  assert.equal(result.operation_count, 3); assert.equal(result.assertion_count, 2);
  assert.deepEqual(result.locator_rebindings, [{ before: '#old', after: '#password-input' }]);
  assert.equal(result.automation_code, source(operations('#password-input')));
  assert.equal(nativeRepairProgramSummary(step).operation_count, 3);assert.equal(nativeRepairProgramSummary(step).assertion_count, 2);
  assert.deepEqual(nativeRepairProgramSummary(step).operation_lines.map(row=>row.assertion),[false,true,true]);
});

test('native repair preserves complete predicates, data scope, actions and their checkpoints', () => {
  const step = section(source(operations('#old'))), candidate = operations('#new');
  const failures = [
    candidate.slice(0, 2),
    [candidate[0], candidate[2], candidate[1]],
    [{ ...candidate[0], name: 'browser_click', arguments: { locator: '#new' } }, ...candidate.slice(1)],
    [{ ...candidate[0], arguments: { ...candidate[0].arguments, value: '@t.password' } }, ...candidate.slice(1)],
    [candidate[0], { ...candidate[1], arguments: { ...candidate[1].arguments, value: 'secret' } }, candidate[2]],
    [candidate[0], candidate[1], { ...candidate[2], arguments: { assertion: 'valid', locator: '#new' } }],
    [candidate[0], candidate[1], { ...candidate[2], arguments: { ...candidate[2].arguments, locator: '#unrelated' } }]
  ];
  for (const changed of failures) {
    const compiled = compileRecordedProgram(changed);
    if (compiled) assert.throws(() => nativeProgramPatch({ step, automationCode: compiled.source }));
  }
  assert.throws(() => nativeProgramPatch({ step, automationCode: source(candidate) + '\nawait fetch("https://other.test");' }));
  assert.throws(() => nativeProgramPatch({ step, automationCode: source(candidate).replace('8000', '99999') }));
  assert.throws(() => nativeProgramPatch({ step, automationCode: step.automation_code }));
});

test('native multi-control repairs cannot merge distinct saved subjects or guess a single replacement', () => {
  const initial = [operations('#email')[0], ...operations('#password')];
  const step = section(source(initial));
  assert.throws(() => nativeLocatorPatch({ step, newLocator: '#merged' }), /one saved subject/i);
  const merged = initial.map(operation => ({ ...operation, arguments: { ...operation.arguments, locator: '#merged' } }));
  assert.throws(() => nativeProgramPatch({ step, automationCode: source(merged) }), /distinct subjects/i);
  const rebound = initial.map(operation => ({ ...operation, arguments: { ...operation.arguments, locator: operation.arguments.locator === '#email' ? '#email-new' : '#password-new' } }));
  assert.equal(nativeProgramPatch({ step, automationCode: source(rebound) }).operation_count, 4);
});

test('native repair does not reinterpret arbitrary callbacks as protected field validation', () => {
  assert.equal(nativeRepairProgramSummary(section('await expect.poll(() => arbitrary()).toBe(true);')), null);
  assert.throws(() => nativeLocatorPatch({ step: section('await page.locator("#old").fill(process.env.SECRET);'), newLocator: '#new' }));
});
