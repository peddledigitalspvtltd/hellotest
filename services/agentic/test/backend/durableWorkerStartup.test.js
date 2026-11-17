const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { workerFailure } = require('../../backend/workflows/temporal/workerFailure');

async function boot({ mcpError, schemaError, connectionError } = {}) {
  const calls = [], diagnostics = [], handlers = new Map();
  const db = { close: async () => calls.push('close:main') }, obs = { close: async () => calls.push('close:observability') };
  const control = { enabled: () => true, queue: () => 'queue', close: async () => calls.push('close:control'), deliver: async () => calls.push('deliver') };
  const connection = { close: async () => calls.push('close:connection') };
  const process = { env: { TEMPORAL_NAMESPACE: 'namespace' }, exitCode: 0, stderr: { write: value => diagnostics.push(JSON.parse(value)) }, once: (name, fn) => handlers.set(name, fn), removeListener: name => handlers.delete(name) };
  const worker = { run: async () => calls.push('run'), shutdown: () => calls.push('shutdown') };
  const dependencies = {
    '@temporalio/worker': { NativeConnection: { connect: async () => { calls.push('connect'); if (connectionError) throw connectionError; return connection; } }, Worker: { create: async options => { calls.push('create'); assert.equal(options.namespace, 'namespace'); assert.equal(options.taskQueue, 'queue'); return worker; } } },
    '@hellotest/platform/backend/src/db': db,
    '@hellotest/platform/backend/src/obsDb': obs,
    '@hellotest/platform/backend/src/db/schemaReadiness': { verifySchema: async (port, component) => { calls.push('schema:' + component); assert.equal(port, component === 'main' ? db : obs); if (schemaError) throw schemaError; } },
    '@hellotest/mcp/backend/server': { handler: { close: async () => calls.push('close:mcp') } },
    './control': control, './connection': { connectionOptions: () => ({ address: 'temporal:7233' }) }, './activities': {}, './workerFailure': { workerFailure }
  };
  const requireMock = name => { if (name === '@hellotest/mcp/backend/server' && mcpError) throw mcpError; assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; };
  requireMock.resolve = name => name;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../backend/workflows/temporal/worker.cjs'), 'utf8'), { require: requireMock, process, setInterval: () => { calls.push('interval'); return 1; }, clearInterval: () => calls.push('clearInterval') });
  for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve));
  return { calls, diagnostics, process, handlers };
}

test('worker bootstrap verifies both real schema components before connecting and cleans up every owned resource', async () => {
  const result = await boot();
  assert.deepEqual(result.calls.slice(0, 4), ['schema:main', 'schema:observability', 'connect', 'create']);
  for (const action of ['run', 'deliver', 'close:main', 'close:observability', 'close:mcp', 'close:connection', 'close:control', 'clearInterval']) assert.ok(result.calls.includes(action), action);
  assert.deepEqual(result.diagnostics, []); assert.equal(result.process.exitCode, 0); assert.equal(result.handlers.size, 0);
});

test('credential initialization failure reports an actionable safe phase and closes opened database pools without starting Temporal', async () => {
  const result = await boot({ mcpError: new Error('SESSION_SECRET must be a non-default secret of at least 32 characters in production') });
  assert.equal(result.process.exitCode, 1); assert.equal(result.diagnostics[0].phase, 'mcp_initialization');
  assert.equal(result.diagnostics[0].code, 'RUNTIME_SECRET_CONFIGURATION_INVALID');
  assert.match(result.diagnostics[0].hint, /development overlay/); assert.ok(!result.calls.includes('connect'));
  assert.ok(result.calls.includes('close:main')); assert.ok(result.calls.includes('close:observability'));
});

test('schema and connection failures preserve only allowlisted diagnostics and never leak error text, causes or private identifiers', async () => {
  const schema = await boot({ schemaError: Object.assign(new Error('PRIVATE_DATABASE_URL'), { code: 'SCHEMA_MIGRATION_REQUIRED' }) });
  assert.equal(schema.diagnostics[0].phase, 'main_schema'); assert.equal(schema.diagnostics[0].code, 'SCHEMA_MIGRATION_REQUIRED');
  const privateFailure = Object.assign(new Error('https://user:PRIVATE_PASSWORD@example.invalid PRIVATE_RESPONSE'), { name: 'PRIVATE_NAME', code: 'PRIVATE_CODE', cause: new Error('PRIVATE_CAUSE') });
  const connection = await boot({ connectionError: privateFailure });
  assert.equal(connection.diagnostics[0].phase, 'temporal_connection'); assert.equal(connection.diagnostics[0].code, 'DURABLE_WORKER_FAILED');
  assert.equal(connection.diagnostics[0].kind, 'Error'); assert.doesNotMatch(JSON.stringify([...schema.diagnostics, ...connection.diagnostics]), /PRIVATE_/);
});
