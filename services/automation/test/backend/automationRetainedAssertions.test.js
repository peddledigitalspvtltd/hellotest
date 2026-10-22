const { expandManagedInstructions } = require('../../../platform/backend/test/helpers/managedInstructions');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRetainedAssertionContract, pendingFinalAssertions, retainedFinalAssertionHints } = require('../../backend/lib/automationRetainedAssertions');
const { compileRecordedProgram } = require('../../backend/lib/automationRecordedProgram');
const { parameterReference, referenceKey, createBrowserParameterResolver } = require('../../backend/lib/automationBrowserParameters');
const { recordBrowserOperation, recordedSectionRequests } = require('../../backend/lib/automationBrowserRecording');

const op = (name, args) => ({ name, arguments: args });
const check = (assertion, locator, value) => op('browser_assert', { assertion, ...(locator === undefined ? {} : { locator }), ...(value === undefined ? {} : { value }) });
const navigation = op('browser_navigate', { url: 'https://fixture.test/auth' });
const fill = op('browser_fill', { locator: '#email', value: '@r.email' });
const visible = check('visible', '#email');
const value = check('value', '#email', '@r.email');
const create = operations => createRetainedAssertionContract({ step: { id: 'step', step_type: 'web', automation_code: compileRecordedProgram(operations).source } });

test('a saved exact URL check omitted by an otherwise visible navigation candidate remains a typed final requirement', () => {
  const exactUrl = check('url', undefined, 'https://fixture.test/auth');
  const contract = create([navigation, exactUrl, visible, check('visible', '#password'), check('visible', '#submit')]);
  assert.equal(contract.status, 'available');assert.match(contract.source_fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(contract.earlier_assertions.length, 0);assert.equal(contract.final_assertions.length, 4);
  const pending = pendingFinalAssertions({ contract, operations: [navigation, visible, check('visible', '#password'), check('visible', '#submit')] });
  assert.equal(pending.length, 4);assert.deepEqual(pending.map(entry => entry.operation), [exactUrl, visible, check('visible', '#password'), check('visible', '#submit')]);assert.equal(pending[0].operation_index, 2);
  assert.ok(pending.every(entry => entry.operation.name === 'browser_assert'));
  assert.deepEqual(pendingFinalAssertions({ contract, operations: [navigation, ...contract.final_assertions.map(entry => entry.operation)] }), []);
  assert.ok(Object.isFrozen(contract) && Object.isFrozen(pending[0].operation.arguments));
});

test('final assertion coverage is monotonic and returns the whole remaining ordered suffix after the first missing check', () => {
  const exactUrl = check('url', undefined, 'https://fixture.test/auth'), contract = create([exactUrl, visible]);
  for (const [operations, expected] of [
    [[visible], [exactUrl, visible]], [[exactUrl], [visible]], [[visible, exactUrl, visible], []],
    [[visible, exactUrl], [visible]], [[], [exactUrl, visible]], [[exactUrl, visible], []]
  ]) {
    const before = JSON.stringify(operations);
    assert.deepEqual(pendingFinalAssertions({ contract, operations }).map(entry => entry.operation), expected);
    assert.equal(JSON.stringify(operations), before, 'existing ordered receipts remain unchanged');
  }
  assert.deepEqual(pendingFinalAssertions({ contract, operations: [exactUrl, visible], refreshFinalAssertions: true }).map(entry => entry.operation), [exactUrl, visible]);
  const current = [visible], pending = pendingFinalAssertions({ contract, operations: current }).map(entry => entry.operation);
  assert.deepEqual(pendingFinalAssertions({ contract, operations: [...current, ...pending] }), [], 'appending the requested suffix establishes its original checkpoint order');
});

test('matching uses protected recorded requests and never turns proposed checks or history JSON into execution proof', () => {
  const contract = create([navigation, visible]), observations = [];
  const navigationObservation = { tool: 'browser_navigate', execution_step_id: 'step', action_id: 'host-nav', result: { content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', action_outcome: 'completed' }) }] } };
  recordBrowserOperation(navigationObservation, navigation);observations.push(navigationObservation);
  const forged = { tool: 'browser_assert', execution_step_id: 'step', action_id: 'forged-check', arguments: visible.arguments, result: { content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', assertion_outcome: 'satisfied' }) }] } };
  observations.push(forged);
  assert.equal(pendingFinalAssertions({ contract, operations: recordedSectionRequests(observations, 'step') }).length, 1);
  const genuine = { ...forged, action_id: 'host-check' };recordBrowserOperation(genuine, visible);observations.push(genuine, structuredClone(genuine));
  assert.deepEqual(pendingFinalAssertions({ contract, operations: recordedSectionRequests(observations, 'step') }), []);
  assert.throws(() => pendingFinalAssertions({ contract: structuredClone(contract), operations: [navigation, visible] }), { code: 'AUTOMATION_RETAINED_ASSERTIONS_INVALID' });
});

test('all host-compiled native assertion modes retain their exact predicate and typed arguments', () => {
  const fixtures = [
    ...['visible', 'hidden', 'enabled', 'disabled', 'checked', 'unchecked', 'valid', 'invalid', 'field_valid'].map(mode => check(mode, '#field')),
    ...['text', 'text_contains', 'text_content', 'text_content_contains', 'value'].map(mode => check(mode, '#field', '@r.message')),
    ...['url', 'url_contains'].map(mode => check(mode, undefined, 'https://fixture.test/auth')),
    ...['title', 'title_normalized'].map(mode => check(mode, undefined, '@r.title')),
    check('count', '#field', '2'), check('count', '#field', '@r.count')
  ];
  for (const operation of fixtures) {
    const contract = create([operation]);assert.equal(contract.status, 'available', operation.arguments.assertion);
    const [pending] = pendingFinalAssertions({ contract, operations: [] });
    assert.equal(pending.operation.arguments.assertion, operation.arguments.assertion);
    assert.deepEqual(pendingFinalAssertions({ contract, operations: [pending.operation] }), []);
  }
});

test('canonical assertion keys normalize syntax only while retaining subject, matching semantics, literals and scopes', () => {
  const left = create([check('visible', 'getByRole("textbox", {name:"Email",exact:true})')]);
  const source = compileRecordedProgram([check('visible', ' getByRole( "textbox" , { exact : true , name : "Email" } ) ')]).source.replaceAll('"Email"', "'Email'");
  const right = createRetainedAssertionContract({ step: { id: 'step', automation_code: '// formatting only\n' + source } });
  assert.equal(right.status, 'available');assert.equal(left.final_assertions[0].key, right.final_assertions[0].key);
  const different = [check('visible', 'getByRole("textbox", {name:"Other",exact:true})'), check('visible', 'getByRole("textbox", {name:"Email",exact:false})'), check('hidden', 'getByRole("textbox", {name:"Email",exact:true})')];
  for (const operation of different) assert.equal(pendingFinalAssertions({ contract: left, operations: [operation] }).length, 1);
  for (const operation of [check('text', '#message', 'Approved'), check('text_contains', '#message', 'Approved'), check('text_content', '#message', 'Approved'), check('text', '#message', 'Declined')]) {
    const contract = create([operation]);assert.equal(contract.status, 'available');
    assert.notEqual(contract.final_assertions[0].key, create([check('text', '#other', 'Approved')]).final_assertions[0].key);
  }
});

test('explicit params and token spellings keep identical exact bindings without treating current literal values as references', () => {
  for (const key of ['r.email', 't.customer name', 's.account.code', 'r.closing]bracket', 'r.path\\segment']) {
    const reference = parameterReference(key), direct = `params[${JSON.stringify(key)}]`;
    const contract = create([op('browser_fill', { locator: '#field', value: direct }), check('value', '#field', direct)]);
    assert.equal(contract.status, 'available', key);
    assert.equal(contract.final_assertions[0].operation.arguments.value, direct, 'the actual retained execution argument keeps its saved parameter expression');
    assert.deepEqual(pendingFinalAssertions({ contract, operations: [op('browser_fill', { locator: '#field', value: reference }), check('value', '#field', reference)] }), []);
    assert.equal(pendingFinalAssertions({ contract, operations: [op('browser_fill', { locator: '#field', value: reference }), check('value', '#field', 'current public literal')] }).length, 1);
    assert.throws(() => pendingFinalAssertions({ contract, operations: [op('browser_fill', { locator: '#field', value: 'current public literal' })] }), { code: 'AUTOMATION_RETAINED_ASSERTION_ACTION_ORDER_GAP' });
  }
  const contract = create([value]);
  for (const other of ['@t.email', '@r.other', 'fixed public input']) assert.equal(pendingFinalAssertions({ contract, operations: [check('value', '#email', other)] }).length, 1);
});

test('earlier checkpoints cannot be supplied at completion or after a different action prefix', () => {
  const contract = create([navigation, visible, fill, value]);
  assert.equal(contract.earlier_assertions.length, 1);assert.deepEqual(contract.final_assertions.map(entry => entry.operation), [value]);
  for (const operations of [[navigation, fill, value], [navigation, fill, visible, value]]) {
    assert.throws(() => pendingFinalAssertions({ contract, operations }), { code: 'AUTOMATION_RETAINED_ASSERTION_ORDER_GAP' });
  }
  assert.deepEqual(pendingFinalAssertions({ contract, operations: [navigation, visible, fill] }).map(entry => entry.operation), [value]);
  assert.deepEqual(pendingFinalAssertions({ contract, operations: [navigation, visible, fill, value] }), []);
  assert.deepEqual(pendingFinalAssertions({ contract, operations: [navigation, visible, fill, value], refreshFinalAssertions: true }).map(entry => entry.operation), [value], 'a later failed check refreshes final proof without deleting the earlier checkpoint');
  const ordered = create([navigation, visible, check('visible', '#password'), fill, value]);
  assert.throws(() => pendingFinalAssertions({ contract: ordered, operations: [navigation, check('visible', '#password'), visible, fill, value] }), { code: 'AUTOMATION_RETAINED_ASSERTION_ORDER_GAP' });
});

test('saved actions must already match in scope, values, targets and order before final checks can run', () => {
  const contract = create([navigation, fill, value]);
  const alternatives = [[], [fill, navigation], [navigation], [navigation, op('browser_fill', { locator: '#other', value: '@r.email' })],
    [navigation, op('browser_fill', { locator: '#email', value: '@t.email' })], [navigation, op('browser_fill', { locator: '#email', value: 'public literal' })], [navigation, navigation, fill]];
  for (const operations of alternatives) assert.throws(() => pendingFinalAssertions({ contract, operations }), { code: 'AUTOMATION_RETAINED_ASSERTION_ACTION_ORDER_GAP' });
  assert.deepEqual(pendingFinalAssertions({ contract, operations: [visible, navigation, fill] }).map(entry => entry.operation), [value], 'additional read-only checks do not change the original action sequence');
});

test('only adjacent identical checks coalesce and a current check before a later action cannot satisfy its final checkpoint', () => {
  const contract = create([visible, visible, fill, visible, visible]);
  assert.equal(contract.assertions.length, 2);assert.equal(contract.earlier_assertions.length, 1);assert.equal(contract.final_assertions.length, 1);
  assert.equal(pendingFinalAssertions({ contract, operations: [visible, fill] }).length, 1);
  assert.deepEqual(pendingFinalAssertions({ contract, operations: [visible, fill, visible] }), []);
  const nonadjacent = create([visible, check('visible', '#password'), visible]);
  assert.equal(nonadjacent.final_assertions.length, 3);
  assert.equal(pendingFinalAssertions({ contract: nonadjacent, operations: [visible, check('visible', '#password')] }).length, 1);
});

test('unsupported custom source, mixed source and explicit wait barriers expose no automatic executable checks', () => {
  const canonical = compileRecordedProgram([navigation, visible]).source;
  const variants = [canonical + '\nawait page.evaluate(() => document.body.click());', 'if (true) { ' + canonical + ' }',
    canonical + '\nawait page.waitForLoadState("load");', canonical + '\nawait page.waitForTimeout(1);',
    canonical + '\nconst extra = page.locator("#unused");', 'await expect.poll(() => { page.reload(); return page.url(); }).toBe("https://fixture.test/auth");',
    '// @hellotest-options optional\n' + canonical, canonical + '\nPRIVATE_UNSUPPORTED_SOURCE();'];
  for (const source of variants) {
    const contract = createRetainedAssertionContract({ step: { id: 'step', step_type: 'web', automation_code: source } });
    assert.equal(contract.status, 'unavailable');assert.deepEqual(contract.assertions, []);assert.deepEqual(contract.final_assertions, []);
    assert.equal(contract.diagnostic.code, 'AUTOMATION_RETAINED_ASSERTIONS_UNAVAILABLE');assert.doesNotMatch(JSON.stringify(contract), /PRIVATE_UNSUPPORTED_SOURCE|document\.body/);
    assert.throws(() => pendingFinalAssertions({ contract, operations: [] }), { code: 'AUTOMATION_RETAINED_ASSERTIONS_UNAVAILABLE' });
  }
});

test('empty source has no retained execution contract and malformed metadata/ledgers fail closed', () => {
  for (const source of [undefined, null, '', '  ']) {
    const contract = createRetainedAssertionContract({ step: { id: 'step', automation_code: source } });assert.equal(contract.status, 'empty');
    assert.deepEqual(pendingFinalAssertions({ contract }), []);
  }
  for (const step of [undefined, { id: '' }, { id: 'step', automation_code: {} }, { id: 'step', step_type: 'api', automation_code: 'x' }]) assert.equal(createRetainedAssertionContract({ step }).status, 'unavailable');
  const contract = create([visible]);
  for (const operations of [null, {}, Array(251).fill(visible), [op('browser_assert', { assertion: 'invented', locator: '#email' })]]) assert.throws(() => pendingFinalAssertions({ contract, operations }), { code: 'AUTOMATION_RETAINED_ASSERTIONS_INVALID' });
  assert.throws(() => pendingFinalAssertions({ contract, refreshFinalAssertions: 'yes' }), { code: 'AUTOMATION_RETAINED_ASSERTIONS_INVALID' });
});

test('ordered final hints reveal symbolic bindings but omit all literal expectations including historical secrets', () => {
  const privateValue = 'CURRENT_PRIVATE_HINT_FIXTURE', historicalSecret = 'HISTORICAL_SECRET_UNKNOWN_TO_RESOLVER', publicValue = 'public-fixture@example.test';
  const resolver = createBrowserParameterResolver({ caseValues: { 'r.email': publicValue, 'r.password': privateValue, 'r.secret_alias': '@r.email' }, materialize: false });
  const projections = [], projectText = text => { projections.push(text); return referenceKey(text) ? resolver.projectText(text) : resolver.projectPrivateText(text); };
  const sensitiveLocator = `getByText(${JSON.stringify(privateValue)}, {exact:true})`;
  const contract = create([navigation, check('url', undefined, 'https://fixture.test/auth'), value, check('value', '#password', 'params["r.password"]'),
    check('value', '#previous-input', historicalSecret), check('count', '#items', '2'), check('visible', sensitiveLocator)]);
  const hints = retainedFinalAssertionHints(contract, { projectText });
  assert.deepEqual(hints.checks.map(row => row.assertion), ['url', 'value', 'value', 'value', 'count', 'visible']);
  assert.deepEqual(hints.checks[0], { assertion: 'url', expected_value_omitted: true });
  assert.equal(hints.checks[1].parameter_reference, '@r.email');assert.equal(hints.checks[2].parameter_reference, '@r.password');
  assert.deepEqual(hints.checks[3], { assertion: 'value', locator: '#previous-input', expected_value_omitted: true });
  assert.deepEqual(hints.checks[4], { assertion: 'count', locator: '#items', expected_value_omitted: true });
  assert.deepEqual(hints.checks[5], { assertion: 'visible', subject_omitted: true });assert.equal(hints.omitted_count, 0);
  const encoded = JSON.stringify(hints);
  for (const raw of [privateValue, historicalSecret, publicValue, 'https://fixture.test/auth', '[private parameter value]', 'source_fingerprint', 'operation_index', 'automation_code']) assert.ok(!encoded.includes(raw), raw);
  assert.ok(!projections.includes('@r.email') && !projections.includes('@r.password'), 'a general projector never materializes symbolic bindings');
  assert.match(expandManagedInstructions(hints.instruction), /Saved locators are requirements, not fresh evidence/);assert.match(expandManagedInstructions(hints.instruction), /following retained checks to host preflight/);
});

test('hint bindings retain exact namespaces and escaped names without disclosing their frozen values', () => {
  const keys = ['t.customer name', 's.account.code', 'r.closing]bracket', 'r.path\\segment'];
  const contract = create(keys.map((key, index) => check('value', '#field-' + index, `params[${JSON.stringify(key)}]`)));
  const hints = retainedFinalAssertionHints(contract, { projectText: text => text });
  assert.deepEqual(hints.checks.map(row => row.parameter_reference), keys.map(parameterReference));assert.equal(hints.omitted_count, 0);
  assert.ok(hints.checks.every(row => !Object.hasOwn(row, 'value') && !Object.hasOwn(row, 'key')));
});

test('hint size retains only a complete ordered prefix within 2000 bytes with an accurate omitted count', () => {
  const operations = Array.from({ length: 12 }, (_, index) => check('visible', '#' + index + '界'.repeat(120)));
  const contract = create(operations), hints = retainedFinalAssertionHints(contract, { projectText: text => text });
  assert.ok(hints.checks.length > 0 && hints.checks.length < operations.length);assert.equal(hints.omitted_count, operations.length - hints.checks.length);
  assert.ok(Buffer.byteLength(JSON.stringify(hints), 'utf8') <= 2000);assert.ok(JSON.stringify(hints).length <= 2000);
  assert.deepEqual(hints.checks.map(row => row.locator), operations.slice(0, hints.checks.length).map(row => row.arguments.locator));
  const oversized = retainedFinalAssertionHints(create([check('visible', '#' + '界'.repeat(700)), visible]), { projectText: text => text });
  assert.deepEqual(oversized.checks, []);assert.equal(oversized.omitted_count, 2, 'a large first check is not skipped to advertise a later one');
  assert.ok(Buffer.byteLength(JSON.stringify(oversized), 'utf8') <= 2000);
});

test('hint projection requires genuine contract authority and fails closed without exposing projection errors', () => {
  const contract = create([visible]);let projections = 0;
  for (const forged of [{}, structuredClone(contract), { ...contract }, null]) assert.throws(() => retainedFinalAssertionHints(forged, { projectText: text => { projections++;return text; } }), { code: 'AUTOMATION_RETAINED_ASSERTIONS_INVALID' });
  assert.equal(projections, 0);
  for (const projectText of [undefined, () => null, () => { throw new Error('PRIVATE_PROJECTION_DETAIL'); }]) {
    assert.throws(() => retainedFinalAssertionHints(contract, { projectText }), error => error.code === 'AUTOMATION_RETAINED_ASSERTIONS_INVALID' && !error.message.includes('PRIVATE_PROJECTION_DETAIL'));
  }
  for (const source of ['', 'PRIVATE_UNSUPPORTED_SOURCE();']) {
    const original = createRetainedAssertionContract({ step: { id: 'step', automation_code: source } });
    const hints = retainedFinalAssertionHints(original, { projectText: text => text });assert.deepEqual(hints.checks, []);assert.equal(hints.omitted_count, 0);assert.doesNotMatch(JSON.stringify(hints), /PRIVATE_UNSUPPORTED_SOURCE/);
  }
  assert.deepEqual(pendingFinalAssertions({ contract, operations: [] }).map(entry => entry.operation), [visible], 'hints never manufacture execution evidence or discharge checks');
});
