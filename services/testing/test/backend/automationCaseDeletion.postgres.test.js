const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

test('automation selection deletion is atomic across live definitions and preserves frozen evidence', {
  skip: process.env.AUTOMATION_DELETE_POSTGRES !== '1', timeout: 120000
}, async t => {
  const primaryUrl = new URL(process.env.DATABASE_URL);
  const observabilityUrl = new URL(process.env.OBS_DATABASE_URL);
  for (const url of [primaryUrl, observabilityUrl]) {
    assert.match(url.pathname, /^\/agent_verify_automation_delete(?:_obs)?$/);
    assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
  }
  assert.equal(process.env.DATABASE_URL, process.env.OBS_DATABASE_URL, 'This release requires observability in the primary physical database.');
  const db = require('@hellotest/platform/backend/src/db');
  const obs = require('@hellotest/platform/backend/src/obsDb');
  try {
    assert.equal((await db.prepare("SELECT to_regclass('public.projects') AS present").get()).present, null, 'Use an empty owned fixture database.');
    assert.equal((await obs.prepare("SELECT to_regclass('public.workspace_transactions') AS present").get()).present, null, 'Use an empty owned observability fixture database.');
    await db.query(fs.readFileSync(path.resolve(__dirname, '../../../platform/backend/instance-setup-data/schema-setup/schema.sql'), 'utf8'));
    await require('../../../platform/backend/src/db/bootstrap').ensureRuntimeSchema();
    await require('../../../platform/backend/src/obsDb/bootstrap').ensureRuntimeSchema();
    // Simulate an existing installation's named/custom live-case FK and prove
    // that the v8 migration safely detaches it and can run more than once.
    await db.query('ALTER TABLE test_engine_jobs ADD CONSTRAINT fixture_legacy_case_fk FOREIGN KEY(test_case_id) REFERENCES test_cases(id) ON DELETE CASCADE');
    for (let iteration = 0; iteration < 2; iteration++) for (const statement of require('../../../platform/backend/src/db/automationCaseDeletionSchema')) await db.query(statement);
    assert.equal((await db.prepare("SELECT COUNT(*)::int AS count FROM pg_constraint WHERE conrelid='test_engine_jobs'::regclass AND confrelid='test_cases'::regclass AND contype='f'").get()).count, 0);
    const originalPrepare = db.prepare.bind(db);
    t.mock.method(db, 'prepare', sql => {
      assert.doesNotMatch(sql, /\b(?:FROM|JOIN)\s+(?:batch_process_jobs|test_engine_jobs)\b/i, 'Read-only execution queue checks must use the observability adapter; generator cancellation uses the primary transaction for atomic rollback.');
      return originalPrepare(sql);
    });
    const deletion = require('../../backend/services/automationCaseDeletion.service');
    const results = require('../../backend/services/executionResult.service');
    const project = randomUUID(), app = randomUUID(), otherApp = randomUUID(), actor = randomUUID();
    await db.prepare("INSERT INTO users(id,email,password_hash,name,status) VALUES(?,?,'not-a-login','Deletion fixture','active')").run(actor, `${actor}@example.test`);
    await db.prepare('INSERT INTO projects(id,name) VALUES(?,?)').run(project, 'Disposable automation deletion');
    const role = await db.prepare('SELECT id FROM roles LIMIT 1').get();
    await db.prepare('INSERT INTO project_members(id,project_id,user_id,role_id) VALUES(?,?,?,?)').run(randomUUID(), project, actor, role.id);
    for (const id of [app, otherApp]) await db.prepare("INSERT INTO app_types(id,project_id,name,type) VALUES(?,?,?,'web')").run(id, project, id);
    const makeCase = async (automated, appId = app) => {
      const id = randomUUID();
      await db.prepare('INSERT INTO test_cases(id,app_type_id,title,automated) VALUES(?,?,?,?)').run(id, appId, `Deletion fixture ${id}`, automated);
      await db.prepare("INSERT INTO test_steps(id,test_case_id,step_order,action,expected_result,step_type,automation_code) VALUES(?,?,1,'Check readiness','Ready is visible','web',?)").run(randomUUID(), id, automated === 'yes' ? "await expect(page.getByText('Ready')).toBeVisible();" : null);
      return db.prepare('SELECT * FROM test_cases WHERE id=?').get(id);
    };
    const manual = await makeCase('no'), first = await makeCase('yes'), second = await makeCase('yes'), untouched = await makeCase('yes'), foreign = await makeCase('yes', otherApp);
    const originalManual = await db.prepare('SELECT * FROM test_cases WHERE id=?').get(manual.id);
    const originalManualSteps = await db.prepare('SELECT * FROM test_steps WHERE test_case_id=? ORDER BY id').all(manual.id);
    const stableDisplayId = untouched.display_id;
    for (const automation of [first, second]) await db.prepare('INSERT INTO automation_case_links(automation_test_case_id,manual_test_case_id,is_primary) VALUES(?,?,TRUE)').run(automation.id, manual.id);
    await db.prepare('UPDATE test_cases SET source_idempotency_key=? WHERE id=?').run(`automation-builder:${manual.id}`, first.id);
    const dataSet = randomUUID(), shared = randomUUID(), suite = randomUUID();
    await db.prepare("INSERT INTO test_data_sets(id,project_id,app_type_id,name,mode,rows) VALUES(?,?,?,'Shared input','key_value',?)").run(dataSet, project, app, [{ name: 'fixture', value: 'ready' }]);
    await db.prepare("INSERT INTO shared_step_groups(id,app_type_id,name,steps) VALUES(?,?,'Reusable instructions',?)").run(shared, app, [{ action: 'Check readiness', expected_result: 'Ready' }]);
    await db.prepare("INSERT INTO test_suites(id,app_type_id,name) VALUES(?,?,'Mixed suite')").run(suite, app);
    for (const item of [manual, first]) {
      await db.prepare('INSERT INTO test_case_data_sets(test_case_id,test_data_set_id) VALUES(?,?)').run(item.id, dataSet);
      await db.prepare('INSERT INTO suite_test_cases(suite_id,test_case_id) VALUES(?,?)').run(suite, item.id);
      await db.prepare('UPDATE test_steps SET reusable_group_id=?,group_kind=? WHERE test_case_id=?').run(shared, 'shared', item.id);
    }
    const run = randomUUID(), snapshotStep = randomUUID();
    await db.prepare("INSERT INTO executions(id,project_id,app_type_id,name,trigger,status,ended_at) VALUES(?,?,?,'Historical run','ci','passed',CURRENT_TIMESTAMP)").run(run, project, app);
    for (const item of [manual, first]) await db.prepare('INSERT INTO execution_case_snapshots(execution_id,test_case_id,test_case_title) VALUES(?,?,?)').run(run, item.id, item.title);
    await db.prepare("INSERT INTO execution_step_snapshots(execution_id,test_case_id,snapshot_step_id,step_order,action,automation_code) VALUES(?,?,?,1,'Frozen instruction','await frozenEvidence();')").run(run, first.id, snapshotStep);
    const rawManual = await results.createExecutionResult({ execution_id: run, test_case_id: manual.id, app_type_id: app, status: 'pending', logs: '{"note":"Keep human evidence untouched"}' });
    const source = await results.createExecutionResult({ execution_id: run, test_case_id: first.id, app_type_id: app, status: 'passed', logs: '{"screenshots":["evidence.png"],"note":"Frozen source evidence"}' });
    const beforeSource = await db.prepare('SELECT * FROM execution_results WHERE id=?').get(source.id);
    const beforeManualResult = await db.prepare('SELECT * FROM execution_results WHERE id=?').get(rawManual.id);
    assert.ok((await results.getExecutionResults({ execution_id: run })).some(row => row.derived && row.test_case_id === manual.id));
    const input = { project_id: project, app_type_id: app, test_case_ids: [first.id, second.id] };
    const actorOptions = { actorId: actor, ipAddress: '127.0.0.1' };
    const remains = async () => assert.equal((await db.prepare('SELECT COUNT(*)::int AS count FROM test_cases WHERE id IN(?,?)').get(first.id, second.id)).count, 2);
    for (const invalid of [manual.id, foreign.id]) {
      await assert.rejects(deletion.deleteAutomationCases({ ...input, test_case_ids: [first.id, invalid] }, actorOptions), error => error.code === 'AUTOMATION_SCOPE_MISMATCH');
      await remains();
    }
    await assert.rejects(deletion.deleteAutomationCases({ ...input, test_case_ids: [first.id, randomUUID()] }, actorOptions), error => error.code === 'AUTOMATION_SELECTION_CHANGED');
    await remains();

    // Real queue records use the observability adapter; the primary adapter
    // assertion above catches an accidental cross-store ownership regression.
    const generator = randomUUID();
    await obs.prepare("INSERT INTO automation_generator_jobs(id,transaction_id,project_id,app_type_id,test_case_id,status) VALUES(?,?,?,?,?,'leased')").run(generator, randomUUID(), project, app, manual.id);
    await assert.rejects(deletion.deleteAutomationCases(input, actorOptions), error => error.code === 'AUTOMATION_CASE_BUSY');
    await obs.prepare("UPDATE automation_generator_jobs SET status='completed' WHERE id=?").run(generator);
    const batch = randomUUID(), batchTransaction = randomUUID();
    await obs.prepare("INSERT INTO workspace_transactions(id,project_id,app_type_id,category,action,title,status) VALUES(?,?,?,'automation_build','automation_build','Build fixture','running')").run(batchTransaction, project, app);
    await obs.prepare("INSERT INTO batch_process_jobs(id,transaction_id,operation,payload,status) VALUES(?,?,'automation_build',?,'queued')").run(batch, batchTransaction, { app_type_id: app, test_case_ids: [second.id] });
    await assert.rejects(deletion.deleteAutomationCases(input, actorOptions), error => error.code === 'AUTOMATION_CASE_BUSY');
    await obs.prepare("UPDATE batch_process_jobs SET status='completed' WHERE id=?").run(batch);
    const activeRun = randomUUID(), queued = randomUUID(), direct = randomUUID();
    await db.prepare("INSERT INTO executions(id,project_id,app_type_id,trigger,status) VALUES(?,?,?,'ci','running')").run(activeRun, project, app);
    await obs.prepare("INSERT INTO test_engine_jobs(id,engine_run_id,project_id,app_type_id,execution_id,test_case_id,test_case_title,status) VALUES(?,?,?,?,?,?,?,'queued')").run(queued, randomUUID(), project, app, activeRun, second.id, second.title);
    await assert.rejects(deletion.deleteAutomationCases(input, actorOptions), error => error.code === 'AUTOMATION_CASE_BUSY');
    await obs.prepare("UPDATE test_engine_jobs SET status='completed',completed_at=CURRENT_TIMESTAMP WHERE id=?").run(queued);
    await obs.prepare("INSERT INTO workspace_transactions(id,project_id,app_type_id,category,action,title,status,metadata) VALUES(?,?,?,'execution','testengine_run','Direct fixture','running',?)").run(direct, project, app, { execution_id: activeRun, test_case_id: first.id });
    await assert.rejects(deletion.deleteAutomationCases(input, actorOptions), error => error.code === 'AUTOMATION_CASE_BUSY');
    await db.prepare("UPDATE executions SET status='passed',ended_at=CURRENT_TIMESTAMP WHERE id=?").run(activeRun);
    await obs.prepare("INSERT INTO workspace_transaction_artifacts(id,transaction_id,file_name,mime_type,content) VALUES(?,?,'evidence.txt','text/plain','Retained evidence')").run(randomUUID(), direct);

    // Force a database failure after the first live step delete and audit write.
    // PostgreSQL must roll the entire mutation back, including current links.
    await db.query(`CREATE FUNCTION block_fixture_automation_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.id = '${second.id}' THEN RAISE EXCEPTION 'Fixture blocks deletion'; END IF; RETURN OLD; END $$`);
    await db.query('CREATE TRIGGER fixture_automation_delete BEFORE DELETE ON test_cases FOR EACH ROW EXECUTE FUNCTION block_fixture_automation_delete()');
    await assert.rejects(deletion.deleteAutomationCases(input, actorOptions), /Fixture blocks deletion/);
    await remains();
    assert.equal((await db.prepare('SELECT COUNT(*)::int AS count FROM test_steps WHERE test_case_id IN(?,?)').get(first.id, second.id)).count, 2);
    assert.equal((await db.prepare('SELECT COUNT(*)::int AS count FROM automation_case_links WHERE manual_test_case_id=?').get(manual.id)).count, 2);
    assert.equal((await db.prepare("SELECT COUNT(*)::int AS count FROM admin_audit_log WHERE action='automation_case.bulk_delete'").get()).count, 0);
    await db.query('DROP TRIGGER fixture_automation_delete ON test_cases');
    await db.query('DROP FUNCTION block_fixture_automation_delete()');

    const receipts = await Promise.all([deletion.deleteAutomationCases(input, actorOptions), deletion.deleteAutomationCases({ ...input, test_case_ids: [...input.test_case_ids].reverse() }, actorOptions)]);
    assert.equal(receipts[0].operation_id, receipts[1].operation_id);
    assert.equal(receipts.filter(row => row.idempotent_replay).length, 1);
    assert.equal(receipts[0].deleted_count, 2);
    assert.deepEqual(receipts[0].unlinked_manual_case_ids, [manual.id]);
    assert.equal(receipts[0].retained_run_count, 1);
    assert.equal(receipts[0].retained_result_count, 1);
    assert.equal((await db.prepare("SELECT COUNT(*)::int AS count FROM admin_audit_log WHERE action='automation_case.bulk_delete'").get()).count, 1);
    assert.equal((await db.prepare('SELECT COUNT(*)::int AS count FROM test_cases WHERE id IN(?,?)').get(first.id, second.id)).count, 0);
    assert.deepEqual(await db.prepare('SELECT * FROM test_cases WHERE id=?').get(manual.id), originalManual);
    // Shared-reference assignment happened after the initial snapshot.
    assert.deepEqual((await db.prepare('SELECT * FROM test_steps WHERE test_case_id=? ORDER BY id').all(manual.id)).map(row => ({ ...row, reusable_group_id: null, group_kind: null })), originalManualSteps);
    assert.deepEqual(await db.prepare('SELECT * FROM execution_results WHERE id=?').get(rawManual.id), beforeManualResult);
    assert.deepEqual(await db.prepare('SELECT * FROM execution_results WHERE id=?').get(source.id), beforeSource);
    assert.equal((await results.getExecutionResults({ execution_id: run })).some(row => row.derived), false);
    assert.equal((await results.getExecutionResult(source.id)).logs, beforeSource.logs);
    assert.equal((await db.prepare('SELECT COUNT(*)::int AS count FROM automation_case_links WHERE manual_test_case_id=?').get(manual.id)).count, 0);
    assert.equal((await db.prepare('SELECT COUNT(*)::int AS count FROM execution_case_snapshots WHERE execution_id=?').get(run)).count, 2);
    assert.equal((await db.prepare('SELECT automation_code FROM execution_step_snapshots WHERE snapshot_step_id=?').get(snapshotStep)).automation_code, 'await frozenEvidence();');
    assert.ok(await db.prepare('SELECT id FROM test_data_sets WHERE id=?').get(dataSet));
    assert.ok(await db.prepare('SELECT id FROM shared_step_groups WHERE id=?').get(shared));
    assert.deepEqual((await db.prepare('SELECT test_case_id FROM suite_test_cases WHERE suite_id=?').all(suite)).map(row => row.test_case_id), [manual.id]);
    assert.equal((await db.prepare('SELECT COUNT(*)::int AS count FROM test_case_data_sets WHERE test_case_id=? AND test_data_set_id=?').get(manual.id, dataSet)).count, 1);
    assert.equal((await db.prepare('SELECT display_id FROM test_cases WHERE id=?').get(untouched.id)).display_id, stableDisplayId);
    assert.equal((await obs.prepare('SELECT content FROM workspace_transaction_artifacts WHERE transaction_id=?').get(direct)).content, 'Retained evidence');
    assert.ok(await obs.prepare('SELECT id FROM test_engine_jobs WHERE id=?').get(queued));

    // Retention must remain useful through the actual API, including its
    // execution hydration and project access checks after the live AT is gone.
    const executionService = require('../../backend/services/execution.service');
    const historicalRun = await executionService.getExecution(run, true);
    assert.ok(historicalRun.case_snapshots.some(row => row.test_case_id === first.id));
    assert.equal(historicalRun.step_snapshots.find(row => row.snapshot_step_id === snapshotStep).automation_code, 'await frozenEvidence();');
    const historicalItems = await require('../../backend/services/executionHistory.service').list({ projectId: project, testCaseId: first.id });
    assert.ok(historicalItems.some(row => row.id === source.id && row.test_case_title === first.title));
    const api = require('fastify')();
    let denyEvidence = false;
    const requiredPermissions = [];
    api.decorate('authenticate', async req => { req.user = { id: actor, role: 'member' }; });
    api.decorate('validate', () => {});
    api.decorate('requirePermission', (permission, { projectId } = {}) => async () => {
      requiredPermissions.push({ permission, projectId });
      if (denyEvidence) throw Object.assign(new Error('Evidence is restricted.'), { statusCode: 403 });
    });
    try {
      await api.register(require('../../backend/routes/executionResults.routes'));
      const detail = await api.inject({ method: 'GET', url: `/execution-results/${source.id}` });
      assert.equal(detail.statusCode, 200);
      assert.equal(detail.json().logs, beforeSource.logs);
      const listed = await api.inject({ method: 'GET', url: `/execution-results?execution_id=${run}&test_case_id=${first.id}` });
      assert.equal(listed.statusCode, 200);
      assert.ok(listed.json().some(row => row.id === source.id && row.status === 'passed'));
      assert.ok(requiredPermissions.every(row => row.permission === 'result.view' && row.projectId === project));
      denyEvidence = true;
      assert.equal((await api.inject({ method: 'GET', url: `/execution-results/${source.id}` })).statusCode, 403);
    } finally {
      await api.close();
    }

    const single = await makeCase('yes');
    const singleReceipt = await require('../../backend/services/testCase.service').deleteTestCase(single.id, { deleted_by: actor });
    assert.equal(singleReceipt.deleted_count, 1);
    assert.ok(await db.prepare('SELECT id FROM test_cases WHERE id=?').get(manual.id));
  } finally {
    await obs.close();
    await db.close();
  }
});
