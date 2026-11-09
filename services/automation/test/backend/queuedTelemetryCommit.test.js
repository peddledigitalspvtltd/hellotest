const test = require('node:test');
const assert = require('node:assert/strict');
const Fastify = require('fastify');
const obsDb = require('@hellotest/platform/backend/src/obsDb');
const db = require('@hellotest/platform/backend/src/db');
const results = require('@hellotest/testing/backend/services/executionResult.service');
const workspace = require('@hellotest/platform/backend/services/workspaceTransaction.service');
const telemetry = require('@hellotest/trace/backend/services/opsTelemetry.service');

test.after(() => Promise.all([db.close(), obsDb.close()]));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function bounded(promise, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), 1000); })]); }
  finally { clearTimeout(timer); }
}

// Real route/service/transaction adapter; all persistence and delivery ports
// are in-memory. The fake connection preserves the row lock until COMMIT.
async function fixture(t) {
  const job = {
    id: 'job', execution_id: `run-${t.name}`, test_case_id: 'case', app_type_id: 'app',
    test_case_title: 'Checkout', transaction_id: 'activity', status: 'running', leased_by: 'worker',
    lease_expires_at: new Date(Date.now() + 60_000).toISOString(), started_at: new Date().toISOString(),
    payload: { steps: [1, 2, 3].map(order => ({ id: `step-${order}`, order, step_type: 'web' })) },
    runtime_state: { logs: { stepStatuses: {} } }
  };
  const state = { commits: 0, rollbacks: 0, released: 0, activeLocks: 0, telemetryPoolReads: 0, failCommit: false, commitGate: null, commitEntered: deferred(), order: [], deliveries: [] };
  let previousLock = Promise.resolve();
  t.mock.method(obsDb.pool, 'query', async statement => {
    const text = typeof statement === 'string' ? statement : statement.text;
    assert.equal(text, 'SELECT telemetry_probe', 'Optional delivery must use a released transaction context.');
    state.telemetryPoolReads++;
    return { rows: [] };
  });
  t.mock.method(obsDb.pool, 'connect', async () => {
    let unlock, before;
    return {
      release() { state.released++; state.order.push('release'); },
      async query(statement, parameters) {
        const text = typeof statement === 'string' ? statement : statement.text;
        const values = typeof statement === 'string' ? parameters : statement.values;
        if (text === 'BEGIN') { before = structuredClone(job); return { rows: [] }; }
        if (text === 'COMMIT') {
          state.order.push('commit-attempt');
          state.commitEntered.resolve();
          if (state.commitGate) await state.commitGate.promise;
          if (state.failCommit) throw Object.assign(new Error('Fixture commit failure'), { code: 'FIXTURE_COMMIT_FAILED' });
          state.commits++; state.order.push('commit'); unlock?.(); return { rows: [] };
        }
        if (text === 'ROLLBACK') {
          state.rollbacks++; state.order.push('rollback');
          for (const key of Object.keys(job)) delete job[key]; Object.assign(job, before);
          unlock?.(); return { rows: [] };
        }
        if (/SELECT id FROM test_engine_jobs.*FOR UPDATE/.test(text)) {
          const wait = previousLock;
          previousLock = new Promise(resolve => { unlock = () => { state.activeLocks--; resolve(); unlock = null; }; });
          await wait; state.activeLocks++; state.order.push('lock'); return { rows: [{ id: job.id }] };
        }
        if (/FROM test_engine_jobs jobs/.test(text)) return { rows: [structuredClone(job)] };
        if (/UPDATE test_engine_jobs/.test(text)) {
          if (/SET lease_expires_at/.test(text)) job.lease_expires_at = values[0];
          else if (/runtime_state =/.test(text)) {
            job.status = values[0]; job.runtime_state = typeof values[1] === 'string' ? JSON.parse(values[1]) : values[1]; job.lease_expires_at = values[2];
          } else throw new Error(`Unexpected mutation: ${text}`);
          state.order.push('persist'); return { rows: [], rowCount: 1 };
        }
        throw new Error(`Unexpected locked query: ${text}`);
      }
    };
  });
  t.mock.method(db.pool, 'query', async statement => {
    assert.match(typeof statement === 'string' ? statement : statement.text, /SELECT status, ended_at FROM executions/);
    return { rows: [{ status: 'running' }] };
  });
  t.mock.method(results, 'findLatestExecutionResult', async () => null);
  t.mock.method(results, 'upsertExecutionResult', async () => { state.order.push('result'); return { id: 'result' }; });
  t.mock.method(workspace, 'appendTransactionEvent', async () => { state.order.push('event'); });
  const gates = [], entered = [];
  t.mock.method(telemetry, 'emitExecutionHierarchyEvents', async payload => {
    assert.ok(state.commits > 0); assert.equal(state.activeLocks, 0); assert.ok(state.released >= state.commits);
    state.order.push('telemetry'); state.deliveries.push(payload);
    // This query can only reach the pool after the real adapter has exited its
    // transaction; inheriting the job connection fails the query above.
    await obsDb.query('SELECT telemetry_probe');
    const gate = deferred(); gates.push(gate); entered[state.deliveries.length - 1]?.resolve();
    await gate.promise;
  });
  const app = Fastify();
  app.decorate('authenticateTestEngine', async () => {}); app.decorate('validate', () => {});
  await app.register(require('../../backend/routes/testEngineInternal.routes'));
  t.after(async () => { state.commitGate?.resolve(); for (const gate of gates) gate.resolve(); await new Promise(resolve => setImmediate(resolve)); await app.close(); });
  const report = number => app.inject({ method: 'POST', url: `/testengine/internal/jobs/job/steps/step-${number}/report`, payload: { worker_id: 'worker', status: 'passed' } });
  const heartbeat = () => app.inject({ method: 'POST', url: '/testengine/internal/jobs/job/heartbeat', payload: { worker_id: 'worker' } });
  const delivery = index => { entered[index] ||= deferred(); if (gates[index]) entered[index].resolve(); return entered[index].promise; };
  return { job, state, report, heartbeat, delivery, gates };
}

test('report HTTP acknowledgement follows commit/release while slow telemetry cannot block a concurrent heartbeat', { timeout: 3000 }, async t => {
  const f = await fixture(t);
  f.state.commitGate = deferred();
  let acknowledged = false;
  const pendingReport = f.report(1).then(response => { acknowledged = true; return response; });
  await bounded(f.state.commitEntered.promise, 'Step callback did not reach its commit boundary.');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(acknowledged, false, 'A callback must not acknowledge uncommitted work.');
  assert.equal(f.state.deliveries.length, 0, 'Telemetry must not read an uncommitted receipt.');
  f.state.commitGate.resolve();
  const report = await bounded(pendingReport, 'Step acknowledgement waited for optional telemetry.');
  assert.equal(report.statusCode, 200); assert.equal(report.json().status, 'passed');
  await bounded(f.delivery(0), 'Expected the committed optional telemetry to start.');
  assert.equal(f.state.commits, 1); assert.equal(f.state.released, 1); assert.equal(f.state.activeLocks, 0);
  assert.ok(f.state.order.indexOf('commit') < f.state.order.indexOf('release'));
  assert.ok(f.state.order.indexOf('release') < f.state.order.indexOf('telemetry'));
  const beat = await bounded(f.heartbeat(), 'Slow telemetry blocked the owner heartbeat.');
  assert.equal(beat.statusCode, 200); assert.equal(beat.json().authorized, true);
  assert.equal(f.state.commits, 2); assert.equal(f.state.deliveries.length, 1);
  assert.equal(f.state.telemetryPoolReads, 1); assert.equal(f.gates.length, 1, 'Telemetry is still deliberately pending.');
});

test('a failed commit rolls back and never publishes queued telemetry; a later receipt has no leaked event', { timeout: 3000 }, async t => {
  const f = await fixture(t); f.state.failCommit = true;
  const failed = await bounded(f.report(1), 'Failed callback did not return.');
  assert.equal(failed.statusCode, 500); assert.equal(f.state.rollbacks, 1); assert.equal(f.state.commits, 0);
  assert.ok(f.state.order.includes('result')); assert.ok(f.state.order.includes('event'));
  assert.equal(f.job.runtime_state.logs.stepStatuses['step-1'], undefined);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(f.state.deliveries.length, 0);
  f.state.failCommit = false;
  assert.equal((await bounded(f.report(2), 'Later callback did not return.')).statusCode, 200);
  await bounded(f.delivery(0), 'Later committed telemetry did not start.');
  assert.deepEqual(f.state.deliveries.map(payload => payload.step_id), ['step-2']);
});

test('slow hierarchy delivery coalesces a Run burst to one in-flight send plus its latest committed step', { timeout: 3000 }, async t => {
  const f = await fixture(t);
  assert.equal((await bounded(f.report(1), 'First callback waited for telemetry.')).statusCode, 200);
  await bounded(f.delivery(0), 'First telemetry did not start.');
  for (const number of [2, 3]) assert.equal((await bounded(f.report(number), 'A later callback waited for telemetry.')).statusCode, 200);
  assert.equal(f.state.commits, 3); assert.deepEqual(f.state.deliveries.map(payload => payload.step_id), ['step-1']);
  f.gates[0].resolve(); await bounded(f.delivery(1), 'Latest committed hierarchy event was not delivered.');
  assert.deepEqual(f.state.deliveries.map(payload => payload.step_id), ['step-1', 'step-3']);
  assert.deepEqual(f.job.runtime_state.logs.stepStatuses, { 'step-1': 'passed', 'step-2': 'passed', 'step-3': 'passed' });
});
