const test = require('node:test');
const assert = require('node:assert/strict');
const runtime = require('../../backend/services/agenticWorkflowExecution.service');
const user = { id: 'queue-reviewer', role: 'member' };
const nodes = [
  { id: 'request', data: { kind: 'trigger' } },
  { id: 'review', data: { kind: 'customAI', prompt: 'Review the supplied evidence.', timeoutMs: 30000, retryCount: 0 } },
  { id: 'result', data: { kind: 'output' } }
];
const definition = { id: 'queued-workflow', project_id: 'queue-project', name: 'Queued review', status: 'draft', trigger_kind: 'manual', nodes,
  edges: [{ source: 'request', target: 'review' }, { source: 'review', target: 'result' }], settings: {} };
test('a third local review waits with a queue position and starts once a worker slot is released', async t => {
  const rows = new Map(), releases = []; let calls = 0, running = 0, peak = 0;
  t.mock.method(require('@hellotest/platform/backend/services/permission.service'), 'hasPermission', async () => true);
  t.mock.method(require('@hellotest/platform/backend/services/featureFlag.service'), 'areEnabled', async () => true);
  t.mock.method(require('../../backend/agents/agentRegistry.service'), 'resolveModel', async () => ({ id: 'model', model: 'fixture' }));
  t.mock.method(runtime._internals.store, 'get', async id => structuredClone(rows.get(id) || null));
  t.mock.method(runtime._internals.store, 'insert', async run => { rows.set(run.id, structuredClone(run)); return { id: run.id }; });
  t.mock.method(runtime._internals.store, 'save', async (id, status, results, output) => {
    const current = rows.get(id); if (current?.status !== 'running') return null;
    rows.set(id, structuredClone({ ...current, status, node_results: results, output_payload: output })); return { id };
  });
  t.mock.method(runtime._internals.store, 'activateLocal', async (id, snapshot, output) => {
    const current = rows.get(id); if (current?.status !== 'running' || current.node_results.some(node => node.status !== 'queued')) return null;
    rows.set(id, structuredClone({ ...current, workflow_snapshot: snapshot, output_payload: output })); return { id };
  });
  t.mock.method(require('../../backend/services/agenticAssistant.service'), 'respond', async () => {
    const index = calls++; running++; peak = Math.max(peak, running);
    if (index < 2) await new Promise(resolve => { releases[index] = resolve; });
    running--;
    return { transaction: { id: `review-${index}` }, result: { response: 'Reviewed', citation_ids: [], findings: [] }, provenance: { generation_mode: 'llm' } };
  });
  t.after(async () => { releases.forEach(release => release()); const tasks = [...runtime._internals.active.values()]; tasks.forEach(task => task.controller.abort()); await Promise.allSettled(tasks.map(task => task.promise)); });
  const runs = await Promise.all([1,2,3].map(index => runtime.start(definition, { request_id: `queued-run-${index}`, input_payload: {} }, user)));
  for (let attempt = 0; attempt < 100 && calls < 2; attempt++) await new Promise(resolve => setTimeout(resolve, 2));
  assert.equal(calls, 2);
  const queued = rows.get(runs[2].id);
  assert.equal(queued.output_payload.execution_state, 'queued');
  assert.equal((await runtime.reconcile(queued)).output_payload.queue_position, 1);
  releases[0](); await runtime._internals.active.get(runs[0].id)?.promise;
  for (let attempt = 0; attempt < 100 && calls < 3; attempt++) await new Promise(resolve => setTimeout(resolve, 2));
  assert.equal(calls, 3); assert.equal(peak, 2);
  await runtime._internals.active.get(runs[2].id)?.promise;
  assert.notEqual(rows.get(runs[2].id).output_payload.execution_state, 'queued');
  releases[1](); await runtime._internals.active.get(runs[1].id)?.promise;
});
