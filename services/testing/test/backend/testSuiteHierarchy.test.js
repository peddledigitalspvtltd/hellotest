const { dependencyName } = require("../../../platform/backend/test/helpers/sourceFile");
const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { AsyncLocalStorage } = require('node:async_hooks');

const fixture = (rows = []) => {
  const suites = new Map(rows.map(row => [row.id, { app_type_id: 'app', revision: 1, name: row.id, ...row }]));
  const calls = [];
  const context = new AsyncLocalStorage();
  const locks = new Map();
  const db = {
    transaction: callback => async () => {
      const transaction = { releases: [], lockedApps: new Set() };
      return context.run(transaction, async () => {
        try { return await callback(); }
        finally { for (const release of transaction.releases) release(); }
      });
    },
    prepare: statement => {
      const sql = statement.replace(/\s+/g, ' ').trim();
      const record = args => { assert.equal((sql.match(/\?/g) || []).length, args.length); calls.push(sql); };
      return {
        get: async (...args) => {
          record(args);
          if (sql.includes('pg_advisory_xact_lock')) {
            const appId = suites.get(args[0])?.app_type_id;
            if (!appId) return null;
            const transaction = context.getStore();
            assert.ok(transaction, 'hierarchy lock belongs to the update transaction');
            const previous = locks.get(appId) || Promise.resolve();
            let release;
            const current = new Promise(resolve => { release = resolve; });
            locks.set(appId, current);
            await previous;
            transaction.releases.push(release);
            transaction.lockedApps.add(appId);
            return {};
          }
          if (/SELECT \* FROM test_suites WHERE id/.test(sql)) return suites.has(args[0]) ? { ...suites.get(args[0]) } : null;
          throw new Error(`Unexpected get: ${sql}`);
        },
        all: async (...args) => {
          record(args);
          if (!sql.startsWith('WITH RECURSIVE ancestors')) throw new Error(`Unexpected all: ${sql}`);
          assert.match(sql, /WHERE NOT ancestors.cyclic/, 'historical cycles terminate the recursive query');
          const result = [], visited = new Set();
          let next = args[0];
          while (next && suites.has(next)) {
            const row = suites.get(next), cyclic = visited.has(next);
            result.push({ id: row.id, app_type_id: row.app_type_id, cyclic });
            if (cyclic) break;
            visited.add(next);
            next = row.parent_id;
          }
          return result;
        },
        run: async (...args) => {
          record(args);
          if (!sql.startsWith('UPDATE test_suites')) throw new Error(`Unexpected mutation: ${sql}`);
          const row = suites.get(args.at(-1));
          const assignments = sql.slice(sql.indexOf(' SET ') + 5, sql.indexOf(' WHERE ')).split(',').filter(part => part.includes('?')).map(part => part.split('=')[0].trim());
          const next = Object.fromEntries(assignments.map((name, index) => [name, args[index]]));
          if (next.parent_id !== row.parent_id) assert.ok(context.getStore().lockedApps.has(row.app_type_id), 'parent move holds the application lock before persistence');
          Object.assign(row, next);
        }
      };
    }
  };
  const service = {};
  vm.runInNewContext(readFileSync(path.join(__dirname, '../../backend/services/testSuite.service.js'), 'utf8'), {
    exports: service,
    require: dependency => {
      if (dependencyName(dependency) === "db") return db;
      if (dependency === 'crypto') return require('node:crypto');
      if (dependency.includes('/utils/')) return require(dependency.startsWith('@hellotest/') ? dependency : path.resolve(__dirname, '../../backend/services', dependency));
      return {};
    }
  });
  return { service, suites, calls };
};

for (const parent_id of ['root', 'child', 'grandchild']) {
  test(`suite cannot move beneath ${parent_id} when that would form a cycle`, async () => {
    const { service, suites, calls } = fixture([{ id: 'root', parent_id: null }, { id: 'child', parent_id: 'root' }, { id: 'grandchild', parent_id: 'child' }]);
    await assert.rejects(service.updateTestSuite('root', { parent_id }), { statusCode: 409, code: 'SUITE_HIERARCHY_CYCLE' });
    assert.equal(suites.get('root').parent_id, null);
    assert.equal(calls.some(sql => sql.startsWith('UPDATE')), false);
  });
}

test('an existing cyclic ancestor chain is rejected without unbounded traversal', async () => {
  const { service, calls } = fixture([{ id: 'root', parent_id: null }, { id: 'broken-a', parent_id: 'broken-b' }, { id: 'broken-b', parent_id: 'broken-a' }]);
  await assert.rejects(service.updateTestSuite('root', { parent_id: 'broken-a' }), { code: 'SUITE_HIERARCHY_CYCLE' });
  assert.equal(calls.filter(sql => sql.startsWith('WITH RECURSIVE')).length, 1);
});

test('valid moves and clearing a parent preserve revisions, while foreign or missing parents reject', async () => {
  const { service, suites } = fixture([{ id: 'root', parent_id: null }, { id: 'child', parent_id: 'root' }, { id: 'sibling', parent_id: null }, { id: 'foreign', app_type_id: 'other' }]);
  await assert.rejects(service.updateTestSuite('child', { parent_id: 'missing' }), /Parent test suite not found/);
  await assert.rejects(service.updateTestSuite('child', { parent_id: 'foreign' }), /same app type/);
  assert.equal((await service.updateTestSuite('child', { parent_id: 'sibling', expected_revision: 1 })).revision, 2);
  assert.equal(suites.get('child').parent_id, 'sibling');
  assert.equal((await service.updateTestSuite('child', { parent_id: null, expected_revision: 2 })).revision, 3);
  assert.equal(suites.get('child').parent_id, null);
  await assert.rejects(service.updateTestSuite('child', { parent_id: 'root', expected_revision: 1 }), { code: 'REVISION_CONFLICT' });
});

test('concurrent reciprocal moves serialize and cannot each validate a stale hierarchy', async () => {
  const { service, suites } = fixture([{ id: 'a', parent_id: null }, { id: 'b', parent_id: null }]);
  const results = await Promise.allSettled([
    service.updateTestSuite('a', { parent_id: 'b' }),
    service.updateTestSuite('b', { parent_id: 'a' })
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'SUITE_HIERARCHY_CYCLE');
  assert.ok(!(suites.get('a').parent_id === 'b' && suites.get('b').parent_id === 'a'));
});

test('ordinary suite edits do not take the application-wide hierarchy lock', async () => {
  const { service, calls } = fixture([{ id: 'root', parent_id: null }]);
  await service.updateTestSuite('root', { name: 'Renamed' });
  assert.equal(calls.some(sql => sql.includes('pg_advisory_xact_lock')), false);
});
