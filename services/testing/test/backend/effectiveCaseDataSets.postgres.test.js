const test = require('node:test');
const assert = require('node:assert/strict');

test('actual PostgreSQL resolves dataset relationship precedence and scope using read-only synthetic CTE rows', {
  skip: process.env.EFFECTIVE_CASE_DATA_SETS_POSTGRES !== '1', timeout: 15_000
}, async () => {
  const db = require('../../../platform/backend/src/db');
  const { loadEffectiveCaseDataSets } = require('../../backend/services/effectiveCaseDataSets.service');
  const cases = [
    ...['own', 'fallback', 'stable', 'foreign-own', 'cross-source', 'shared'].map(id => ({ id, app_type_id: 'app', automated: 'yes' })),
    { id: 'foreign-target', app_type_id: 'other-app', automated: 'yes' },
    ...['manual-a', 'manual-b', 'manual-z'].map(id => ({ id, app_type_id: 'app', automated: 'no' })),
    { id: 'foreign-manual', app_type_id: 'other-app', automated: 'no' }
  ];
  const link = (target, source, primary = false) => ({ automation_test_case_id: target, manual_test_case_id: source, is_primary: primary });
  const mapping = (owner, id, order = 1) => ({ test_case_id: owner, test_data_set_id: id, sort_order: order });
  const links = [link('own', 'manual-b', true), link('fallback', 'manual-a'), link('fallback', 'manual-b', true),
    link('stable', 'manual-z'), link('stable', 'manual-a'), link('foreign-own', 'manual-a', true),
    link('cross-source', 'foreign-manual', true), link('shared', 'manual-z', true)];
  const mappings = [mapping('own', 'own-later', 2), mapping('own', 'own-first'), mapping('manual-a', 'manual-a-data'),
    mapping('manual-b', 'manual-b-data'), mapping('manual-z', 'project-shared'), mapping('foreign-own', 'wrong-project'), mapping('foreign-manual', 'wrong-project')];
  const datasets = ['own-first', 'own-later', 'manual-a-data', 'manual-b-data', 'project-shared', 'wrong-project'].map(id => ({
    id, name: id, project_id: id === 'wrong-project' ? 'other-project' : 'project', app_type_id: id === 'project-shared' ? null : id === 'wrong-project' ? 'other-app' : 'app',
    mode: 'table', columns: ['t.name'], rows: [{ 't.name': 'Synthetic fixture value' }]
  }));
  const tables = [cases, [], [{ id: 'app', project_id: 'project' }, { id: 'other-app', project_id: 'other-project' }], links, mappings, datasets];
  const ctes = `WITH
    test_cases AS (SELECT * FROM jsonb_to_recordset(?::jsonb) AS x(id text,app_type_id text,suite_id text,automated text)),
    test_suites AS (SELECT * FROM jsonb_to_recordset(?::jsonb) AS x(id text,app_type_id text)),
    app_types AS (SELECT * FROM jsonb_to_recordset(?::jsonb) AS x(id text,project_id text)),
    automation_case_links AS (SELECT * FROM jsonb_to_recordset(?::jsonb) AS x(automation_test_case_id text,manual_test_case_id text,is_primary boolean)),
    test_case_data_sets AS (SELECT * FROM jsonb_to_recordset(?::jsonb) AS x(test_case_id text,test_data_set_id text,sort_order integer)),
    test_data_sets AS (SELECT * FROM jsonb_to_recordset(?::jsonb) AS x(id text,name text,description text,project_id text,app_type_id text,mode text,columns jsonb,rows jsonb))
  `;
  const database = { prepare: sql => ({ all: (...args) => db.prepare(ctes+sql).all(...tables, ...args) }) };
  try {
    const rows = await loadEffectiveCaseDataSets({ testCaseIds: ['own', 'fallback', 'stable', 'cross-source', 'shared', 'foreign-target'], projectId: 'project', appTypeId: 'app', database });
    assert.deepEqual(rows.map(row => [row.test_case_id, row.test_data_set_id, row.mapping_source]), [
      ['fallback', 'manual-b-data', 'linked_manual'], ['own', 'own-first', 'test_case'],
      ['shared', 'project-shared', 'linked_manual'], ['stable', 'manual-a-data', 'linked_manual']
    ]);
    const ownOnly = await loadEffectiveCaseDataSets({ testCaseIds: ['own', 'fallback'], projectId: 'project', appTypeId: 'app', includeLinkedManual: false, database });
    assert.deepEqual(ownOnly.map(row => row.test_data_set_id), ['own-first']);
    await assert.rejects(loadEffectiveCaseDataSets({ testCaseIds: ['foreign-own'], projectId: 'project', appTypeId: 'app', database }), { code: 'TEST_CASE_DATA_SET_UNAVAILABLE' });
    assert.deepEqual(await loadEffectiveCaseDataSets({ testCaseIds: ['own', 'fallback'], projectId: 'other-project', appTypeId: 'app', database }), []);
  } finally { await db.close(); }
});
