const test = require('node:test');
const assert = require('node:assert/strict');
const runtime = require('../../backend/services/agenticWorkflowExecution.service');
const permissions = require('@hellotest/platform/backend/services/permission.service');
const flags = require('@hellotest/platform/backend/services/featureFlag.service');

const user = { id: 'reviewer', role: 'member' };
const node = (id, kind, data = {}) => ({ id, type: 'agenticStep', data: { label: id, kind, ...data } });
const wire = (source, target, sourceHandle, targetHandle) => ({ id: `${source}-${target}-${sourceHandle || 'out'}-${targetHandle || 'in'}`, source, target, ...(sourceHandle ? { sourceHandle } : {}), ...(targetHandle ? { targetHandle } : {}) });
const graph = (nodes, edges) => ({ id: 'workflow', project_id: 'project-a', app_type_id: 'app-a', name: 'Native flow test', status: 'draft', trigger_kind: 'manual', nodes, edges, settings: {} });
const result = (run, id) => run.node_results.find(item => item.node_id === id);
function setup(t) {
  const rows = new Map();
  t.mock.method(permissions, 'hasPermission', async (_user, _permission, project) => project === 'project-a');
  t.mock.method(flags, 'areEnabled', async () => true);
  t.mock.method(runtime._internals.store, 'get', async id => structuredClone(rows.get(id) || null));
  t.mock.method(runtime._internals.store, 'mergePublication', async () => null);
  t.mock.method(runtime._internals.store, 'insert', async run => {
    if (rows.has(run.id)) return null;
    rows.set(run.id, structuredClone(run));
    return { id: run.id };
  });
  t.mock.method(runtime._internals.store, 'save', async (id, status, nodes, output, expectedNodes = null) => {
    const current = rows.get(id);
    if (!current || current.status !== 'running' || expectedNodes && JSON.stringify(expectedNodes) !== JSON.stringify(current.node_results)) return null;
    rows.set(id, structuredClone({ ...current, status, node_results: nodes, output_payload: output, completed_at: status === 'running' ? null : new Date().toISOString() }));
    return { id };
  });
  t.after(async () => {
    const active = [...runtime._internals.active.values()];
    active.forEach(task => task.controller.abort());
    await Promise.allSettled(active.map(task => task.promise));
  });
  return rows;
}
async function finished(id) {
  await runtime._internals.active.get(id)?.promise;
  return runtime._internals.store.get(id);
}
async function execute(definition, input_payload) {
  const readiness = runtime.readiness(definition);
  assert.equal(readiness.ready, true, JSON.stringify(readiness.blockers));
  const started = await runtime.start(definition, { input_payload }, user);
  return finished(started.id);
}
function loopGraph(extra = {}) {
  return graph([node('request', 'trigger'), node('loop', 'loop', { loopAction: 'workflow', loopSourceKey: 'input.items', loopMaxIterations: '100', loopBatchSize: '2', ...extra }),
    node('first', 'transform', { transformMapping: '{"values":"$input","outer_item":"$item","batch":"$iteration.index","batch_size":"$iteration.batch_size"}' }),
    node('second', 'transform', { transformMapping: '{"previous":"$input","outer_item":"$item","batch":"$iteration.index"}' }), node('finish', 'output')],
  [wire('request', 'loop'), wire('loop', 'first', 'loop'), wire('first', 'second'), wire('second', 'loop', undefined, 'continue'), wire('loop', 'finish', 'done')]);
}

test('connected AI loop Done retains every batch review and an earlier evidence limitation', async t => {
  setup(t);
  t.mock.method(require('../../backend/agents/agentRegistry.service'), 'resolveModel', async () => ({ id: 'model', model: 'fixture-model' }));
  let calls = 0;
  t.mock.method(require('../../backend/services/agenticAssistant.service'), 'respond', async () => {
    const index = calls++;
    return { transaction: { id: `batch-review-${index}` }, result: { response: `Review ${index} [K-${index}]`, citation_ids: [`K-${index}`],
      readiness: { status: index === 0 ? 'limited_evidence' : 'ready_for_review', evidence_count: 1, task_evidence_count: 1, limitations: index === 0 ? ['First batch needs more evidence.'] : [] } }, provenance: { generation_mode: 'llm' } };
  });
  const definition = graph([node('request', 'trigger'), node('loop', 'loop', { loopAction: 'workflow', loopSourceKey: 'input.items', loopMaxIterations: 10, loopBatchSize: 1 }),
    node('review', 'customAI', { prompt: 'Review this batch against its supplied evidence.' }), node('finish', 'output')],
    [wire('request', 'loop'), wire('loop', 'review', 'loop'), wire('review', 'loop', undefined, 'continue'), wire('loop', 'finish', 'done')]);
  const saved = await execute(definition, { items: [{ id: 'first' }, { id: 'second' }] });
  assert.equal(calls, 2);
  assert.equal(saved.status, 'needs_review', 'A later ready batch cannot erase the earlier evidence limitation.');
  assert.deepEqual(result(saved, 'finish').output.reviews.map(review => [review.session_id, review.iteration_path, review.citation_ids]), [
    ['batch-review-0', ['loop', 0], ['K-0']], ['batch-review-1', ['loop', 1], ['K-1']],
  ]);
  assert.deepEqual(saved.output_payload.review_session_ids, ['batch-review-0', 'batch-review-1']);
});

test('connected Loop Over Items runs a two-step body for every batch, persists each iteration and delivers collected Done output', async t => {
  setup(t);
  const input = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const saved = await execute(loopGraph(), { items: input });
  assert.equal(saved.status, 'completed');
  const loop = result(saved, 'loop'), first = result(saved, 'first'), second = result(saved, 'second');
  assert.equal(loop.output.processed, 3); assert.equal(loop.output.total_batches, 2);
  assert.deepEqual(loop.output.data.map(item => item.previous.values), [[input[0], input[1]], [input[2]]]);
  assert.deepEqual(loop.output.data.map(item => item.previous.batch_size), [2, 1]);
  assert.deepEqual(loop.output.data.map(item => item.batch), [0, 1]);
  assert.equal(first.iterations.length, 2); assert.equal(second.iterations.length, 2);
  assert.deepEqual(first.iterations[0].input.input, [input[0], input[1]]);
  assert.deepEqual(second.iterations[0].input.input, first.iterations[0].output.data);
  assert.deepEqual(second.input.input, first.output.data);
  assert.deepEqual(result(saved, 'finish').output.data, loop.output.data);
  assert.deepEqual(loop.output.paired_items.map(item => [item.batch_index, item.source_node_id, item.input_start_index, item.input_item_count]), [[0, 'second', 0, 2], [1, 'second', 2, 1]]);
});

test('a single-item batch exposes the actual item, and empty loops run no body while still reaching Done', async t => {
  setup(t);
  const single = await execute(loopGraph({ loopBatchSize: 1 }), { items: [{ id: 'a' }, { id: 'b' }] });
  assert.equal(single.status, 'completed');
  assert.deepEqual(result(single, 'loop').output.data.map(item => item.outer_item), [{ id: 'a' }, { id: 'b' }]);
  const empty = await execute(loopGraph(), { items: [] });
  assert.equal(empty.status, 'completed');
  assert.equal(result(empty, 'loop').output.processed, 0);
  assert.equal(result(empty, 'loop').output.total_batches, 0);
  for (const id of ['first', 'second']) { assert.equal(result(empty, id).status, 'skipped'); assert.equal(result(empty, id).attempts, 0); }
  assert.deepEqual(result(empty, 'finish').output.data, []);
});

test('a connected loop rejects oversized input without running a successful prefix or its Done branch', async t => {
  setup(t);
  const saved = await execute(loopGraph({ loopMaxIterations: 2 }), { items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
  assert.equal(saved.status, 'failed');
  assert.match(result(saved, 'loop').error, /received 3 items.*limit is 2/);
  for (const id of ['first', 'second', 'finish']) assert.equal(result(saved, id).status, 'skipped');
  assert.equal(result(saved, 'first').attempts, 0);
});

test('connected loop configuration rejects zero, boolean and unbounded batch sizes', () => {
  for (const loopBatchSize of [0, true, false, -1, 1.5, 101]) assert.equal(runtime.readiness(loopGraph({ loopBatchSize })).ready, false, JSON.stringify(loopBatchSize));
});

test('a connected loop enforces its own step deadline and aborts a pending body delay', async t => {
  setup(t);
  const definition = graph([node('request', 'trigger'), node('loop', 'loop', { loopAction: 'workflow', loopSourceKey: 'input.items', loopMaxIterations: 10, loopBatchSize: 1, timeoutMs: 1000 }),
    node('wait', 'wait', { waitMs: 5000, timeoutMs: 6000 }), node('finish', 'output')],
    [wire('request', 'loop'), wire('loop', 'wait', 'loop'), wire('wait', 'loop', undefined, 'continue'), wire('loop', 'finish', 'done')]);
  const began = Date.now();
  const saved = await execute(definition, { items: [{ id: 'a' }] });
  assert.equal(saved.status, 'failed');
  assert.equal(result(saved, 'loop').error_details.code, 'NODE_TIMEOUT');
  assert.ok(Date.now() - began < 3000, 'The body delay exceeded the loop step deadline.');
  assert.equal(result(saved, 'finish').status, 'skipped');
});

test('nested connected loops collect each inner result into its outer item and retain complete iteration paths', async t => {
  setup(t);
  const definition = graph([node('request', 'trigger'),
    node('outer', 'loop', { loopAction: 'workflow', loopSourceKey: 'input.items', loopMaxIterations: 10, loopBatchSize: 1 }),
    node('inner', 'loop', { loopAction: 'workflow', loopSourceKey: 'item.items', loopMaxIterations: 10, loopBatchSize: 2 }),
    node('worker', 'dataOperation', { dataOperation: 'editFields', dataKeepOtherFields: false, dataMapping: '{"value":"$item"}' }),
    node('group', 'transform', { transformMapping: '{"group":"$item.id","values":"$input"}' }), node('finish', 'output')],
    [wire('request', 'outer'), wire('outer', 'inner', 'loop'), wire('inner', 'worker', 'loop'), wire('worker', 'inner', undefined, 'continue'), wire('inner', 'group', 'done'), wire('group', 'outer', undefined, 'continue'), wire('outer', 'finish', 'done')]);
  const saved = await execute(definition, { items: [{ id: 'a', items: [1, 2, 3] }, { id: 'b', items: [4] }] });
  assert.equal(saved.status, 'completed');
  assert.deepEqual(result(saved, 'finish').output.data, [{ group: 'a', values: [{ value: 1 }, { value: 2 }, { value: 3 }] }, { group: 'b', values: [{ value: 4 }] }]);
  assert.deepEqual(result(saved, 'worker').iterations.map(item => item.iteration_path), [['outer', 0, 'inner', 0], ['outer', 0, 'inner', 1], ['outer', 1, 'inner', 0]]);
  assert.equal(result(saved, 'inner').iterations.length, 2);
  assert.equal(result(saved, 'group').iterations.length, 2);
});

test('a body failure records a terminal failed iteration and preserves earlier work without starting the next batch', async t => {
  setup(t);
  const definition = graph([node('request', 'trigger'), node('loop', 'loop', { loopAction: 'workflow', loopSourceKey: 'input.items', loopMaxIterations: 10, loopBatchSize: 1 }),
    node('first', 'transform', { transformMapping: '{"id":"$item.id"}' }), node('stop', 'stop', { stopMessage: 'Body contract rejected.' }), node('finish', 'output')],
    [wire('request', 'loop'), wire('loop', 'first', 'loop'), wire('first', 'stop'), wire('stop', 'loop', undefined, 'continue'), wire('loop', 'finish', 'done')]);
  const saved = await execute(definition, { items: [{ id: 'a' }, { id: 'b' }] });
  assert.equal(saved.status, 'failed');
  assert.equal(result(saved, 'first').iterations.length, 1); assert.equal(result(saved, 'first').iterations[0].status, 'completed');
  assert.equal(result(saved, 'stop').iterations.length, 1); assert.equal(result(saved, 'stop').iterations[0].status, 'failed');
  assert.match(result(saved, 'stop').iterations[0].error, /Body contract rejected/);
  assert.deepEqual(result(saved, 'stop').iterations[0].iteration_path, ['loop', 0]);
  assert.equal(saved.output_payload.failed_node_id,'stop');assert.equal(saved.output_payload.failed_parent_node_id,'loop');
  assert.equal(saved.output_payload.error_code,'WORKFLOW_STOPPED');
  assert.deepEqual(result(saved,'loop').error_details.origin,{node_id:'stop',node_name:'stop',loop_node_id:'loop',batch_index:0,iteration_path:['loop',0]});
  assert.equal(result(saved, 'finish').status, 'skipped');
});

test('unknown operation outcomes stop before an Error handler or downstream action can redispatch', async t => {
  setup(t);
  const operations=require('../../backend/workflows/nodeOperations'),original=operations.execute;
  t.mock.method(operations,'execute',async input=>{if(input.node.id==='uncertain')throw Object.assign(new Error('PRIVATE_REMOTE_BODY'),{
    statusCode:502,code:'AGENT_HTTP_OUTCOME_UNKNOWN',outcome_unknown:true,retryable:false,operation_id:'http-original-operation',publicMessage:'The original operation was not acknowledged. Verify its outcome before sending it again.'});return original(input);});
  const definition=graph([node('request','trigger'),node('uncertain','transform',{transformMapping:'{}',onError:'errorOutput'}),node('recover','errorHandler'),node('finish','output')],
    [wire('request','uncertain'),wire('uncertain','recover','error'),wire('recover','finish')]);
  const saved=await execute(definition,{});
  assert.equal(saved.status,'failed');assert.equal(result(saved,'recover').status,'skipped');assert.equal(result(saved,'finish').status,'skipped');
  assert.equal(result(saved,'uncertain').error_details.reconciliation_required,true);assert.equal(saved.output_payload.error_details.operation_id,'http-original-operation');
  assert.doesNotMatch(JSON.stringify(saved),/PRIVATE_REMOTE_BODY/);
});

test('nested loops share the total batch budget instead of multiplying independent per-loop limits', async t => {
  setup(t);
  const definition = graph([node('request', 'trigger'),
    node('outer', 'loop', { loopAction: 'workflow', loopSourceKey: 'input.items', loopMaxIterations: 10, loopBatchSize: 1 }),
    node('inner', 'loop', { loopAction: 'workflow', loopSourceKey: 'item.items', loopMaxIterations: 10, loopBatchSize: 1 }),
    node('worker', 'transform', { transformMapping: '{"value":"$item"}' }),
    node('group', 'transform', { transformMapping: '{"values":"$input"}' }), node('finish', 'output')],
    [wire('request', 'outer'), wire('outer', 'inner', 'loop'), wire('inner', 'worker', 'loop'), wire('worker', 'inner', undefined, 'continue'), wire('inner', 'group', 'done'), wire('group', 'outer', undefined, 'continue'), wire('outer', 'finish', 'done')]);
  const saved = await execute(definition, { items: Array.from({ length: 10 }, (_, id) => ({ id, items: Array.from({ length: 10 }, (_, index) => index) })) });
  assert.equal(saved.status, 'failed');
  assert.match(result(saved, 'outer').error, /100 total batches/);
  assert.equal(result(saved, 'worker').iterations.length, 90);
  assert.equal(result(saved, 'finish').status, 'skipped');
});

test('typed conditions inside a connected body select only the matching return branch for each item', async t => {
  setup(t);
  const definition = graph([node('request', 'trigger'), node('loop', 'loop', { loopAction: 'workflow', loopSourceKey: 'input.items', loopMaxIterations: 10, loopBatchSize: 1 }),
    node('condition', 'condition', { conditions: [{ conditionPath: 'item.ready', conditionOperator: 'isTrue' }, { conditionPath: 'item.score', conditionOperator: 'greaterOrEqual', conditionValue: '80' }], conditionCombinator: 'all' }),
    node('yes', 'transform', { transformMapping: '{"id":"$item.id","selected":true}' }), node('no', 'transform', { transformMapping: '{"id":"$item.id","selected":false}' }), node('finish', 'output')],
  [wire('request', 'loop'), wire('loop', 'condition', 'loop'), wire('condition', 'yes', 'true'), wire('condition', 'no', 'false'), wire('yes', 'loop', undefined, 'continue'), wire('no', 'loop', undefined, 'continue'), wire('loop', 'finish', 'done')]);
  const saved = await execute(definition, { items: [{ id: 'a', ready: true, score: 80 }, { id: 'b', ready: true, score: 20 }] });
  assert.equal(saved.status, 'completed');
  assert.deepEqual(result(saved, 'loop').output.data, [{ id: 'a', selected: true }, { id: 'b', selected: false }]);
  assert.deepEqual(result(saved, 'yes').iterations.map(item => item.status), ['completed', 'skipped']);
  assert.deepEqual(result(saved, 'no').iterations.map(item => item.status), ['skipped', 'completed']);
});

function switchGraph() {
  return graph([node('request', 'trigger'), node('switch', 'dataOperation', { dataOperation: 'switch', dataSourceKey: 'input.items' }),
    node('yes', 'transform', { transformMapping: '{"branch":"passed","values":"$input"}' }), node('other', 'transform', { transformMapping: '{"branch":"other","values":"$input"}' }),
    node('merge', 'aggregator', { mergeMode: 'waitAllAppend' }), node('finish', 'output')],
  [wire('request', 'switch'), wire('switch', 'yes', 'passed'), wire('switch', 'other', 'fallback'), wire('other', 'merge', undefined, 'input-2'), wire('yes', 'merge', undefined, 'input-1'), wire('merge', 'finish')]);
}
test('Switch sends exact route subsets to branches and fan-in preserves input-port order', async t => {
  setup(t);
  const items = [{ id: 'a', status: 'passed' }, { id: 'b', status: 'failed' }];
  const saved = await execute(switchGraph(), { items });
  assert.equal(saved.status, 'completed');
  assert.deepEqual(result(saved, 'yes').input.input, [items[0]]);
  assert.deepEqual(result(saved, 'other').input.input, [items[1]]);
  assert.deepEqual(result(saved, 'finish').output.data, [{ branch: 'passed', values: [items[0]] }, { branch: 'other', values: [items[1]] }]);
  const one = await execute(switchGraph(), { items: [items[0]] });
  assert.equal(one.status, 'completed'); assert.equal(result(one, 'other').status, 'skipped');
  assert.deepEqual(result(one, 'finish').output.data, [{ branch: 'passed', values: [items[0]] }]);
});

test('empty Filter output skips connected work rather than passing a fabricated item to it', async t => {
  setup(t);
  const definition = graph([node('request', 'trigger'), node('filter', 'dataOperation', { dataOperation: 'filter', dataSourceKey: 'input.items' }), node('body', 'transform', { transformMapping: '{"fabricated":true}' }), node('finish', 'output')],
    [wire('request', 'filter'), wire('filter', 'body'), wire('body', 'finish')]);
  const saved = await execute(definition, { items: [{ status: 'failed' }] });
  assert.equal(result(saved, 'filter').status, 'completed');
  assert.equal(result(saved, 'filter').output.item_count, 0);
  assert.equal(result(saved, 'body').status, 'skipped'); assert.equal(result(saved, 'body').attempts, 0);
  assert.equal(result(saved, 'finish').status, 'skipped');
});

test('readiness rejects duplicate loop returns, body escape paths and extra external body entry points', () => {
  const duplicate = loopGraph(); duplicate.edges.push({ ...duplicate.edges.find(edge => edge.targetHandle === 'continue'), id: 'duplicate' });
  assert.equal(runtime.readiness(duplicate).ready, false);
  assert.ok(runtime.readiness(duplicate).blockers.some(item => /duplicate connections/.test(item.message)));
  const escape = loopGraph(); escape.edges.push(wire('first', 'finish'));
  assert.equal(runtime.readiness(escape).ready, false);
  assert.ok(runtime.readiness(escape).blockers.some(item => /loop body|Loop output|Output after/i.test(item.message)));
  const extra = loopGraph(); extra.edges.push(wire('request', 'first'));
  assert.equal(runtime.readiness(extra).ready, false);
  assert.ok(runtime.readiness(extra).blockers.some(item => /only receive data through its Loop output/.test(item.message)));
});

test('Switch readiness rejects undeclared or unselected output ports before persisting a run', () => {
  const unknown = switchGraph(); unknown.edges.find(edge => edge.source === 'switch').sourceHandle = 'does-not-exist';
  assert.equal(runtime.readiness(unknown).ready, false);
  const missing = switchGraph(); delete missing.edges.find(edge => edge.source === 'switch').sourceHandle;
  assert.equal(runtime.readiness(missing).ready, false);
  const disabledFallback = switchGraph(); disabledFallback.nodes.find(item => item.id === 'switch').data.dataFallback = 'none';
  assert.equal(runtime.readiness(disabledFallback).ready, false);
});

test('Stop records its explicit reason and routes only to an attached error handler when configured', async t => {
  setup(t);
  const definition = graph([node('request', 'trigger'), node('stop', 'stop', { stopMessage: 'Review rejected: required contract missing.', onError: 'errorOutput' }), node('recover', 'errorHandler'), node('normal', 'output'), node('recovered', 'output')],
    [wire('request', 'stop'), wire('stop', 'normal'), wire('stop', 'recover'), wire('recover', 'recovered')]);
  const saved = await execute(definition, { release: 'a' });
  assert.equal(saved.status, 'needs_review'); assert.equal(result(saved, 'stop').status, 'failed');
  assert.match(result(saved, 'stop').error, /required contract missing/);
  assert.equal(result(saved, 'normal').status, 'skipped');
  assert.equal(result(saved, 'recover').output.recovered, true);
  assert.match(result(saved, 'recovered').output.data[0].error, /required contract missing/);
  const unhandled = graph([node('request', 'trigger'), node('stop', 'stop', { stopMessage: 'Explicit stop.' }), node('finish', 'output')], [wire('request', 'stop'), wire('stop', 'finish')]);
  const failed = await execute(unhandled, {});
  assert.equal(failed.status, 'failed'); assert.equal(result(failed, 'finish').status, 'skipped');
});

test('Wait preserves connected data and cancellation aborts the actual pending delay before downstream work', async t => {
  const rows = setup(t);
  const definition = graph([node('request', 'trigger'), node('wait', 'wait', { waitMs: 1 }), node('finish', 'output')], [wire('request', 'wait'), wire('wait', 'finish')]);
  const saved = await execute(definition, { release: 'a' });
  assert.equal(saved.status, 'completed'); assert.equal(result(saved, 'wait').output.waited_ms, 1);
  assert.deepEqual(result(saved, 'finish').output.data, { release: 'a' });
  definition.nodes[1].data.waitMs = 5000; definition.nodes[1].data.timeoutMs = 6000;
  const started = await runtime.start(definition, { input_payload: { release: 'b' } }, user);
  const deadline = Date.now() + 2000;
  while (result(rows.get(started.id), 'wait').status !== 'running') {
    assert.ok(Date.now() < deadline, 'Wait did not reach its running checkpoint.');
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  const cancellationStarted = Date.now();
  await runtime.cancel(await runtime._internals.store.get(started.id), user);
  const cancelled = await finished(started.id);
  assert.ok(Date.now() - cancellationStarted < 1000, 'Cancellation waited for the pending delay.');
  assert.equal(cancelled.status, 'cancelled'); assert.equal(result(cancelled, 'wait').status, 'cancelled');
  assert.equal(result(cancelled, 'finish').status, 'skipped'); assert.equal(result(cancelled, 'finish').attempts, 0);
});
