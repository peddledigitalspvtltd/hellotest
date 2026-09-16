const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');

async function fixture() {
  const handlers = new Map();
  const calls = [];
  const permissions = [];
  const state = { denied: null, authenticated: true, foreignRequirement: false, missingRequirement: false };
  const register = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/routes/testCases.routes'), 'utf8'), {
    module: register,
    require: name => {
      if (name === '../services/testCase.service') return {
        getTestCases: async () => assert.fail('Picker must not load the full catalog'),
        getTestCasesForRequirements: async query => { calls.push({ kind: 'resolver', query }); return []; }
      };
      if (name === '../services/testCaseCatalog.service') return {
        listPage: async query => { calls.push({ kind: 'picker', query }); return { items: [], is_last: true, next_cursor: null }; },
        getMetrics: async () => assert.fail('Picker must not fetch metrics')
      };
      if (name === '../services/testCaseScope.service') return {
        resolveListProjectId: async query => query.project_id || (query.app_type_id ? 'project' : null),
        uniqueIds: ids => [...new Set(ids.map(id => id.trim()).filter(Boolean))],
        resolveRequirementScopes: async ids => state.missingRequirement ? [] : ids.map(id => ({ id, project_id: state.foreignRequirement ? 'foreign' : 'project' }))
      };
      if (name === '../services/appType.service') return { getAppType: async id => ({ id, project_id: 'project' }) };
      if (name === '../services/project.service') return { getProject: async id => ({ id }) };
      if (name === '../services/requirement.service') return { getRequirement: async () => assert.fail('Resolver must use references instead of full Requirement hydration') };
      if (name === '../utils/pagination') return require('../src/utils/pagination');
      return {};
    }
  });
  await register.exports({
    get: (path, handler) => handlers.set(`GET ${path}`, handler), post: (path, handler) => handlers.set(`POST ${path}`, handler), put() {}, delete() {}, validate() {},
    authenticate: async () => { if (!state.authenticated) throw Object.assign(new Error('Unauthenticated'), { statusCode: 401 }); },
    requirePermission: (code, scope) => async () => {
      permissions.push({ code, projectId: scope.projectId });
      if (state.denied === code) throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
    }
  });
  const req = (query = {}, body = {}) => ({ query, body, user: { id: 'member', role: 'member' } });
  return { handlers, calls, permissions, state, req };
}

test('picker projection automatically uses one bounded endpoint and only requires scoped Test Case visibility', async () => {
  const { handlers, calls, permissions, state, req } = await fixture();
  state.denied = 'run.view';
  await handlers.get('GET /test-cases')(req({ app_type_id: 'app', projection: 'picker', ids: 'chosen', include_execution: 'true' }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, 'picker');
  assert.equal(calls[0].query.project_id, 'project');
  assert.equal(calls[0].query.ids, 'chosen');
  assert.deepEqual(permissions, [{ code: 'testcase.view', projectId: 'project' }]);
});

test('picker identity selections cannot bypass authentication, project scoping, or Test Case permission', async () => {
  const { handlers, calls, state, req } = await fixture();
  const handler = handlers.get('GET /test-cases');
  state.authenticated = false;
  await assert.rejects(handler(req({ project_id: 'project', projection: 'picker', ids: 'chosen' })), { statusCode: 401 });
  state.authenticated = true;
  await assert.rejects(handler(req({ projection: 'picker', ids: 'chosen' })), { statusCode: 400 });
  state.denied = 'testcase.view';
  await assert.rejects(handler(req({ project_id: 'project', projection: 'picker', ids: 'chosen' })), { statusCode: 403 });
  assert.equal(calls.length, 0);
});

test('picker projection never bypasses execution permissions on the metrics endpoint', async () => {
  const { handlers, state, req } = await fixture();
  state.denied = 'run.view';
  await assert.rejects(handlers.get('GET /test-cases/metrics')(req({ project_id: 'project', projection: 'picker', include_execution: 'true' })), { statusCode: 403 });
});

test('explicit Requirement selection validates every reference in the app project before resolving case IDs', async () => {
  const { handlers, calls, permissions, state, req } = await fixture();
  const handler = handlers.get('POST /test-cases/resolve-requirements');
  const request = req({}, { app_type_id: 'app', requirement_ids: ['story', 'story'] });
  state.foreignRequirement = true;
  await assert.rejects(handler(request), { statusCode: 403 });
  state.foreignRequirement = false;
  state.missingRequirement = true;
  await assert.rejects(handler(request), { statusCode: 404 });
  state.missingRequirement = false;
  await handler(request);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, 'resolver');
  assert.deepEqual([...calls[0].query.requirement_ids], ['story']);
  assert.ok(permissions.some(item => item.code === 'testcase.view' && item.projectId === 'project'));
  assert.ok(permissions.some(item => item.code === 'requirement.view' && item.projectId === 'project'));
});
