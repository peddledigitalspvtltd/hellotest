// The outbox delivers commands only. Temporal owns workflow scheduling and state.
const db = require('@hellotest/platform/backend/src/db');
const enabled = () => Boolean(process.env.TEMPORAL_ADDRESS);
const queue = () => process.env.TEMPORAL_TASK_QUEUE || 'hellotest-agentic-v1';
const workflowId = id => `hellotest-review-${id}`;
let connectionPromise;
let delivering = false;
async function client() {
  if (!connectionPromise) connectionPromise = (async () => {
    const { Connection, Client } = require('@temporalio/client');
    const { connectionOptions } = require('./connection');
    const connection = await Connection.connect(connectionOptions());
    return { connection, client: new Client({ connection, namespace: process.env.TEMPORAL_NAMESPACE || 'default' }) };
  })().catch(error => { connectionPromise = null; throw error; });
  return (await connectionPromise).client;
}
async function enqueue(run, insert) {
  return db.transaction(async () => {
    await db.query("SET LOCAL statement_timeout = '5s'");
    if (!await insert()) return false;
    const graph = run.workflow_snapshot;
    const bodies = require('@hellotest/platform/backend/src/utils/agenticWorkflowGraph').loopBodies(graph.nodes, graph.edges);
    const payload = { runId: run.id, deadline: graph.runtime_contract.deadline_at, scheduler_version: 2, processing: graph.runtime_contract.processing,
      nodes: graph.execution_order.map(id => {
        const node = graph.nodes.find(item => item.id === id);
        return { id, kind: node.data.kind, onError: node.data.onError || 'stop', exclusive: require('../workflowScheduling').exclusive(node), ...(bodies[id] ? { body_ids: bodies[id] } : {}) };
      }), edges: graph.edges.map(({ source, target, sourceHandle, targetHandle }) => ({ source, target, sourceHandle, targetHandle })) };
    await db.prepare(`INSERT INTO workflow_delivery_outbox(id,project_id,run_id,command,payload) VALUES(?,?,?,'start',?) ON CONFLICT(id) DO NOTHING`)
      .run(`start:${run.id}`, run.project_id, run.id, payload);
    return true;
  })();
}
async function cancel(run) {
  await db.prepare(`INSERT INTO workflow_delivery_outbox(id,project_id,run_id,command,payload) VALUES(?,?,?,'cancel','{}') ON CONFLICT(id) DO NOTHING`)
    .run(`cancel:${run.id}`, run.project_id, run.id);
}
async function deliver() {
  if (!enabled() || delivering) return;
  delivering = true;
  try {
    const rows = await db.prepare(`SELECT * FROM workflow_delivery_outbox WHERE delivered_at IS NULL AND next_attempt_at <= CURRENT_TIMESTAMP ORDER BY created_at,command DESC LIMIT 10`).all();
    if (!rows.length) return;
    const temporal = await client();
    for (const row of rows) {
      try {
        if (row.command === 'start') {
          try {
            await temporal.workflow.start('reviewWorkflow', { workflowId: workflowId(row.run_id), taskQueue: queue(), args: [row.payload],
              workflowIdReusePolicy: 'REJECT_DUPLICATE' });
          } catch (error) { if (error.name !== 'WorkflowExecutionAlreadyStartedError') throw error; }
        } else {
          const start = await db.prepare(`SELECT delivered_at FROM workflow_delivery_outbox WHERE id=?`).get(`start:${row.run_id}`);
          if (!start?.delivered_at) continue;
          const handle = temporal.workflow.getHandle(workflowId(row.run_id));
          try { await handle.cancel(); }
          catch (error) {
            const description = await handle.describe();
            if (description.status.name === 'RUNNING') throw error;
          }
        }
        await db.prepare('UPDATE workflow_delivery_outbox SET delivered_at=CURRENT_TIMESTAMP,last_error=NULL WHERE id=?').run(row.id);
      } catch (error) {
        // Payloads, endpoints, credentials and provider errors never enter delivery logs.
        await db.prepare(`UPDATE workflow_delivery_outbox SET attempts=attempts+1,last_error=?,next_attempt_at=CURRENT_TIMESTAMP+INTERVAL '5 seconds' WHERE id=?`)
          .run(error.name === 'ServiceError' ? 'TEMPORAL_UNAVAILABLE' : 'TEMPORAL_DELIVERY_FAILED', row.id);
      }
    }
  } finally { delivering = false; }
}
async function close() { const state = await connectionPromise?.catch(() => null); await state?.connection.close(); connectionPromise = null; }
module.exports = { enabled, queue, enqueue, cancel, deliver, close, workflowId };
