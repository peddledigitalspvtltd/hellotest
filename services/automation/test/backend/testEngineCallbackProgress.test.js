const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHmac } = require('node:crypto');
const ts = require('typescript');
const callbacks = require('../../backend/services/testEngineCallback.service');
const db = require('@hellotest/platform/backend/src/db');
const obs = require('@hellotest/platform/backend/src/obsDb');
const executions = require('@hellotest/testing/backend/services/execution.service');
const results = require('@hellotest/testing/backend/services/executionResult.service');
const workspace = require('@hellotest/platform/backend/services/workspaceTransaction.service');
const telemetry = require('@hellotest/trace/backend/services/opsTelemetry.service');
test.after(() => Promise.all([db.close(), obs.close()]));

const nativeSource = fs.readFileSync(path.resolve(__dirname, '../../../../testengine/backend/src/lib/executor.ts'), 'utf8');
const range = (start, end) => nativeSource.slice(nativeSource.indexOf(start), nativeSource.indexOf(end, nativeSource.indexOf(start)));
const producer = new Function('nowIso', ts.transpileModule(
  range('const buildStepApiDetailMap =', 'const mergeArtifactBundle =')
  + range('const buildProgressCallback =', 'const executeUnsupportedRun =') + '\nreturn buildProgressCallback;',
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }
).outputText)(() => '2026-11-10T00:00:00.000Z');

function fixture(t, { runStatus = 'running', transactionStatus = 'running', finalReceived = false } = {}) {
  const secret = 'callback-progress-regression-secret-over-32-characters';
  const previous = process.env.TESTENGINE_CALLBACK_SECRET;
  process.env.TESTENGINE_CALLBACK_SECRET = secret;
  t.after(() => { if (previous === undefined) delete process.env.TESTENGINE_CALLBACK_SECRET; else process.env.TESTENGINE_CALLBACK_SECRET = previous; });
  const run = { id: 'run', project_id: 'project', app_type_id: 'app', trigger: 'local', status: runStatus,
    case_snapshots: [{ test_case_id: 'case', test_case_title: 'Login' }], step_snapshots: [1, 2, 3].map(index => ({ test_case_id: 'case', snapshot_step_id: `s${index}` })) };
  const transaction = { id: 'transaction', project_id: 'project', status: transactionStatus, metadata: {
    source: 'hellotest.local-run', queue_mode: 'direct-local', execution_id: 'run', test_case_id: 'case', callback_final_received: finalReceived
  } };
  let current = null;
  const writes = [];
  t.mock.method(obs.pool, 'connect', async () => ({ release() {}, query: async () => ({ rows: [] }) }));
  t.mock.method(db.pool, 'query', async statement => ({ rows: /COUNT\(/.test(statement.text || '') ? [{ count: 0 }] : [{ id: 'case', app_type_id: 'app' }], rowCount: 1 }));
  t.mock.method(executions, 'getExecution', async () => run);
  t.mock.method(results, 'findLatestExecutionResult', async () => current);
  t.mock.method(results, 'upsertExecutionResult', async input => { current = { id: 'result', ...input }; writes.push(current); return current; });
  t.mock.method(workspace, 'findTransactionByRelated', async () => transaction);
  t.mock.method(workspace, 'appendTransactionEvent', async (_id, event) => { transaction.status = event.status; transaction.metadata = { ...transaction.metadata, ...event.metadata }; });
  t.mock.method(workspace, 'updateTransaction', async (_id, patch) => { transaction.status = patch.status; transaction.metadata = { ...transaction.metadata, ...patch.metadata }; });
  t.mock.method(telemetry, 'emitExecutionHierarchyEvents', async () => {});
  const send = async payload => { const rawPayload = JSON.stringify(payload); return callbacks.handleRunCallback({ payload, rawPayload,
    headers: { 'x-testengine-signature': createHmac('sha256', secret).update(rawPayload).digest('hex') } }); };
  const progress = outcomes => producer({ envelope: { hellotest_run_id: 'run', hellotest_test_case_id: 'case', hellotest_test_case_title: 'Login' },
    run: { id: 'engine', artifact_bundle: { artifact_refs: [] }, patch_proposals: [] }, stepOutcomes: outcomes, stepSummaries: [], stepCaptures: {}, stepWebDetails: {}, stepAutomationDetails: {}, latestOutcome: outcomes.at(-1), durationMs: 100, totalSteps: 3 });
  return { writes, progress, send, transaction };
}

test('native partial progress stays running through signed callback persistence until the final case receipt', async t => {
  const f = fixture(t);
  const first = f.progress([{ step_id: 's1', status: 'passed' }]);
  assert.equal(first.state, 'running'); assert.equal(first.case_result.status, 'running');
  await f.send(first); assert.equal(f.writes.at(-1).status, 'running');
  const complete = f.progress([1, 2, 3].map(index => ({ step_id: `s${index}`, status: 'passed' })));
  await f.send(complete); assert.equal(f.writes.at(-1).status, 'running', 'Final hooks and completion still own the terminal outcome');
  await f.send({ ...complete, event: 'run.completed', state: 'completed', case_result: { ...complete.case_result, status: 'passed' } });
  assert.equal(f.writes.at(-1).status, 'passed');
  const stale = await f.send({ ...first, summary: 'Delayed prior progress' });
  assert.equal(stale.stale, true); assert.equal(f.writes.length, 3); assert.equal(f.writes.at(-1).status, 'passed');
});

for (const status of ['failed', 'blocked']) test(`real ${status} step outcomes cannot become running progress`, async t => {
  const f = fixture(t), payload = f.progress([{ step_id: 's1', status }]);
  assert.equal(payload.case_result.status, status);
  await f.send({ ...payload, case_result: { ...payload.case_result, status: 'running' } });
  assert.equal(f.writes.at(-1).status, status);
});

test('a terminal incomplete receipt remains blocked even when its explicit status says passed', async t => {
  const f = fixture(t), partial = f.progress([{ step_id: 's1', status: 'passed' }]);
  await f.send(partial); assert.equal(f.writes.at(-1).status, 'running');
  await f.send({ ...partial, event: 'run.completed', state: 'completed', case_result: { ...partial.case_result, status: 'passed' } });
  assert.equal(f.writes.at(-1).status, 'blocked');
});

test('legacy terminal attempt records fence delayed progress without reopening the result', async t => {
  const f = fixture(t, { transactionStatus: 'completed' });
  assert.equal((await f.send(f.progress([{ step_id: 's1', status: 'passed' }]))).stale, true);
  assert.equal(f.writes.length, 0);
});

test('a finished Run fences progress from an older attempt even without a final callback flag', async t => {
  const f = fixture(t, { runStatus: 'completed' });
  assert.equal((await f.send(f.progress([{ step_id: 's1', status: 'passed' }]))).stale, true);
  assert.equal(f.writes.length, 0);
});
