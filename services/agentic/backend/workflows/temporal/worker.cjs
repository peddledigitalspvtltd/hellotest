const { Worker, NativeConnection } = require('@temporalio/worker');
const db = require('@hellotest/platform/backend/src/db');
const obsDb = require('@hellotest/platform/backend/src/obsDb');
const control = require('./control');
async function main() {
  if (!control.enabled()) throw new Error('Set TEMPORAL_ADDRESS before starting the durable agent worker.');
  await require('@hellotest/platform/backend/src/db/schemaReadiness').verifySchema(db,'main');
  process.env.HELLOTEST_MCP_INTERNAL_URL ||= process.env.HELLOTEST_MCP_PUBLIC_URL || 'http://api:3000/mcp';
  const mcp = require('@hellotest/mcp/backend/server');
  const connection = await NativeConnection.connect(require('./connection').connectionOptions());
  const worker = await Worker.create({ connection, namespace:process.env.TEMPORAL_NAMESPACE || 'default', taskQueue:control.queue(),
    workflowsPath:require.resolve('./workflows'), activities:require('./activities'), maxConcurrentActivityTaskExecutions:2,
    maxConcurrentWorkflowTaskExecutions:10, shutdownGraceTime:'20 seconds' });
  let stopping = false;
  const shutdown = () => { if (!stopping) { stopping=true; worker.shutdown(); } };
  process.once('SIGINT',shutdown); process.once('SIGTERM',shutdown);
  const delivery = setInterval(() => control.deliver().catch(() => process.stderr.write('Workflow command delivery unavailable.\n')),2000);
  try { const task=worker.run(); await control.deliver().catch(() => process.stderr.write('Workflow command delivery unavailable.\n')); await task; }
  finally { clearInterval(delivery); process.removeListener('SIGINT',shutdown); process.removeListener('SIGTERM',shutdown); await control.close(); await mcp.handler.close(); await connection.close(); await Promise.allSettled([db.close(),obsDb.close()]); }
}
main().catch(error => { process.stderr.write(`Agent worker stopped: ${error.code || error.name}\n`); process.exitCode=1; });
