const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

test('PostgreSQL serializes concurrent completion callbacks and preserves one final result and evidence receipt', {
  skip: process.env.AUTOMATION_EXECUTION_POSTGRES !== '1', timeout: 90000
}, async () => {
  const primary = new URL(process.env.DATABASE_URL);
  const observation = new URL(process.env.OBS_DATABASE_URL);
  assert.match(primary.pathname, /^\/agent_verify_automation_[a-z0-9_]+$/);
  assert.equal(primary.href, observation.href);
  const db = require('@hellotest/platform/backend/src/db');
  const obsDb = require('@hellotest/platform/backend/src/obsDb');
  try {
    assert.equal((await db.prepare("SELECT to_regclass('public.projects') AS present").get()).present, null, 'Only a new, empty disposable database is accepted.');
    await db.query(fs.readFileSync(path.resolve(__dirname, '../../../platform/backend/instance-setup-data/schema-setup/schema.sql'), 'utf8'));
    await require('../../../platform/backend/src/db/bootstrap').ensureRuntimeSchema();
    const dispatch = require('../../backend/services/testEngineDispatch.service');
    const workspace = require('@hellotest/platform/backend/services/workspaceTransaction.service');
    const projectId = randomUUID(), appTypeId = randomUUID(), caseId = randomUUID(), executionId = randomUUID(), jobId = randomUUID(), dataSetId = randomUUID(), stepId = randomUUID();
    await db.prepare('INSERT INTO projects(id,name) VALUES(?,?)').run(projectId, 'Disposable execution callback checks');
    await db.prepare("INSERT INTO app_types(id,project_id,name,type) VALUES(?,?,?,'web')").run(appTypeId, projectId, 'Browser fixture');
    await db.prepare("INSERT INTO test_cases(id,app_type_id,title,automated,automation_status) VALUES(?,?,?,'yes','ready')").run(caseId, appTypeId, 'Frozen case');
    await db.prepare("INSERT INTO executions(id,project_id,app_type_id,name,trigger,status) VALUES(?,?,?,?,'ci','running')").run(executionId, projectId, appTypeId, 'Frozen execution');
    const snapshot = { mode: 'table', columns: ['t.email'], rows: [{ 't.email': 'first' }, { 't.email': 'second' }] };
    await db.prepare("INSERT INTO execution_case_snapshots(execution_id,test_case_id,test_case_title,test_data_set_id,test_data_set_snapshot,data_set_source) VALUES(?,?,?,?,?,'test_case')").run(executionId, caseId, 'Frozen case', dataSetId, snapshot);
    const transaction = await workspace.createTransaction({ project_id: projectId, app_type_id: appTypeId, category: 'automation', action: 'testengine_run', status: 'running', title: 'Concurrent callback fixture' });
    const payload = {
      parameter_scope_default: 't', parameters_frozen: true,
      data_set: { id: dataSetId, name: 'Frozen rows', mode: 'table', rows: [snapshot.rows[1]], iteration: { index: 1, key: 'second', total: 2 } },
      steps: [{ id: stepId, order: 1, step_type: 'web', action: 'Confirm readiness', automation_code: 'await web.expectText("h1", "Ready");' }]
    };
    const runtime = { logs: { stepStatuses: { [stepId]: 'passed' }, stepNotes: { [stepId]: 'Readiness confirmed' }, stepCaptures: { [stepId]: { 't.receipt': 'original' } } } };
    await obsDb.prepare("INSERT INTO test_engine_jobs(id,engine_run_id,project_id,app_type_id,execution_id,test_case_id,test_case_title,transaction_id,payload,runtime_state,status,started_at) VALUES(?,?,?,?,?,?,?,?,?,?,'running',CURRENT_TIMESTAMP)").run(jobId, randomUUID(), projectId, appTypeId, executionId, caseId, 'Frozen case', transaction.id, payload, runtime);
    const input = { job_id: jobId, status: 'passed', artifact_bundle: { artifact_refs: [{ file_name: 'trace.zip', content_type: 'application/zip', content_base64: 'YQ==' }] } };

    // Hold the row externally until both real callback transactions are waiting
    // for its PostgreSQL lock. No in-process mutex or mocked adapter is used.
    const blocker = await obsDb.pool.connect();
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM test_engine_jobs WHERE id=$1 FOR UPDATE', [jobId]);
    const completions = Promise.all([dispatch.completeQueuedJob(input), dispatch.completeQueuedJob(input)]);
    try {
      let waiting = 0;
      for (let attempt = 0; attempt < 100 && waiting < 2; attempt += 1) {
        waiting = Number((await db.query("SELECT COUNT(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'")).rows[0].count);
        if (waiting < 2) await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.equal(waiting, 2, 'Both callbacks contend on the persisted job lock.');
    } finally {
      await blocker.query('COMMIT');
      blocker.release();
    }
    const receipts = await completions;
    assert.deepEqual(receipts[0], receipts[1]);
    assert.equal(receipts[0].status, 'passed');
    const saved = await db.prepare('SELECT * FROM execution_results WHERE execution_id=?').all(executionId);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].id, receipts[0].execution_result_id);
    assert.equal(saved[0].data_set_iteration_index, 1);
    assert.equal(saved[0].test_data_set_id, dataSetId);
    assert.deepEqual(saved[0].data_set_row_snapshot, snapshot.rows[1]);
    assert.equal((await workspace.listTransactionArtifacts(transaction.id)).length, 1);
    assert.equal((await obsDb.prepare("SELECT COUNT(*)::int AS count FROM workspace_transaction_events WHERE transaction_id=? AND phase='run.completed'").get(transaction.id)).count, 1);
    assert.equal((await obsDb.prepare('SELECT status FROM test_engine_jobs WHERE id=?').get(jobId)).status, 'completed');

    const late = await dispatch.reportQueuedStep({ job_id: jobId, step_id: stepId, status: 'failed', captures: { receipt: 'changed' }, note: 'Late update' });
    assert.equal(late.status, 'passed');
    assert.deepEqual(late.captures, { 't.receipt': 'original' });
    await assert.rejects(dispatch.startQueuedJob({ job_id: jobId, worker_id: 'late-worker' }), error => error.statusCode === 409 && error.receipt.execution_result_id === saved[0].id);
    assert.equal((await dispatch.completeQueuedJob({ job_id: jobId, status: 'failed' })).status, 'passed');
    assert.equal((await db.prepare('SELECT status FROM execution_results WHERE id=?').get(saved[0].id)).status, 'passed');
    assert.equal((await workspace.listTransactionArtifacts(transaction.id)).length, 1);
  } finally {
    await obsDb.close();
    await db.close();
  }
});
