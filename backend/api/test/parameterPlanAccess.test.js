const assert = require('node:assert/strict');
const test = require('node:test');
const Fastify = require('fastify');
const permissionService = require('../src/services/permission.service');
const projectService = require('../src/services/project.service');
const executions = require('../src/services/execution.service');
const plans = require('../src/services/runParameterPlan.service');
const flags = require('../src/services/featureFlag.service');
const db = require('../src/db');
const dataSets = require('../src/services/testDataSet.service');

async function fixture(t, { permissions, disabled = [] }) {
  const requests = [];
  t.mock.method(db, 'prepare', sql => ({ get: async () => {
    assert.match(sql, /FROM project_deletion_jobs/);
    return { active: false };
  } }));
  t.mock.method(permissionService, 'hasPermission', async (_user, code, projectId) => {
    return (!projectId || projectId === 'project') && permissions.includes(code);
  });
  t.mock.method(flags, 'areEnabled', async keys => keys.every(key => !disabled.includes(key)));
  t.mock.method(projectService, 'getProject', async id => {
    if (id !== 'project') throw Object.assign(new Error('Project denied'), { statusCode: 403 });
    return { id };
  });
  t.mock.method(executions, 'getExecution', async id => ({ id, project_id: id === 'foreign' ? 'foreign-project' : 'project', app_type_id: 'app', test_case_ids: ['saved-case'], suite_ids: ['saved-suite'], test_data_set_id: 'saved-data' }));
  t.mock.method(dataSets, 'getTestDataSet', async id => ({ id, project_id: 'project' }));
  t.mock.method(plans, 'buildRunParameterPlan', async input => { requests.push(input); return { case_count: 1, parameters: [] }; });
  const app = Fastify(); t.after(() => app.close());
  await app.register(require('../src/plugins/errorHandler'));
  await app.register(require('../src/plugins/validator'));
  await app.register(require('../src/plugins/accessControl'));
  app.addHook('onRequest', async req => { req.user = { id: 'member', role: 'member', status: 'active' }; });
  await app.register(require('../src/routes/executions.routes'));
  await app.ready();
  return { requests, post: input => app.inject({ method: 'POST', url: '/executions/parameter-plan', payload: { project_id: 'project', app_type_id: 'app', ...input } }) };
}

test('case/suite authoring parameter preview works when Runs is disabled', async t => {
  const { post, requests } = await fixture(t, { permissions: ['workspace.view', 'testcase.view', 'suite.view'], disabled: ['hellotest.manual.runs'] });
  assert.equal((await post({ test_case_ids: ['case'], suite_ids: ['suite'] })).statusCode, 200);
  assert.equal(requests.length, 1);
});

test('frozen Run parameter preview works without authoring; new live scope is still denied', async t => {
  const { post, requests } = await fixture(t, { permissions: ['workspace.view', 'run.view'], disabled: ['hellotest.manual.test_cases', 'hellotest.manual.suites'] });
  assert.equal((await post({ execution_id: 'saved', test_case_ids: ['saved-case'], suite_ids: ['saved-suite'] })).statusCode, 200);
  assert.equal((await post({ execution_id: 'saved', test_case_ids: ['new-case'] })).statusCode, 403);
  assert.equal((await post({ execution_id: 'saved', suite_ids: ['new-suite'] })).statusCode, 403);
  assert.equal((await post({ test_case_ids: ['saved-case'] })).statusCode, 403);
  assert.equal((await post({ execution_id: 'foreign' })).statusCode, 404);
  assert.equal(requests.length, 1);
});

test('an enabled authoring flag never substitutes for the project permission', async t => {
  const { post, requests } = await fixture(t, { permissions: ['workspace.view'] });
  assert.equal((await post({ test_case_ids: ['case'] })).statusCode, 403);
  assert.equal((await post({ execution_id: 'saved' })).statusCode, 403);
  assert.equal(requests.length, 0);
});

test('selecting a live dataset requires data permission while frozen data remains available to Run viewers', async t => {
  const { post, requests } = await fixture(t, { permissions: ['workspace.view', 'testcase.view', 'run.view'] });
  assert.equal((await post({ test_case_ids: ['case'], test_data_set_id: 'live-data' })).statusCode, 403);
  assert.equal((await post({ execution_id: 'saved', test_data_set_id: 'saved-data' })).statusCode, 200);
  assert.equal((await post({ execution_id: 'saved', test_data_set_id: 'live-data' })).statusCode, 403);
  assert.equal(requests.length, 1);
});

test('authorized dataset validation forwards the selected data and draft declaration without broadening access', async t => {
  const { post, requests } = await fixture(t, { permissions: ['workspace.view', 'testcase.view', 'data.view'] });
  const result = await post({ test_case_ids: ['case'], test_data_set_id: 'live-data', parameter_values: { 'r.build': '' },
    test_data_options: { override_test_case_data: false, override_suite_data: false, override_shared_steps: true } });
  assert.equal(result.statusCode, 200);
  assert.equal(requests[0].test_data_set_id, 'live-data');
  assert.deepEqual(requests[0].parameter_values, { 'r.build': '' });
  assert.equal(requests[0].test_data_options.override_test_case_data, false);
});
