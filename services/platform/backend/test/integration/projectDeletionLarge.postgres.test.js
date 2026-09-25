const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('large project deletion batches SQL, handles legacy scopes and preserves unrelated records atomically', {
  skip: process.env.PROJECT_DELETION_LARGE_POSTGRES !== '1', timeout: 180000
}, async t => {
  const url = new URL(process.env.DATABASE_URL);
  assert.match(url.pathname.slice(1), /^agent_verify_project_deletion_[a-z0-9_]+$/);
  process.env.POSTGRES_URL = process.env.OBS_DATABASE_URL = process.env.OBS_POSTGRES_URL = url.toString();
  const db = require('../../src/db');
  const { deleteProjectData, PROJECT_DELETION_INDEXES } = require('../../services/projectDeletion.repository');
  try {
    assert.equal((await db.query("SELECT to_regclass('public.projects') AS name")).rows[0].name, null, 'An empty disposable database is required');
    await db.query(fs.readFileSync(path.resolve(__dirname, '../../instance-setup-data/schema-setup/schema.sql'), 'utf8'));
    await require('../../src/db/bootstrap').ensureRuntimeSchema();
    // Exercise the exact worker preflight SQL outside a transaction. Parent-key
    // index coverage is necessary even when very few rows contain non-null FKs.
    for (const index of PROJECT_DELETION_INDEXES) await db.query(index.sql);
    await db.query(`
      INSERT INTO users(id,email,password_hash,name) VALUES ('owner','owner@example.test','unused','Owner');
      INSERT INTO projects(id,name,created_by) VALUES ('large','Large deletion fixture','owner'),('keep','Retained project','owner');
      INSERT INTO app_types(id,project_id,name,type) VALUES ('large-app','large','Large app','web'),('keep-app','keep','Retained app','web');
      INSERT INTO requirements(id,project_id,title) VALUES ('large-story','large','Story'),('keep-story','keep','Retained Story');
      INSERT INTO test_suites(id,app_type_id,name,parent_id) VALUES ('large-root','large-app','Root',NULL),('large-child','large-app','Child','large-root'),('keep-suite','keep-app','Retained',NULL);
      INSERT INTO test_cases(id,app_type_id,suite_id,title)
        SELECT 'large-case-'||LPAD(n::text,6,'0'),'large-app','large-child','Case '||n FROM generate_series(1,100000) n;
      INSERT INTO test_cases(id,app_type_id,suite_id,title)
        SELECT 'keep-case-'||LPAD(n::text,6,'0'),'keep-app','keep-suite','Retained '||n FROM generate_series(1,50000) n;
      INSERT INTO test_steps(id,test_case_id,step_order,action) SELECT 'step-'||id,id,1,'Check' FROM test_cases WHERE app_type_id='large-app';
      INSERT INTO test_case_versions(id,test_case_id,revision,snapshot)
        SELECT 'version-'||id,id,1,'{}'::jsonb FROM test_cases WHERE app_type_id='large-app';
      INSERT INTO test_data_sets(id,project_id,name,mode) VALUES ('large-data','large','Data','table');
      INSERT INTO test_case_data_set_link_archive(test_case_id,test_data_set_id,sort_order) VALUES ('large-case-000001','large-data',1);
      INSERT INTO test_cases(id,title,requirement_id) VALUES ('legacy-owned','Legacy owned','large-story'),('legacy-mapped','Legacy mapped',NULL),('legacy-shared','Shared legacy','keep-story');
      INSERT INTO requirement_test_cases(requirement_id,test_case_id) VALUES ('large-story','legacy-mapped'),('large-story','legacy-shared');
      UPDATE test_cases SET manual_test_case_id='large-case-000001',requirement_id='large-story',suite_id='large-child' WHERE id='keep-case-000001';
      INSERT INTO executions(id,project_id,name) VALUES ('large-run','large','Owned run'),('keep-run','keep','Retained run');
      INSERT INTO notifications(id,run_id,type,title,message)
        SELECT 'legacy-notification-'||n,'large-run','execution','Finished','Run finished' FROM generate_series(1,1100) n;
      INSERT INTO notifications(id,run_id,type,title,message) VALUES ('keep-notification','keep-run','execution','Finished','Retained run finished');
    `);
    const before = (await db.query('SELECT count(*)::integer AS count FROM test_cases')).rows[0].count;
    const client = { query: db.query };
    await t.test('a foreign mandatory application relationship rejects before deleting any data', async () => {
      await db.query("INSERT INTO executions(id,project_id,app_type_id,name) VALUES ('foreign-run','keep','large-app','Foreign run')");
      await assert.rejects(db.transaction(() => deleteProjectData({ client, projectId: 'large' }))(), { code: 'PROJECT_DELETION_SCOPE_CONFLICT' });
      assert.equal((await db.query('SELECT count(*)::integer AS count FROM test_cases')).rows[0].count, before);
      await db.query("DELETE FROM executions WHERE id='foreign-run'");
    });
    await t.test('a foreign project notification cannot disappear through a run cascade', async () => {
      await db.query("INSERT INTO notifications(id,project_id,run_id,type,title,message) VALUES ('foreign-notification','keep','large-run','execution','Finished','Foreign notification')");
      await assert.rejects(db.transaction(() => deleteProjectData({ client, projectId: 'large' }))(), { code: 'PROJECT_DELETION_SCOPE_CONFLICT' });
      assert.equal((await db.query("SELECT id FROM notifications WHERE id='foreign-notification'")).rowCount, 1);
      assert.equal((await db.query('SELECT count(*)::integer AS count FROM test_cases')).rows[0].count, before);
      await db.query("DELETE FROM notifications WHERE id='foreign-notification'");
    });
    await t.test('failure after a completed mutation batch rolls back the entire project', async () => {
      await assert.rejects(db.transaction(() => deleteProjectData({
        client, projectId: 'large', batchSize: 1000,
        onProgress: async progress => {
          if (progress.table === 'test_steps' && progress.rows > 0) throw new Error('Injected batch failure');
        }
      }))(), /Injected batch failure/);
      assert.equal((await db.query("SELECT count(*)::integer AS count FROM test_steps")).rows[0].count, 100000);
      assert.equal((await db.query('SELECT count(*)::integer AS count FROM test_cases')).rows[0].count, before);
      assert.equal((await db.query("SELECT id FROM projects WHERE id='large'")).rowCount, 1);
    });
    await t.test('100,000 cases delete with bounded statements and indexed dependency checks', async () => {
      const progress = [];
      const start = performance.now();
      const result = await db.transaction(async () => {
        await db.query("SET LOCAL statement_timeout='15s'");
        return deleteProjectData({ client, projectId: 'large', batchSize: 1000, onProgress: async update => progress.push(update) });
      })();
      const elapsed = performance.now() - start;
      assert.equal(result.deleted, true);
      assert.equal(result.counts['deleted.test_cases'], 100002, 'application-owned plus exclusively scoped legacy cases');
      assert.equal(result.counts['deleted.test_steps'], 100000);
      assert.equal(result.counts['deleted.test_case_versions'], 100000);
      assert.equal(result.counts['deleted.test_case_data_set_link_archive'], 1, 'archive has no FK cascade and must be removed explicitly');
      assert.equal(result.counts['deleted.notifications'], 1100, 'legacy run notifications delete in bounded batches before run cascades');
      assert.deepEqual((await db.query('SELECT id FROM notifications')).rows, [{ id: 'keep-notification' }]);
      assert.ok(progress.filter(item => item.rows > 0).length >= 300);
      assert.ok(progress.every(item => item.rows <= 1000), 'every mutation is bounded');
      assert.equal(progress.at(-1).phase, 'data_deleted');
      assert.deepEqual((await db.query('SELECT id FROM projects')).rows, [{ id: 'keep' }]);
      assert.equal((await db.query("SELECT count(*)::integer AS count FROM test_cases WHERE app_type_id='keep-app'")).rows[0].count, 50000);
      assert.deepEqual((await db.query("SELECT manual_test_case_id,requirement_id,suite_id FROM test_cases WHERE id='keep-case-000001'")).rows[0], { manual_test_case_id: null, requirement_id: null, suite_id: null });
      assert.deepEqual((await db.query("SELECT id,requirement_id FROM test_cases WHERE app_type_id IS NULL")).rows, [{ id: 'legacy-shared', requirement_id: 'keep-story' }]);
      assert.equal((await db.query('SELECT count(*)::integer AS count FROM test_steps')).rows[0].count, 0);
      assert.equal((await db.query('SELECT count(*)::integer AS count FROM test_case_versions')).rows[0].count, 0);
      assert.deepEqual((await db.query('SELECT id FROM test_suites')).rows, [{ id: 'keep-suite' }]);
      assert.equal((await db.query("SELECT count(*)::integer AS count FROM pg_tables WHERE schemaname LIKE 'pg_temp%' AND tablename LIKE 'project_delete_%'")).rows[0].count, 0);
      t.diagnostic(JSON.stringify({ deleted_cases: 100002, deleted_steps: 100000, deleted_versions: 100000, retained_cases: 50001, mutation_batches: progress.filter(item => item.rows > 0).length, elapsed_ms: Math.round(elapsed) }));
    });
  } finally {
    await db.close();
    await require('../../src/obsDb').close();
  }
});
