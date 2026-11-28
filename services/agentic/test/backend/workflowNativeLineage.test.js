const test = require('node:test');
const assert = require('node:assert/strict');
const runtime = require('../../backend/services/agenticWorkflowExecution.service');
const artifactTasks = require('../../backend/workflows/artifactTasks');
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

test('agent workflow execution publishes its final artifact and saves only durable intermediate state', async t => {
  const { run, target, result } = fixture(t, { artifactTask: 'automation-engineer' }, { kind: 'artifactTask' });
  const checkpoint = { schema_version: 1, input_fingerprint: 'pinned-source', stories: [] };
  const final = { data: [{ story_id: 'completed-story' }] };
  t.mock.method(artifactTasks, 'execute', async ({ onProgress }) => {
    await onProgress({ current_item: 1, percent: 20, completed_items: [{ draft: 'temporary' }] });
    await onProgress({ percent: 50, automation_checkpoint: checkpoint, automation_startup_retry: true });
    await onProgress({ percent: 90, completed_items: [{ draft: 'another temporary draft' }] });
    return { __workflow_result: { output: final, context: final } };
  });
  const snapshots = [];
  await runtime._internals.runStep(run, target, { id: 'actor' }, new AbortController().signal,
    async () => { snapshots.push(structuredClone(result)); });
  assert.deepEqual(result.output, final);
  assert.deepEqual(result.progress, { automation_checkpoint: checkpoint });
  assert.deepEqual(result.logs.map(item => item.event), ['node_started', 'node_completed']);
  assert.ok(snapshots.some(item => item.status === 'running' && item.progress?.automation_checkpoint));
  assert.doesNotMatch(JSON.stringify(snapshots), /temporary|automation_startup_retry|completed_items|percent/);
});

test('native automation uses the Studio timeout default when an imported node omits it', async t => {
  const guarded = require('@hellotest/knowledge/backend/services/knowledgeExecution.service');
  const bounded = guarded.bounded;
  const budgets = [];
  t.mock.method(guarded, 'bounded', async (task, options) => {
    budgets.push(options.timeoutMs);
    return bounded(task, options);
  });
  t.mock.method(artifactTasks, 'execute', async () => ({ data: [] }));
  await execute(fixture(t, { artifactTask: 'automation-engineer' }, { kind: 'artifactTask' }));
  assert.ok(budgets.includes(1_800_000));
  budgets.length = 0;
  await execute(fixture(t, { artifactTask: 'automation-engineer', timeoutMs: '90000' }, { kind: 'artifactTask' }));
  assert.ok(budgets.includes(90_000));
  assert.ok(!budgets.includes(1_800_000));
});

test('a timed-out automation with a dispatched action still requires reconciliation', async t => {
  const data = fixture(t, { artifactTask: 'automation-engineer' }, { kind: 'artifactTask' });
  const timedOut = Object.assign(new Error('The test action did not return a receipt.'), {
    code: 'DEADLINE_EXCEEDED', effect_dispatched: true, outcome_unknown: true, operation_id: 'receipt'
  });
  t.mock.method(artifactTasks, 'execute', async () => { throw timedOut; });
  await assert.rejects(execute(data), { code: 'DEADLINE_EXCEEDED', outcome_unknown: true, operation_id: 'receipt' });
});

test('failed automation returns a terminal partial outcome for complete drafts', async t => {
  const data = fixture(t, { artifactTask: 'automation-engineer' }, { kind: 'artifactTask' });
  const completed = { client_id:'case-one', validation:{status:'passed'}, executable:{code:'complete Playwright source'} };
  t.mock.method(artifactTasks, 'execute', async ({ onProgress }) => {
    await onProgress({ automation_checkpoint:{
      input_fingerprint:'private',stories:[{story_id:'a',story_revision:'revision-a',automation:[completed,null]}]
    }, completed_items:[{script:'unfinished draft'}] });
    throw Object.assign(new Error('Next case could not complete.'),{statusCode:502});
  });
  await assert.rejects(execute(data),/Next case could not complete/);
  assert.equal(data.result.output.partial,true);
  assert.deepEqual(data.result.output.data[0].automation,[completed,null]);
  assert.doesNotMatch(JSON.stringify(data.result.output),/private|unfinished draft/);
  assert.equal(data.result.progress.automation_checkpoint.input_fingerprint,'private');
});

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

test('a disabled node passes the exact authorized Story checkpoints to downstream tasks', async t => {
  const fixtureValue = fixture(t, { disabled: true }, { kind: 'wait' });
  fixtureValue.run.workflow_snapshot.edges = [{ source: 'a', target: 'target' }];
  await execute(fixtureValue);
  assert.equal(fixtureValue.result.status, 'skipped');
  assert.equal(fixtureValue.result.attempts, 0);
  assert.deepEqual(fixtureValue.result.output, { data: [{ story_id: 'a' }] });
  assert.deepEqual(fixtureValue.result.execution_context, fixtureValue.run.node_results[0].execution_context);
});

test('a disabled join cannot bypass workflow result size limits', async t => {
  const fixtureValue = fixture(t, { disabled: true });
  for (const [index, source] of fixtureValue.run.node_results.slice(0, 2).entries()) {
    fixtureValue.run.workflow_snapshot.nodes[index].data.kind = 'transform';
    delete source.execution_context;
    source.output = { data: { [source.node_id]: 'v'.repeat(70 * 1024) } };
  }
  await assert.rejects(execute(fixtureValue), /Node output exceeded 128 KB/);
  assert.equal(fixtureValue.result.output, undefined);
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

test('nested Sprint loops prepare and automate every exact case, then merge all case results into each Story checkpoint', async t => {
  t.mock.method(permissions, 'hasPermission', async () => true);
  t.mock.method(flags, 'areEnabled', async () => true);
  const cases = storyId => [1, 2].map(number => ({ client_id: `${storyId}-case-${number}`, title: `Case ${number}`, steps: [{ action: 'Open the page', expected_result: 'The page is visible.' }] }));
  const packets = ['story-a', 'story-b'].map((story_id, index) => ({ story_id, story_revision: `revision-${index + 1}`,
    story: { id: story_id, title: story_id }, cases: cases(story_id), case_assurance: [] }));
  const seen = [];
  t.mock.method(require('../../backend/workflows/artifactTasks'), 'execute', async ({ node: taskNode, context }) => {
    const task = taskNode.data.artifactTask;
    assert.equal(context.input.length, 1);
    const packet = context.input[0], selected = context.item;
    assert.equal(packet.cases.find(draft => draft.client_id === selected.client_id)?.client_id, selected.client_id);
    seen.push({ task, story_id: packet.story_id, client_id: selected.client_id,
      has_case_data: Boolean(packet.test_data_by_case?.[selected.client_id]) });
    const next = task === 'test-case-assurance'
      ? { ...packet, case_assurance: Object.assign([...packet.case_assurance], { [packet.cases.findIndex(item => item.client_id === selected.client_id)]: { client_id: selected.client_id,
          case_fingerprint: artifactTasks.fingerprint(selected), verification: { status: 'passed' } } }) }
      : task === 'test-data-generator'
        ? { ...packet, test_data_by_case: { ...(packet.test_data_by_case || {}), [selected.client_id]: { status: 'ready' } } }
        : { ...packet, automation_by_case: { ...(packet.automation_by_case || {}), [selected.client_id]: { client_id: selected.client_id, validation: { status: 'passed' } } } };
    return { __workflow_result: { output: { data: [{ story_id: packet.story_id, client_id: selected.client_id, task }] }, context: { data: [next] } } };
  });
  const nodes = [node('request', 'trigger'), node('source', 'artifactTask'),
    node('each-story', 'loop', { loopAction: 'workflow', loopSourceKey: 'input', loopMaxIterations: 10, loopBatchSize: 1 }),
    node('each-case', 'loop', { loopAction: 'workflow', loopSourceKey: 'input.0.cases', loopMaxIterations: 10, loopBatchSize: 1 }),
    node('assurance', 'artifactTask', { artifactTask: 'test-case-assurance' }),
    node('test-data', 'artifactTask', { artifactTask: 'test-data-generator' }),
    node('automation', 'artifactTask', { artifactTask: 'automation-engineer' }), node('finish', 'output')];
  const edges = [{ source: 'request', target: 'source' }, { source: 'source', target: 'each-story' },
    { source: 'each-story', target: 'each-case', sourceHandle: 'loop' }, { source: 'each-case', target: 'assurance', sourceHandle: 'loop' },
    { source: 'assurance', target: 'test-data' },
    { source: 'test-data', target: 'automation' }, { source: 'automation', target: 'each-case', targetHandle: 'continue' },
    { source: 'each-case', target: 'each-story', sourceHandle: 'done', targetHandle: 'continue' },
    { source: 'each-story', target: 'finish', sourceHandle: 'done' }];
  const result = { node_id: 'each-story', node_name: 'each-story', node_type: 'loop', status: 'queued', attempts: 0, logs: [] };
  const run = { id: 'nested-sprint-lineage', project_id: 'p', input_payload: {}, output_payload: {},
    workflow_snapshot: { id: 'workflow', settings: {}, nodes, execution_order: nodes.map(item => item.id), edges },
    node_results: [
      { node_id: 'source', node_name: 'source', node_type: 'artifactTask', status: 'completed', output: { data: packets }, execution_context: { data: packets } },
      result,
      ...nodes.slice(3).map(item => ({ node_id: item.id, node_name: item.id, node_type: item.data.kind, status: 'queued', attempts: 0, logs: [] }))
    ] };
  await runtime._internals.runStep(run, nodes[2], { id: 'actor' }, new AbortController().signal, async () => {});
  assert.deepEqual(seen.map(item => [item.task, item.story_id, item.client_id, item.has_case_data]), [
    ['test-case-assurance', 'story-a', 'story-a-case-1', false], ['test-data-generator', 'story-a', 'story-a-case-1', false], ['automation-engineer', 'story-a', 'story-a-case-1', true],
    ['test-case-assurance', 'story-a', 'story-a-case-2', false], ['test-data-generator', 'story-a', 'story-a-case-2', false], ['automation-engineer', 'story-a', 'story-a-case-2', true],
    ['test-case-assurance', 'story-b', 'story-b-case-1', false], ['test-data-generator', 'story-b', 'story-b-case-1', false], ['automation-engineer', 'story-b', 'story-b-case-1', true],
    ['test-case-assurance', 'story-b', 'story-b-case-2', false], ['test-data-generator', 'story-b', 'story-b-case-2', false], ['automation-engineer', 'story-b', 'story-b-case-2', true],
  ]);
  assert.deepEqual(result.execution_context.data.map(packet => packet.story_id), ['story-a', 'story-b']);
  for (const packet of result.execution_context.data) {
    assert.deepEqual(Object.keys(packet.test_data_by_case).sort(), packet.cases.map(draft => draft.client_id).sort());
    assert.deepEqual(packet.case_assurance.map(item => item.verification.status), ['passed', 'passed']);
    assert.deepEqual(Object.keys(packet.automation_by_case).sort(), packet.cases.map(draft => draft.client_id).sort());
  }
});

test('native graph fields cannot override exclusive effect scheduling', () => {
  const scheduling = require('../../backend/workflows/workflowScheduling');
  for (const data of [{ kind: 'artifactTask' }, { kind: 'loop' }, { kind: 'mcpTool' }, { kind: 'apiTool', apiMethod: 'POST' }]) {
    assert.equal(scheduling.exclusive({ id: 'effect', exclusive: false, data }), true, data.kind);
  }
  assert.equal(scheduling.exclusive({ id: 'read', exclusive: true, data: { kind: 'apiTool', apiMethod: 'GET' } }), false, 'Native graph concurrency derives from its actual operation.');
  assert.equal(scheduling.exclusive(node('source', 'repositoryAgent', { repositoryOptional: true, repositoryAgentType: 'api_tests' })), false);
  assert.equal(scheduling.exclusive(node('source', 'repositoryAgent', { repositoryOptional: true, repositoryAgentType: 'object_repository' })), false);
  assert.equal(scheduling.exclusive(node('source', 'repositoryAgent', { repositoryAgentType: 'api_tests' })), true);
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
