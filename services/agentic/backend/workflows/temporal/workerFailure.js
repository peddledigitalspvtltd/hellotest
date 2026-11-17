const PHASES = new Set(['configuration', 'main_schema', 'observability_schema', 'mcp_initialization', 'temporal_connection', 'worker_initialization', 'running']);
const HINTS = {
  configuration: 'Configure the durable Temporal connection before starting this worker.',
  main_schema: 'Run the additive main database migration and verify database connectivity.',
  observability_schema: 'Run the additive observability migration and verify database connectivity.',
  mcp_initialization: 'Verify the worker runtime mode and shared API credential configuration.',
  temporal_connection: 'Verify the Temporal address, namespace, TLS and authentication configuration.',
  worker_initialization: 'Verify the workflow bundle, registered activities and Temporal worker configuration.',
  running: 'Review the durable runtime health and retained workflow receipts before restarting.'
};

// Errors can contain credential-bearing URLs, provider bodies or arbitrary
// server text. Publish only the known stage, bounded identifiers and static
// remediation; the failure is useful without copying its private message.
function workerFailure(error, phase) {
  const stage = PHASES.has(phase) ? phase : 'configuration';
  const codes = new Set(['SCHEMA_MIGRATION_REQUIRED', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'EACCES', 'EPERM', 'EADDRINUSE', 'MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND', 'ERR_DLOPEN_FAILED']);
  const kinds = new Set(['Error', 'TypeError', 'RangeError', 'AggregateError', 'TransportError', 'ServiceError', 'ConnectionError', 'IllegalStateError']);
  const secretConfiguration = /^(?:SESSION_SECRET|Test Engine shared secret|Mobile Engine shared secret) (?:is required when NODE_ENV=production|must be a non-default secret of at least \d+ characters in production)$/.test(String(error?.message || ''));
  return {
    event: 'agent_worker_stopped',
    phase: stage,
    code: secretConfiguration ? 'RUNTIME_SECRET_CONFIGURATION_INVALID' : (codes.has(error?.code) ? error.code : 'DURABLE_WORKER_FAILED'),
    kind: kinds.has(error?.name) ? error.name : 'Error',
    hint: secretConfiguration ? 'Use production-grade shared credentials in production, or the explicit development overlay for a local runtime. Preserve existing encryption keys.' : HINTS[stage]
  };
}
module.exports = { workerFailure };
