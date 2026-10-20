const { randomUUID } = require('node:crypto');
const { readBoundedResponseJson } = require('@hellotest/platform/backend/src/utils/boundedResponse');
const { resolveTestEngineSecret } = require('@hellotest/platform/backend/src/security/runtimeSecrets');

// Direct dispatch can spend up to 60 seconds waiting for its acknowledgement.
// A missing receipt during that window is not proof that execution was lost.
const MIN_SETTLED_DISPATCH_MS = 120000;
const LOCAL_RUNNERS = new Set(['localhost', '127.0.0.1', '[::1]', 'host.docker.internal', 'hellotest-local-testengine', 'testengine']);
const FINAL_STATES = new Set(['completed', 'failed', 'incident']);

exports.inspectDirectRun = async (transaction, { deadline = Date.now() + 2500 } = {}) => {
  const metadata = transaction.metadata || {};
  if (metadata.source !== 'hellotest.local-run' || metadata.queue_mode !== 'direct-local'
    || !metadata.engine_run_id || transaction.related_id !== metadata.engine_run_id
    || !metadata.execution_id || !metadata.test_case_id
    || !Number.isFinite(Date.parse(transaction.started_at || transaction.created_at))
    || Date.now() - Date.parse(transaction.started_at || transaction.created_at) < MIN_SETTLED_DISPATCH_MS) return null;
  let runner;
  try { runner = new URL(metadata.engine_host); } catch { return null; }
  if (!['http:', 'https:'].includes(runner.protocol) || !LOCAL_RUNNERS.has(runner.hostname)
    || runner.username || runner.password || runner.search || runner.hash || !['', '/'].includes(runner.pathname)) return null;
  const request = async (pathname, secret) => {
    const remaining = Math.min(2500, deadline - Date.now());
    if (remaining <= 0) throw new Error('Reconciliation deadline reached');
    const response = await fetch(new URL(pathname, runner), {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(remaining),
      headers: secret ? { accept: 'application/json', 'x-hellotest-testengine-secret': secret } : { accept: 'application/json' }
    });
    const body = await readBoundedResponseJson(response, { maxBytes: 256 * 1024, label: 'Test Engine status response' });
    return { response, body };
  };
  try {
    const live = await request('/health/live');
    if (!live.response.ok || live.body?.ok !== true || live.body?.status !== 'live' || live.body?.ui !== 'hellotest') return null;
    const resource = `/api/v1/runs/${encodeURIComponent(metadata.engine_run_id)}`;
    // A proxy's generic 404 must not be mistaken for an authenticated runner
    // proving an attempt is absent. Verify the actual privileged-route guard.
    const challenge = await request(resource, `invalid-reconciliation-${randomUUID()}`);
    if (challenge.response.status !== 401 || !challenge.response.headers.get('www-authenticate')?.includes('hellotest-testengine')) return null;
    const status = await request(resource, resolveTestEngineSecret());
    if (status.response.status === 404 && status.body?.message === 'Run not found') {
      return { outcome: 'abandoned', runner_state: 'missing', verified_at: new Date().toISOString() };
    }
    if (!status.response.ok || status.body?.id !== metadata.engine_run_id
      || (status.body.hellotest_execution_id || status.body.hellotest_run_id) !== metadata.execution_id
      || status.body.hellotest_test_case_id !== metadata.test_case_id || !FINAL_STATES.has(status.body.state)) return null;
    return { outcome: 'finished', runner_state: status.body.state, verified_at: new Date().toISOString() };
  } catch {
    // Authentication, connectivity, response bounds and malformed state remain
    // protected as busy. Never infer inactivity from an unavailable runner.
    return null;
  }
};
