const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('@hellotest/platform/backend/src/db');
const obs = require('@hellotest/platform/backend/src/obsDb');
const runs = require('@hellotest/testing/backend/services/execution.service');
const dispatch = require('../../backend/services/testEngineDispatch.service');
const integrations = require('@hellotest/integration/backend/services/integration.service');
const mobile = require('@hellotest/platform/backend/services/mobileFeature.service');
const telemetry = require('@hellotest/trace/backend/services/opsTelemetry.service');
test.after(() => Promise.all([db.close(), obs.close()]));

function fixture(t, { mode = 'remote', unsupported = 0, eligible = 1 } = {}) {
  const writes = [];
  t.mock.method(db.pool, 'query', async query => {
    const sql = typeof query === 'string' ? query : query.text;
    writes.push(sql);
    return { rows: [], rowCount: 1 };
  });
  t.mock.method(runs, 'getExecution', async () => ({ id: 'run', project_id: 'p', status: 'queued', trigger: mode === 'manual' ? 'manual' : 'ci', revision: 1 }));
  t.mock.method(mobile, 'assertExecutionMobileFeatureEnabled', async () => {});
  const plan = t.mock.method(dispatch, 'planExecutionDispatch', async () => ({
    eligible_automated_case_count: eligible, unsupported_automated_case_count: unsupported,
    manual_case_count: 0, warnings: unsupported ? ['Case A: Step 1 needs an executable assertion.'] : []
  }));
  const integration = t.mock.method(integrations, 'getActiveIntegrationByTypeForProject', async () => ({ id: 'engine', config: {} }));
  const queued = t.mock.method(dispatch, 'queueExecutionDispatch', async () => ({ queued_for_engine_count: eligible }));
  const local = t.mock.method(dispatch, 'runExecutionDirectLocal', async () => ({ local_run_count: eligible }));
  t.mock.method(telemetry, 'emitExecutionHierarchyEvents', async () => {});
  return { writes, plan, integration, queued, local };
}

for (const mode of ['local', 'remote']) for (const eligible of [0, 1]) test(`${mode} refuses incomplete automation before starting or dispatching a run (${eligible} other runnable cases)`, async t => {
  const f = fixture(t, { mode, unsupported: 1, eligible });
  await assert.rejects(runs.startExecution('run', { execution_mode: mode }), error => error.code === 'AUTOMATION_NOT_EXECUTABLE'
    && error.statusCode === 409 && /executable assertion/.test(error.message));
  assert.equal(f.writes.some(sql => /SET status = 'running'/.test(sql)), false);
  assert.equal(f.integration.mock.callCount(), 0);
  assert.equal(f.queued.mock.callCount(), 0);
  assert.equal(f.local.mock.callCount(), 0);
});

test('a complete remote plan starts once and queues the selected automation', async t => {
  const f = fixture(t);
  const result = await runs.startExecution('run', { execution_mode: 'remote' });
  assert.equal(result.started, true);
  assert.equal(result.queued_for_engine_count, 1);
  assert.equal(f.queued.mock.callCount(), 1);
  assert.equal(f.writes.filter(sql => /SET status = 'running'/.test(sql)).length, 1);
});

test('manual runs retain their manual start behavior without calling the automation planner', async t => {
  const f = fixture(t, { mode: 'manual', unsupported: 1 });
  assert.equal((await runs.startExecution('run')).started, true);
  assert.equal(f.plan.mock.callCount(), 0);
  assert.equal(f.queued.mock.callCount(), 0);
});

function dispatchFixture(t, step, options = { automation_case_type: 'api' }) {
  t.mock.method(db.pool, 'query', async query => {
    const sql = typeof query === 'string' ? query : query.text;
    const rows = /FROM projects/.test(sql) ? [{ id: 'p' }]
      : /FROM app_types/.test(sql) ? [{ id: 'app', type: 'web' }]
        : /FROM test_cases/.test(sql) ? [{ id: 'case', automated: 'yes', automation_status: 'ready', test_data_options: { automation_case_type: 'web' } }] : [];
    return { rows, rowCount: rows.length };
  });
  return {
    project_id: 'p', app_type_id: 'app',
    case_snapshots: [{ test_case_id: 'case', test_case_title: 'Frozen API case', automated: 'yes', test_data_options: options }],
    step_snapshots: [{ test_case_id: 'case', snapshot_step_id: 'step', step_order: 1, ...step }]
  };
}

test('dispatch uses the frozen API case type inside a Web application and keeps parameter references', async t => {
  const execution = dispatchFixture(t, { step_type: 'web', action: 'GET @t.base_url/health', expected_result: 'HTTP 200', api_request: {
    method: 'GET', url: '@t.base_url/health', validations: [{ kind: 'status', expected: '200' }]
  } });
  const plan = await dispatch.planExecutionDispatch(execution);
  assert.equal(plan.eligibleCases.length, 1);
  assert.equal(plan.eligibleCases[0].steps[0].step_type, 'api');
  assert.equal(plan.eligibleCases[0].steps[0].api_request.url, '@t.base_url/health');
  assert.equal(execution.step_snapshots[0].step_type, 'web', 'Legacy inference does not mutate a frozen snapshot.');
});

test('an API case cannot dispatch saved browser code even if its application is Web', async t => {
  const execution = dispatchFixture(t, { step_type: 'web', action: 'Click Save', automation_code: 'await page.locator("button").click();' });
  await assert.rejects(dispatch.planExecutionDispatch(execution), { code: 'AUTOMATION_CASE_TYPE_MISMATCH' });
});

test('invalid authored API fields cannot become runnable through permissive normalization', async t => {
  const execution = dispatchFixture(t, { step_type: 'api', action: 'Fetch orders', expected_result: 'HTTP 200', api_request: {
    method: 'FETCH', url: '/orders', validations: [{ kind: 'status', expected: '200' }]
  } });
  const plan = await dispatch.planExecutionDispatch(execution);
  assert.equal(plan.eligibleCases.length, 0);
  assert.equal(plan.unsupported_automated_case_count, 1);
  assert.ok(plan.warnings.some(message => /supported method/.test(message)));
});

test('unsupported step runtimes are rejected rather than inferred as Web', async t => {
  const execution = dispatchFixture(t, { step_type: 'browser-ish', action: 'Open workspace' }, { automation_case_type: 'unified' });
  await assert.rejects(dispatch.planExecutionDispatch(execution), { code: 'AUTOMATION_STEP_TYPE_INVALID' });
});

for (const local of [false, true]) test(`manual cases retain manual dispatch classification with stale automation-only metadata (local ${local})`, async t => {
  const execution = dispatchFixture(t, { step_type: 'legacy-manual', action: 'Inspect the document manually' }, { automation_case_type: 'retired-platform' });
  execution.case_snapshots[0].automated = 'no';
  const plan = await dispatch.planExecutionDispatch(execution, { allowApiCasesWithoutAutomation: local });
  assert.equal(plan.manual_case_count, 1);
  assert.equal(plan.unsupported_automated_case_count, 0);
  assert.equal(plan.eligibleCases.length, 0);
});
