const test = require('node:test');
const assert = require('node:assert/strict');
const runtime = require('../../backend/services/agenticWorkflowExecution.service');
const permissions = require('@hellotest/platform/backend/services/permission.service');
const flags = require('@hellotest/platform/backend/services/featureFlag.service');
const node = (id, kind, data = {}) => ({ id, data: { label: id, kind, ...data } });
function fixture(t, data, { firstSkipped = false, kind = 'aggregator' } = {}) {
  t.mock.method(permissions, 'hasPermission', async () => true);
  t.mock.method(flags, 'areEnabled', async () => true);
  const target = node('target', kind, data);
  const sources = ['a', 'b'].map(id => ({ node_id: id, node_name: id, node_type: 'artifactTask', status: id === 'b' && firstSkipped ? 'skipped' : 'completed',
    output: { data: [{ story_id: id }] }, execution_context: { data: [{ story_id: id, story_revision: `revision-${id}`, authorised: true }] } }));
  const run = { id: 'native-lineage-fixture', project_id: 'p', input_payload: {}, output_payload: {},
    workflow_snapshot: { settings: {}, nodes: [node('a', 'artifactTask'), node('b', 'artifactTask'), target],
      edges: [{ source: 'a', target: 'target', targetHandle: 'input-2' }, { source: 'b', target: 'target', targetHandle: 'input-1' }] },
    node_results: [...sources, { node_id: 'target', node_name: 'target', node_type: kind, status: 'queued', attempts: 0, logs: [] }] };
  return { run, target, result: run.node_results.at(-1) };
}
const execute = ({ run, target }) => runtime._internals.runStep(run, target, { id: 'actor' }, new AbortController().signal, async () => {});

test('Choose Input propagates only its selected input-port native Story checkpoints', async t => {
  const fixtureValue = fixture(t, { mergeMode: 'chooseInput', mergeChooseInput: 1 });
  await execute(fixtureValue);
  assert.deepEqual(fixtureValue.result.output.data, [{ story_id: 'b' }]);
  assert.deepEqual(fixtureValue.result.execution_context.data.map(item => item.story_id), ['b'], 'Discarded Stories must not reappear in downstream native generation/publication.');
  assert.equal(fixtureValue.result.execution_context.data[0].story_revision, 'revision-b');
});

test('Choose Input selecting an inactive branch cannot inherit a different active branch checkpoint', async t => {
  const fixtureValue = fixture(t, { mergeMode: 'chooseInput', mergeChooseInput: 1 }, { firstSkipped: true });
  await execute(fixtureValue);
  assert.deepEqual(fixtureValue.result.output.data, []);
  assert.equal(fixtureValue.result.execution_context, undefined);
});

test('generic native Story joins are rejected rather than unioning unmatched artifact checkpoints', async t => {
  for (const mergeMode of ['combinePosition', 'combineMatching', 'combineAll']) {
    const fixtureValue = fixture(t, { mergeMode, mergeMatchFields: [{ left: 'story_id', right: 'story_id' }] });
    await assert.rejects(execute(fixtureValue), error => {
      assert.match(error.publicMessage || error.message, /native|checkpoint|lineage|artifact/i);
      return true;
    }, mergeMode);
    assert.equal(fixtureValue.result.execution_context, undefined);
  }
});

test('Wait preserves the exact native Story checkpoint while passing connected data', async t => {
  const fixtureValue = fixture(t, { waitMs: 0, timeoutMs: 1000 }, { kind: 'wait' });
  fixtureValue.run.workflow_snapshot.edges = [{ source: 'a', target: 'target' }];
  await execute(fixtureValue);
  assert.deepEqual(fixtureValue.result.output.data, [{ story_id: 'a' }]);
  assert.deepEqual(fixtureValue.result.execution_context, fixtureValue.run.node_results[0].execution_context);
});

test('each connected loop batch receives its own native Story input, while Done collects all completed checkpoints', async t => {
  t.mock.method(permissions, 'hasPermission', async () => true);
  t.mock.method(flags, 'areEnabled', async () => true);
  const seen = [];
  t.mock.method(require('../../backend/workflows/artifactTasks'), 'execute', async ({ context }) => {
    seen.push(structuredClone(context.input));
    const packets = context.input.map(packet => ({ ...packet, completed_native_task: true }));
    return { __workflow_result: { output: { data: packets.map(packet => ({ story_id: packet.story_id, story_revision: packet.story_revision, result_detail: 'native output '.repeat(6500) })) }, context: { data: packets } } };
  });
  const loop = node('loop', 'loop', { loopAction: 'workflow', loopSourceKey: 'input', loopMaxIterations: 2, loopBatchSize: 1 });
  const nodes = [node('source', 'artifactTask'), loop, node('body', 'artifactTask', { artifactTask: 'story-assurance', timeoutMs: 1000 }), node('done', 'artifactTask', { artifactTask: 'story-assurance', timeoutMs: 1000 })];
  const result = { node_id: 'loop', node_name: 'loop', node_type: 'loop', status: 'queued', attempts: 0, logs: [] };
  const run = { id: 'native-loop-lineage', project_id: 'p', input_payload: {}, output_payload: {}, workflow_snapshot: { id: 'workflow', settings: {}, nodes,
    execution_order: ['source', 'loop', 'body', 'done'], edges: [{ source: 'source', target: 'loop' }, { source: 'loop', target: 'body', sourceHandle: 'loop' }, { source: 'body', target: 'loop', targetHandle: 'continue' }, { source: 'loop', target: 'done', sourceHandle: 'done' }] },
    node_results: [{ node_id: 'source', node_name: 'source', node_type: 'artifactTask', status: 'completed', output: { data: [{ story_id: 'a', story_revision: 'revision-a' }, { story_id: 'b', story_revision: 'revision-b' }] },
      execution_context: { data: [{ story_id: 'a', story_revision: 'revision-a' }, { story_id: 'b', story_revision: 'revision-b' }] } }, result,
      { node_id: 'body', node_name: 'body', node_type: 'artifactTask', status: 'queued', attempts: 0, logs: [] }, { node_id: 'done', node_name: 'done', node_type: 'artifactTask', status: 'queued', attempts: 0, logs: [] }] };
  await runtime._internals.runStep(run, loop, { id: 'actor' }, new AbortController().signal, async () => {});
  assert.deepEqual(seen.map(batch => batch.map(item => item.story_id)), [['a'], ['b']], 'Accumulated Done lineage must not replace the next batch input.');
  assert.deepEqual(seen.map(batch => batch.map(item => item.story_revision)), [['revision-a'], ['revision-b']], 'Batch selection preserves the exact upstream native revision.');
  assert.deepEqual(result.output.data.map(item => item.story_id), ['a', 'b']);
  assert.ok(Buffer.byteLength(JSON.stringify(result.output)) > 128 * 1024, 'Native foreach collection retains the native artifact budget above the generic limit');
  assert.deepEqual(result.execution_context.data.map(item => item.story_id), ['a', 'b']);
  assert.ok(result.execution_context.data.every(item => item.completed_native_task));
  await runtime._internals.runStep(run, nodes.at(-1), { id: 'actor' }, new AbortController().signal, async () => {});
  assert.deepEqual(seen.at(-1).map(item => item.story_id), ['a', 'b'], 'A native task after Done receives every collected checkpoint, rather than only the final batch.');
  assert.deepEqual(seen.at(-1).map(item => item.story_revision), ['revision-a', 'revision-b']);
});

test('native graph fields cannot override exclusive effect scheduling', () => {
  const scheduling = require('../../backend/workflows/workflowScheduling');
  for (const data of [{ kind: 'artifactTask' }, { kind: 'loop' }, { kind: 'mcpTool' }, { kind: 'apiTool', apiMethod: 'POST' }]) {
    assert.equal(scheduling.exclusive({ id: 'effect', exclusive: false, data }), true, data.kind);
  }
  assert.equal(scheduling.exclusive({ id: 'read', exclusive: true, data: { kind: 'apiTool', apiMethod: 'GET' } }), false, 'Native graph concurrency derives from its actual operation.');
  assert.equal(scheduling.exclusive({ id: 'effect', kind: 'apiTool', exclusive: true }), true, 'Server-created Temporal metadata preserves the resolved policy.');
});

test('executing a selected loop body step cannot dispatch a downstream body write', async t => {
  t.mock.method(permissions, 'hasPermission', async () => true);
  t.mock.method(flags, 'areEnabled', async () => true);
  const insert = t.mock.method(runtime._internals.store, 'insert', async () => { throw new Error('Unexpected run persistence'); });
  const dispatch = t.mock.method(require('../../backend/workflows/connections'), 'callHttp', async () => { throw new Error('Unexpected body write'); });
  const workflow = { id: 'target-body-fixture', project_id: 'p', settings: {}, status: 'draft', trigger_kind: 'manual', nodes: [node('input', 'trigger'),
    node('loop', 'loop', { loopAction: 'workflow', loopSourceKey: 'input.items', loopMaxIterations: 2, loopBatchSize: 1 }),
    node('bodyA', 'transform', { transformMapping: '{}' }), node('bodyB', 'apiTool', { connectionId: 'managed', apiMethod: 'POST', apiUrl: 'https://example.test/api', apiBody: '{}' }), node('done', 'output')],
    edges: [{ source: 'input', target: 'loop' }, { source: 'loop', target: 'bodyA', sourceHandle: 'loop' }, { source: 'bodyA', target: 'bodyB' }, { source: 'bodyB', target: 'loop', targetHandle: 'continue' }, { source: 'loop', target: 'done', sourceHandle: 'done' }] };
  await assert.rejects(runtime.start(workflow, { target_node_id: 'bodyA', input_payload: { items: [1] } }, { id: 'actor' }), error => {
    assert.equal(error.statusCode, 422);
    assert.match(error.publicMessage, /enclosing Loop|loop body|batch context/i);
    return true;
  });
  assert.equal(insert.mock.callCount(), 0);
  assert.equal(dispatch.mock.callCount(), 0);
});
