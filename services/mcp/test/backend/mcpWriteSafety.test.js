const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createVerification } = require('../../backend/operationVerification');

const filename = path.resolve(__dirname, '../../backend/backplane.js');
const nativeRequire = createRequire(filename);
const fail = (message, statusCode = 403, code = 'MCP_ACCESS_DENIED') => Object.assign(new Error(message), { statusCode, code, publicMessage: message });
const actor = { projectId: 'project', user: { id: 'user' }, clientId: 'host' };

function fixture({ rejectStart = false, denyRead = false } = {}) {
  const read = { id: 'read-run', method: 'GET', path: '/executions/:id', permission: 'run.view', read: true, path_parameters: ['id'], policy: { scope: { entity: 'execution', path_parameter: 'id' } } };
  const create = { id: 'create-run', method: 'POST', path: '/executions', permission: 'run.create', prepare: true, path_parameters: [], input_schema: { body: { type: 'object', additionalProperties: true, properties: { project_id: { type: 'string' }, app_type_id: { type: 'string' }, name: { type: 'string' }, test_case_ids: { type: 'array', items: { type: 'string' } }, created_by: { type: 'string' } } } }, policy: { effect: 'create', scope: { entity: 'execution' }, verification: { path: read.path, targetParameter: 'id', matchFields: ['app_type_id', 'name'], memberships: [{ bodyField: 'test_case_ids', listPath: 'direct_test_case_ids', mode: 'equals' }] } } };
  const operations = [read, create];
  let record = { id: 'saved-run', project_id: actor.projectId, app_type_id: 'app', name: 'Reviewed run', status: 'queued', revision: 1, direct_test_case_ids: ['case'], case_snapshots: [{ test_case_id: 'case' }] };
  const row = { id: 'plan', user_id: actor.user.id, project_id: actor.projectId, client_id: actor.clientId, operation_id: create.id, catalog_revision: 'catalog', state: 'authorized', expires_at: new Date(Date.now() + 60000).toISOString(), arguments: { body: { app_type_id: 'app', name: 'Reviewed run', test_case_ids: ['case'] }, preconditions: { execution_case_revisions: [] } } };
  let submitted = 0, persisted = false;
  const permissions = [];
  const db = {
    transaction: callback => async () => callback(),
    prepare: sql => ({
      get: async () => sql.includes('FROM mcp_action_plans') ? row : sql.includes('FROM executions') ? persisted ? { id: record.id } : undefined : { project_id: actor.projectId },
      all: async () => [],
      run: async (...values) => {
        if (sql.includes("SET state='executing'")) { row.state = 'executing'; row.started_at = new Date().toISOString(); }
        if (sql.includes('SET state=?,receipt=?')) { row.state = values[0]; row.receipt = values[1]; }
        return { changes: 1 };
      }
    })
  };
  const mocks = {
    '@hellotest/platform/backend/src/db': db,
    './registry': { all: () => operations, get: id => operations.find(item => item.id === id), revision: () => 'catalog', rootFor: () => ['/executions', 'execution'] },
    './featureOperations': { assertScope: async () => {}, assertResponseScope: async () => {}, readMembership: async () => [] },
    './auth': { fail, permit: async (_actor, permission) => { permissions.push(permission); if (denyRead && permission === 'run.view') throw fail('Permission required: run.view'); } },
    '@hellotest/platform/backend/src/utils/token': { createToken: () => 'internal-test-token' },
    '@hellotest/platform/backend/services/entityScope.service': {},
    '@hellotest/testing/backend/services/executionPlanPreconditions.service': { verify: async () => [], capture: async () => [] }
  };
  const module = { exports: {} };
  const source = fs.readFileSync(filename, 'utf8') + '\nmodule.exports.__verifyCreatedRecord = verifyCreatedRecord;';
  new Function('require', 'module', 'exports', source)(id => Object.hasOwn(mocks, id) ? mocks[id] : nativeRequire(id), module, module.exports);
  const backplane = module.exports;
  backplane.configure({ inject: async request => {
    const isCreate = request.method === 'POST';
    if (isCreate) { submitted++; persisted = true; }
    const statusCode = isCreate && rejectStart ? 409 : 200;
    const value = statusCode === 409 ? { code: 'TESTENGINE_REQUIRED', message: 'Configure an active Test Engine integration.' } : isCreate ? { id: record.id } : record;
    return { statusCode, headers: { 'content-type': 'application/json' }, json: () => value };
  } });
  row.digest = backplane.planDigest(row);
  return { backplane, read, create, row, permissions, setRecord: value => { record = value; }, get record() { return record; }, get submitted() { return submitted; }, get persisted() { return persisted; } };
}

test('execution creation verifies reviewed metadata as well as exact case scope', async () => {
  const f = fixture();
  f.setRecord({ ...f.record, name: 'Different persisted name' });
  await assert.rejects(f.backplane.__verifyCreatedRecord(actor, f.create, f.row, f.record.id), { code: 'MCP_UNVERIFIED_COMPLETION' });
});

test('a native conflict after durable run creation does not claim that no effect occurred', async () => {
  const f = fixture({ rejectStart: true });
  const receipt = await f.backplane.execute(actor, { plan_id: f.row.id });
  assert.equal(f.submitted, 1);
  assert.equal(f.persisted, true);
  assert.notEqual(receipt.state, 'failed', 'Native execution creation commits the run before starting TestEngine; a subsequent 409 cannot establish that no effect occurred.');
  assert.ok(['unknown', 'submitted', 'succeeded_verified'].includes(receipt.state));
});

test('a native shared-group conflict after a durable Test Case create is uncertain until reconciled', async () => {
  const f = fixture({ rejectStart: true });
  f.create.path = '/test-cases';
  f.read.path = '/test-cases/:id';
  f.create.policy.verification.path = f.read.path;
  f.row.arguments.body.title = 'Reviewed case';
  delete f.row.arguments.body.name;
  f.row.digest = f.backplane.planDigest(f.row);
  const receipt = await f.backplane.execute(actor, { plan_id: f.row.id });
  assert.equal(f.persisted, true);
  assert.notEqual(receipt.state, 'failed', 'Native Test Case creation commits before shared-group synchronization, which can reject the later sync with 409.');
});

test('prepare checks create read-back permission before persisting an approval plan', async () => {
  const f = fixture({ denyRead: true });
  await assert.rejects(f.backplane.prepare(actor, { operation_id: f.create.id, arguments: { body: { app_type_id: 'app', name: 'Reviewed run', test_case_ids: ['case'] } } }), { code: 'MCP_ACCESS_DENIED' });
  assert.equal(f.submitted, 0);
  assert.ok(f.permissions.includes('run.view'));
});

test('an update acknowledgement cannot substitute another matching record for the reviewed target', async () => {
  const read = { id: 'read', method: 'GET', path: '/records/:id', read: true, path_parameters: ['id'] };
  const op = { id: 'update', method: 'PUT', path: read.path, policy: { effect: 'update', scope: { path_parameter: 'id' }, verification: { path: read.path, matchFields: ['name'] } } };
  const records = { reviewed: { id: 'reviewed', name: 'Before' }, substitute: { id: 'substitute', name: 'After' } };
  const helper = createVerification({ registry: { all: () => [read, op] }, invoke: async (_actor, _operation, args) => records[args.path.id], fail, digest: value => JSON.stringify(value) });
  await assert.rejects(helper.verify(actor, op, { arguments: { path: { id: 'reviewed' }, body: { name: 'After' } } }, { id: 'substitute' }), { code: 'MCP_UNVERIFIED_COMPLETION' });
});

test('capturing a write target pins its native identity when the read resolves an alias', async () => {
  const read = { id: 'read', method: 'GET', path: '/records/:id', read: true, path_parameters: ['id'] };
  const op = { id: 'update', method: 'PUT', path: read.path, policy: { effect: 'update', scope: { path_parameter: 'id' }, verification: { path: read.path, matchFields: ['name'] } } };
  const helper = createVerification({ registry: { all: () => [read, op] }, invoke: async () => ({ id: 'native-record', name: 'Before', revision: 1 }), fail, digest: value => JSON.stringify(value) });
  const captured = await helper.capture(actor, op, { path: { id: 'TC-display-alias' }, body: { name: 'After' } });
  assert.equal(captured.id, 'native-record', 'The reviewed native identity must be visible and usable even when the original selector was a display alias.');
});
