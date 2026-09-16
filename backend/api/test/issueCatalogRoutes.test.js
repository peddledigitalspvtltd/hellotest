const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');

async function fixture() {
  const calls = [];
  const handlers = new Map();
  const state = { authenticated: true, allowed: true };
  const service = Object.fromEntries(['getIssues', 'getIssuePage', 'getIssueMetrics'].map(name => [name, async filters => { calls.push({ name, filters }); return { service: name }; }]));
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/routes/issues.routes'), 'utf8'), {
    module,
    require: name => {
      if (name === '../services/issues.service') return service;
      if (name === '../services/project.service') return { getProject: async id => ({ id }) };
      if (name === '../utils/pagination') return require('../src/utils/pagination');
      return {};
    }
  });
  const fastify = {
    authenticate: async () => { if (!state.authenticated) throw Object.assign(new Error('Unauthenticated'), { statusCode: 401 }); },
    requirePermission: (permission, scope) => async () => {
      assert.equal(permission, 'feedback.view');
      assert.equal(scope.projectId, 'p');
      if (!state.allowed) throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
    },
    get: (path, handler) => handlers.set(path, handler), post() {}, put() {}, delete() {}
  };
  await module.exports(fastify);
  return { calls, handlers, state };
}
const request = query => ({ query, user: { id: 'viewer', role: 'member' } });

test('Bug metric and page routes authenticate and authorize before querying either service', async () => {
  const { calls, handlers, state } = await fixture();
  for (const path of ['/feedback', '/feedback/metrics', '/issues', '/issues/metrics']) {
    state.authenticated = false;
    await assert.rejects(handlers.get(path)(request({ project_id: 'p', include_page: 'true' })), { statusCode: 401 });
    state.authenticated = true;
    state.allowed = false;
    await assert.rejects(handlers.get(path)(request({ project_id: 'p', include_page: 'true' })), { statusCode: 403 });
  }
  assert.equal(calls.length, 0);
});

test('Bug list pages and metric routes pass identical server filters without materializing the catalog', async () => {
  const { calls, handlers } = await fixture();
  const filters = { project_id: 'p', q: 'payment %_', status: 'open', priority: 'High', assignee_id: '__unassigned__' };
  await handlers.get('/feedback')(request({ ...filters, include_page: 'true', include_total: 'false', page_size: '25', cursor: 'next' }));
  await handlers.get('/feedback/metrics')(request(filters));
  assert.deepEqual(calls.map(call => call.name), ['getIssuePage', 'getIssueMetrics']);
  for (const call of calls) {
    for (const [key, value] of Object.entries(filters)) assert.equal(call.filters[key], value);
    assert.equal(call.filters.viewer_id, 'viewer');
  }
  assert.equal(calls[0].filters.page_size, '25');
  assert.equal(calls[0].filters.include_total, 'false');
  assert.equal(calls[0].filters.cursor, 'next');
});

test('Unscoped Bug catalog calls reject ordinary users and disregard caller-supplied viewer elevation', async () => {
  const { calls, handlers } = await fixture();
  await assert.rejects(handlers.get('/feedback/metrics')(request({ viewer_is_admin: true })), { statusCode: 400 });
  await handlers.get('/feedback/metrics')(request({ project_id: 'p', viewer_id: 'another', viewer_is_admin: true }));
  assert.equal(calls[0].filters.viewer_id, 'viewer');
  assert.equal(Boolean(calls[0].filters.viewer_is_admin), false);
});
