const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { TestWorkflowEnvironment } = require('@temporalio/testing');
const { Worker } = require('@temporalio/worker');

const node = (id, kind, data = {}) => ({ id, data: { label: id, kind, ...data } });
const edge = (source, target, extra = {}) => ({ id: `${source}-${target}`, source, target, ...extra });
async function until(read, predicate, label, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const value = await read();
    if (predicate(value)) return value;
    await delay(25);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

exports.run = async ({ db, workflow, user }) => {
  const environment = await TestWorkflowEnvironment.createLocal();
  const previousAddress = process.env.TEMPORAL_ADDRESS;
  const previousQueue = process.env.TEMPORAL_TASK_QUEUE;
  process.env.TEMPORAL_ADDRESS = environment.address;
  process.env.TEMPORAL_TASK_QUEUE = `hellotest-scheduling-fixture-${randomUUID()}`;
  const control = require('../../backend/workflows/temporal/control');
  const activities = require('../../backend/workflows/temporal/activities');
  const runtime = require('../../backend/services/agenticWorkflowExecution.service');
  const operations = require('../../backend/workflows/nodeOperations');
  const workflowsPath = require.resolve('../../backend/workflows/temporal/workflows');
  let worker, workerTask, originalError;
  const dispatches = [], activeBranches = new Set();
  let maximumBranches = 0, lostLoopAcknowledgement = false;
  const loopRuns = new Map(), lostAcknowledgements = new Set();
  const receiptFailures = new Map(), injectedFailures = new Set(), bodyDispatches = new Map();
  const originalPrepare = db.prepare, originalExecute = operations.execute;
  const start = async (definition, input_payload, lostAckNode, failReceiptNode) => {
    const report = await runtime.checkReadiness(definition, '', user, input_payload);
    assert.equal(report.ready, true, JSON.stringify(report.blockers));
    const run = await runtime.start(definition, { request_id: randomUUID(), input_payload }, user);
    assert.equal(run.workflow_snapshot.runtime_contract.orchestrator, 'temporal');
    const command = await db.prepare("SELECT payload FROM workflow_delivery_outbox WHERE run_id=? AND command='start'").get(run.id);
    assert.equal(command.payload.scheduler_version, 2, 'The outbox must explicitly select the new deterministic scheduler.');
    assert.equal(command.payload.processing.max_parallel_nodes, definition.settings.processing_mode === 'parallel' ? definition.settings.max_parallel_nodes : 1);
    if (lostAckNode) loopRuns.set(run.id, lostAckNode);
    if (failReceiptNode) receiptFailures.set(run.id, failReceiptNode);
    await control.deliver(); await control.deliver();
    return run;
  };
  const finish = async run => {
    const handle = environment.client.workflow.getHandle(control.workflowId(run.id));
    await handle.result();
    const final = await runtime._internals.store.get(run.id);
    await Worker.runReplayHistory({ workflowsPath }, await handle.fetchHistory());
    return final;
  };
  try {
    // Inject only one named run/node's receipt failure, after its complete body
    // projections are persisted but before the whole-loop receipt commits.
    db.prepare = function (sql, ...args) {
      const statement = originalPrepare.call(this, sql, ...args);
      if (!/UPDATE\s+workflow_node_receipts\s+SET\s+state='recorded'/i.test(sql)) return statement;
      return { ...statement, get: async (...parameters) => {
        const runId = parameters[2], nodeId = parameters[3];
        if (receiptFailures.get(runId) === nodeId && !injectedFailures.has(runId)) {
          injectedFailures.add(runId);
          throw Object.assign(new Error('Fixture failed loop receipt before commit'), { code: 'FIXTURE_LOOP_RECEIPT_FAILED' });
        }
        return statement.get(...parameters);
      } };
    };
    operations.execute = async function (input) {
      if (receiptFailures.has(input.run.id) && input.node.id === 'body') bodyDispatches.set(input.run.id, (bodyDispatches.get(input.run.id) || 0) + 1);
      return originalExecute.call(this, input);
    };
    worker = await Worker.create({ connection: environment.nativeConnection, taskQueue: control.queue(), workflowsPath,
      activities: { ...activities, executeReviewNode: async input => {
        dispatches.push({ run_id: input.runId, node_id: input.nodeId });
        const branch = input.nodeId.startsWith('branch-');
        if (branch) { activeBranches.add(input.nodeId); maximumBranches = Math.max(maximumBranches, activeBranches.size); }
        try {
          // Vary completion order; fan-in must use declared input ports and wait
          // for every dependency rather than completion order.
          if (branch) await delay(input.nodeId === 'branch-a' ? 150 : 50);
          const receipt = await activities.executeReviewNode(input);
          if (loopRuns.get(input.runId) === input.nodeId && !lostAcknowledgements.has(input.runId)) {
            lostAcknowledgements.add(input.runId);
            lostLoopAcknowledgement = true;
            throw new Error('Fixture lost acknowledgement after loop receipt commit');
          }
          return receipt;
        } finally { if (branch) activeBranches.delete(input.nodeId); }
      } } });
    workerTask = worker.run();

    const branches = ['a', 'b', 'c', 'd'];
    const parallel = { ...workflow, settings: { processing_mode: 'parallel', max_parallel_nodes: 3 }, nodes: [node('input', 'trigger'),
      ...branches.map(label => node(`branch-${label}`, 'transform', { transformMapping: JSON.stringify({ branch: label, request: '$request.message' }) })),
      node('merge', 'aggregator', { mergeMode: 'waitAllAppend' }), node('output', 'output')],
      edges: [...branches.map(label => edge('input', `branch-${label}`)),
        ...['d', 'b', 'a', 'c'].map((label, index) => edge(`branch-${label}`, 'merge', { targetHandle: `input-${index + 1}` })), edge('merge', 'output')] };
    const parallelRun = await start(parallel, { message: 'Parallel scope' });
    const parallelFinal = await finish(parallelRun);
    assert.equal(parallelFinal.status, 'completed');
    assert.equal(maximumBranches, 3, 'Independent native activities must overlap up to the configured cap.');
    assert.deepEqual(parallelFinal.node_results.find(result => result.node_id === 'merge').output.data, ['d', 'b', 'a', 'c'].map(branch => ({ branch, request: 'Parallel scope' })));
    assert.ok(parallelFinal.node_results.every(result => result.status === 'completed'));
    for (const label of branches) assert.equal(dispatches.filter(item => item.run_id === parallelRun.id && item.node_id === `branch-${label}`).length, 1);
    const mergeDispatch = dispatches.findIndex(item => item.run_id === parallelRun.id && item.node_id === 'merge');
    assert.ok(branches.every(label => dispatches.findIndex(item => item.run_id === parallelRun.id && item.node_id === `branch-${label}`) < mergeDispatch));

    const loop = { ...workflow, settings: { processing_mode: 'parallel', max_parallel_nodes: 3 }, nodes: [node('input', 'trigger'),
      node('loop', 'loop', { loopAction: 'workflow', loopSourceKey: 'input.items', loopMaxIterations: 10, loopBatchSize: 2 }),
      node('body', 'transform', { transformMapping: '{"batch":"$item","number":"$iteration.number"}' }), node('output', 'output')],
      edges: [edge('input', 'loop'), edge('loop', 'body', { sourceHandle: 'loop' }), edge('body', 'loop', { targetHandle: 'continue' }), edge('loop', 'output', { sourceHandle: 'done' })] };
    const loopRun = await runtime.start(loop, { request_id: randomUUID(), input_payload: { items: [1, 2, 3, 4, 5] } }, user);
    loopRuns.set(loopRun.id, 'loop');
    await control.deliver(); await control.deliver();
    const loopFinal = await finish(loopRun);
    assert.equal(loopFinal.status, 'completed');
    assert.equal(lostLoopAcknowledgement, true);
    const loopResult = loopFinal.node_results.find(result => result.node_id === 'loop');
    const bodyResult = loopFinal.node_results.find(result => result.node_id === 'body');
    assert.deepEqual(loopResult.output.data, [{ batch: [1, 2], number: 1 }, { batch: [3, 4], number: 2 }, { batch: [5], number: 3 }]);
    assert.equal(loopResult.output.total_batches, 3);
    assert.equal(loopResult.output.processed, 5);
    assert.equal(bodyResult.iterations.length, 3, 'A lost acknowledgement restores the committed body results without rerunning batches.');
    assert.deepEqual(bodyResult.iterations.map(item => item.input_item_count), [2, 2, 1]);
    assert.equal((await db.prepare("SELECT COUNT(*)::int AS n FROM workflow_node_receipts WHERE run_id=? AND node_id='loop' AND state='recorded'").get(loopRun.id)).n, 1);
    assert.equal(dispatches.filter(item => item.run_id === loopRun.id && item.node_id === 'body').length, 0, 'Connected loop bodies execute within the single reserved loop activity.');

    const nested = { ...workflow, settings: { processing_mode: 'parallel', max_parallel_nodes: 3 }, nodes: [node('input', 'trigger'),
      node('outer', 'loop', { loopAction: 'workflow', loopSourceKey: 'input.items', loopMaxIterations: 10, loopBatchSize: 1 }),
      node('inner', 'loop', { loopAction: 'workflow', loopSourceKey: 'item.items', loopMaxIterations: 10, loopBatchSize: 2 }),
      node('worker', 'transform', { transformMapping: '{"batch":"$item","number":"$iteration.number"}' }),
      node('group', 'transform', { transformMapping: '{"values":"$input"}' }), node('output', 'output')], edges: [edge('input', 'outer'),
        edge('outer', 'inner', { sourceHandle: 'loop' }), edge('inner', 'worker', { sourceHandle: 'loop' }), edge('worker', 'inner', { targetHandle: 'continue' }),
        edge('inner', 'group', { sourceHandle: 'done' }), edge('group', 'outer', { targetHandle: 'continue' }), edge('outer', 'output', { sourceHandle: 'done' })] };
    const nestedRun = await start(nested, { items: [{ items: [1, 2, 3] }, { items: [4, 5, 6] }] }, 'outer');
    const nestedFinal = await finish(nestedRun);
    assert.equal(nestedFinal.status, 'completed');
    assert.equal(lostAcknowledgements.has(nestedRun.id), true, 'Nested loop composite acknowledgement was lost after its committed receipt.');
    const outerResult = nestedFinal.node_results.find(result => result.node_id === 'outer');
    const nestedWorker = nestedFinal.node_results.find(result => result.node_id === 'worker');
    assert.deepEqual(outerResult.output.data.map(item => item.values), [
      [{ batch: [1, 2], number: 1 }, { batch: [3], number: 2 }],
      [{ batch: [4, 5], number: 1 }, { batch: [6], number: 2 }],
    ]);
    assert.deepEqual(nestedWorker.iterations.map(item => item.iteration_path), [
      ['outer', 0, 'inner', 0], ['outer', 0, 'inner', 1], ['outer', 1, 'inner', 0], ['outer', 1, 'inner', 1],
    ], 'Nested iteration identities and all four committed worker results survive acknowledgement recovery.');
    assert.equal(outerResult.output.execution_usage.batches, 6);
    assert.equal(dispatches.filter(item => item.run_id === nestedRun.id && ['inner', 'worker', 'group'].includes(item.node_id)).length, 0, 'Nested bodies stay within the outer reserved composite activity.');

    const uncertainRun = await start(loop, { items: [1, 2, 3, 4, 5] }, undefined, 'loop');
    const uncertainFinal = await finish(uncertainRun);
    assert.equal(injectedFailures.has(uncertainRun.id), true);
    assert.equal(uncertainFinal.status, 'failed');
    const uncertainLoop = uncertainFinal.node_results.find(result => result.node_id === 'loop');
    const preservedBody = uncertainFinal.node_results.find(result => result.node_id === 'body');
    assert.equal(uncertainLoop.error_details.code, 'AGENT_ACTIVITY_OUTCOME_UNKNOWN');
    assert.equal(uncertainLoop.error_details.outcome_unknown, true);
    assert.equal(preservedBody.iterations.length, 3, 'A missing whole-loop receipt cannot erase already persisted batch results.');
    assert.deepEqual(preservedBody.iterations.map(item => item.output.data), [{ batch: [1, 2], number: 1 }, { batch: [3, 4], number: 2 }, { batch: [5], number: 3 }]);
    assert.equal(bodyDispatches.get(uncertainRun.id), 3, 'Recovery reads partial projections; it never reruns the uncertain loop body.');
    assert.equal(dispatches.filter(item => item.run_id === uncertainRun.id && item.node_id === 'output').length, 0);

    const cancellation = { ...workflow, settings: { processing_mode: 'parallel', max_parallel_nodes: 2 },
      nodes: [node('input', 'trigger'), node('wait', 'wait', { waitMs: 5000, timeoutMs: 10000 }), node('output', 'output')],
      edges: [edge('input', 'wait'), edge('wait', 'output')] };
    const cancelledRun = await start(cancellation, {});
    await until(() => runtime._internals.store.get(cancelledRun.id), run => run.node_results.some(result => result.node_id === 'wait' && result.status === 'running'), 'a running durable wait');
    await runtime.cancel(cancelledRun, user);
    await control.deliver(); await control.deliver();
    const cancelledFinal = await finish(cancelledRun);
    assert.equal(cancelledFinal.status, 'cancelled');
    assert.equal(dispatches.filter(item => item.run_id === cancelledRun.id && item.node_id === 'output').length, 0);
    assert.equal((await db.prepare('SELECT COUNT(*)::int AS n FROM llm_request_traces WHERE run_id IN (?,?,?,?,?)').get(parallelRun.id, loopRun.id, nestedRun.id, uncertainRun.id, cancelledRun.id)).n, 0, 'Pure control/data workflows do not invoke a provider.');
    return { parallel_overlap: maximumBranches, ordered_fan_in: true, loop_batches: 3, nested_batches: 6, loop_ack_recovery: true, nested_ack_recovery: true, uncertain_loop_preserved_without_replay: true, cancellation: true, replay: true };
  } catch (error) { originalError = error; throw error; }
  finally {
    const failures = [];
    if (worker) { try { worker.shutdown(); } catch (error) { failures.push(error); } }
    if (workerTask) { try { await workerTask; } catch (error) { failures.push(error); } }
    db.prepare = originalPrepare;
    operations.execute = originalExecute;
    try { await control.close(); } catch (error) { failures.push(error); }
    if (previousAddress === undefined) delete process.env.TEMPORAL_ADDRESS; else process.env.TEMPORAL_ADDRESS = previousAddress;
    if (previousQueue === undefined) delete process.env.TEMPORAL_TASK_QUEUE; else process.env.TEMPORAL_TASK_QUEUE = previousQueue;
    try { await environment.teardown(); } catch (error) { failures.push(error); }
    if (!originalError && failures.length) throw new AggregateError(failures, 'Temporal fixture cleanup failed.');
  }
};
