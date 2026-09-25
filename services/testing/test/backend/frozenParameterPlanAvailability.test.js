const assert = require('node:assert/strict');
const test = require('node:test');
const db = require('../../../platform/backend/src/db');
const scopes = require('../../backend/services/suiteExecutionContext.service');

test('a frozen parameter plan retains saved membership without reading current suite children or defaults', async t => {
  const expanded = [], contexts = [];
  t.mock.method(scopes, 'expandSuiteSelection', async ids => { expanded.push(ids); return []; });
  t.mock.method(scopes, 'loadSuiteContexts', async ids => { contexts.push(ids); return new Map(); });
  const execution = { id: 'run', project_id: 'project', app_type_id: 'app', direct_test_case_ids: [], parameter_values: {}, parameter_scope_default: 'r' };
  t.mock.method(db, 'prepare', sql => ({
    get: async () => {
      if (/FROM app_types/.test(sql)) return { id: 'app' };
      if (/FROM executions/.test(sql)) return execution;
      assert.fail('Unexpected resource read: ' + sql);
    },
    all: async (...args) => {
      if (/FROM execution_case_snapshots/.test(sql)) return [{ test_case_id: 'case', test_case_title: 'Frozen case', suite_id: 'suite', parameter_values: { 't.account': 'saved' }, test_data_set_snapshot: null }];
      if (/FROM execution_step_snapshots/.test(sql)) return [{ test_case_id: 'case', step_order: 1, action: 'Open @t.account', expected_result: 'Ready' }];
      if (/FROM execution_suites/.test(sql)) return [{ suite_id: 'suite' }];
      if (/FROM test_cases c/.test(sql)) { assert.deepEqual(args.slice(1), [[], []]); return []; }
      if (/FROM test_steps|FROM suite_test_cases|FROM test_case_data_sets/.test(sql)) return [];
      assert.fail('Unexpected authoring read: ' + sql);
    }
  }));
  const { buildRunParameterPlan } = require('../../backend/services/runParameterPlan.service');
  const plan = await buildRunParameterPlan({ project_id: 'project', app_type_id: 'app', execution_id: 'run', suite_ids: ['suite'], test_case_ids: [] });
  assert.equal(plan.case_count, 1);
  assert.equal(plan.expected_instance_count, 1);
  assert.deepEqual(plan.suite_ids, ['suite']);
  assert.deepEqual(plan.parameters, [{ name: 't.account', token: '@t.account', scope: 't', case_count: 1 }]);
  assert.deepEqual(expanded, [[]]);
  assert.deepEqual(contexts, [[]]);
});
