const message = 'Configure Temporal and its durable worker for workflow execution. For a development-only manual queue, explicitly enable WORKFLOW_ALLOW_LOCAL_FALLBACK=true.';

function executionRuntimePolicy({ durable = false, env = process.env } = {}) {
  if (durable) return { available: true, mode: 'temporal', durable: true };
  const appMode = String(env.APP_MODE || '').trim().toLowerCase();
  const nodeMode = String(env.NODE_ENV || '').trim().toLowerCase();
  const local = appMode === 'local' || ['test', 'development'].includes(nodeMode)
    || String(env.WORKFLOW_ALLOW_LOCAL_FALLBACK || '').trim().toLowerCase() === 'true';
  return local ? { available: true, mode: 'development_fifo', durable: false }
    : { available: false, mode: 'unavailable', durable: false, code: 'WORKFLOW_DURABLE_RUNTIME_REQUIRED', message };
}
function assertExecutionRuntime(input) {
  const state = executionRuntimePolicy(input);
  if (!state.available) throw Object.assign(new Error(state.message), { code: state.code, statusCode: 503, publicMessage: state.message });
  return state;
}
module.exports = { executionRuntimePolicy, assertExecutionRuntime };
