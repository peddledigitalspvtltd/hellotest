const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Fastify = require('fastify');
const { ROUTE_PERMISSIONS } = require('../../../platform/backend/src/security/permissions.catalog');

test('workflow node model calls recheck project, workflow, ops and source access for every list and detail', async () => {
  const queried = [], checks = [], module = { exports: {} };
  const run = { id: 'run', project_id: 'project', workflow_snapshot: { nodes: [{ id: 'node' }] }, node_results: [{ node_id: 'node' }] };
  new Function('require', 'module', fs.readFileSync(require.resolve('../../backend/routes/workflowModelCalls.routes'), 'utf8'))(id => {
    if (id === '../services/agenticWorkflow.service') return { getWorkflowRun: async id => { if (id !== 'run') throw Object.assign(new Error('Not found'), { statusCode: 404 }); return run; } };
    if (id.endsWith('/projectAccess')) return { getProject: async (project, user) => { checks.push(`project:${project}`); if (user === 'removed') throw Object.assign(new Error('Project access removed'), { statusCode: 403 }); } };
    if (id.endsWith('/workflowModelCalls')) return {
      list: async (...args) => { queried.push(args); return { items: [] }; },
      detail: async (...args) => { queried.push(args); return { id: args[1], content_access: args[2].includeContent }; }
    };
    if (id.endsWith('/executionReadAccess')) return { publicRun: async (_, user) => ({ ...run, node_results: [{ node_id: 'node', automation_source_hidden: user.id === 'source-removed' }] }) };
    throw new Error(`Unexpected dependency ${id}`);
  }, module);
  const app = Fastify();
  app.decorate('authenticate', async req => {
    if (!req.headers['x-user']) throw Object.assign(new Error('Login required'), { statusCode: 401 });
    req.user = { id: req.headers['x-user'], role: req.headers['x-role'] || 'member' };
  });
  app.decorate('requirePermission', (permission, { projectId }) => async req => {
    checks.push(`${permission}:${projectId}`);
    if (req.headers['x-deny'] === permission) throw Object.assign(new Error('Permission removed'), { statusCode: 403 });
  });
  await app.register(module.exports);
  const url = '/agentic-workflow-runs/run/nodes/node/model-calls';
  try {
    for (const route of [url, `${url}/call`]) {
      assert.equal((await app.inject({ url: route })).statusCode, 401);
      for (const denied of ['agentic_workflow.view', 'ops.view']) {
        const before = queried.length;
        assert.equal((await app.inject({ url: route, headers: { 'x-user': 'reviewer', 'x-deny': denied } })).statusCode, 403);
        assert.equal(queried.length, before, 'Rejected permission cannot read trace storage');
      }
      assert.equal((await app.inject({ url: route, headers: { 'x-user': 'removed' } })).statusCode, 403);
    }
    const list = await app.inject({ url: `${url}?run_id=foreign&node_id=foreign&project_id=foreign&cursor=next`, headers: { 'x-user': 'reviewer' } });
    assert.equal(list.statusCode, 200); assert.equal(list.headers['cache-control'], 'no-store');
    assert.deepEqual(queried.at(-1), [{ projectId: 'project', runId: 'run', nodeId: 'node' }, { cursor: 'next' }], 'Client-supplied project/run/node filters cannot widen the path scope');
    const member = await app.inject({ url: `${url}/call`, headers: { 'x-user': 'reviewer' } });
    assert.equal(member.json().content_access, false);
    const admin = await app.inject({ url: `${url}/call`, headers: { 'x-user': 'reviewer', 'x-role': 'admin' } });
    assert.equal(admin.json().content_access, true);
    const hidden = await app.inject({ url: `${url}/call`, headers: { 'x-user': 'source-removed', 'x-role': 'admin' } });
    assert.equal(hidden.json().content_access, false, 'An admin role cannot bypass the current automation source boundary');
    const before = queried.length;
    assert.equal((await app.inject({ url: '/agentic-workflow-runs/run/nodes/foreign/model-calls', headers: { 'x-user': 'reviewer', 'x-role': 'admin' } })).statusCode, 404);
    assert.equal(queried.length, before);
    assert.ok(checks.includes('agentic_workflow.view:project')); assert.ok(checks.includes('ops.view:project'));
    assert.equal(ROUTE_PERMISSIONS.get('GET /agentic-workflow-runs/:id/nodes/:nodeId/model-calls'), 'ops.view');
    assert.equal(ROUTE_PERMISSIONS.get('GET /agentic-workflow-runs/:id/nodes/:nodeId/model-calls/:callId'), 'ops.view');
  } finally { await app.close(); }
});

test('workflow trace list uses chronological keyset pages and detail binds the exact run and node', async () => {
  const queries = [], module = { exports: {} };
  new Function('require', 'module', fs.readFileSync(require.resolve('../../../trace/backend/services/llmTraceQuery.service'), 'utf8'))(() => ({ pool: { query: async query => {
    queries.push(query);
    return { rows: query.text.includes('COUNT(*)') ? [{ calls: 0 }] : [] };
  } } }), module);
  const service = module.exports;
  const cursor = Buffer.from(JSON.stringify({ time: new Date().toISOString(), id: 'last-call' })).toString('base64url');
  await service.list('project', { run_id: "run' OR true --", node_id: 'node', cursor }, { chronological: true });
  assert.match(queries[0].text, /ORDER BY started_at ASC,id ASC/);
  assert.match(queries[0].text, /\(started_at,id\) > /);
  assert.match(queries[0].text, /run_id = \$3 AND node_id = \$4/);
  assert.equal(queries[0].values[2], "run' OR true --");
  assert.ok(!queries[0].text.includes("run' OR true --"));
  await assert.rejects(service.detail('project', 'call', { runId: 'run', nodeId: 'node', includeContent: true }), error => error.statusCode === 404);
  assert.match(queries.at(-1).text, /project_id=\$1 AND id=\$2 AND run_id=\$3 AND node_id=\$4/);
  assert.deepEqual(queries.at(-1).values, ['project', 'call', 'run', 'node']);
  const before = queries.length;
  await assert.rejects(service.detail('project', 'call', { runId: 'run' }), error => error.statusCode === 400);
  assert.equal(queries.length, before);
});
