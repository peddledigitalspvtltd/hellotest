const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const fixture = () => {
  const state = { mappings: [['story', 'bug']], writes: [], depth: 0 };
  const db = {
    transaction: callback => async () => { state.depth++; try { return await callback(); } finally { state.depth--; } },
    prepare: statement => {
      const sql = statement.replace(/\s+/g, ' ').trim();
      const check = args => assert.equal((sql.match(/\?/g) || []).length, args.length);
      return {
        get: async (...args) => { check(args); return args[0] === 'story' ? { id: 'story', project_id: 'project-a' } : null; },
        all: async (...args) => { check(args); return args.flatMap(id => id === 'missing' ? [] : [{ id, project_id: id === 'foreign-bug' ? 'project-b' : 'project-a' }]); },
        run: async (...args) => {
          check(args); assert.ok(state.depth > 0); state.writes.push(sql);
          if (sql.startsWith('DELETE')) state.mappings = [];
          if (sql.startsWith('INSERT')) state.mappings.push(args.slice(0, 2));
        }
      };
    }
  };
  const service = {};
  vm.runInNewContext(readFileSync(path.join(__dirname, '../src/services/requirementDefect.service.js'), 'utf8'), {
    exports: service,
    require: dependency => dependency === '../db' ? db : require(path.join(__dirname, '../src/services', dependency))
  });
  return { service, state };
};

for (const [issueId, statusCode] of [['foreign-bug', 403], ['missing', 404]]) {
  test(`Story defect mapping rejects ${issueId} without removing existing links`, async () => {
    const { service, state } = fixture();
    await assert.rejects(service.replaceMappingsForRequirement('story', [issueId]), { statusCode });
    assert.deepEqual(state.mappings, [['story', 'bug']]);
    assert.deepEqual(state.writes, []);
  });
}

test('same-project defect links deduplicate, install, and clear successfully', async () => {
  const { service, state } = fixture();
  assert.equal((await service.replaceMappingsForRequirement('story', ['bug', 'other-bug', 'bug'])).mapped, 2);
  assert.deepEqual(state.mappings, [['story', 'bug'], ['story', 'other-bug']]);
  await service.replaceMappingsForRequirement('story', []);
  assert.deepEqual(state.mappings, []);
});

const routeFixture = async (t, denied = null) => {
  const app = require('fastify')({ logger: false });
  const service = require('../src/services/requirementDefect.service');
  const entityScopes = require('../src/services/entityScope.service');
  const calls = [];
  t.after(() => app.close());
  t.mock.method(entityScopes, 'resolveEntityScope', async ({ entityId }) => {
    if (entityId === 'missing') throw Object.assign(new Error('Not found'), { statusCode: 404 });
    return { entityId, projectId: entityId.startsWith('foreign') ? 'project-b' : 'project-a' };
  });
  t.mock.method(service, 'listMappings', async () => { calls.push(['list']); return []; });
  t.mock.method(service, 'replaceMappingsForRequirement', async () => { calls.push(['replace']); return { updated: true }; });
  app.decorate('authenticate', async req => { req.user = { id: 'member', role: 'member' }; });
  app.decorate('requirePermission', (permission, { projectId }) => async () => {
    calls.push(['permission', permission, projectId]);
    if (projectId !== 'project-a' || permission === denied) throw Object.assign(new Error('Denied'), { statusCode: 403 });
  });
  await app.register(require('../src/plugins/validator'));
  await app.register(require('../src/routes/requirementDefects.routes'));
  return { app, calls };
};

test('unfiltered Story defect reads and foreign identifiers cannot bypass actual project permission', async t => {
  const { app, calls } = await routeFixture(t);
  assert.equal((await app.inject('/requirement-defects')).statusCode, 400);
  assert.equal((await app.inject('/requirement-defects?requirement_id=foreign-story&project_id=project-a')).statusCode, 403);
  assert.equal((await app.inject('/requirement-defects?issue_id=foreign-bug')).statusCode, 403);
  assert.equal((await app.inject('/requirement-defects?requirement_id=story&issue_id=foreign-bug')).statusCode, 403);
  assert.equal((await app.inject('/requirement-defects?requirement_id=missing')).statusCode, 404);
  assert.equal(calls.some(([operation]) => operation === 'list'), false);
});

test('replacing links in a foreign Story rejects despite a spoofed accessible project body', async t => {
  const { app, calls } = await routeFixture(t);
  assert.equal((await app.inject({ method: 'PUT', url: '/requirement-defects/replace', payload: { requirement_id: 'foreign-story', project_id: 'project-a', issue_ids: [] } })).statusCode, 403);
  assert.equal(calls.some(([operation]) => operation === 'replace'), false);
});

test('Bug visibility alone does not disclose Story traceability', async t => {
  const { app } = await routeFixture(t, 'requirement.view');
  assert.equal((await app.inject('/requirement-defects?issue_id=bug')).statusCode, 403);
});

test('valid Story defect reads and edits enforce the appropriate persisted-project grants', async t => {
  const { app, calls } = await routeFixture(t);
  assert.equal((await app.inject('/requirement-defects?requirement_id=story&issue_id=bug')).statusCode, 200);
  assert.equal((await app.inject({ method: 'PUT', url: '/requirement-defects/replace', payload: { requirement_id: 'story', issue_ids: [] } })).statusCode, 200);
  assert.ok(calls.some(([operation, permission, projectId]) => operation === 'permission' && permission === 'feedback.view' && projectId === 'project-a'));
  assert.ok(calls.some(([operation, permission, projectId]) => operation === 'permission' && permission === 'feedback.manage' && projectId === 'project-a'));
});
