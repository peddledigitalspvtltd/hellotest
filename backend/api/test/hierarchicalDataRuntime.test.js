const test = require('node:test');
const assert = require('node:assert/strict');
const { composeScopedTestData, normalizeDataOptions } = require('../src/utils/scopedTestData');
const { resolveParameterLayers } = require('../src/utils/stepParameterResolution');
const { materializeDataSetSnapshot } = require('../src/utils/testDataGenerators');
const data = (rows) => ({ id:'data', mode:'table', rows });
const on = normalizeDataOptions({});

test('new data policy retains missing columns, explicit blanks and row ordering', () => {
  const snapshot = composeScopedTestData({ hierarchical:true, caseData:data([{'t.customer':'one','r.keep':'case'}]), suiteData:data([{'s.tenant':'EU'}, {'s.tenant':'IN'}]), runData:data([{'r.build':'first'},{'r.build':''}]) }).snapshot;
  assert.equal(snapshot.rows.length,2);
  assert.deepEqual(snapshot.rows[1], {'t.customer':'one','r.keep':'case','s.tenant':'IN','r.build':''});
  assert.throws(() => composeScopedTestData({hierarchical:true,caseData:data([{'t.a':'one'},{'t.a':'two'}]),runData:data([{'r.b':'one'}])}), {code:'TEST_DATA_ROW_MISMATCH'});
  assert.equal(composeScopedTestData({hierarchical:true,caseData:data([{'t.a':'one'},{'t.a':'two'}]),runData:data([{'t.a':'run'}])}).snapshot.rows.length,1);
});

test('all 64 independent group, suite and run policies protect defaults and dataset values consistently', () => {
  for (const caseShared of [false,true]) for (const suiteCase of [false,true]) for (const suiteShared of [false,true]) for (const runCase of [false,true]) for (const runSuite of [false,true]) for (const runShared of [false,true]) {
    const policy={version:2,case:{...on,override_shared_steps:caseShared},suite:{...on,override_test_case_data:suiteCase,override_shared_steps:suiteShared},run:{...on,override_test_case_data:runCase,override_suite_data:runSuite,override_shared_steps:runShared}};
    const source={dataPolicy:policy,caseValues:{'t.case':'case default','r.shared':'case shared'},suiteValues:{'t.case':'suite override','s.suite':'suite default','r.shared':'suite shared'},runValues:{'t.case':'run override','s.suite':'run suite','r.shared':'run shared'},sharedValues:{'r.shared':'group'},isSharedStep:true};
    const resolved=resolveParameterLayers(source);
    assert.equal(resolved['t.case'], runCase && (runSuite || !suiteCase) ? 'run override' : suiteCase ? 'suite override' : 'case default');
    assert.equal(resolved['s.suite'],runSuite?'run suite':'suite default');
    let expected=caseShared?'case shared':'group';
    if(suiteShared && (suiteCase || !caseShared)) expected='suite shared';
    if(runShared && (runCase || !caseShared) && (runSuite || !(suiteShared && (suiteCase || !caseShared)))) expected='run shared';
    assert.equal(resolved['r.shared'],expected,JSON.stringify(policy));
    const snap=composeScopedTestData({hierarchical:true,caseData:data([source.caseValues]),suiteData:data([source.suiteValues]),runData:data([source.runValues]),caseOptions:policy.case,suiteOptions:policy.suite,runOptions:policy.run,sharedNames:new Set(['r.shared'])}).snapshot;
    assert.deepEqual(resolveParameterLayers({dataSet:snap,sharedValues:source.sharedValues,isSharedStep:true}),resolved);
  }
});

test('case lock protects shared defaults without leaking values between groups or changing ordinary steps', () => {
  const policy={version:2,case:{...on,override_shared_steps:false},suite:on,run:on};
  for(const group of ['group-a','group-b']) assert.equal(resolveParameterLayers({dataPolicy:policy,caseValues:{login:'case'},sharedValues:{login:group},isSharedStep:true})['r.login'],group);
  assert.equal(resolveParameterLayers({dataPolicy:policy,caseValues:{login:'case'},sharedValues:{login:'group'}})['r.login'],'case');
  assert.equal(resolveParameterLayers({dataPolicy:policy,caseValues:{login:'case'},sharedValues:{login:'group'},isSharedStep:true,runValues:{login:'run'}})['r.login'],'run');
});

test('rerun materializes source templates while keeping protected layer values and source ownership', () => {
  const first=composeScopedTestData({hierarchical:true,caseData:data([{'t.keep':'case'}]),runData:{...data([{'r.build':'2026-09-01T00:00:00.000Z'}]),template_rows:[{'r.build':'{{date:ISO}}'}]},runOptions:{override_test_case_data:false}}).snapshot;
  const regenerated=materializeDataSetSnapshot(first,new Date('2026-09-20T00:00:00Z'));
  const value=resolveParameterLayers({dataSet:regenerated});
  assert.equal(value['t.keep'],'case');
  assert.equal(value['r.build'],'2026-09-20T00:00:00.000Z');
  assert.equal(regenerated.rows[0]['r.build'],value['r.build']);
  assert.equal(first.rows[0]['r.build'],'2026-09-01T00:00:00.000Z');
});

test('an intermediate suite replacement removes obsolete case iteration constraints', () => {
  const input = { hierarchical:true, caseData:data([{'r.customer':'case one'}, {'r.customer':'case two'}]),
    suiteData:data([{'r.customer':'suite'}]), runData:data([{'r.build':'one'}, {'r.build':'two'}, {'r.build':'three'}]) };
  const snapshot = composeScopedTestData(input).snapshot;
  assert.deepEqual(snapshot.rows, [
    {'r.customer':'suite','r.build':'one'}, {'r.customer':'suite','r.build':'two'}, {'r.customer':'suite','r.build':'three'}
  ]);
  assert.equal(snapshot.parameter_data_layers.case.rows.length, 1);
  assert.equal(materializeDataSetSnapshot(snapshot).rows.length,3);
  assert.throws(() => composeScopedTestData({...input,suiteOptions:{override_test_case_data:false}}), {code:'TEST_DATA_ROW_MISMATCH'});
  const lockedRun = composeScopedTestData({...input,runData:data([{'r.customer':'ignored','r.build':'one'}, {'r.customer':'ignored','r.build':'two'}, {'r.customer':'ignored','r.build':'three'}]),runOptions:{override_test_case_data:false}}).snapshot;
  assert.ok(lockedRun.rows.every(row => row['r.customer']==='suite'), 'collapsing obsolete rows must retain case ownership for run override protection');
});
