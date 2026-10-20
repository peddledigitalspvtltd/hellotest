const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const filename = path.resolve(__dirname, '../../backend/services/knowledgeGraphManagement.service.js');
const native = createRequire(filename);
const user = { id: 'curator', role: 'admin' };

function fixture({ active = true, grants = ['knowledge.view', 'knowledge.manage'], sourceLock } = {}) {
  const calls = { permissions: [], statements: [], nodeReads: 0, writes: 0, committed: 0, rolledBack: 0 };
  const db = {
    query: async sql => { calls.statements.push(sql); },
    prepare: sql => ({
      get: async () => {
        calls.statements.push(sql);
        if (sql.includes('FROM users')) {
          assert.match(sql, /status = 'active'/);
          return active ? { id: user.id } : undefined;
        }
        throw new Error('Unexpected canonical read after the aborted source lock.');
      },
      all: async () => {
        calls.statements.push(sql);
        if (sql.includes('FROM ai_knowledge_sources') && sql.includes('FOR UPDATE')) return sourceLock ? sourceLock() : [];
        calls.nodeReads++;
        throw new Error('Unexpected graph read after the aborted source lock.');
      },
      run: async () => { calls.writes++; throw new Error('An aborted candidate must not write.'); }
    }),
    transaction: task => async () => {
      try { const result = await task(); calls.committed++; return result; }
      catch (error) { calls.rolledBack++; throw error; }
    }
  };
  const mocks = {
    '@hellotest/platform/backend/src/db': db,
    '@hellotest/platform/backend/services/permission.service': { hasPermission: async (_user, permission) => { calls.permissions.push(permission); return grants.includes(permission); } },
    '@hellotest/platform/backend/services/featureFlag.service': { getFeatureKeysForPermission: () => [], areEnabled: async () => true },
    '@hellotest/platform/backend/public/projectAccess': { getProject: async () => ({ id: 'project' }) },
    './knowledgeRag.service': { resolveAllowedSourcePermissions: async () => [] }
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', fs.readFileSync(filename, 'utf8'))(
    name => Object.hasOwn(mocks, name) ? mocks[name] : native(name), module, module.exports);
  return { management: module.exports, calls };
}

test('a candidate cancelled while waiting for canonical source locks rolls back before graph reads or writes', async () => {
  let enteredLock, releaseLock;
  const entered = new Promise(resolve => { enteredLock = resolve; });
  const pending = new Promise(resolve => { releaseLock = resolve; });
  const { management, calls } = fixture({ sourceLock: async () => { enteredLock(); await pending; return []; } });
  const controller = new AbortController();
  const result = management.propose({ projectId: 'project', user, signal: controller.signal, input: {
    source_node_id: 'auth', target_node_id: 'checkout', relation_type: 'DEPENDS_ON',
    chunk_id: 'source-fragment', excerpt: 'Auth depends on Checkout.'
  } });
  await entered;
  controller.abort(); releaseLock();
  await assert.rejects(result, error => error.code === 'REQUEST_CANCELLED');
  assert.equal(calls.nodeReads, 0); assert.equal(calls.writes, 0);
  assert.equal(calls.committed, 0); assert.equal(calls.rolledBack, 1);
  assert.ok(calls.statements.some(sql => /SET LOCAL lock_timeout = '2s'/.test(sql)));
});

test('inactive native curators are rejected before administrator grants or transaction work', async () => {
  const { management, calls } = fixture({ active: false });
  await assert.rejects(management.authorize('project', user, true), error => error.statusCode === 403);
  assert.deepEqual(calls.permissions, []); assert.equal(calls.committed, 0);
});

test('curation requires the current knowledge read grant as well as the manage grant', async () => {
  const { management, calls } = fixture({ grants: ['knowledge.manage'] });
  await assert.rejects(management.authorize('project', user, true), error => error.statusCode === 403);
  assert.deepEqual(calls.permissions, ['knowledge.view']);
});
