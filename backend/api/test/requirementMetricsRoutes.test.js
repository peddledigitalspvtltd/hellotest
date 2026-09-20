const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');

async function fixture() {
  const calls = [];
  const handlers = new Map();
  const state = { denied: null };
  const projectId = 'target-project';
  const requirement = { id: 'story', project_id: projectId };
  const catalog = {
    getMetrics: async query => { calls.push({ type: 'metrics', query }); return {}; },
    withCatalogMetrics: async (rows, query) => { calls.push({ type: 'detail', query }); return rows; }
  };
  const service = {
    getRequirement: async () => requirement,
    getRequirementsPage: async query => { calls.push({ type: 'page', query }); return { items: [] }; }
  };
  const fastify = {
    authenticate: async () => {}, validate() {},
    requirePermission: (permission, scope) => async () => {
      assert.equal(scope.projectId, projectId);
      if (state.denied === permission) throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
    },
    get: (path, handler) => handlers.set(path, handler), post() {}, put() {}, delete() {}
  };
  for (const source of ['requirements.routes', 'requirementIterations.routes']) {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(require.resolve(`../src/routes/${source}`), 'utf8'), {
      module,
      require: name => {
        if (name === '../services/requirementCatalog.service') return catalog;
        if (name === '../services/requirement.service') return service;
        if (name === '../services/requirementIteration.service') return { getIterationSummary: async () => ({ id: 'sprint', project_id: projectId }) };
        if (name === '../services/project.service') return { getProject: async () => ({ id: projectId }) };
        if (name === '../utils/pagination') return require('../src/utils/pagination');
        if (name === '../runtime/httpConfig') return require('../src/runtime/httpConfig');
        return {};
      }
    });
    await module.exports(fastify);
  }
  const req = query => ({ params: { id: 'story' }, query: { project_id: projectId, include_page: 'true', ...query }, user: { id: 'viewer', role: 'member' } });
  return { handlers, calls, state, req };
}
const paths = ['/requirements', '/requirements/metrics', '/requirements/:id', '/requirement-iterations/:id/requirements'];

test('Product metrics require both run and result access before reading execution aggregates', async () => {
  const { handlers, calls, state, req } = await fixture();
  for (const denied of ['run.view', 'result.view']) {
    state.denied = denied;
    for (const path of paths) await assert.rejects(handlers.get(path)(req({ include_execution: 'true' })), { statusCode: 403 });
  }
  assert.equal(calls.length, 0);
});

test('Product Stories and Sprint pages remain available without execution metric access', async () => {
  const { handlers, calls, state, req } = await fixture();
  state.denied = 'result.view';
  for (const path of paths) await handlers.get(path)(req({ include_execution: 'false' }));
  assert.equal(calls.length, paths.length);
  assert.ok(calls.every(call => call.query.include_execution === 'false'));
  assert.equal(calls.at(-1).query.project_id, 'target-project');
});

test('Authorized Product metric queries forward execution scope explicitly', async () => {
  const { handlers, calls, req } = await fixture();
  for (const path of paths) await handlers.get(path)(req({ include_execution: 'true' }));
  assert.equal(calls.length, paths.length);
  assert.ok(calls.every(call => call.query.include_execution === 'true'));
});
