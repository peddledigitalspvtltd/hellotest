const test = require('node:test');
const assert = require('node:assert/strict');
const dispatch = require('../../backend/services/testEngineDispatch.service');
const obsDb = require('@hellotest/platform/backend/src/obsDb');
const db = require('@hellotest/platform/backend/src/db');
const resultService = require('@hellotest/testing/backend/services/executionResult.service');
const workspace = require('@hellotest/platform/backend/services/workspaceTransaction.service');
const telemetry = require('@hellotest/trace/backend/services/opsTelemetry.service');
const api = require('../../backend/services/apiRequestExecution.service');

test.after(() => Promise.all([db.close(), obsDb.close()]));

// Exercise the real PostgreSQL transaction adapter and service, replacing only
// its connection port. This models row-lock ordering without a customer DB.
function fixture(t, { statuses = { one: 'passed', two: 'passed' }, notes = {}, iteration = 1 } = {}) {
  const job = {
    id: 'job', execution_id: 'run', test_case_id: 'case', app_type_id: 'app',
    test_case_title: 'Checkout', transaction_id: 'transaction', status: 'running',
    started_at: new Date(Date.now() - 500).toISOString(), created_by: 'owner',
    payload: { parameter_scope_default: 't', data_set: { id: 'data', name: 'Customers', mode: 'table', rows: [{ email: 'row-two' }], iteration: { index: iteration } },
      steps: [{ id: 'one', order: 1, step_type: 'web' }, { id: 'two', order: 2, step_type: 'api' }] },
    runtime_state: { logs: { stepStatuses: statuses, stepNotes: notes, stepCaptures: { one: { 't.receipt': 'saved' } } } }
  };
  let previousLock = Promise.resolve();
  let storedResult = null;
  const writes = [], events = [], artifacts = [], resultWrites = [], reads = [];
  t.mock.method(obsDb.pool, 'query', async () => { throw new Error('Job mutations must use the transaction connection.'); });
  t.mock.method(obsDb.pool, 'connect', async () => {
    let releaseLock = null;
    return {
      release() {},
      async query(statement, params) {
        const text = typeof statement === 'string' ? statement : statement.text;
        const values = typeof statement === 'string' ? params || [] : statement.values || [];
        if (text === 'BEGIN') return { rows: [] };
        if (text === 'COMMIT' || text === 'ROLLBACK') { releaseLock?.(); return { rows: [] }; }
        if (/SELECT id FROM test_engine_jobs.*FOR UPDATE/s.test(text)) {
          const wait = previousLock;
          previousLock = new Promise(resolve => { releaseLock = resolve; });
          await wait;
          return { rows: [{ id: job.id }] };
        }
        if (/FROM test_engine_jobs jobs/.test(text)) return { rows: [structuredClone(job)] };
        if (/UPDATE test_engine_jobs/.test(text)) {
          writes.push({ text, values });
          if (/completed_at =/.test(text)) {
            [job.status, job.runtime_state, job.completed_at, job.last_error] = values;
            job.runtime_state = JSON.parse(job.runtime_state);
          } else if (/runtime_state =/.test(text)) {
            [job.status, job.runtime_state, , job.last_error] = values;
            job.runtime_state = JSON.parse(job.runtime_state);
          } else throw new Error(`Unexpected nonterminal mutation: ${text}`);
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`Unexpected query: ${text}`);
      }
    };
  });
  t.mock.method(db.pool, 'query', async statement => {
    assert.match(typeof statement === 'string' ? statement : statement.text, /FROM execution_case_snapshots/);
    return { rows: [] };
  });
  t.mock.method(resultService, 'findLatestExecutionResult', async input => { reads.push(input); return storedResult; });
  t.mock.method(resultService, 'upsertExecutionResult', async input => {
    resultWrites.push(input);
    // Force concurrent completion callbacks to overlap while the job is locked.
    await new Promise(resolve => setImmediate(resolve));
    storedResult = { ...input, id: 'result' };
    return storedResult;
  });
  t.mock.method(workspace, 'createTransactionArtifact', async (id, input) => { artifacts.push(input); return { id: 'artifact' }; });
  t.mock.method(workspace, 'appendTransactionEvent', async (id, input) => { events.push(input); });
  t.mock.method(workspace, 'updateTransaction', async () => {});
  t.mock.method(telemetry, 'emitExecutionHierarchyEvents', async () => {});
  return { job, writes, events, artifacts, resultWrites, reads };
}

test('concurrent completion retries share the persisted receipt and attach evidence once', async t => {
  const f = fixture(t);
  const input = { job_id: 'job', status: 'passed', artifact_bundle: { artifact_refs: [{ file_name: 'trace.zip', content_base64: 'YQ==' }] } };
  const receipts = await Promise.all([dispatch.completeQueuedJob(input), dispatch.completeQueuedJob(input)]);
  assert.deepEqual(receipts, [
    { job_id: 'job', execution_result_id: 'result', status: 'passed' },
    { job_id: 'job', execution_result_id: 'result', status: 'passed' }
  ]);
  assert.equal(f.resultWrites.length, 1);
  assert.equal(f.writes.length, 1);
  assert.equal(f.artifacts.length, 1);
  assert.equal(f.events.length, 1);
  assert.equal(f.job.status, 'completed');
  assert.equal(f.reads.at(-1).data_set_iteration_index, 1, 'Replay targets the same frozen data row.');
});

test('late start and reports cannot reopen a finished job or replace its captured evidence', async t => {
  const f = fixture(t);
  await dispatch.completeQueuedJob({ job_id: 'job', status: 'passed' });
  await assert.rejects(dispatch.startQueuedJob({ job_id: 'job', worker_id: 'late-worker' }), error => error.code === 'TESTENGINE_JOB_FINISHED' && error.statusCode === 409 && error.receipt.status === 'passed');
  const report = await dispatch.reportQueuedStep({ job_id: 'job', step_id: 'one', status: 'failed', captures: { receipt: 'injected' }, note: 'late failure' });
  const retry = await dispatch.completeQueuedJob({ job_id: 'job', status: 'failed', error: 'late failure' });
  assert.equal(report.status, 'passed');
  assert.equal(report.case_status, 'passed');
  assert.deepEqual(report.captures, { 't.receipt': 'saved' });
  assert.equal(retry.status, 'passed');
  assert.equal(f.writes.length, 1);
  assert.equal(f.resultWrites.length, 1);
  assert.equal(f.events.length, 1);
});

test('worker capture transport and resume stay raw while all public diagnostic projections are redacted', async t => {
  const f = fixture(t, {statuses:{}}), secret = 'FROZEN_PRIVATE_CUSTOM';
  f.job.payload.parameters_frozen = true;
  f.job.payload.case_parameters = {'t.custom':secret};
  f.job.payload.data_policy = {version:2,case:{private_parameter_names:['t.custom']}};
  const receipt = await dispatch.reportQueuedStep({job_id:'job',step_id:'one',status:'passed',note:`Capture copy = ${secret}`,
    captures:{'t.copy':secret},web_detail:{console:[{message:secret}],network:[{response:{body:{id:secret},headers:{'set-cookie':'unclassified_cookie'}}}]},
    automation_detail:{line_results:[{line:1,status:'failed',error:`Expected ${secret}`}]}});
  assert.equal(receipt.captures['t.copy'],secret,'authenticated worker capture response remains executable');
  assert.equal(f.job.runtime_state.captured_values['t.copy'],secret,'a resumed worker receives the real captured value');
  assert.doesNotMatch(JSON.stringify(f.resultWrites),/FROZEN_PRIVATE_CUSTOM|unclassified_cookie/);
  assert.doesNotMatch(JSON.stringify(f.events),/FROZEN_PRIVATE_CUSTOM|unclassified_cookie/);
  assert.equal(f.job.runtime_state.logs.stepCaptures.one['t.copy'],'[REDACTED]');
  assert.equal(f.resultWrites[0].status,'running');
});

test('an API request cannot be executed again after its job completed', async t => {
  const f = fixture(t);
  let requests = 0;
  t.mock.method(api, 'executeApiRequestStep', async () => { requests += 1; });
  await dispatch.completeQueuedJob({ job_id: 'job', status: 'passed' });
  await assert.rejects(dispatch.executeQueuedApiStep({ job_id: 'job', step_id: 'two' }), error => error.code === 'TESTENGINE_JOB_FINISHED' && error.statusCode === 409);
  assert.equal(requests, 0);
  assert.equal(f.resultWrites.length, 1);
});

test('failed saved steps take precedence over a blocked completion and retain the original failure', async t => {
  const f = fixture(t, { statuses: { one: 'failed', two: 'passed' }, notes: { one: 'Checkout total was incorrect', two: 'Cleanup completed' } });
  const receipt = await dispatch.completeQueuedJob({ job_id: 'job', status: 'blocked' });
  assert.equal(receipt.status, 'failed');
  assert.equal(f.resultWrites[0].error, 'Checkout total was incorrect');
  assert.equal(f.job.runtime_state.deterministic_attempted, true);
});

test('startup failure does not report a deterministic attempt or infer a successful missing section', async t => {
  const f = fixture(t, { statuses: {} });
  const receipt = await dispatch.completeQueuedJob({ job_id: 'job', status: 'passed' });
  assert.equal(receipt.status, 'blocked');
  assert.equal(f.job.runtime_state.deterministic_attempted, false);
  assert.equal(f.resultWrites[0].status, 'blocked');
});

test('skipped sections are recorded but only an actual passing section can establish a case pass', async t => {
  const f = fixture(t, { statuses: { one: 'skipped', two: 'passed' } });
  const receipt = await dispatch.completeQueuedJob({ job_id: 'job', status: 'passed' });
  assert.equal(receipt.status, 'passed');
  assert.equal(JSON.parse(f.resultWrites[0].logs).stepStatuses.one, 'skipped');
});

test('a case with only skipped sections stays blocked', async t => {
  fixture(t, { statuses: { one: 'skipped', two: 'skipped' } });
  assert.equal((await dispatch.completeQueuedJob({ job_id: 'job', status: 'passed' })).status, 'blocked');
});

test('mixed runs cannot settle while a manual case is pending or paused', async t => {
  let manualStatus = 'pending';
  const updates = [];
  t.mock.method(db.pool, 'query', async (statement) => {
    const text = typeof statement === 'string' ? statement : statement.text;
    if (/FROM execution_case_snapshots/.test(text)) return { rows: [{ test_case_id: 'automated' }, { test_case_id: 'manual' }] };
    if (/FROM (?:execution_results|test_case_effective_results)/.test(text)) return { rows: [{ test_case_id: 'automated', status: 'passed' }, { test_case_id: 'manual', status: manualStatus }] };
    if (/FROM executions/.test(text)) return { rows: [{}] };
    if (/UPDATE executions/.test(text)) { updates.push(statement.values); return { rows: [], rowCount: 1 }; }
    throw new Error(text);
  });
  for (const status of ['pending', 'paused', 'running']) {
    manualStatus = status;
    await dispatch.settleExecutionIfComplete('run');
    assert.equal(updates.length, 0, status);
  }
  manualStatus = 'passed';
  await dispatch.settleExecutionIfComplete('run');
  assert.deepEqual(updates, [['completed', 'run']]);
});
