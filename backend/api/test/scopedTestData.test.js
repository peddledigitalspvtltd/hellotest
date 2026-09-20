const test = require('node:test');
const assert = require('node:assert/strict');
const { composeScopedTestData, normalizeDataOptions, sharedParameterNames } = require('../src/utils/scopedTestData');
const { materializeDataSetSnapshot } = require('../src/utils/testDataGenerators');
const data = (id, rows) => ({ id, name: id, mode: 'table', columns: [...new Set(rows.flatMap(Object.keys))], rows });

test('default run data remains authoritative even when inherited scopes have incompatible rows', () => {
  const runData = data('run', [{ 't.name': 'override' }]);
  assert.strictEqual(composeScopedTestData({ runData, suiteData: data('suite', [{ a: 1 }, { a: 2 }]), caseData: data('case', [{ b: 1 }, { b: 2 }, { b: 3 }]), suiteOptions: { override_lower_scopes: false } }).snapshot, runData);
});

test('scoped data aligns case, suite and run rows without multiplying iterations', () => {
  const result = composeScopedTestData({ caseData: data('case', [{ 't.customer': 'first' }, { 't.customer': 'second' }]),
    suiteData: data('suite', [{ 's.tenant': 'EU', 't.customer': 'ignored' }, { 's.tenant': 'IN' }]),
    runData: data('run', [{ 'r.build': 'one', 's.tenant': 'ignored' }, { 'r.build': 'two', 't.customer': 'ignored' }]),
    suiteOptions: { override_lower_scopes: false }, runOptions: { override_lower_scopes: false } });
  assert.equal(result.source, 'run');
  assert.deepEqual(result.snapshot.rows, [{ 't.customer': 'first', 's.tenant': 'EU', 'r.build': 'one' }, { 't.customer': 'second', 's.tenant': 'IN', 'r.build': 'two' }]);
});

test('one inherited row provides defaults while explicit empty values override', () => {
  const result = composeScopedTestData({ caseData: data('case', [{ 't.expected': '', 'r.region': 'default' }]),
    runData: data('run', [{ 'r.region': '' }, { 'r.region': 'IN' }]), runOptions: { override_lower_scopes: false } });
  assert.deepEqual(result.snapshot.rows, [{ 't.expected': '', 'r.region': '' }, { 't.expected': '', 'r.region': 'IN' }]);
});

test('mismatched inherited rows report a actionable error instead of losing iterations', () => {
  assert.throws(() => composeScopedTestData({ caseData: data('case', [{ 't.x': 'one' }, { 't.x': 'two' }]), runData: data('run', [{ 'r.x': 'one' }]), runOptions: { override_lower_scopes: false } }), error => error.statusCode === 422 && error.code === 'TEST_DATA_ROW_MISMATCH');
});

test('shared-step parameter protection includes API and expected-result inputs', () => {
  const names = sharedParameterNames([{ group_kind: 'reusable', action: 'Use @token', expected_result: '@t.expected', api_request: { url: '@base/login' } }, { action: 'Use @unrelated' }]);
  assert.deepEqual([...names].sort(), ['r.base', 'r.token', 't.expected']);
  const result = composeScopedTestData({ caseData: data('case', [{ 'r.token': 'saved', 't.expected': 'original' }]), runData: data('run', [{ 'r.token': 'ignored', 't.expected': 'ignored', 'r.build': '123' }]), runOptions: { override_shared_steps: false }, sharedNames: names });
  assert.deepEqual(result.snapshot.rows, [{ 'r.token': 'saved', 't.expected': 'original', 'r.build': '123' }]);
});

test('frozen composed templates preserve protected and inherited columns when regenerated', () => {
  const runData = { ...data('run', [{ 'r.build': '42', 't.protected': 'not permitted' }]), template_rows: [{ 'r.build': '{{randomNumber}}', 't.protected': 'not permitted' }] };
  const result = composeScopedTestData({ caseData: data('case', [{ 't.protected': 'keep' }]), runData, runOptions: { override_lower_scopes: false } }).snapshot;
  assert.deepEqual(result.template_rows, [{ 't.protected': 'keep', 'r.build': '{{randomNumber}}' }]);
  assert.equal(materializeDataSetSnapshot(result).rows[0]['t.protected'], 'keep');
});

test('options reject non-boolean policy values and preserve defaults', () => {
  assert.deepEqual(normalizeDataOptions({}), { override_lower_scopes: true, override_shared_steps: true, override_test_case_data: true, override_suite_data: true });
  assert.throws(() => normalizeDataOptions({ override_lower_scopes: 'false' }), error => error.statusCode === 400);
});

test('case protection applies only to shared steps and retains the case iteration count', () => {
  const { resolveParameterLayers } = require('../src/utils/stepParameterResolution');
  const sharedNames = sharedParameterNames([{ group_kind: 'reusable', action: 'Given <login>', shared_parameter_values: { 'r.login': 'group' } }]);
  const caseData = data('case', [{ 'r.login': 'case-one', 't.item': 'one' }, { 'r.login': 'case-two', 't.item': 'two' }]);
  const result = composeScopedTestData({ caseData, caseOptions: { override_shared_steps: false }, sharedNames }).snapshot;
  assert.equal(result.rows.length, 2);
  assert.equal(resolveParameterLayers({ sharedValues: { login: 'group-a' }, isSharedStep: true, dataSet: result, rowIndex: 1 })['r.login'], 'group-a');
  assert.equal(resolveParameterLayers({ sharedValues: { login: 'group-b' }, isSharedStep: true, dataSet: result, rowIndex: 1 })['r.login'], 'group-b');
  assert.equal(resolveParameterLayers({ dataSet: result, rowIndex: 1 })['r.login'], 'case-two');
  assert.equal(resolveParameterLayers({ sharedValues: { login: 'group' }, caseValues: { login: 'explicit' }, isSharedStep: true, dataSet: result })['r.login'], 'explicit');
  const run = composeScopedTestData({ caseData, caseOptions: { override_shared_steps: false }, sharedNames, runData: data('run', [{ login: 'run' }]) }).snapshot;
  assert.equal(resolveParameterLayers({ sharedValues: { login: 'group' }, isSharedStep: true, dataSet: run })['r.login'], 'run');
  const protectedRun = composeScopedTestData({ caseData, caseOptions: { override_shared_steps: false }, sharedNames, runData: data('run', [{ login: 'ignored' }, {login:'ignored-two'}]), runOptions: { override_shared_steps: false } });
  assert.equal(resolveParameterLayers({ sharedValues: { login: 'group' }, isSharedStep: true, dataSet: protectedRun.snapshot })['r.login'], 'group');
});


test('shared case policy composes key/value suite data as parameter maps and retains secret metadata', () => {
  const { resolveParameterLayers } = require('../src/utils/stepParameterResolution');
  const snapshot = composeScopedTestData({ caseData: data('case',[{login:'case'}]), caseOptions:{override_shared_steps:false}, sharedNames:new Set(['r.login']),
    suiteData:{id:'suite',mode:'key_value',rows:[{key:'login',value:'suite-secret',is_secret:true}]} }).snapshot;
  assert.deepEqual(snapshot.shared_rows,[{'r.login':'suite-secret'}]);
  assert.deepEqual(snapshot.sensitive_names,['r.login']);
  assert.equal(resolveParameterLayers({sharedValues:{login:'group'},isSharedStep:true,dataSet:snapshot})['r.login'],'suite-secret');
});
