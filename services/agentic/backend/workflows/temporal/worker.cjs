const { Worker, NativeConnection } = require('@temporalio/worker');
const db = require('@hellotest/platform/backend/src/db');
const obsDb = require('@hellotest/platform/backend/src/obsDb');
const control = require('./control');
const { workerFailure } = require('./workerFailure');
let phase = 'configuration';
async function main() {
  let connection, mcp, worker, delivery, stopping = false;
  const shutdown = () => { if (!stopping && worker) { stopping = true; worker.shutdown(); } };
  try {
    if (!control.enabled()) throw new Error('Set TEMPORAL_ADDRESS before starting the durable agent worker.');
    const { verifySchema } = require('@hellotest/platform/backend/src/db/schemaReadiness');
    phase = 'main_schema'; await verifySchema(db, 'main');
    phase = 'observability_schema'; await verifySchema(obsDb, 'observability');
    process.env.HELLOTEST_MCP_INTERNAL_URL ||= process.env.HELLOTEST_MCP_PUBLIC_URL || 'http://api:3000/mcp';
    phase = 'mcp_initialization'; mcp = require('@hellotest/mcp/backend/server');
    phase = 'temporal_connection'; connection = await NativeConnection.connect(require('./connection').connectionOptions());
    phase = 'worker_initialization'; worker = await Worker.create({ connection, namespace: process.env.TEMPORAL_NAMESPACE || 'default', taskQueue: control.queue(),
      workflowsPath: require.resolve('./workflows'), activities: require('./activities'), maxConcurrentActivityTaskExecutions: 2,
      maxConcurrentWorkflowTaskExecutions: 10, shutdownGraceTime: '20 seconds' });
    process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
    delivery = setInterval(() => Promise.all([control.deliver(), require('../../services/workflowTriggers.service').processPending()]).catch(() => process.stderr.write('Workflow command delivery unavailable.\n')), 2000);
    phase = 'running';
    const task = worker.run();
    await control.deliver().catch(() => process.stderr.write('Workflow command delivery unavailable.\n'));
    await task;
  } finally {
    clearInterval(delivery);
    process.removeListener('SIGINT', shutdown); process.removeListener('SIGTERM', shutdown);
    await Promise.allSettled([() => control.close(), () => mcp?.handler.close(), () => connection?.close(), () => db.close(), () => obsDb.close()].map(close => Promise.resolve().then(close)));
  }
}
main().catch(error => { process.stderr.write(JSON.stringify(workerFailure(error, phase)) + '\n'); process.exitCode = 1; });
