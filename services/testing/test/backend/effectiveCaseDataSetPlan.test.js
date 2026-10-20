const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../../platform/backend/src/db');
const scopes = require('../../backend/services/suiteExecutionContext.service');
const { composeScopedTestData } = require('../../../platform/backend/src/utils/scopedTestData');

function fixture(t, frozen = false) {
  let mappingReads = 0;
  const storedData = composeScopedTestData({ hierarchical: true,
    caseData: { id: 'manual-data', mode: 'table', rows: [{ 't.name': 'Frozen name' }] },
    runData: { id: 'run-data', mode: 'table', rows: [{ 'r.region': 'One' }, { 'r.region': 'Two' }] } }).snapshot;
  const saved = { test_case_id: 'automation', test_case_title: 'Saved case', parameter_values: {}, test_data_options: {}, data_set_source: 'run', test_data_set_snapshot: storedData };
  const run = { id: 'run', project_id: 'project', app_type_id: 'app', direct_test_case_ids: ['automation'], parameter_values: {}, parameter_scope_default: 'r',
    test_data_set_id: 'run-data', test_data_set_snapshot: { id: 'run-data', mode: 'table', rows: [{ 'r.region': 'One' }, { 'r.region': 'Two' }] } };
  t.mock.method(scopes, 'expandSuiteSelection', async () => []);t.mock.method(scopes, 'loadSuiteContexts', async () => new Map());
  t.mock.method(db, 'prepare', sql => ({ get: async () => {
    if (/FROM app_types/.test(sql)) return { id: 'app' };if (/FROM executions/.test(sql)) return run;
    assert.fail('Unexpected live resource read: '+sql);
  }, all: async (...args) => {
    if (/FROM execution_case_snapshots/.test(sql)) return frozen ? [saved] : [];
    if (/FROM execution_step_snapshots/.test(sql)) return [{ test_case_id: 'automation', step_order: 1, action: 'Enter @t.name', expected_result: 'Name is retained' }];
    if (/FROM execution_suites/.test(sql)) return [];
    if (/FROM test_cases c/.test(sql)) return frozen ? [] : [{ id: 'automation', automated: 'yes', title: 'Linked case', app_type_id: 'app', parameter_values: {} }];
    if (/FROM test_cases target/.test(sql)) { mappingReads++;assert.equal(frozen, false, 'frozen plans must not query live case/manual mappings');
      assert.deepEqual(args, [true, ['automation'], 'project', 'project', 'app', 'app']);
      return [{ test_case_id: 'automation', test_data_set_id: 'manual-data', source_test_case_id: 'manual', mapping_source: 'linked_manual', id: 'manual-data',
        name: 'Linked data', mode: 'table', columns: ['t.name'], rows: [{ 't.name': 'Live one' }, { 't.name': 'Live two' }] }]; }
    if (/FROM test_steps/.test(sql)) return frozen ? [] : [{ test_case_id: 'automation', step_order: 1, action: 'Enter @t.name', expected_result: 'Name is retained' }];
    if (/FROM suite_test_cases|FROM automation_case_links link/.test(sql)) return [];
    assert.fail('Unexpected query: '+sql);
  } }));
  return { saved, get mappingReads() { return mappingReads; } };
}

test('actual run parameter plan includes linked manual dataset columns and all inherited iterations', async t => {
  const f = fixture(t), { buildRunParameterPlan } = require('../../backend/services/runParameterPlan.service');
  const plan = await buildRunParameterPlan({ project_id: 'project', app_type_id: 'app', test_case_ids: ['automation'] });
  assert.equal(f.mappingReads, 1);assert.equal(plan.case_count, 1);assert.equal(plan.expected_instance_count, 2);
  assert.deepEqual(plan.parameters, [{ name: 't.name', token: '@t.name', scope: 't', case_count: 1 }]);
});

test('a frozen run parameter plan changing run policy retains its saved case layer without reading newer linked defaults', async t => {
  const f = fixture(t, true), before = structuredClone(f.saved), { buildRunParameterPlan } = require('../../backend/services/runParameterPlan.service');
  const plan = await buildRunParameterPlan({ project_id: 'project', app_type_id: 'app', execution_id: 'run', test_case_ids: ['automation'],
    test_data_options: { override_test_case_data: false } });
  assert.equal(f.mappingReads, 0);assert.equal(plan.case_count, 1);assert.equal(plan.expected_instance_count, 2);assert.deepEqual(f.saved, before);
  assert.equal(plan.parameters.some(parameter => parameter.name === 't.name'), false, 'protected case parameters are excluded from the Run override template');
});
