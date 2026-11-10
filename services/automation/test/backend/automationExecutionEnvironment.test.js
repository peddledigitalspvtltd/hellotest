const test = require('node:test');
const assert = require('node:assert/strict');
const { executionWithCaseEnvironment } = require('../../backend/lib/automationExecutionEnvironment');
const db = require('@hellotest/platform/backend/src/db');
test.after(() => db.close());

const execution = { project_id: 'project', app_type_id: 'app', created_by: 'creator' };
const caseSnapshot = { test_data_options: { test_environment_id: 'case-environment' } };
const resource = { id: 'case-environment', name: 'QA', base_url: 'https://qa.fixture.test', browser: 'firefox', variables: [{ key: 'password', value: 'private-fixture', is_secret: true }] };

test('an explicit frozen Run environment overrides every saved case default without reading a live resource', async () => {
  const selected = { ...execution, test_environment: { id: 'selected', snapshot: { base_url: 'https://selected.fixture.test' } } };
  assert.equal(await executionWithCaseEnvironment({ execution: selected, caseSnapshot, access: () => assert.fail('No new environment selection'), database: {} }), selected);
});

test('case defaults are authorized, application scoped and frozen once per actor and dispatch', async () => {
  let checks = 0, reads = 0;
  const access = async (user, project, permissions) => { checks++; assert.equal(user.id, 'executor'); assert.equal(project, 'project'); assert.deepEqual(permissions, ['environment.view']); return { 'environment.view': true }; };
  const database = { prepare: sql => { assert.match(sql, /id=\? AND project_id=\? AND \(app_type_id IS NULL OR app_type_id=\?\)/); return { get: async (...args) => { reads++; assert.deepEqual(args, ['case-environment', 'project', 'app']); return resource; } }; } };
  const input = { execution, caseSnapshot, actorId: 'executor', access, database, cache: new Map() };
  const [first, second] = await Promise.all([executionWithCaseEnvironment(input), executionWithCaseEnvironment(input)]);
  assert.equal(checks, 1); assert.equal(reads, 1);
  assert.equal(first.test_environment, second.test_environment);
  assert.deepEqual(first.test_environment.snapshot.variables, resource.variables, 'Private variables are carried only in the runtime snapshot');
  assert.equal(first.test_environment.snapshot.base_url, 'https://qa.fixture.test');
  assert.equal(execution.test_environment, undefined, 'Dispatch does not modify the saved Run');
});

test('revoked, moved, deleted or malformed default environments fail before engine handoff', async () => {
  const denied = { execution, caseSnapshot, actorId: 'executor', access: async () => ({ 'environment.view': false }), database: { prepare: () => assert.fail('Access must precede resource reads') } };
  await assert.rejects(executionWithCaseEnvironment(denied), { code: 'AUTOMATION_ENVIRONMENT_ACCESS_REQUIRED', statusCode: 403 });
  await assert.rejects(executionWithCaseEnvironment({ ...denied, access: async () => ({ 'environment.view': true }), database: { prepare: () => ({ get: async () => null }) } }), { code: 'AUTOMATION_ENVIRONMENT_UNAVAILABLE', statusCode: 404 });
  await assert.rejects(executionWithCaseEnvironment({ ...denied, caseSnapshot: { test_data_options: { test_environment_id: '../another-project' } } }), { code: 'AUTOMATION_ENVIRONMENT_INVALID' });
});
