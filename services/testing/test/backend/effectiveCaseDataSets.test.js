const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { loadEffectiveCaseDataSets, frozenCaseDataSet, caseDataSetResource } = require('../../backend/services/effectiveCaseDataSets.service');
const { normalizeDataOptions, composeScopedTestData, sharedParameterNames, dataOptionsForCase } = require('../../../platform/backend/src/utils/scopedTestData');
const { materializeDataSetSnapshot } = require('../../../platform/backend/src/utils/testDataGenerators');

const data = (extra = {}) => ({ test_case_id: 'automation', test_data_set_id: 'data', source_test_case_id: 'manual', mapping_source: 'linked_manual',
  id: 'data', name: 'Linked data', mode: 'table', columns: ['t.name'], rows: [{ 't.name': 'Frozen linked value' }], ...extra });

test('effective dataset query binds exact targets and scope, chooses explicit mapping before resources, and has stable manual precedence', async () => {
  let sql, args;
  const rows = await loadEffectiveCaseDataSets({ testCaseIds: ['automation', 'automation'], projectId: 'project', appTypeId: 'app',
    database: { prepare: query => { sql = query;return { all: async (...input) => { args = input;return [data()]; } }; } } });
  assert.deepEqual(args, [true, ['automation'], 'project', 'project', 'app', 'app']);
  assert.match(sql, /WHERE mapping\.test_case_id = target\.id/);
  assert.match(sql, /own_mapping\.test_data_set_id IS NULL/);
  assert.match(sql, /source\.app_type_id = target\.app_type_id/);
  assert.match(sql, /target\.automated = 'yes'/);
  assert.match(sql, /COALESCE\(source\.automated, 'no'\) = 'no'/);
  assert.match(sql, /ORDER BY link\.is_primary DESC, source\.id, mapping\.sort_order, mapping\.test_data_set_id/);
  assert.match(sql, /data_set\.project_id = target_app\.project_id/);
  assert.match(sql, /data_set\.app_type_id IS NULL OR data_set\.app_type_id = target_app\.id/);
  assert.match(sql, /target_app\.project_id = \?/);assert.match(sql, /target_app\.id = \?/);
  assert.ok(sql.indexOf(') own_mapping ON true') < sql.indexOf('LEFT JOIN test_data_sets data_set'));
  assert.equal(rows[0].mapping_source, 'linked_manual');
  assert.deepEqual(caseDataSetResource(rows[0]), { id: 'data', name: 'Linked data', mode: 'table', columns: ['t.name'], rows: [{ 't.name': 'Frozen linked value' }] });
});

test('invalid explicit or inherited mapping fails closed without selecting another dataset and locked reads preserve source relationships', async () => {
  let calls = 0, sql, args;
  const database = { prepare: query => { sql = query;return { all: async (...input) => { calls++;args = input;return [data({ id: null })]; } }; } };
  await assert.rejects(loadEffectiveCaseDataSets({ testCaseIds: ['automation'], projectId: 'project', appTypeId: 'app', includeLinkedManual: false, lock: true, database }),
    error => error.statusCode === 404 && error.code === 'TEST_CASE_DATA_SET_UNAVAILABLE' && !error.message.includes('manual'));
  assert.equal(calls, 1);assert.equal(args[0], false);
  assert.match(sql, /FOR SHARE OF mapping/);assert.match(sql, /FOR SHARE OF link,source,mapping/);assert.match(sql, /FOR SHARE OF target,target_app/);
  assert.deepEqual(await loadEffectiveCaseDataSets({ testCaseIds: [], database }), []);assert.equal(calls, 1);
});

test('frozen case layers retain materialized values and secret metadata without source lookup, mutation or template regeneration', () => {
  const original = composeScopedTestData({ hierarchical: true,
    caseData: { id: 'case-data', name: 'Case data', mode: 'table', rows: [{ 't.name': 'Already generated' }], template_rows: [{ 't.name': '{{randomString:12}}' }], sensitive_names: ['t.name'] },
    runData: { id: 'run-data', name: 'Run data', mode: 'table', rows: [{ 'r.region': 'One' }, { 'r.region': 'Two' }] } });
  const snapshot = { test_case_id: 'automation', data_set_source: original.source, test_data_set_snapshot: original.snapshot };
  const before = structuredClone(snapshot), saved = frozenCaseDataSet(snapshot);
  assert.deepEqual(saved.rows, [{ 't.name': 'Already generated' }]);assert.deepEqual(saved.sensitive_names, ['t.name']);assert.equal(saved.template_rows, undefined);
  saved.rows[0]['t.name'] = 'Mutated caller';assert.deepEqual(snapshot, before);
  assert.equal(frozenCaseDataSet({ test_data_set_snapshot: { mode: 'table', rows: [{}] }, data_set_source: 'run' }), null);
  assert.deepEqual(frozenCaseDataSet({ test_data_set_snapshot: { id: 'legacy', mode: 'table', rows: [{ old: 'saved' }] }, data_set_source: 'test_case' }).rows, [{ old: 'saved' }]);
});

function snapshotAttacher(loadData) {
  const source = fs.readFileSync(require.resolve('../../backend/services/execution.service'), 'utf8');
  const body = source.slice(source.indexOf('function buildExecutionDataSetSnapshot(resource)'), source.indexOf('async function buildSnapshotPayload('));
  return new Function('normalizeDataOptions', 'normalizeText', 'loadSuiteContexts', 'materializeDataSetSnapshot', 'parseJsonValue', 'composeScopedTestData', 'sharedParameterNames', 'dataOptionsForCase', 'require',
    body+'return attachCaseDataSetSnapshots;')(normalizeDataOptions, value => String(value || '').trim(), async () => new Map(), materializeDataSetSnapshot,
      (value, fallback) => value == null ? fallback : typeof value === 'string' ? JSON.parse(value) : value, composeScopedTestData, sharedParameterNames, dataOptionsForCase,
      name => { assert.equal(name, './effectiveCaseDataSets.service');return { loadEffectiveCaseDataSets: loadData, frozenCaseDataSet }; });
}

test('actual execution snapshot composition inherits one materialized manual dataset and freezes later run-option recomposition', async () => {
  let calls = 0, liveValue = 'Original linked value';
  const attach = snapshotAttacher(async input => { calls++;assert.deepEqual(input, { testCaseIds: ['automation'], projectId: 'project', appTypeId: 'app' });
    return [data({ columns: ['t.name', 't.id'], rows: [{ 't.name': liveValue, 't.id': '{{randomString:12}}' }] })]; });
  const [first] = await attach([{ test_case_id: 'automation', test_data_options: {} }], null, {}, [], { projectId: 'project', appTypeId: 'app' });
  const frozen = structuredClone(first), generated = first.test_data_set_snapshot.rows[0]['t.id'];
  assert.match(generated, /^[a-z0-9]{12}$/i);assert.equal(first.test_data_set_snapshot.rows[0]['t.name'], liveValue);
  assert.equal(first.test_data_set_snapshot.mapping_source, undefined, 'relationship diagnostics do not enter frozen resource data');
  liveValue = 'Later manual edit';
  const [changed] = await attach([first], { snapshot: { id: 'run', name: 'Run', mode: 'table', rows: [{ 'r.region': 'New run choice' }] } }, {}, [],
    { projectId: 'project', appTypeId: 'app', preserveFrozen: true });
  assert.equal(calls, 1, 'a frozen case never loads current relationships during a run option edit');
  assert.equal(changed.test_data_set_snapshot.rows[0]['t.name'], 'Original linked value');
  assert.equal(changed.test_data_set_snapshot.rows[0]['t.id'], generated);
  assert.equal(changed.test_data_set_snapshot.rows[0]['r.region'], 'New run choice');assert.deepEqual(first, frozen);
});
