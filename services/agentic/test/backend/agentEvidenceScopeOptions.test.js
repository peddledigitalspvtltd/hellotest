const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('@hellotest/platform/backend/src/db');
const permissions = require('@hellotest/platform/backend/services/permission.service');
const flags = require('@hellotest/platform/backend/services/featureFlag.service');
const service = require('../../backend/services/agentEvidenceScopeOptions.service');
function fixture(t) {
  const queries = [];
  t.mock.method(permissions, 'hasPermission', async () => true);
  t.mock.method(flags, 'areEnabled', async () => true);
  t.mock.method(db, 'prepare', sql => ({ all: async (...params) => {
    queries.push({ sql, params });
    return Array.from({ length: 11 }, (_, index) => ({ id: `story-${index}`, display_id: `ST-${index}`, name: `Story ${index}` }));
  } }));
  return queries;
}
test('scope choices preload at most ten records and bind literal search, project, application and other selections', async t => {
  const queries = fixture(t);
  const input = { project_id: 'project-a', app_type_id: 'app-a', field: 'story_id', story_id: 'replace-me', sprint_id: 'sprint-a', search: "ID_%' OR TRUE --", limit: 1000 };
  const result = await service.options(input, { id: 'user-a' });
  assert.equal(result.items.length, 10); assert.equal(result.has_more, true);
  assert.deepEqual(result.items[0], { id: 'story-0', label: 'ST-0', description: 'Story 0' });
  assert.equal(queries[0].params[0], 'project-a'); assert.equal(queries[0].params.at(-1), 11);
  assert.ok(queries[0].params.includes('sprint-a')); assert.ok(queries[0].params.includes('app-a'));
  assert.ok(!queries[0].params.includes('replace-me')); assert.ok(!queries[0].sql.includes(input.search));
  assert.match(queries[0].sql, /STRPOS/);
});
test('scope choices honor permission and feature revocation before reading names', async t => {
  const queries = fixture(t);
  permissions.hasPermission = async () => false;
  await assert.rejects(service.options({ project_id: 'project-a', field: 'test_case_id' }, { id: 'user-a' }), { statusCode: 403 });
  assert.equal(queries.length, 0);
  permissions.hasPermission = async () => true; flags.areEnabled = async () => false;
  await assert.rejects(service.options({ project_id: 'project-a', field: 'test_case_id' }, { id: 'user-a' }), { statusCode: 403 });
  assert.equal(queries.length, 0);
});
test('delivery choices remain project bound while intersecting the selected Story and Run', async t => {
  const queries = fixture(t);
  await service.options({ project_id: 'project-a', field: 'release_id', story_id: 'story-a', execution_id: 'run-a' }, { id: 'user-a' });
  assert.match(queries[0].sql, /scope_record.project_id = record.project_id/);
  assert.ok(queries[0].params.includes('story-a')); assert.ok(queries[0].params.includes('run-a'));
});
