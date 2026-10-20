const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHmac } = require('node:crypto');
const http = require('node:http');

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

test('deletion cancels only unclaimed builds atomically and serializes actual worker claims and manual-source enqueue', {
  skip: process.env.AUTOMATION_DELETE_BUSY_POSTGRES !== '1', timeout: 120000
}, async t => {
  const url = new URL(process.env.DATABASE_URL);
  assert.match(url.pathname, /^\/agent_verify_automation_delete_busy(?:_[a-z0-9]+)?$/);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
  assert.equal(process.env.DATABASE_URL, process.env.OBS_DATABASE_URL);
  const db = require('@hellotest/platform/backend/src/db');
  const obs = require('@hellotest/platform/backend/src/obsDb');
  let pause;
  try {
    assert.equal((await db.prepare("SELECT to_regclass('public.projects') AS present").get()).present, null, 'Use an empty owned fixture database.');
    await db.query(fs.readFileSync(path.resolve(__dirname, '../../../platform/backend/instance-setup-data/schema-setup/schema.sql'), 'utf8'));
    await require('../../../platform/backend/src/db/bootstrap').ensureRuntimeSchema();
    await require('../../../platform/backend/src/obsDb/bootstrap').ensureRuntimeSchema();
    const originalPrepare = db.prepare.bind(db);
    t.mock.method(db, 'prepare', sql => {
      const statement = originalPrepare(sql);
      if (/FROM automation_generator_jobs[\s\S]*FOR UPDATE/.test(sql)) {
        return { ...statement, all: async (...params) => {
          const rows = await statement.all(...params);
          if (pause) { const current = pause; current.locked.resolve(); await current.release.promise; }
          return rows;
        } };
      }
      return statement;
    });
    const deletion = require('../../backend/services/automationCaseDeletion.service');
    const generator = require('../../../automation/backend/services/automationGenerator.service');
    const project = randomUUID(), app = randomUUID();
    await db.prepare("INSERT INTO projects(id,name) VALUES(?,'Disposable deletion contention')").run(project);
    await db.prepare("INSERT INTO app_types(id,project_id,name,type) VALUES(?,?,'Web','web')").run(app, project);
    const makeCase = async (automated = 'yes', source = null) => {
      const id = randomUUID();
      await db.prepare("INSERT INTO test_cases(id,app_type_id,title,automated,source_idempotency_key) VALUES(?,?,'Contention fixture',?,?)").run(id, app, automated, source ? `automation-builder:${source}` : null);
      return id;
    };
    const remove = id => deletion.deleteAutomationCases({ project_id: project, app_type_id: app, test_case_ids: [id] });
    const queue = id => generator.queueGeneratorJob({ test_case_id: id, start_url: 'https://fixture.example.test/' });
    const jobState = id => obs.prepare('SELECT * FROM automation_generator_jobs WHERE id=?').get(id);
    const waitForDatabaseLock = async queryFragment => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const row = await db.prepare("SELECT COUNT(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE ?").get(`%${queryFragment}%`);
        if (row.count > 0) return;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.fail(`Expected a real PostgreSQL waiter for ${queryFragment}`);
    };
    const startPausedDelete = async id => {
      pause = { locked: deferred(), release: deferred() };
      const outcome = remove(id).then(value => ({ value }), error => ({ error }));
      await pause.locked.promise;
      return outcome;
    };

    // A failed deletion must restore both the queued job and its activity.
    // An actual worker claim waits for that same transaction, then succeeds.
    const rolledBackCase = await makeCase();
    const rollbackJob = await queue(rolledBackCase);
    await db.query(`CREATE FUNCTION reject_fixture_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Fixture rejects delete'; END $$`);
    await db.query('CREATE TRIGGER reject_fixture_delete BEFORE DELETE ON test_cases FOR EACH ROW EXECUTE FUNCTION reject_fixture_delete()');
    let rollbackOutcome;
    const rollbackStarted = startPausedDelete(rolledBackCase).then(result => { rollbackOutcome = result; });
    await pause.locked.promise;
    const rollbackClaim = generator.leaseNextJob({ worker_id: 'fixture-rollback-worker' });
    await waitForDatabaseLock('UPDATE automation_generator_jobs');
    pause.release.resolve();
    await rollbackStarted;
    assert.match(rollbackOutcome.error.message, /Fixture rejects delete/);
    assert.equal((await rollbackClaim).id, rollbackJob.job_id);
    pause = null;
    assert.ok(await db.prepare('SELECT id FROM test_cases WHERE id=?').get(rolledBackCase));
    assert.equal((await obs.prepare('SELECT status FROM workspace_transactions WHERE id=?').get(rollbackJob.transaction_id)).status, 'queued');
    assert.equal((await obs.prepare("SELECT COUNT(*)::int AS count FROM workspace_transaction_events WHERE transaction_id=? AND phase='generator.cancelled'").get(rollbackJob.transaction_id)).count, 0);
    assert.equal((await db.prepare("SELECT COUNT(*)::int AS count FROM admin_audit_log WHERE action='automation_case.bulk_delete'").get()).count, 0);
    await db.query('DROP TRIGGER reject_fixture_delete ON test_cases');
    await db.query('DROP FUNCTION reject_fixture_delete()');
    await assert.rejects(remove(rolledBackCase), { code: 'AUTOMATION_CASE_BUSY' });
    // Expiry is recoverable work, not permission to ignore a claimed job.
    await obs.prepare("UPDATE automation_generator_jobs SET lease_expires_at=CURRENT_TIMESTAMP-INTERVAL '1 hour' WHERE id=?").run(rollbackJob.job_id);
    await assert.rejects(remove(rolledBackCase), { code: 'AUTOMATION_CASE_BUSY' });
    await assert.rejects(generator.runLeasedJob({ job_id: rollbackJob.job_id, worker_id: 'fixture-rollback-worker' }), { statusCode: 409 });
    await obs.prepare("UPDATE automation_generator_jobs SET status='completed',completed_at=CURRENT_TIMESTAMP WHERE id=?").run(rollbackJob.job_id);

    // Committed cancellation wins against the same real acquisition UPDATE.
    const cancelledCase = await makeCase();
    const queued = await queue(cancelledCase);
    await obs.prepare("UPDATE automation_generator_jobs SET created_at=CURRENT_TIMESTAMP-INTERVAL '7 days',payload=payload||?::jsonb WHERE id=?").run({ scheduled_at: '2099-01-01T00:00:00.000Z' }, queued.job_id);
    // Make the scheduled job due only for the contention check.
    await obs.prepare("UPDATE automation_generator_jobs SET payload=payload-'scheduled_at' WHERE id=?").run(queued.job_id);
    let committedOutcome;
    const committedStarted = startPausedDelete(cancelledCase).then(result => { committedOutcome = result; });
    await pause.locked.promise;
    const rejectedClaim = generator.leaseNextJob({ worker_id: 'fixture-cancelled-worker' });
    await waitForDatabaseLock('UPDATE automation_generator_jobs');
    pause.release.resolve();
    await committedStarted;
    pause = null;
    assert.equal(committedOutcome.error, undefined);
    assert.equal(await rejectedClaim, null);
    assert.deepEqual(committedOutcome.value.cancelled_generator_job_ids, [queued.job_id]);
    const cancelled = await jobState(queued.job_id);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.result.reason, 'automation_case_deleted');
    assert.ok(cancelled.completed_at);
    const cancelledActivity = await obs.prepare('SELECT status,metadata FROM workspace_transactions WHERE id=?').get(queued.transaction_id);
    assert.equal(cancelledActivity.status, 'failed');
    assert.equal(cancelledActivity.metadata.cancelled, true);
    assert.equal(cancelledActivity.metadata.deletion_operation_id, committedOutcome.value.operation_id);
    assert.equal((await remove(cancelledCase)).operation_id, committedOutcome.value.operation_id);
    await assert.rejects(generator.runLeasedJob({ job_id: queued.job_id, worker_id: 'fixture-cancelled-worker' }), { statusCode: 409 });
    await assert.rejects(queue(cancelledCase), /Test case not found/);

    // Never-started scheduled builds are cancelled too; previously started
    // queued retries remain protected even when they are very old.
    const scheduledCase = await makeCase();
    const scheduledJob = await generator.queueGeneratorJob({ test_case_id: scheduledCase, start_url: 'https://fixture.example.test/', scheduled_at: '2099-01-01T00:00:00.000Z' });
    assert.deepEqual((await remove(scheduledCase)).cancelled_generator_job_ids, [scheduledJob.job_id]);
    const retryCase = await makeCase(), retryJob = await queue(retryCase);
    await obs.prepare("UPDATE automation_generator_jobs SET attempts=1,started_at=CURRENT_TIMESTAMP-INTERVAL '7 days' WHERE id=?").run(retryJob.job_id);
    await assert.rejects(remove(retryCase), { code: 'AUTOMATION_CASE_BUSY' });
    await obs.prepare("UPDATE automation_generator_jobs SET status='failed',completed_at=CURRENT_TIMESTAMP WHERE id=?").run(retryJob.job_id);

    // Source aliases are serialized as well. An enqueue that observed an AT
    // before deletion cannot silently recreate that target after waiting.
    const manual = await makeCase('no'), target = await makeCase('yes', manual);
    let aliasOutcome;
    const aliasStarted = startPausedDelete(target).then(result => { aliasOutcome = result; });
    await pause.locked.promise;
    const aliasQueue = queue(manual).then(value => ({ value }), error => ({ error }));
    await waitForDatabaseLock('hellotest.automation-build');
    pause.release.resolve();
    await aliasStarted;
    pause = null;
    assert.equal(aliasOutcome.error, undefined);
    assert.equal((await aliasQueue).error.code, 'AUTOMATION_TARGET_CHANGED');
    assert.equal((await obs.prepare('SELECT COUNT(*)::int AS count FROM automation_generator_jobs WHERE test_case_id=?').get(manual)).count, 0);
    assert.ok(await db.prepare('SELECT id FROM test_cases WHERE id=?').get(manual));
    // A subsequent explicit build of that manual case remains valid.
    const nextTarget = await makeCase('yes', manual), sourceJob = await queue(manual);
    assert.deepEqual((await remove(nextTarget)).cancelled_generator_job_ids, [sourceJob.job_id]);

    const batches = require('../../backend/services/batchProcess.service');
    t.mock.method(batches, 'triggerProcessing', () => {});
    const batchSource = await makeCase('no'), racingBatchTarget = await makeCase('yes', batchSource);
    let batchDeleteOutcome;
    const batchDeleteStarted = startPausedDelete(racingBatchTarget).then(result => { batchDeleteOutcome = result; });
    await pause.locked.promise;
    const racedBatch = batches.queueAutomationBuild({ app_type_id: app, test_case_ids: [batchSource], start_url: 'https://fixture.example.test/' }).then(value => ({ value }), error => ({ error }));
    await waitForDatabaseLock('hellotest.automation-build');
    pause.release.resolve();
    await batchDeleteStarted;
    pause = null;
    assert.equal(batchDeleteOutcome.error, undefined);
    assert.equal((await racedBatch).error.code, 'AUTOMATION_TARGET_CHANGED');
    const protectedBatchTarget = await makeCase('yes', batchSource);
    const queuedBatch = await batches.queueAutomationBuild({ app_type_id: app, test_case_ids: [batchSource], start_url: 'https://fixture.example.test/' });
    await assert.rejects(remove(protectedBatchTarget), { code: 'AUTOMATION_CASE_BUSY' });
    await obs.prepare("UPDATE batch_process_jobs SET status='completed',completed_at=CURRENT_TIMESTAMP WHERE id=?").run(queuedBatch.job_id);

    // The durable queue job owns queued execution activity. Stale activity
    // rows from completed jobs must not block a reopened or mixed-case run.
    const runCase = await makeCase(), execution = randomUUID(), engineRun = randomUUID(), transaction = randomUUID(), engineJob = randomUUID();
    await db.prepare("INSERT INTO executions(id,project_id,app_type_id,trigger,status) VALUES(?,?,?,'ci','running')").run(execution, project, app);
    await obs.prepare("INSERT INTO workspace_transactions(id,project_id,app_type_id,category,action,title,status,related_id,metadata) VALUES(?,?,?,'automation','testengine_run','Stale queued activity','running',?,?)").run(transaction, project, app, engineRun, { execution_id: execution, test_case_id: runCase, queue_mode: 'hellotest-pull' });
    await obs.prepare("INSERT INTO test_engine_jobs(id,engine_run_id,transaction_id,project_id,app_type_id,execution_id,test_case_id,test_case_title,status) VALUES(?,?,?,?,?,?,?,'Run fixture','queued')").run(engineJob, engineRun, transaction, project, app, execution, runCase);
    await assert.rejects(remove(runCase), { code: 'AUTOMATION_CASE_BUSY' });
    await obs.prepare("UPDATE test_engine_jobs SET status='completed',completed_at=CURRENT_TIMESTAMP WHERE id=?").run(engineJob);
    const direct = randomUUID();
    await obs.prepare("INSERT INTO workspace_transactions(id,project_id,app_type_id,category,action,title,status,metadata) VALUES(?,?,?,'automation','testengine_run','Direct activity','running',?)").run(direct, project, app, { execution_id: execution, test_case_id: runCase });
    await assert.rejects(remove(runCase), { code: 'AUTOMATION_CASE_BUSY' });
    await obs.prepare("UPDATE workspace_transactions SET metadata=metadata||?::jsonb WHERE id=?").run({ callback_final_received: true }, direct);
    await remove(runCase);
    assert.equal((await db.prepare('SELECT status FROM executions WHERE id=?').get(execution)).status, 'running');
    assert.ok(await obs.prepare('SELECT id FROM test_engine_jobs WHERE id=?').get(engineJob));

    // A healthy, authenticated local runner can prove that an old direct
    // attempt was lost across a restart. Keep an abandoned activity receipt,
    // fence late callbacks and preserve all actual results and frozen context.
    const secret = 'disposable-direct-deletion-reconciliation-secret';
    const oldSecret = process.env.TESTENGINE_SHARED_SECRET;
    process.env.TESTENGINE_SHARED_SECRET = secret;
    t.after(() => { if (oldSecret === undefined) delete process.env.TESTENGINE_SHARED_SECRET; else process.env.TESTENGINE_SHARED_SECRET = oldSecret; });
    const engineRecords = new Map();
    const runner = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/health/live') return res.end('{"ok":true,"status":"live","ui":"hellotest"}');
      if (req.headers['x-hellotest-testengine-secret'] !== secret) {
        res.writeHead(401, { 'www-authenticate': 'Bearer realm="hellotest-testengine"' });
        return res.end('{"message":"Unauthorized Test Engine request"}');
      }
      const record = engineRecords.get(req.url.split('/').pop());
      if (!record) { res.writeHead(404); return res.end('{"message":"Run not found"}'); }
      return res.end(JSON.stringify(record));
    });
    await new Promise(resolve => runner.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => { runner.closeAllConnections(); runner.close(resolve); }));
    const directFixture = async state => {
      const caseId = await makeCase(), runId = randomUUID(), engineId = randomUUID(), txId = randomUUID(), stepId = randomUUID();
      await db.prepare("INSERT INTO executions(id,project_id,app_type_id,trigger,status) VALUES(?,?,?,'local','running')").run(runId, project, app);
      await db.prepare("INSERT INTO execution_case_snapshots(execution_id,test_case_id,test_case_title) VALUES(?,?,'Frozen direct fixture')").run(runId, caseId);
      await db.prepare("INSERT INTO execution_step_snapshots(execution_id,test_case_id,snapshot_step_id,step_order,action,expected_result,step_type,automation_code) VALUES(?,?,?,1,'Check readiness','Ready is visible','web','await expect(page.getByText(\"Ready\")).toBeVisible();')").run(runId, caseId, stepId);
      await obs.prepare("INSERT INTO workspace_transactions(id,project_id,app_type_id,category,action,title,status,related_kind,related_id,created_at,started_at,metadata) VALUES(?,?,?,'automation','testengine_run','Direct fixture','running','testengine_run',?,CURRENT_TIMESTAMP-INTERVAL '1 hour',CURRENT_TIMESTAMP-INTERVAL '1 hour',?)").run(txId, project, app, engineId, { source: 'hellotest.local-run', queue_mode: 'direct-local', engine_host: `http://127.0.0.1:${runner.address().port}`, engine_run_id: engineId, execution_id: runId, test_case_id: caseId });
      if (state) engineRecords.set(engineId, { id: engineId, hellotest_run_id: runId, hellotest_test_case_id: caseId, state });
      return { caseId, runId, engineId, txId, stepId };
    };
    const sendFinal = async fixture => {
      const payload = { engine_run_id: fixture.engineId, hellotest_run_id: fixture.runId, hellotest_test_case_id: fixture.caseId, event: 'run.completed', state: 'completed', case_result: { status: 'passed', logs: { stepStatuses: { [fixture.stepId]: 'passed' } } } };
      const rawPayload = JSON.stringify(payload);
      return require('../../../automation/backend/services/testEngineCallback.service').handleRunCallback({ payload, rawPayload, headers: { 'x-hellotest-engine-signature': createHmac('sha256', secret).update(rawPayload).digest('hex') } });
    };
    const missing = await directFixture(null);
    await db.query(`CREATE FUNCTION reject_fixture_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Fixture rejects delete'; END $$`);
    await db.query('CREATE TRIGGER reject_fixture_delete BEFORE DELETE ON test_cases FOR EACH ROW EXECUTE FUNCTION reject_fixture_delete()');
    await assert.rejects(remove(missing.caseId), /Fixture rejects delete/);
    const rollbackDirect = await obs.prepare('SELECT status,metadata FROM workspace_transactions WHERE id=?').get(missing.txId);
    assert.equal(rollbackDirect.status, 'running');
    assert.equal(rollbackDirect.metadata.callback_final_received, undefined);
    assert.equal((await obs.prepare("SELECT COUNT(*)::int AS count FROM workspace_transaction_events WHERE transaction_id=? AND phase='run.abandoned'").get(missing.txId)).count, 0);
    await db.query('DROP TRIGGER reject_fixture_delete ON test_cases');
    await db.query('DROP FUNCTION reject_fixture_delete()');
    const abandonedReceipt = await remove(missing.caseId);
    assert.equal(abandonedReceipt.reconciled_direct_runs[0].outcome, 'abandoned');
    const abandonedActivity = await obs.prepare('SELECT status,metadata FROM workspace_transactions WHERE id=?').get(missing.txId);
    assert.equal(abandonedActivity.status, 'failed');
    assert.equal(abandonedActivity.metadata.callback_final_received, true);
    assert.equal((await sendFinal(missing)).stale, true);
    assert.equal((await db.prepare('SELECT COUNT(*)::int AS count FROM execution_results WHERE execution_id=?').get(missing.runId)).count, 0, 'A missing attempt must never fabricate a passing result.');
    assert.ok(await db.prepare('SELECT * FROM execution_case_snapshots WHERE execution_id=? AND test_case_id=?').get(missing.runId, missing.caseId));
    const missingWithEvidence = await directFixture(null);
    const actualEvidence = await require('../../backend/services/executionResult.service').createExecutionResult({ execution_id: missingWithEvidence.runId, test_case_id: missingWithEvidence.caseId, app_type_id: app, status: 'passed', logs: '{"note":"Keep the actual prior outcome and evidence"}' });
    const originalEvidence = await db.prepare('SELECT * FROM execution_results WHERE id=?').get(actualEvidence.id);
    await remove(missingWithEvidence.caseId);
    assert.deepEqual(await db.prepare('SELECT * FROM execution_results WHERE id=?').get(actualEvidence.id), originalEvidence, 'Abandoning activity must not alter an existing actual terminal outcome.');
    const stillRunning = await directFixture('running');
    await assert.rejects(remove(stillRunning.caseId), { code: 'AUTOMATION_CASE_BUSY' });
    assert.equal((await obs.prepare('SELECT status FROM workspace_transactions WHERE id=?').get(stillRunning.txId)).status, 'running');
    const finished = await directFixture('completed');
    assert.equal((await remove(finished.caseId)).reconciled_direct_runs[0].outcome, 'finished');
    assert.equal((await obs.prepare('SELECT metadata FROM workspace_transactions WHERE id=?').get(finished.txId)).metadata.callback_final_received, undefined);
    const reported = await sendFinal(finished);
    assert.equal(reported.stale, undefined, 'A finished attempt can still deliver its real signed historical evidence.');
    assert.equal((await db.prepare('SELECT status FROM execution_results WHERE id=?').get(reported.execution_result_id)).status, 'passed');

    // An app-wide batch with an empty explicit list still targets all manual
    // sources, so deleting a prepared AT must not evade the batch busy guard.
    const batchTarget = await makeCase('yes', manual), batch = randomUUID(), batchTx = randomUUID();
    await obs.prepare("INSERT INTO workspace_transactions(id,project_id,app_type_id,category,action,title,status) VALUES(?,?,?,'automation_build','automation_build','All manual sources','queued')").run(batchTx, project, app);
    await obs.prepare("INSERT INTO batch_process_jobs(id,transaction_id,operation,payload,status) VALUES(?,?,'automation_build',?,'queued')").run(batch, batchTx, { app_type_id: app, test_case_ids: [] });
    await assert.rejects(remove(batchTarget), { code: 'AUTOMATION_CASE_BUSY' });
    assert.ok(await db.prepare('SELECT id FROM test_cases WHERE id=?').get(batchTarget));
  } finally {
    pause?.release.resolve();
    await Promise.all([obs.close(), db.close()]);
  }
});
