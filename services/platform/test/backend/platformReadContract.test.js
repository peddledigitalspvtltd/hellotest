const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const db = require('../../backend/src/db');
const projects = require('../../backend/public/projectAccess');
const applications = require('../../backend/public/applicationAccess');
const root = path.resolve(__dirname, '../../../..');

const restoreEnv = (key, value) => { if (value === undefined) delete process.env[key]; else process.env[key] = value; };

test('Platform contracts expose only shared reads', () => {
  assert.deepEqual(Object.keys(projects).sort(), ['getProject', 'getProjectCatalog']);
  assert.deepEqual(Object.keys(applications), ['getAppType']);
});

test('all profiles preserve project membership checks without a Platform HTTP dependency', async t => {
  const prior = process.env.HELLOTEST_SERVICE_PROFILE;
  t.after(() => restoreEnv('HELLOTEST_SERVICE_PROFILE', prior));
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Shared Platform reads must not make network requests'); });
  const calls = [];
  t.mock.method(db, 'prepare', sql => ({
    get: async (...args) => {
      calls.push({ sql, args });
      if (sql.includes('FROM project_members')) return args[1] === 'member' ? { id: 'membership' } : undefined;
      if (sql.includes('FROM projects')) return args[0] === 'project' ? { id: 'project', name: 'Existing project' } : undefined;
      if (sql.includes('FROM app_types')) return args[0] === 'app' ? { id: 'app', project_id: 'project' } : undefined;
      throw new Error('Unexpected read');
    }
  }));
  const owners = Object.keys(require('../../../capabilities.json').dependencies);
  for (const profile of ['all', ...owners]) {
    process.env.HELLOTEST_SERVICE_PROFILE = profile;
    assert.equal((await projects.getProject('project', 'member')).id, 'project');
    await assert.rejects(projects.getProject('project', 'outsider'), /Access denied/);
    await assert.rejects(projects.getProject('missing', 'member'), /Project not found/);
    assert.equal((await applications.getAppType('app')).project_id, 'project');
    await assert.rejects(applications.getAppType('missing'), /App type not found/);
  }
  assert.equal(calls.filter(call => call.sql.includes('FROM project_members')).length, (owners.length + 1) * 2);
  assert.ok(calls.filter(call => call.sql.includes('FROM project_members')).every(call => call.args[0] === 'project'));
});

test('catalog reads bind the caller and preserve summary redaction and database failures', async t => {
  const reads = [];
  t.mock.method(db, 'prepare', sql => ({ all: async (...args) => {
    reads.push({ sql, args });
    return [{ id: 'project', has_access: false, description: null, created_by: null }];
  } }));
  await assert.rejects(projects.getProjectCatalog(), /User is required/);
  assert.equal(reads.length, 0);
  assert.deepEqual(await projects.getProjectCatalog('member', { projection: 'summary' }), [{ id: 'project', has_access: false, description: null, created_by: null }]);
  assert.deepEqual(reads[0].args, ['member', 'member']);
  assert.match(reads[0].sql, /CASE WHEN catalog.has_access THEN LEFT\(catalog.description, 1024\) ELSE NULL END/);
  const failure = Object.assign(new Error('Database unavailable'), { code: 'ECONNREFUSED' });
  t.mock.method(db, 'prepare', () => ({ get: async () => { throw failure; } }));
  await assert.rejects(projects.getProject('project', 'member'), error => error === failure);
});

test('selected profiles load only their own manifests and cannot expose the retired bridge', () => {
  const script = `
    const Module = require('node:module');
    const assert = require('node:assert/strict');
    const original = Module._load;
    Module._load = function(id, ...rest) {
      if (/(?:^|\\/)services\\/(?!testing\\/)[^/]+\\/backend\\/service.manifest.js$/.test(id)) throw new Error('Foreign manifest loaded: ' + id);
      return original.call(this, id, ...rest);
    };
    const manifest = require('./services/platform/backend/src/routes/manifest');
    assert.deepEqual(manifest.serviceManifests.map(m => m.id), ['testing']);
    assert.ok(manifest.routeModules.every(route => !route.source.includes('platformReads')));
  `;
  const result = spawnSync(process.execPath, ['-e', script], { cwd: root, encoding: 'utf8', env: { ...process.env, HELLOTEST_SERVICE_PROFILE: 'testing', HELLOTEST_ENABLED_CAPABILITIES: 'all' } });
  assert.equal(result.status, 0, result.stderr);
});
