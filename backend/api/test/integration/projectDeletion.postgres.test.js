const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const identifier = value => {
  assert.match(value, /^[a-z_][a-z0-9_]*$/);
  return `"${value}"`;
};

test('project deletion removes connected sample data atomically and preserves other workspaces', {
  skip: process.env.PROJECT_DELETION_POSTGRES !== '1', timeout: 120000
}, async t => {
  const url = new URL(process.env.DATABASE_URL);
  assert.match(url.pathname.slice(1), /^agent_verify_project_deletion_[a-z0-9_]+$/);
  // Never inherit an OBS or POSTGRES override pointing outside this disposable DB.
  process.env.POSTGRES_URL = process.env.OBS_DATABASE_URL = process.env.OBS_POSTGRES_URL = url.toString();
  const db = require('../../src/db');
  try {
    assert.equal((await db.prepare("SELECT to_regclass('public.projects') AS name").get()).name, null, 'An empty disposable database is required');
    await db.query(fs.readFileSync(path.resolve(__dirname, '../../../db/schema.sql'), 'utf8'));
    await require('../../src/db/bootstrap').ensureRuntimeSchema();
    await db.query(`
      INSERT INTO roles(id,name) VALUES ('deletion-role-admin','admin'),('deletion-role-reviewer','Deletion reviewer');
      INSERT INTO permissions(id,code) VALUES ('deletion-permission','deletion.test');
      INSERT INTO role_permissions(role_id,permission_id) VALUES ('deletion-role-reviewer','deletion-permission');
      INSERT INTO users(id,email,password_hash,name,is_workspace_admin,default_role_id)
        VALUES ('deletion-admin','deletion@example.test','not-a-login','Deletion validation',TRUE,'deletion-role-reviewer');
    `);
    const sampleService = require('../../src/services/adminPortal.service');
    const installed = await sampleService.seedSampleData({ actorId: 'deletion-admin' });
    assert.equal(installed.installed.length, require('../../src/services/sampleData/catalog').modules.length);
    const samples = require('../../src/services/sampleData');
    const packs = Object.values(samples.buildRecords('deletion-admin'));
    const records = packs.flat();
    // A complete second project exercises every connected table, with the same
    // user and global roles/integrations shared by both projects.
    const preserve = value => typeof value === 'string'
      ? value.replaceAll('sample-', 'preserved-').replaceAll('DEMO', 'KEEP')
      : Array.isArray(value) ? value.map(preserve)
        : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, preserve(item)])) : value;
    const retainedRecords = records.filter(record => record.table !== 'integrations').map(record => ({ ...record, values: preserve(record.values) }));
    for (const pack of packs) await samples.insertRecords(pack.filter(record => record.table !== 'integrations').map(record => ({ ...record, values: preserve(record.values) })));
    await db.query(`
      INSERT INTO project_members(id,project_id,user_id,role_id)
        VALUES ('preserved-membership','preserved-project','deletion-admin','deletion-role-reviewer');
      INSERT INTO ai_knowledge_repo(id,project_id,app_type_id,title,content)
        VALUES ('deletion-app-knowledge','sample-project','sample-app-web','Application knowledge','Scoped content');
      INSERT INTO agentic_workflow_runs(id,project_id,workflow_id,workflow_name)
        VALUES ('deletion-workflow-run','sample-project','sample-v2-workflow-story-review','Project run'),
               ('preserved-workflow-run','preserved-project','preserved-v2-workflow-story-review','Retained run');
      INSERT INTO automation_generator_jobs(id,project_id,app_type_id,test_case_id,transaction_id)
        VALUES ('deletion-generation','sample-project','sample-app-web','sample-v2-case-login','deletion-generation-transaction'),
               ('deletion-legacy-generation',NULL,NULL,'sample-v2-case-login','deletion-legacy-transaction'),
               ('deletion-activity-generation',NULL,NULL,'missing-legacy-case','sample-v2-activity-launchpad'),
               ('preserved-generation','preserved-project','preserved-app-web','preserved-v2-case-login','preserved-generation-transaction'),
               ('preserved-legacy-generation',NULL,NULL,'preserved-v2-case-login','preserved-legacy-transaction');
      INSERT INTO integrations(id,type,name,project_key,config)
        VALUES ('deletion-scoped-integration','jira','Project integration','sample-project','{"project_id":"sample-project","custom":"retained"}'),
               ('preserved-scoped-integration','jira','Other integration','preserved-project','{"project_id":"preserved-project","custom":"retained"}');
      INSERT INTO attachments(id,project_id,entity_type,entity_id,bucket_name,object_name,file_name)
        VALUES ('deletion-attachment','sample-project','project','sample-project','test-only','deletion-object','notes.txt'),
               ('preserved-attachment','preserved-project','project','preserved-project','test-only','preserved-object','notes.txt');
    `);
    const snapshot = async () => {
      const tables = await db.prepare("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name").all();
      const result = {};
      for (const { table_name } of tables) {
        result[table_name] = (await db.query(`SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY to_jsonb(row)::text),'[]'::jsonb) AS rows FROM ${identifier(table_name)} row`)).rows[0].rows;
      }
      return result;
    };
    const before = await snapshot();
    const removedObjects = [];
    const storage = require('../../src/services/objectStorage.service');
    t.mock.method(storage, 'removeObject', async object => {
      assert.equal(await db.prepare('SELECT id FROM projects WHERE id = ?').get('sample-project'), undefined, 'Object cleanup starts only after the SQL commit');
      removedObjects.push(object);
    });
    const projectService = require('../../src/services/project.service');

    await t.test('a late failure rolls back activity, AI records and all product data', async () => {
      await db.query(`
        CREATE FUNCTION reject_project_deletion() RETURNS TRIGGER LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'Injected late project deletion failure'; END $$;
        CREATE TRIGGER reject_project_deletion BEFORE DELETE ON projects
          FOR EACH ROW WHEN (OLD.id = 'sample-project') EXECUTE FUNCTION reject_project_deletion();
      `);
      await assert.rejects(projectService.deleteProject('sample-project'), /Injected late project deletion failure/);
      assert.deepEqual(await snapshot(), before, 'Every table must retain its original rows after rollback');
      assert.deepEqual(removedObjects, [], 'Failed deletes must not remove stored files');
      await db.query('DROP TRIGGER reject_project_deletion ON projects; DROP FUNCTION reject_project_deletion()');
    });

    await t.test('all sample project records are removed, with unrelated rows unchanged', async () => {
      assert.deepEqual(await projectService.deleteProject('sample-project'), { deleted: true, attachment_cleanup: { attempted: 1, failed: 0 } });
      assert.deepEqual(removedObjects, [{ bucket: 'test-only', objectName: 'deletion-object' }]);
      const after = await snapshot();
      const matches = (row, record) => record.keys.every(key => row[key] === record.values[key]);
      for (const record of records) {
        if (record.table === 'integrations') continue; // Workspace-wide examples remain available.
        assert.ok(!after[record.table].some(row => matches(row, record)), `${record.table}: ${JSON.stringify(record.values.id || record.keys)} was left behind`);
      }
      for (const record of retainedRecords) {
        assert.deepEqual(after[record.table].find(row => matches(row, record)), before[record.table].find(row => matches(row, record)), `Other project changed in ${record.table}`);
      }
      for (const table of ['roles', 'role_permissions', 'permissions', 'users', 'admin_audit_log']) assert.deepEqual(after[table], before[table], `${table} must be preserved`);
      for (const [table, rows] of Object.entries(after)) {
        assert.ok(!rows.some(row => row.project_id === 'sample-project'), `${table} contains an orphaned project_id`);
        assert.ok(!rows.some(row => row.app_type_id?.startsWith('sample-app-')), `${table} contains an orphaned app_type_id`);
      }
      assert.deepEqual(after.automation_generator_jobs.map(row => row.id).sort(), ['preserved-generation', 'preserved-legacy-generation']);
      assert.deepEqual(after.agentic_workflow_runs, before.agentic_workflow_runs.filter(row => row.project_id === 'preserved-project'));
      assert.deepEqual(after.attachments, before.attachments.filter(row => row.project_id === 'preserved-project'));
      assert.deepEqual(after.project_members, before.project_members.filter(row => row.project_id === 'preserved-project'));
      assert.deepEqual(after.integrations.filter(row => row.id !== 'deletion-scoped-integration'), before.integrations.filter(row => row.id !== 'deletion-scoped-integration'));
      const detached = after.integrations.find(row => row.id === 'deletion-scoped-integration');
      assert.equal(detached.project_key, null);
      assert.deepEqual(detached.config, { custom: 'retained' });
      const catalog = await sampleService.getSampleCatalog();
      assert.equal(catalog.project_id, null);
      assert.ok(catalog.modules.filter(module => module.key !== 'integrations').every(module => module.record_count === 0));
      await assert.rejects(projectService.deleteProject('sample-project'), /Project not found/);
      assert.equal(removedObjects.length, 1, 'A repeated delete must not purge files again');
    });
    console.log(JSON.stringify({ sample_modules: installed.installed.length, sample_records: records.length, protected_records: retainedRecords.length, rollback_tables: Object.keys(before).length }));
  } finally {
    await db.close();
    await require('../../src/obsDb').close();
  }
});
