const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const callbacks = require('../../backend/services/testEngineCallback.service');
const db = require('@hellotest/platform/backend/src/db');
const obsDb = require('@hellotest/platform/backend/src/obsDb');
const workspace = require('@hellotest/platform/backend/services/workspaceTransaction.service');
const executions = require('@hellotest/testing/backend/services/execution.service');
const results = require('@hellotest/testing/backend/services/executionResult.service');
const telemetry = require('@hellotest/trace/backend/services/opsTelemetry.service');

test.after(() => Promise.all([db.close(), obsDb.close()]));

function fixture(t) {
  const secret = 'execution-result-ledger-fixture-secret';
  const previous = process.env.HELLOTEST_TESTENGINE_SECRET;
  process.env.HELLOTEST_TESTENGINE_SECRET = secret;
  t.after(() => { if (previous === undefined) delete process.env.HELLOTEST_TESTENGINE_SECRET; else process.env.HELLOTEST_TESTENGINE_SECRET = previous; });
  const execution = {
    id: 'run', project_id: 'project', app_type_id: 'app', trigger: 'local', status: 'running',
    case_snapshots: [{ test_case_id: 'automation', test_case_title: 'Automated case' }, { test_case_id: 'manual', test_case_title: 'Manual case' }],
    step_snapshots: ['one', 'two'].map(id => ({ test_case_id: 'automation', snapshot_step_id: id }))
  };
  const transaction = { id: 'transaction', project_id: 'project', metadata: { source: 'hellotest.local-run', queue_mode: 'direct-local', execution_id: 'run', test_case_id: 'automation' } };
  const writes = [], settled = [], events = [];
  t.mock.method(obsDb.pool, 'connect', async () => ({ release() {}, query: async () => ({ rows: [] }) }));
  t.mock.method(executions, 'getExecution', async () => execution);
  t.mock.method(workspace, 'findTransactionByRelated', async () => transaction);
  t.mock.method(workspace, 'appendTransactionEvent', async (_id, event) => { events.push(event); transaction.metadata = { ...transaction.metadata, ...event.metadata }; });
  t.mock.method(workspace, 'updateTransaction', async () => {});
  t.mock.method(results, 'findLatestExecutionResult', async () => null);
  t.mock.method(results, 'upsertExecutionResult', async value => { writes.push(value); return { id: 'result', ...value }; });
  t.mock.method(telemetry, 'emitExecutionHierarchyEvents', async () => {});
  t.mock.method(db.pool, 'query', async statement => {
    const sql = typeof statement === 'string' ? statement : statement.text;
    if (/FROM test_cases/.test(sql)) return { rows: [{ id: 'automation', app_type_id: 'app' }] };
    if (/COUNT\(\*\)/.test(sql)) return { rows: [{ count: 2 }] };
    if (/FROM (?:execution_results|test_case_effective_results)/.test(sql)) return { rows: [{ test_case_id: 'automation', status: writes.at(-1)?.status }, { test_case_id: 'manual', status: 'pending' }] };
    if (/UPDATE executions/.test(sql)) { settled.push(statement.values); return { rows: [], rowCount: 1 }; }
    throw new Error(sql);
  });
  return {
    writes, settled, events, execution,
    nextAttempt() { transaction.id = 'new-attempt'; transaction.metadata = { source: 'hellotest.local-run', queue_mode: 'direct-local', execution_id: 'run', test_case_id: 'automation' }; },
    async send(stepStatuses, status = 'passed', outcomes = [], engineRunId = 'engine', extra = {}) {
      const payload = { engine_run_id: engineRunId, hellotest_run_id: 'run', hellotest_test_case_id: 'automation', event: 'run.completed', state: 'completed', case_result: { status, logs: { stepStatuses } }, step_outcomes: outcomes, ...extra };
      const rawPayload = JSON.stringify(payload);
      return callbacks.handleRunCallback({ payload, rawPayload, headers: { 'x-hellotest-engine-signature': createHmac('sha256', secret).update(rawPayload).digest('hex') } });
    }
  };
}

for (const [description, statuses, expected] of [
  ['missing saved section', { one: 'passed' }, 'blocked'],
  ['failed saved section', { one: 'passed', two: 'failed' }, 'failed'],
  ['all skipped sections', { one: 'skipped', two: 'skipped' }, 'blocked'],
  ['passing required section and explicit skip', { one: 'passed', two: 'skipped' }, 'passed']
]) test(`signed final callback cannot hide ${description}`, async t => {
  const f = fixture(t);
  await f.send(statuses);
  assert.equal(f.writes[0].status, expected);
  assert.equal(f.settled.length, 0, 'The pending manual case keeps the mixed run open.');
});

test('step-outcome-only callbacks preserve skipped section evidence', async t => {
  const f = fixture(t);
  await f.send({}, 'passed', [{ step_id: 'one', status: 'passed' }, { step_id: 'two', status: 'skipped', note: 'Optional section failed; execution continued.' }]);
  const saved = JSON.parse(f.writes[0].logs);
  assert.deepEqual(saved.stepStatuses, { one: 'passed', two: 'skipped' });
  assert.match(saved.stepNotes.two, /Optional section failed/);
  assert.equal(f.writes[0].status, 'passed');
});

for (const first of ['passed', 'failed']) test(`a distinct final delivery cannot replace an already ${first} dispatched attempt`, async t => {
  const f = fixture(t);
  await f.send({ one: first, two: 'passed' }, first);
  const next = first === 'passed' ? 'failed' : 'passed';
  const receipt = await f.send({ one: next, two: 'passed' }, next);
  assert.equal(receipt.stale, true);
  assert.equal(receipt.execution_result_id, 'result');
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].status, first);
});

test('a separately dispatched engine attempt remains eligible after an earlier attempt finished', async t => {
  const f = fixture(t);
  await f.send({ one: 'failed', two: 'passed' }, 'failed');
  f.nextAttempt();
  const receipt = await f.send({ one: 'passed', two: 'passed' }, 'passed', [], 'new-engine-attempt');
  assert.notEqual(receipt.stale, true);
  assert.equal(f.writes.length, 2);
  assert.equal(f.writes[1].status, 'passed');
});

test('signed legacy-worker output is redacted before result and activity persistence', async t => {
  const f = fixture(t);
  const privateValue = 'private-custom-fixture-491';
  const environmentSecret = 'private-environment-fixture-862';
  f.execution.case_snapshots[0].test_parameters = { 't.custom': privateValue };
  f.execution.case_snapshots[0].data_policy = { version: 2, case: { private_parameter_names: ['t.custom'] } };
  f.execution.environment_snapshot = { variables: [{ key: 'LOGIN_CODE', value: environmentSecret, is_secret: true }] };
  const originalSnapshot = JSON.stringify(f.execution);

  await f.send({}, 'failed', [
    { step_id: 'one', status: 'passed', note: `Captured ${privateValue}`, captures: { 't.custom': privateValue, 't.copy': privateValue } },
    { step_id: 'two', status: 'failed', note: `Unexpected value ${environmentSecret}`, line_results: [{ line: 1, status: 'failed', error: privateValue }] }
  ], 'engine', {
    summary: `Cannot sign in with ${privateValue}`,
    case_result: {
      status: 'failed', error: `Server returned ${environmentSecret}`, duration_ms: 17,
      logs: {
        stepStatuses: { one: 'passed', two: 'failed' },
        stepNotes: { two: `Validation failed for ${privateValue}` },
        stepWebDetails: { two: { response: { body: { id: privateValue, code: environmentSecret } } } }
      }
    }
  });

  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].status, 'failed');
  assert.equal(f.writes[0].duration_ms, 17);
  const saved = JSON.parse(f.writes[0].logs);
  assert.deepEqual(saved.stepStatuses, { one: 'passed', two: 'failed' });
  assert.equal(saved.stepCaptures.one['t.copy'], '[REDACTED]');
  assert.match(f.writes[0].error, /\[REDACTED\]/);
  const persisted = JSON.stringify({ writes: f.writes, events: f.events });
  assert.ok(!persisted.includes(privateValue));
  assert.ok(!persisted.includes(environmentSecret));
  assert.ok(f.events.length > 0);
  assert.equal(JSON.stringify(f.execution), originalSnapshot, 'Frozen input remains available to the authenticated execution path.');
});
