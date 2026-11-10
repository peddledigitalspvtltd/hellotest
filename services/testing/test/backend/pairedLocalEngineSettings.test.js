const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const dispatch = require('@hellotest/automation/backend/services/testEngineDispatch.service');
const workspace = require('@hellotest/platform/backend/services/workspaceTransaction.service');
const db = require('@hellotest/platform/backend/src/db');
const obs = require('@hellotest/platform/backend/src/obsDb');
test.after(() => Promise.all([db.close(), obs.close()]));

function fixture(t, integration) {
  const filename = require.resolve('../../backend/services/execution.service');
  const source = fs.readFileSync(filename, 'utf8');
  const prepare = source.slice(source.indexOf('exports.preparePairedLocalExecution ='), source.indexOf('\nexports.getExecutions ='));
  const localRequire = createRequire(filename), calls = [], transactions = [];
  const execution = { id: 'run', project_id: 'project', app_type_id: 'app', status: 'queued', case_snapshots: [], step_snapshots: [] };
  const caseSnapshot = { test_case_id: 'case', test_case_title: 'Slow application' };
  const plan = { execution, project: { id: 'project', name: 'Project' }, appType: { id: 'app', type: 'web' },
    automated_case_count: 1, manual_case_count: 0, unsupported_automated_case_count: 0, warnings: [],
    eligibleCases: [{ engine_run_id: 'engine-case', case_snapshot: caseSnapshot, steps: [{ id: 'step', order: 1, step_type: 'web', action: 'Wait for ready UI', automation_code: 'await expect(page.locator("#ready")).toBeVisible();' }] }] };
  t.mock.method(obs.pool, 'query', async () => ({ rows: [], rowCount: 0 }));
  t.mock.method(workspace, 'createTransaction', async input => { transactions.push(input); return { ...input, id: 'transaction' }; });
  t.mock.method(workspace, 'appendTransactionEvent', async () => {});
  t.mock.method(require('@hellotest/platform/backend/services/aiConfiguration.service'), 'resolve', async () => ({ config: { instruction_blocks: {
    'engineRepair.goal': 'Retain behavior', 'engineRepair.screen_selection': 'Use observed UI', 'engineRepair.correction_policy': 'Do not replay actions'
  } } }));
  t.mock.method(dispatch, 'planExecutionDispatch', async input => { assert.equal(input, execution); return plan; });
  t.mock.method(globalThis, 'fetch', () => assert.fail('Paired local preparation must not connect to a remote or loopback engine'));
  let prepared;
  const paired = { security: { fail: message => new Error(message) }, prepare: async input => {
    assert.equal(input.user.id, 'actor');
    prepared = await dispatch.preparePairedLocalDispatch({ ...input, plan: await input.plan(), initiatedBy: input.user.id, pairedDispatchId: 'dispatch',
      callbackFor: item => ({ url: 'https://application.test/api/testengine/callbacks/runs', signing_secret: `scoped-${item.engine_run_id}` }) });
    return { id: execution.id, started: true, execution_mode: 'local' };
  } };
  const exports = { getExecution: async id => { assert.equal(id, execution.id); return execution; } };
  const executionCache = new Map([['run', 'stale']]);
  new Function('exports', 'require', 'integrationService', 'loadExecutionRuntimeContext', 'testEngineDispatchService', 'assertExecutableDispatchPlan', 'executionCache', prepare)(
    exports, id => id === '@hellotest/automation/backend/services/pairedLocalExecution.service' ? paired : localRequire(id),
    { getActiveIntegrationByTypeForProject: async (...args) => { calls.push(args); return integration; } }, async value => value,
    dispatch, value => assert.equal(value.unsupported_automated_case_count, 0), executionCache
  );
  return { run: () => exports.preparePairedLocalExecution('run', { initiated_by: 'actor', local_agent_id: 'agent', paired_origin: 'https://application.test' }),
    calls, transactions, executionCache, envelope: () => prepared.envelopes[0] };
}

test('paired preparation inherits effective engine waits and evidence settings into the actual local envelope', async t => {
  const f = fixture(t, { id: 'global-engine', project_id: null, base_url: 'https://remote-engine.invalid', api_key: 'REMOTE_PRIVATE_API_KEY', config: {
    navigation_timeout_ms: 120000, action_timeout_ms: 15000, assertion_timeout_ms: 45000, recovery_wait_ms: 1200,
    domcontentloaded_wait_ms: 11000, network_idle_wait_ms: 2500, run_timeout_seconds: 2400,
    screenshot_mode: 'failed', screenshot_on_failure: true, screenshot_on_success: false, capture_console: false, capture_network: false,
    trace_mode: 'on', video_mode: 'off', artifact_retention_days: 14, max_video_attachment_mb: 9,
    active_web_engine: 'selenium', headless: true, healing_enabled: true, max_repair_attempts: 3,
    web_session_mode: 'reuse', web_session_reuse_key: 'remote-session', connect_over_cdp_endpoint: 'https://remote-engine.invalid/cdp',
    shared_secret: 'REMOTE_PRIVATE_SHARED_SECRET', callback_secret: 'REMOTE_PRIVATE_CALLBACK_SECRET'
  } });
  await f.run();
  assert.deepEqual(f.calls, [['testengine', 'project']]);
  const envelope = f.envelope();
  assert.deepEqual(envelope.timeouts, { navigation_timeout_ms: 120000, action_timeout_ms: 15000, assertion_timeout_ms: 45000, recovery_wait_ms: 1200, domcontentloaded_wait_ms: 11000, network_idle_wait_ms: 2500 });
  assert.equal(envelope.run_timeout_seconds, 2400);
  assert.equal(envelope.artifact_policy.screenshot_mode, 'failed'); assert.equal(envelope.artifact_policy.capture_console, false); assert.equal(envelope.artifact_policy.capture_network, false);
  assert.equal(envelope.artifact_policy.trace_mode, 'on'); assert.equal(envelope.artifact_policy.video_mode, 'off'); assert.equal(envelope.artifact_policy.artifact_retention_days, 14); assert.equal(envelope.artifact_policy.max_video_attachment_mb, 9);
  assert.equal(envelope.web_engine.active, 'playwright'); assert.equal(envelope.headless, false); assert.equal(envelope.max_repair_attempts, 0);
  assert.equal(envelope.session_policy.web.mode, 'new'); assert.equal(envelope.session_policy.web.reuse_key, null); assert.equal(envelope.session_policy.web.connect_over_cdp_endpoint, null);
  assert.equal(envelope.callback.signing_secret, 'scoped-engine-case');
  assert.doesNotMatch(JSON.stringify({ envelope, transactions: f.transactions }), /REMOTE_PRIVATE_|remote-session|remote-engine\.invalid/);
  assert.equal(f.executionCache.has('run'), false);
});

test('paired local preparation remains available without any remote engine integration', async t => {
  const f = fixture(t, null); await f.run();
  const envelope = f.envelope();
  assert.equal(envelope.timeouts.navigation_timeout_ms, 30000); assert.equal(envelope.timeouts.action_timeout_ms, 5000); assert.equal(envelope.timeouts.assertion_timeout_ms, 10000);
  assert.equal(envelope.headless, false); assert.equal(envelope.web_engine.active, 'playwright'); assert.equal(envelope.max_repair_attempts, 0);
  assert.equal(envelope.artifact_policy.trace_mode, 'retain-on-failure'); assert.equal(envelope.artifact_policy.video_mode, 'retain-on-failure');
  assert.equal(envelope.callback.signing_secret, 'scoped-engine-case');
});
