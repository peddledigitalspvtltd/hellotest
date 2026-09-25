const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
test('Test Case import preserves authoring relationships, is atomic and keeps durable replay-safe outcomes', { skip: process.env.TEST_CASE_IMPORT_POSTGRES !== '1', timeout: 120000 }, async t => {
  assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/agent_verify_case_import_[a-z0-9_]+$/);
  const db = require('../../src/db'), obsDb = require('../../src/obsDb');
  const service = require('../../../../testing/backend/services/testCase.service');
  const transactions = require('../../services/workspaceTransaction.service');
  const queue = require('../../../../testing/backend/services/batchProcess.service');
  try {
    await db.query(fs.readFileSync(path.resolve(__dirname, '../../instance-setup-data/schema-setup/schema.sql'), 'utf8'));
    await require('../../src/db/bootstrap').ensureRuntimeSchema();
    await db.query(`INSERT INTO users(id,email,password_hash,name) VALUES ('author','author@example.test','no-login','Author'),('reviewer','reviewer@example.test','no-login','Reviewer');
      INSERT INTO projects(id,name) VALUES ('project','Import verification'),('foreign','Foreign');
      INSERT INTO app_types(id,project_id,name,type) VALUES ('web','project','Web','web'),('other','foreign','Other','web');
      INSERT INTO roles(id,name) VALUES ('role','Import member');
      INSERT INTO project_members(id,project_id,user_id,role_id) VALUES ('pa','project','author','role'),('pr','project','reviewer','role');
      INSERT INTO requirements(id,display_id,project_id,title) VALUES ('story','STORY-71','project','Sign in'),('foreign-story','STORY-72','foreign','Foreign');
      INSERT INTO test_suites(id,display_id,app_type_id,name) VALUES ('suite','TS-71','web','Smoke');
      INSERT INTO test_case_modules(id,display_id,app_type_id,name) VALUES ('module','TCM-71','web','Primary'),('inherited','TCM-72','web','Story Module');
      INSERT INTO test_case_module_requirements(module_id,requirement_id) VALUES ('inherited','story');
      INSERT INTO test_data_sets(id,project_id,app_type_id,name,mode,columns,rows) VALUES ('dataset','project','web','Accounts','key_value','["username"]','[{"username":"person"}]'),('foreign-data','foreign','other','Foreign','key_value','[]','[]');`);
    const steps = [{ action: 'Open @base_url', expected_result: 'Login appears', group_kind: 'reusable', group_name: 'Login setup' }, { action: 'Enter @username', expected_result: 'User input accepted', group_kind: 'local', group_name: 'Credentials' }];
    const row = { title: 'Import all metadata', description: 'Detailed\nDescription', status: 'ready', priority: 2, labels: ['smoke','authentication'], author: 'author@example.test', reviewer: 'reviewer@example.test', test_case_type: 'functional', authoring_mode: 'structured', requirements: 'STORY-71', suites: 'TS-71', modules: 'TCM-71', test_data_references: 'dataset', parameter_values: { base_url:'https://example.test', username:'person' }, steps, shared_groups: [{ name:'Login setup', steps:[steps[0]], parameter_values:{base_url:'https://example.test'} }] };
    let receipt, imported;
    await t.test('queued receipt exists before worker execution and results link every authored field', async () => {
      receipt = await queue.queueTestCaseImport({ app_type_id:'web', rows:[row], created_by:'author', import_source:'csv' });
      const queued = await obsDb.prepare('SELECT * FROM batch_process_jobs WHERE transaction_id = ?').get(receipt.transaction_id);
      assert.equal(queued.status,'queued');
      assert.equal((await transactions.getTransaction(receipt.transaction_id)).status,'queued');
      imported = await service.bulkImportTestCases({ app_type_id:'web', rows:[row], created_by:'author', transaction_id:receipt.transaction_id });
      assert.equal(imported.imported,1,JSON.stringify(imported.errors));
      assert.equal(imported.failed,0);
      const item = await service.getTestCase(imported.created[0].id);
      assert.deepEqual(item.labels,['smoke','authentication']);
      assert.equal(item.author_id,'author'); assert.equal(item.reviewer_id,'reviewer'); assert.equal(item.review_status,'pending'); assert.equal(item.status,'draft');
      assert.deepEqual(item.requirement_ids,['story']); assert.deepEqual(item.suite_ids,['suite']);
      assert.deepEqual(item.module_ids.sort(),['inherited','module']); assert.deepEqual(item.test_data_set_ids,['dataset']);
      assert.equal(item.parameter_values.username,'person');
      const stored = await db.prepare('SELECT * FROM test_steps WHERE test_case_id = ? ORDER BY step_order').all(item.id);
      assert.equal(stored.length,2); assert.equal(stored[0].group_kind,'reusable'); assert.ok(stored[0].reusable_group_id); assert.equal(stored[1].group_kind,'local');
      assert.notEqual(stored[0].group_id,stored[1].group_id);
      const artifact = await transactions.getTransactionArtifact(imported.artifact_id);
      const result = JSON.parse(artifact.content);
      assert.equal(result.created[0].id,item.id); assert.match(result.created[0].display_id,/^TC[-_]/); assert.equal(result.transaction_id,receipt.transaction_id);
    });
    await t.test('retry preserves edited imported case and never overwrites an existing shared group', async () => {
      const id = imported.created[0].id;
      await db.prepare('UPDATE test_cases SET title = ? WHERE id = ?').run('Author edited after import',id);
      const replay = await service.bulkImportTestCases({ app_type_id:'web', rows:[row], created_by:'author', transaction_id:receipt.transaction_id });
      assert.equal(replay.created[0].id,id); assert.equal((await service.getTestCase(id)).title,'Author edited after import');
      assert.equal((await db.prepare('SELECT COUNT(*)::int AS count FROM test_cases').get()).count,1);
      const original = await db.prepare("SELECT steps FROM shared_step_groups WHERE name = 'Login setup'").get();
      const second = await service.bulkImportTestCases({app_type_id:'web',created_by:'author',rows:[{...row,title:'Another import',steps:[{...steps[0],action:'Imported snapshot variation'}]}]});
      assert.equal(second.imported,1,JSON.stringify(second.errors));
      assert.deepEqual((await db.prepare("SELECT steps FROM shared_step_groups WHERE name = 'Login setup'").get()).steps, original.steps);
    });
    await t.test('invalid rows fail individually, roll back side effects and persist complete failure evidence', async () => {
      const result = await service.bulkImportTestCases({app_type_id:'web',created_by:'author',rows:[
        {title:'Missing Story',requirements:'STORY-72'},
        {title:'Foreign data',test_data_references:'foreign-data'},
        {title:'Unknown explicit Suite',suite_ids:['nonexistent-suite-id']},
        {title:'Multiple primary modules',modules:'Primary|Story Module'},
        {title:'Rollback suite and group',suites:'Must roll back',shared_groups:[{name:'Rollback group',steps:[{action:'Temporary'}]}],steps:[{action:'Missing reference',group_kind:'reusable',reusable_group_id:'foreign-group'}]},
        {title:'Invalid priority',priority:200},
        {title:'Valid unaffected row',steps:[{action:'Check',expected_result:'Pass'}]}
      ]});
      assert.equal(result.imported,1); assert.equal(result.failed,6);
      assert.equal((await db.prepare("SELECT COUNT(*)::int AS count FROM test_suites WHERE name = 'Must roll back'").get()).count,0);
      assert.equal((await db.prepare("SELECT COUNT(*)::int AS count FROM shared_step_groups WHERE name = 'Rollback group'").get()).count,0);
      const trace=JSON.parse((await transactions.getTransactionArtifact(result.artifact_id)).content);
      assert.equal(trace.errors.length,6); assert.equal(trace.errors[0].row,1); assert.match(trace.errors[0].message,/Story not found/);
    });
  } finally { await Promise.all([db.close(),obsDb.close()]); }
});
