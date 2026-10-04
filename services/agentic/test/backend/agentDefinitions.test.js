const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('@hellotest/platform/backend/src/db');
const registry = require('../../backend/agents/agentRegistry.service');
const contract = require('../../backend/agents/agentDefinition');
const selection = require('@hellotest/integration/backend/services/aiLlmSelection.service');
const rag = require('@hellotest/knowledge/backend/services/knowledgeRag.service');
const runtime = require('../../backend/services/agenticWorkflowExecution.service');

const definition = () => contract.normalize({ name: 'Release reviewer', objective: 'Review supplied release evidence.', required_inputs: ['release_id'] });
function storage(t) {
  const rows = new Map(), versions = new Map();
  t.mock.method(registry._internals.store, 'get', async (id, project) => rows.get(id)?.project_id === project ? structuredClone(rows.get(id)) : null);
  t.mock.method(registry._internals.store, 'version', async (id, version) => structuredClone(versions.get(`${id}:${version}`)));
  t.mock.method(registry._internals.store, 'list', async project => [...rows.values()].filter(row => row.project_id === project).map(row => ({ ...structuredClone(row), ...structuredClone(versions.get(`${row.id}:${row.current_version}`)) })));
  t.mock.method(db, 'transaction', fn => fn);
  t.mock.method(db, 'query', async () => ({}));
  t.mock.method(db, 'prepare', sql => ({
    run: async (...args) => {
      if (sql.startsWith('INSERT INTO ai_agent_definitions')) { const [id, project_id] = args; rows.set(id, { id, project_id, current_version: 0, active_version: null, archived: false }); }
      else if (sql.startsWith('INSERT INTO ai_agent_versions')) { const [agent_id, version, value, definition_hash, created_by, activated_at] = args; assert.equal(versions.has(`${agent_id}:${version}`), false, 'Version rows are immutable'); versions.set(`${agent_id}:${version}`, { agent_id, version, definition: structuredClone(value), definition_hash, created_by, activated_at }); }
      else if (sql.startsWith('UPDATE ai_agent_definitions SET current_version')) { const [current_version, active_version, id] = args; Object.assign(rows.get(id), { current_version, active_version, archived: false }); }
      else assert.fail(sql);
    },
    get: async (...args) => {
      assert.match(sql, /SET archived = true/);
      const [id, project, version] = args, row = rows.get(id);
      if (!row || row.project_id !== project || row.current_version !== version) return null;
      row.archived = true; return { id };
    }
  }));
  t.mock.method(selection, 'resolveLlmIntegrationForUsage', async () => ({ id: 'model', model: 'fixture', is_active: true, api_key: 'fixture-only-key' }));
  t.mock.method(rag, 'assertLlmIntegrationProjectScope', () => {});
  return { rows, versions };
}

test('agent drafts and active versions are immutable, scoped and protected from stale edits', async t => {
  const { versions } = storage(t);
  const first = await registry.save({ project_id: 'p', definition: definition(), activate: false }, null, 'author');
  assert.equal(first.current_version, 1); assert.equal(first.active_version, null);
  await assert.rejects(registry.resolve(first.id, 1, 'p'), { code: 'AGENT_UNAVAILABLE' });
  const active = await registry.save({ project_id: 'p', definition: first.definition, expected_version: 1, activate: true }, first.id, 'author');
  assert.equal(active.active_version, 2);
  const pinned = await registry.resolve(first.id, 2, 'p');
  assert.equal(pinned.definition_hash, contract.definitionHash(first.definition));
  const draft = await registry.save({ project_id: 'p', definition: { ...first.definition, objective: 'Review a different contract.' }, expected_version: 2 }, first.id, 'author');
  assert.equal(draft.current_version, 3); assert.equal(draft.active_version, 2);
  assert.deepEqual(await registry.resolve(first.id, 2, 'p'), pinned);
  assert.equal((await registry.list('p'))[0].active_definition.objective, first.definition.objective);
  await assert.rejects(registry.resolve(first.id, 3, 'p'), { code: 'AGENT_VERSION_INACTIVE' });
  await assert.rejects(registry.save({ project_id: 'p', definition: definition(), expected_version: 2 }, first.id, 'author'), { statusCode: 409 });
  assert.equal(versions.size, 3);
  await assert.rejects(registry.resolve(first.id, 2, 'other'), { code: 'AGENT_UNAVAILABLE' });
  assert.deepEqual(await registry.list('other'), []);
  await assert.rejects(registry.archive(first.id, 'other', 3), { statusCode: 409 });
  await registry.archive(first.id, 'p', 3);
  await assert.rejects(registry.resolve(first.id, 2, 'p'), { code: 'AGENT_UNAVAILABLE' });
});

test('activation requires a usable LLM and never creates an active version on failure', async t => {
  const { rows, versions } = storage(t);
  t.mock.method(selection, 'resolveLlmIntegrationForUsage', async () => null);
  await assert.rejects(registry.save({ project_id: 'p', definition: definition(), activate: true }, null, 'author'), { code: 'AGENT_MODEL_REQUIRED' });
  assert.equal(rows.size, 0); assert.equal(versions.size, 0);
  const draft = await registry.save({ project_id: 'p', definition: definition() }, null, 'author');
  assert.equal(draft.active_version, null);
});

test('typed contracts reject unsupported tools, arbitrary verifiers and unbounded configuration', () => {
  for (const patch of [{ tools: ['shell'] }, { allowed_tools: ['shell'] }, { context_scopes: ['other-project'] }, { acceptance: { code: 'return true' } }, { required_inputs: ['constructor'] }, { limits: { max_model_calls: 100 } }, { skills: [{ id: 'empty', name: 'Empty', instructions: '' }] }, { objective: 'x'.repeat(2001) }]) assert.throws(() => contract.normalize({ ...definition(), ...patch }), { statusCode: 422 });
  assert.throws(() => contract.validateInputs(definition(), {}), { code: 'AGENT_INPUT_REQUIRED' });
  assert.doesNotThrow(() => contract.validateInputs(definition(), { release_id: 'release-1' }));
  const incomplete = contract.verify({ response: 'Done', citation_ids: [], findings: [] }, [], { require_evidence: true, minimum_findings: 1 });
  assert.equal(incomplete.status, 'needs_input');
  assert.equal(contract.verify({ response: 'Done', citation_ids: ['invented'] }, [{ id: 'actual' }]).status, 'needs_input');
  const reviewed = contract.verify({ response: 'Observed [actual]', citation_ids: ['actual'], findings: [], evidence_gaps: [] }, [{ id: 'actual' }]);
  assert.equal(reviewed.status, 'passed'); assert.equal(reviewed.semantic_review, 'human_review_required');
});

test('workflow readiness blocks AI nodes without a model while ordinary data nodes remain executable', async t => {
  t.mock.method(registry, 'resolveModel', async () => { throw contract.fail('Configure a model.', 'AGENT_MODEL_REQUIRED'); });
  const graph = { project_id: 'p', trigger_kind: 'manual', nodes: [
    { id: 'start', data: { kind: 'trigger' } },
    { id: 'ai', data: { kind: 'agent', agentId: 'quality-evaluator', prompt: 'Review evidence.' } },
    { id: 'output', data: { kind: 'output' } }
  ], edges: [{ source: 'start', target: 'ai' }, { source: 'ai', target: 'output' }] };
  const report = await runtime.checkReadiness(graph, '', { id: 'user' });
  assert.equal(report.ready, false); assert.ok(report.blockers.some(item => item.node_id === 'ai' && /model/.test(item.message)));
  graph.nodes[1].data = { kind: 'transform', transformMapping: '{"release":"$input.release_id"}' };
  assert.equal((await runtime.checkReadiness(graph)).ready, true);
});

test('agent registry HTTP operations enforce project manage permission before mutation', async t => {
  const fastify = require('fastify')(); t.after(() => fastify.close());
  fastify.decorate('authenticate', async req => { req.user = { id: 'viewer' }; });
  fastify.decorate('requirePermission', permission => async () => { throw Object.assign(new Error(permission), { statusCode: 403 }); });
  fastify.decorate('validate', () => {});
  t.mock.method(require('@hellotest/platform/backend/public/projectAccess'), 'getProject', async id => ({ id }));
  const save = t.mock.method(registry, 'save', async () => assert.fail('Unauthorized mutation'));
  await fastify.register(require('../../backend/routes/agenticWorkflows.routes'));
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const response = await fastify.inject({ method, url: `/agentic-workflows/agents${method === 'POST' ? '' : '/id'}?project_id=p&version=1`, ...(method !== 'DELETE' ? { payload: { project_id: 'p', definition: definition() } } : {}) });
    assert.equal(response.statusCode, 403);
  }
  assert.equal(save.mock.callCount(), 0);
});
