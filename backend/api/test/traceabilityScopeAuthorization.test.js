const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const makeFixture = () => {
  const state = {
    stories: new Map([['story-a', { id: 'story-a', project_id: 'project-a' }], ['story-b', { id: 'story-b', project_id: 'project-b' }]]),
    cases: new Map([
      ['case-a', { id: 'case-a', projects: ['project-a'], requirement_id: 'story-a' }],
      ['case-b', { id: 'case-b', projects: ['project-b'], requirement_id: null }],
      ['case-orphan', { id: 'case-orphan', projects: [], requirement_id: null }]
    ]),
    mappings: [['story-a', 'case-a']], writes: [], queries: [], syncs: [], depth: 0
  };
  const db = {
    transaction: callback => async () => {
      const snapshot = structuredClone({ cases: state.cases, mappings: state.mappings });
      state.depth++;
      try { return await callback(); }
      catch (error) { state.cases = snapshot.cases; state.mappings = snapshot.mappings; throw error; }
      finally { state.depth--; }
    },
    prepare: statement => {
      const sql = statement.replace(/\s+/g, ' ').trim();
      const record = args => { assert.equal((sql.match(/\?/g) || []).length, args.length); state.queries.push(sql); };
      return {
        get: async (...args) => {
          record(args);
          if (/FROM requirements WHERE id =/.test(sql)) return state.stories.get(args[0]);
          if (/FROM test_cases WHERE id =/.test(sql)) return state.cases.get(args[0]);
          throw new Error(`Unexpected get: ${sql}`);
        },
        all: async (...args) => {
          record(args);
          if (/^WITH selected_cases/.test(sql)) {
            return args.flatMap(id => {
              const item = state.cases.get(id);
              if (!item) return [];
              const linkedStories = [item.requirement_id, ...state.mappings.filter(([, caseId]) => caseId === id).map(([storyId]) => storyId)];
              return [{ id, project_ids: [...new Set([...item.projects, ...linkedStories.map(storyId => state.stories.get(storyId)?.project_id).filter(Boolean)])] }];
            });
          }
          if (/FROM test_cases WHERE id IN/.test(sql)) return args.filter(id => state.cases.has(id)).map(id => ({ id }));
          if (/FROM requirements WHERE id IN/.test(sql)) return args.map(id => state.stories.get(id)).filter(Boolean);
          throw new Error(`Unexpected all: ${sql}`);
        },
        run: async (...args) => {
          record(args); assert.ok(state.depth > 0, 'mapping writes occur inside a transaction'); state.writes.push(sql);
          if (/^DELETE FROM requirement_test_cases WHERE requirement_id/.test(sql)) state.mappings = state.mappings.filter(([id]) => id !== args[0]);
          else if (/^DELETE FROM requirement_test_cases WHERE test_case_id/.test(sql)) state.mappings = state.mappings.filter(([, id]) => id !== args[0]);
          else if (/^INSERT INTO requirement_test_cases/.test(sql)) state.mappings.push([...args]);
          else if (/SET requirement_id = NULL/.test(sql)) for (const item of state.cases.values()) { if (item.requirement_id === args[0]) item.requirement_id = null; }
          else if (/SET requirement_id = \?/.test(sql)) state.cases.get(args[1]).requirement_id = args[0];
          else throw new Error(`Unexpected mutation: ${sql}`);
        }
      };
    }
  };
  const scopes = { exports: {} };
  vm.runInNewContext(readFileSync(path.join(__dirname, '../src/services/testCaseScope.service.js'), 'utf8'), { module: scopes, require: () => db });
  const service = {};
  vm.runInNewContext(readFileSync(path.join(__dirname, '../src/services/requirementTestCase.service.js'), 'utf8'), {
    exports: service,
    require: dependency => dependency === '../db' ? db : dependency === './testCaseScope.service' ? scopes.exports : {
      syncAutomaticDefectsForRequirement: async id => state.syncs.push(id),
      syncAutomaticDefectsForTestCase: async id => state.syncs.push(id)
    }
  });
  return { service, state };
};

for (const [caseId, statusCode] of [['case-b', 403], ['case-orphan', 409], ['missing', 404]]) {
  test(`story mapping rejects ${caseId} before deleting existing traceability`, async () => {
    const { service, state } = makeFixture();
    await assert.rejects(service.replaceMappingsForRequirement('story-a', [caseId]), { statusCode });
    assert.deepEqual(state.mappings, [['story-a', 'case-a']]);
    assert.deepEqual(state.writes, []);
    assert.deepEqual(state.syncs, []);
  });
}

test('conflicting legacy or existing relationships cannot launder a foreign case into the selected project', async () => {
  const { service, state } = makeFixture();
  state.mappings.push(['story-b', 'case-a']);
  await assert.rejects(service.replaceMappingsForRequirement('story-a', ['case-a']), { statusCode: 409 });
  assert.deepEqual(state.writes, []);
});

test('valid same-project mappings deduplicate input and resolve the complete batch in one scope query', async () => {
  const { service, state } = makeFixture();
  for (let index = 0; index < 150; index++) state.cases.set(`bulk-${index}`, { id: `bulk-${index}`, projects: ['project-a'] });
  const ids = ['case-a', ...Array.from({ length: 150 }, (_, index) => `bulk-${index}`)];
  const result = await service.replaceMappingsForRequirement('story-a', [...ids, 'case-a']);
  assert.equal(result.mapped, 151);
  assert.equal(state.mappings.length, 151);
  assert.equal(state.queries.filter(sql => sql.startsWith('WITH selected_cases')).length, 1);
  assert.deepEqual(state.syncs, ['story-a']);
  await service.replaceMappingsForRequirement('story-a', []);
  assert.equal(state.mappings.length, 0);
  assert.equal(state.cases.get('case-a').requirement_id, null);
});

test('case-side synchronization rejects foreign/missing Stories and keeps existing mappings intact', async () => {
  const { service, state } = makeFixture();
  await assert.rejects(service.syncMappingsForTestCase('case-a', ['story-b']), { statusCode: 403 });
  await assert.rejects(service.syncMappingsForTestCase('case-a', ['missing']), { statusCode: 404 });
  await assert.rejects(service.syncMappingsForTestCase('missing', ['story-a']), { statusCode: 404 });
  assert.deepEqual(state.writes, []);
  await service.syncMappingsForTestCase('case-a', ['story-a', 'story-a']);
  assert.deepEqual(state.mappings, [['story-a', 'case-a']]);
});

const routeFixture = async (t, { role = 'member', denied = null } = {}) => {
  const Fastify = require('fastify');
  const service = require('../src/services/requirementTestCase.service');
  const scopes = require('../src/services/testCaseScope.service');
  const calls = [];
  t.mock.method(scopes, 'getRequirementScope', async id => id === 'missing' ? null : ({ id, project_id: id === 'story-a' ? 'project-a' : 'project-b' }));
  t.mock.method(scopes, 'resolveTestCaseScopes', async ids => ids[0] === 'missing' ? [] : [{ id: ids[0], project_ids: [ids[0] === 'case-a' ? 'project-a' : 'project-b'] }]);
  t.mock.method(service, 'listMappings', async input => { calls.push(['list', input]); return []; });
  t.mock.method(service, 'replaceMappingsForRequirement', async (...input) => { calls.push(['replace', ...input]); return { updated: true }; });
  const app = Fastify({ logger: false });
  t.after(() => app.close());
  app.decorate('authenticate', async req => { req.user = { id: 'reader', role }; });
  app.decorate('requirePermission', (permission, { projectId }) => async () => {
    calls.push(['permission', permission, projectId]);
    if ((role !== 'admin' && projectId !== 'project-a') || denied === permission) throw Object.assign(new Error('Denied'), { statusCode: 403 });
  });
  await app.register(require('../src/plugins/validator'));
  await app.register(require('../src/routes/requirementTestCases.routes'));
  await app.ready();
  return { app, calls };
};

test('unfiltered mappings cannot expose every project to a non-admin', async t => {
  const { app, calls } = await routeFixture(t);
  assert.equal((await app.inject('/requirement-test-cases')).statusCode, 400);
  assert.equal(calls.some(([operation]) => operation === 'list'), false);
});

test('mapping reads and writes authorize the persisted Story scope despite an accessible query project', async t => {
  const { app, calls } = await routeFixture(t);
  for (const method of ['GET', 'PUT']) {
    const response = await app.inject(method === 'GET'
      ? { method, url: '/requirement-test-cases?requirement_id=story-b&project_id=project-a' }
      : { method, url: '/requirement-test-cases/replace', payload: { requirement_id: 'story-b', project_id: 'project-a', test_case_ids: [] } });
    assert.equal(response.statusCode, 403);
  }
  assert.equal(calls.some(([operation]) => operation === 'list' || operation === 'replace'), false);
  assert.ok(calls.every(([, , projectId]) => projectId === 'project-b'));
});

test('case-filtered mapping reads need both Story and case read access in the actual project', async t => {
  const { app, calls } = await routeFixture(t, { denied: 'requirement.view' });
  assert.equal((await app.inject('/requirement-test-cases?test_case_id=case-a')).statusCode, 403);
  assert.deepEqual(calls, [['permission', 'requirement.view', 'project-a']]);
});

test('valid scoped mapping requests work, while mismatched filters and missing targets reject', async t => {
  const { app, calls } = await routeFixture(t);
  assert.equal((await app.inject('/requirement-test-cases?requirement_id=story-a&test_case_id=case-a')).statusCode, 200);
  assert.equal((await app.inject('/requirement-test-cases?requirement_id=story-a&test_case_id=case-b')).statusCode, 403);
  assert.equal((await app.inject('/requirement-test-cases?test_case_id=missing')).statusCode, 404);
  assert.equal((await app.inject({ method: 'PUT', url: '/requirement-test-cases/replace', payload: { requirement_id: 'story-a', test_case_ids: [] } })).statusCode, 200);
  assert.ok(calls.some(([operation, permission, projectId]) => operation === 'permission' && permission === 'testcase.update' && projectId === 'project-a'));
});
