const assert = require('node:assert/strict');
const { TestWorkflowEnvironment } = require('@temporalio/testing');
const { Worker } = require('@temporalio/worker');
const { randomUUID } = require('node:crypto');

exports.run = async ({ db, workflow, user, payload }) => {
  const environment = await TestWorkflowEnvironment.createLocal();
  const previousAddress = process.env.TEMPORAL_ADDRESS;
  process.env.TEMPORAL_ADDRESS = environment.address;
  const control = require('../../backend/workflows/temporal/control');
  const activities = require('../../backend/workflows/temporal/activities');
  const runtime = require('../../backend/services/agenticWorkflowExecution.service');
  const workflowsPath = require.resolve('../../backend/workflows/temporal/workflows');
  let worker, task;
  try {
    let lostAcknowledgement = false;
    worker = await Worker.create({ connection:environment.nativeConnection, taskQueue:control.queue(), workflowsPath,
      activities:{ ...activities, executeReviewNode:async input => {
        const result = await activities.executeReviewNode(input);
        if (input.nodeId === 'review' && !lostAcknowledgement) { lostAcknowledgement=true; throw new Error('Simulated lost acknowledgement after receipt commit'); }
        return result;
      } } });
    task = worker.run();
    const run = await runtime.start(workflow,{request_id:`durable-${randomUUID()}`,input_payload:payload},user);
    assert.equal(run.workflow_snapshot.runtime_contract.orchestrator,'temporal');
    assert.equal((await db.prepare('SELECT COUNT(*)::int AS n FROM workflow_delivery_outbox WHERE run_id=?').get(run.id)).n,1);
    await control.deliver(); await control.deliver();
    const handle = environment.client.workflow.getHandle(control.workflowId(run.id));
    await handle.result();
    assert.equal(lostAcknowledgement,true);
    const finished = await runtime._internals.store.get(run.id);
    assert.ok(['completed','needs_review'].includes(finished.status),JSON.stringify(finished));
    assert.equal(finished.node_results.find(item=>item.node_id==='review').attempts,1,'Lost acknowledgements must not dispatch the model twice');
    const rows = await db.prepare('SELECT * FROM workflow_node_receipts WHERE run_id=?').all(run.id);
    assert.equal(rows.length,3); assert.ok(rows.every(row=>row.state==='recorded'));
    const traceCount = await db.prepare('SELECT COUNT(*)::int AS n FROM llm_request_traces WHERE run_id=?').get(run.id);
    assert.equal(traceCount.n,1,'Recovery must preserve the original model budget');
    await Worker.runReplayHistory({ workflowsPath },await handle.fetchHistory());
    worker.shutdown(); await task; worker=null; task=null;
    // A run can be accepted without an activity worker. Cancellation remains a
    // durable Temporal command, then publishes when a new worker starts.
    const stopped = await runtime.start(workflow,{input_payload:payload},user);
    await runtime.cancel(stopped,user);
    await control.deliver(); await control.deliver();
    worker=await Worker.create({connection:environment.nativeConnection,taskQueue:control.queue(),workflowsPath,activities});
    task=worker.run();
    await environment.client.workflow.getHandle(control.workflowId(stopped.id)).result();
    assert.equal((await runtime._internals.store.get(stopped.id)).status,'cancelled');
    assert.equal((await db.prepare('SELECT COUNT(*)::int AS n FROM llm_request_traces WHERE run_id=?').get(stopped.id)).n,0);
  } finally {
    if(worker) worker.shutdown(); if(task) await task;
    await control.close();
    if(previousAddress==null) delete process.env.TEMPORAL_ADDRESS; else process.env.TEMPORAL_ADDRESS=previousAddress;
    await environment.teardown();
  }
};
