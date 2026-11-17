const test = require('node:test');
const assert = require('node:assert/strict');

test('authoring admission serializes build/recorder claims and honors durable import completion in PostgreSQL', {
  skip: process.env.AUTOMATION_ADMISSION_POSTGRES_TEST !== '1', timeout: 60000
}, async t => {
  const target = new URL(process.env.DATABASE_URL);
  assert.match(target.pathname, /^\/agent_verify_authoring_admission_[0-9]+$/);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname));
  assert.equal(process.env.DATABASE_URL, process.env.OBS_DATABASE_URL);
  const db = require('@hellotest/platform/backend/src/db'), obsDb = require('@hellotest/platform/backend/src/obsDb');
  try {
    await db.query(`CREATE TABLE app_types(id TEXT PRIMARY KEY,project_id TEXT NOT NULL);
      CREATE TABLE test_cases(id TEXT PRIMARY KEY,app_type_id TEXT REFERENCES app_types(id));
      CREATE TABLE automation_case_links(manual_test_case_id TEXT REFERENCES test_cases(id),automation_test_case_id TEXT REFERENCES test_cases(id));
      CREATE TABLE workspace_transactions(id TEXT PRIMARY KEY,project_id TEXT,app_type_id TEXT,category TEXT,action TEXT,status TEXT,metadata JSONB,related_kind TEXT,related_id TEXT,created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE automation_generator_jobs(id TEXT PRIMARY KEY,transaction_id TEXT,project_id TEXT,test_case_id TEXT,status TEXT,created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP);`);
    for (const statement of require('../../backend/recordingImportSchema').statements) await db.query(statement);
    await db.query("INSERT INTO app_types VALUES('app','project'),('other-app','other-project'); INSERT INTO test_cases VALUES('manual','app'),('automation','app'),('other','other-app'); INSERT INTO automation_case_links VALUES('manual','automation');");
    const admission = require('../../backend/services/automationAuthoringAdmission.service').createAuthoringAdmission({ db, obsDb });
    const scope = { testCase: { id: 'manual', app_type_id: 'app', project_id: 'project' } };
    const reserve = (id, action, status = 'running', metadata = {}) => obsDb.prepare("INSERT INTO workspace_transactions(id,project_id,app_type_id,category,action,status,metadata,related_kind,related_id) VALUES(?,'project','app','automation_build',?,?,?,'test_case','manual') RETURNING id").get(id, action, status, metadata);
    const clear = () => db.query('TRUNCATE workspace_transactions,automation_generator_jobs,automation_recording_imports');

    await t.test('simultaneous build and recorder admission grants exactly one reservation', async () => {
      let release, entered;
      const claimed = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
      const building = admission.withBuild(scope, async () => { entered();await gate;return reserve('build', 'test_case_automation_build'); });
      await claimed;
      const recording = admission.withRecorder(scope, () => reserve('recording', 'test_case_recorder'));
      release();
      const [build, record] = await Promise.allSettled([building, recording]);
      assert.equal(build.status, 'fulfilled');assert.equal(record.status, 'rejected');
      assert.equal(record.reason.code, 'AUTOMATION_AUTHORING_BUSY');assert.equal(record.reason.details.activity_id, 'build');
      assert.equal((await obsDb.prepare('SELECT count(*)::int AS count FROM workspace_transactions').get()).count, 1);
      const state = await admission.state(scope);
      assert.equal(state.state, 'building');assert.equal(state.can_record, false);
      await clear();
    });

    await t.test('a recorder claim blocks direct and linked-case builds before their reservation callbacks', async () => {
      await admission.withRecorder(scope, () => reserve('recording', 'test_case_recorder'));
      let called = false;
      for (const id of ['manual', 'automation']) await assert.rejects(admission.withBuild({ testCase: { ...scope.testCase, id } }, () => { called = true; }), { code: 'AUTOMATION_AUTHORING_BUSY' });
      assert.equal(called, false);assert.equal((await admission.state(scope)).can_build, false);
      await clear();
    });

    await t.test('queued batch inputs and leased generator jobs prevent recording without leaking native metadata', async () => {
      await reserve('batch', 'batch_case_automation_build', 'queued', { input_test_case_ids: ['automation'], secret: 'private-fixture-value' });
      await obsDb.prepare("UPDATE workspace_transactions SET related_id='unrelated' WHERE id='batch'").run();
      await assert.rejects(admission.withRecorder(scope, () => assert.fail('No recorder before the batch finishes.')), { code: 'AUTOMATION_AUTHORING_BUSY' });
      assert.ok(!JSON.stringify(await admission.state(scope)).includes('private-fixture-value'));
      await clear();
      await obsDb.prepare("INSERT INTO automation_generator_jobs(id,transaction_id,project_id,test_case_id,status) VALUES('job','generator','project','automation','leased')").run();
      assert.equal((await admission.state(scope)).build.activity_id, 'generator');
      await clear();
    });

    await t.test('a durable saved-plan receipt releases stale running recorder activity; replay never reapplies a later edit', async () => {
      await reserve('recording', 'test_case_recorder');
      const imports = require('../../backend/services/recordingImport.service').createRecordingImportService({ db });
      const input = { projectId: 'project', sourceCaseId: 'manual', userId: 'author', sessionId: 'session', transactionId: 'recording' };
      let writes = 0;
      await imports.commit(input, 'automation', async () => { writes++;return { test_case_id: 'automation', generated_step_count: 1 }; });
      assert.equal((await admission.state(scope)).state, 'idle');
      await admission.withBuild(scope, () => reserve('after-save', 'test_case_automation_build'));
      await imports.commit(input, 'automation', async () => { writes++;assert.fail('A receipt retry must not overwrite later edits.'); });
      assert.equal(writes, 1);
      assert.equal((await db.prepare('SELECT transaction_id FROM automation_recording_imports').get()).transaction_id, 'recording');
      await clear();
    });

    await t.test('scope drift, cross-project selection and malformed scope fail before reserving', async () => {
      for (const input of [{}, { testCase: scope.testCase, caseIds: ['missing'] }, { testCase: scope.testCase, caseIds: ['other'] }]) {
        await assert.rejects(admission.state(input), error => /^AUTOMATION_AUTHORING_SCOPE_/.test(error.code));
      }
      assert.equal((await obsDb.prepare('SELECT count(*)::int AS count FROM workspace_transactions').get()).count, 0);
    });
  } finally { await Promise.all([db.close(), obsDb.close()]); }
});
