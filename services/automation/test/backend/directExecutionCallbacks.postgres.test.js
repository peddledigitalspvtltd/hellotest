const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHmac } = require('node:crypto');

test('distinct concurrent signed finals preserve the first dispatched attempt receipt while a new attempt can execute', {
  skip: process.env.AUTOMATION_CALLBACK_POSTGRES !== '1', timeout: 90000
}, async t => {
  const primary = new URL(process.env.DATABASE_URL), observation = new URL(process.env.OBS_DATABASE_URL);
  assert.match(primary.pathname, /^\/agent_verify_automation_[a-z0-9_]+$/);
  assert.equal(primary.href, observation.href);
  const db = require('@hellotest/platform/backend/src/db'), obsDb = require('@hellotest/platform/backend/src/obsDb');
  const secret = 'disposable-direct-callback-concurrency-secret';
  const previous = process.env.HELLOTEST_TESTENGINE_SECRET;
  process.env.HELLOTEST_TESTENGINE_SECRET = secret;
  t.after(() => { if (previous === undefined) delete process.env.HELLOTEST_TESTENGINE_SECRET; else process.env.HELLOTEST_TESTENGINE_SECRET = previous; });
  try {
    if (!(await db.prepare("SELECT to_regclass('public.projects') AS present").get()).present) {
      await db.query(fs.readFileSync(path.resolve(__dirname, '../../../platform/backend/instance-setup-data/schema-setup/schema.sql'), 'utf8'));
      await require('../../../platform/backend/src/db/bootstrap').ensureRuntimeSchema();
    } else {
      assert.ok(await db.prepare("SELECT id FROM projects WHERE name IN ('Disposable execution callback checks','Disposable direct callback checks') LIMIT 1").get(), 'Only an owned disposable callback fixture database can be reused.');
    }
    const callbacks = require('../../backend/services/testEngineCallback.service');
    const workspace = require('@hellotest/platform/backend/services/workspaceTransaction.service');
    const projectId = randomUUID(), appTypeId = randomUUID(), caseId = randomUUID(), executionId = randomUUID(), engineRunId = randomUUID(), stepId = randomUUID(), dataSetId = randomUUID();
    await db.prepare('INSERT INTO projects(id,name) VALUES(?,?)').run(projectId, 'Disposable direct callback checks');
    await db.prepare("INSERT INTO app_types(id,project_id,name,type) VALUES(?,?,?,'web')").run(appTypeId, projectId, 'Signed callback fixture');
    await db.prepare("INSERT INTO test_cases(id,app_type_id,title,automated,automation_status) VALUES(?,?,?,'yes','ready')").run(caseId, appTypeId, 'Signed final case');
    await db.prepare("INSERT INTO executions(id,project_id,app_type_id,name,trigger,status) VALUES(?,?,?,?,'local','running')").run(executionId, projectId, appTypeId, 'Direct callback fixture');
    await db.prepare("INSERT INTO execution_case_snapshots(execution_id,test_case_id,test_case_title,test_data_set_id,test_data_set_snapshot,data_set_source) VALUES(?,?,?,?,?,'test_case')").run(executionId, caseId, 'Signed final case', dataSetId, { mode: 'table', columns: ['t.row'], rows: [{ 't.row': 'one' }, { 't.row': 'two' }] });
    await db.prepare("INSERT INTO execution_step_snapshots(execution_id,test_case_id,snapshot_step_id,step_order,action,step_type,automation_code) VALUES(?,?,?,1,'Confirm readiness','web','await web.expectText(\"h1\", \"Ready\");')").run(executionId, caseId, stepId);
    const createDispatch = async id => workspace.createTransaction({ project_id: projectId, app_type_id: appTypeId, category: 'automation', action: 'testengine_run', status: 'running', title: 'Signed callback fixture', related_kind: 'testengine_run', related_id: id,
      metadata: { source: 'hellotest.local-run', queue_mode: 'direct-local', execution_id: executionId, test_case_id: caseId } });
    const transaction = await createDispatch(engineRunId);
    const payload = (status, id = engineRunId) => ({ engine_run_id: id, hellotest_run_id: executionId, hellotest_test_case_id: caseId, event: status === 'passed' ? 'run.completed' : 'run.failed', state: status === 'passed' ? 'completed' : 'failed', summary: `Distinct final ${status}`,
      data_set_iteration: { index: 0, key: 'one' }, case_result: { status, logs: { stepStatuses: { [stepId]: status } } }, artifact_bundle: { artifact_refs: [{ file_name: `${status}.zip`, content_base64: 'YQ==' }] } });
    const send = async value => {
      const rawPayload = JSON.stringify(value);
      return callbacks.handleRunCallback({ payload: value, rawPayload, headers: { 'x-hellotest-engine-signature': createHmac('sha256', secret).update(rawPayload).digest('hex') } });
    };
    const blocker = await obsDb.pool.connect();
    await blocker.query('BEGIN');
    await blocker.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))', ['hellotest.engine-callback', engineRunId]);
    const inputs = [payload('passed'), payload('failed')];
    const deliveries = Promise.all(inputs.map(send));
    try {
      let waiting = 0;
      for (let attempt = 0; attempt < 200 && waiting < 2; attempt += 1) {
        waiting = Number((await db.query("SELECT COUNT(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'")).rows[0].count);
        if (waiting < 2) await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.equal(waiting, 2, 'Both signed final deliveries wait on the persisted attempt lock.');
    } finally {
      await blocker.query('COMMIT'); blocker.release();
    }
    const receipts = await deliveries;
    const winner = receipts.findIndex(receipt => !receipt.stale);
    assert.ok(winner >= 0);
    assert.equal(receipts.filter(receipt => receipt.stale).length, 1);
    assert.equal(receipts[0].execution_result_id, receipts[1].execution_result_id);
    let saved = await db.prepare('SELECT * FROM execution_results WHERE execution_id=?').all(executionId);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].status, inputs[winner].case_result.status);
    assert.equal((await workspace.listTransactionArtifacts(transaction.id)).length, 1);
    assert.equal((await obsDb.prepare('SELECT COUNT(*)::int AS count FROM workspace_transaction_events WHERE transaction_id=?').get(transaction.id)).count, 1);
    const late = await send(payload(saved[0].status === 'passed' ? 'failed' : 'passed'));
    assert.equal(late.stale, true);
    assert.equal((await db.prepare('SELECT status FROM execution_results WHERE id=?').get(saved[0].id)).status, saved[0].status);

    const nextEngineRunId = randomUUID();
    await createDispatch(nextEngineRunId);
    const nextStatus = saved[0].status === 'passed' ? 'failed' : 'passed';
    const next = await send(payload(nextStatus, nextEngineRunId));
    assert.notEqual(next.stale, true, 'A separately dispatched attempt retains its own lifecycle.');
    assert.equal((await db.prepare('SELECT status FROM execution_results WHERE execution_id=?').get(executionId)).status, nextStatus);
  } finally {
    await obsDb.close(); await db.close();
  }
});
