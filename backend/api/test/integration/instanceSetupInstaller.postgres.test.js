const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('repository installer validates before writes, retries a file atomically and resumes durable jobs', { skip: process.env.INSTANCE_SETUP_INSTALLER_POSTGRES !== '1', timeout: 120000 }, async t => {
  assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/agent_verify_instance_installer_[a-z0-9_]+$/);
  const db = require('../../src/db'), obs = require('../../src/obsDb');
  const service = require('../../src/services/adminPortal.service');
  const repository = require('../../src/services/sampleData/repository');
  const originalPrepare = db.prepare;
  const jobs = require('../../src/services/instanceSetup.service').createInstanceSetupService({ logger: { error() {} } });
  const actorId = 'setup-validation-admin';
  const input = { modules: ['workspace'], actorId };
  const root = repository.loadManifest().root;
  let temporary;
  try {
    assert.equal((await db.prepare("SELECT to_regclass('public.projects') AS present").get()).present, null);
    await db.query(fs.readFileSync(path.resolve(__dirname, '../../../db/schema.sql'), 'utf8'));
    await require('../../src/db/bootstrap').ensureRuntimeSchema();
    await db.prepare("INSERT INTO roles(id,name) VALUES ('setup-admin-role','admin') ON CONFLICT DO NOTHING").run();
    await db.prepare("INSERT INTO users(id,email,password_hash,name,is_workspace_admin,status) VALUES (?, 'installer@example.test', 'no-login', 'Installer', TRUE, 'active')").run(actorId);
    await t.test('invalid selected file fails before any project or membership is written', async () => {
      temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'instance-installer-'));
      fs.cpSync(root, temporary, { recursive: true });
      const target = repository.loadManifest().manifest.files.find(file => file.table === 'app_types');
      fs.appendFileSync(path.join(temporary, target.path), '\n');
      process.env.HELLOTEST_INSTANCE_SETUP_DATA_DIR = temporary;
      await assert.rejects(service.seedSampleData(input), error => error.code === 'SETUP_CHECKSUM_MISMATCH' && error.file === target.path);
      assert.equal((await db.prepare('SELECT COUNT(*)::int AS count FROM projects').get()).count, 0);
      delete process.env.HELLOTEST_INSTANCE_SETUP_DATA_DIR;
    });
    let saved;
    await t.test('a transient write rolls back just its file and retries with a smaller batch', async () => {
      let failed = false;
      const transitions = [];
      db.prepare = sql => {
        const statement = originalPrepare(sql);
        if (/^INSERT INTO "app_types"/.test(sql) && !failed) {
          return { ...statement, run: async () => { failed = true; throw Object.assign(new Error('injected serialization failure'), { code: '40001' }); } };
        }
        return statement;
      };
      const result = await service.seedSampleData({ ...input, onProgress: async update => { transitions.push(structuredClone(update)); saved = structuredClone(update); } });
      db.prepare = originalPrepare;
      assert.ok(failed);
      assert.ok(transitions.some(update => update.files.some(file => file.status === 'retrying')));
      const retried = result.file_results.find(file => file.table === 'app_types');
      assert.equal(retried.attempts, 2);
      assert.equal(retried.fallback_batch_size, 10);
      assert.equal(result.inserted_records, 4);
      assert.equal(result.administrator_memberships, 1);
      assert.equal(saved.phase, 'verifying');
      assert.ok(saved.files.every(file => file.status === 'completed'));
    });
    await t.test('completed checkpoints retain receipts and user changes', async () => {
      await db.prepare("UPDATE projects SET name = 'Retained title' WHERE id = 'sample-project'").run();
      const result = await service.seedSampleData({ ...input, checkpoints: saved.files, expectedManifestHash: saved.manifest_hash });
      assert.equal(result.inserted_records, 4, 'Receipt retains work committed earlier by this job');
      assert.equal(result.administrator_memberships, 1);
      assert.equal((await db.prepare("SELECT name FROM projects WHERE id='sample-project'").get()).name, 'Retained title');
      assert.equal((await db.prepare("SELECT COUNT(*)::int AS count FROM project_members WHERE project_id='sample-project'").get()).count, 1);
      assert.equal((await service.seedSampleData(input)).inserted_records, 0, 'A new installation reports only its own new rows');
    });
    await t.test('manifest mismatch and revoked access fail without writes', async () => {
      await assert.rejects(service.seedSampleData({ ...input, expectedManifestHash: '0'.repeat(64) }), error => error.code === 'SETUP_DATASET_CHANGED');
      await db.prepare('UPDATE users SET is_workspace_admin = FALSE WHERE id = ?').run(actorId);
      await assert.rejects(service.seedSampleData(input), error => error.statusCode === 403);
      await db.prepare('UPDATE users SET is_workspace_admin = TRUE WHERE id = ?').run(actorId);
    });
    await t.test('actual durable job fails on audit then resumes verified files without duplicates', async () => {
      await db.query("ALTER TABLE admin_audit_log ADD CONSTRAINT reject_setup_audit CHECK (action <> 'sample_data.seed') NOT VALID");
      const queued = await jobs.start({ modules: ['design'], actorId });
      assert.equal(queued.job.status, 'queued');
      await jobs.processNext();
      const failed = await jobs.getStatus({ jobId: queued.job.id });
      assert.equal(failed.job.status, 'failed');
      assert.equal(failed.job.result, null);
      assert.equal(failed.job.completed_files, failed.job.total_files);
      assert.equal(failed.job.phase, 'verifying');
      const before = await db.prepare("SELECT COUNT(*)::int AS count FROM test_cases WHERE app_type_id IN (SELECT id FROM app_types WHERE project_id='sample-project')").get();
      await db.query('ALTER TABLE admin_audit_log DROP CONSTRAINT reject_setup_audit');
      await jobs.retry({ jobId: queued.job.id, actorId });
      await jobs.processNext();
      const completed = await jobs.getStatus({ jobId: queued.job.id });
      assert.equal(completed.job.status, 'completed', JSON.stringify(completed.job.error));
      assert.ok(completed.job.result);
      assert.ok(completed.job.files.every(file => file.status === 'completed'));
      const after = await db.prepare("SELECT COUNT(*)::int AS count FROM test_cases WHERE app_type_id IN (SELECT id FROM app_types WHERE project_id='sample-project')").get();
      assert.equal(before.count, after.count);
      assert.equal(completed.job.result.inserted_records, failed.job.files.reduce((n, file) => n + (file.inserted_records || 0), 0));
    });
    await t.test('saved indirect and JSON relationships cannot cross scope or silently disappear', async () => {
      await db.prepare("INSERT INTO projects(id,display_id,name,created_by) VALUES ('foreign-project','FOREIGN','Foreign scope',?)").run(actorId);
      await db.prepare("INSERT INTO app_types(id,project_id,name,type) VALUES ('foreign-app','foreign-project','Foreign Web','web')").run();
      await db.prepare("INSERT INTO test_cases(id,app_type_id,title,created_by) VALUES ('foreign-case','foreign-app','Foreign case',?)").run(actorId);
      await db.prepare("UPDATE test_steps SET test_case_id='foreign-case' WHERE id='sample-v2-step-login-2'").run();
      await assert.rejects(service.seedSampleData({ ...input, modules: ['design'] }), error => error.code === 'SETUP_SCOPE_CONFLICT' && Boolean(error.file));
      assert.equal((await db.prepare("SELECT test_case_id FROM test_steps WHERE id='sample-v2-step-login-2'").get()).test_case_id, 'foreign-case', 'Do not rewrite an existing relationship automatically');
      await db.prepare("UPDATE test_steps SET test_case_id='sample-v2-case-login' WHERE id='sample-v2-step-login-2'").run();
      await assert.rejects(db.prepare("UPDATE requirement_releases SET sprint_ids=? WHERE id='sample-v4-metrics-release'").run(['missing-sprint']), error => error.code === '23503', 'Native release-sprint database guard also remains enforced');
      const version = await db.prepare("SELECT id,snapshot FROM test_case_versions WHERE id='sample-v2-version-login'").get();
      await db.prepare('UPDATE test_case_versions SET snapshot=? WHERE id=?').run({ ...version.snapshot, suite_id: 'missing-suite' }, version.id);
      await assert.rejects(service.seedSampleData({ ...input, modules: ['design'] }), error => error.code === 'SETUP_RELATION_MISSING');
      await db.prepare('UPDATE test_case_versions SET snapshot=? WHERE id=?').run(version.snapshot, version.id);
      await service.seedSampleData({ ...input, modules: ['design'] });
    });
    await t.test('post-write relationship validation prevents a false completion receipt', async () => {
      const before = await db.prepare("SELECT COUNT(*)::int AS count FROM admin_audit_log WHERE action='sample_data.seed'").get();
      let altered = false;
      await assert.rejects(service.seedSampleData({ ...input, modules: ['design'], onProgress: async update => {
        if (!altered && update.phase === 'verifying') {
          altered = true;
          await db.prepare("UPDATE test_steps SET test_case_id='foreign-case' WHERE id='sample-v2-step-login-2'").run();
        }
      } }), error => error.code === 'SETUP_SCOPE_CONFLICT');
      const after = await db.prepare("SELECT COUNT(*)::int AS count FROM admin_audit_log WHERE action='sample_data.seed'").get();
      assert.equal(after.count, before.count);
      await db.prepare("UPDATE test_steps SET test_case_id='sample-v2-case-login' WHERE id='sample-v2-step-login-2'").run();
    });

  } finally {
    db.prepare = originalPrepare;
    delete process.env.HELLOTEST_INSTANCE_SETUP_DATA_DIR;
    if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
    await jobs.close();
    await Promise.all([db.close(), obs.close()]);
  }
});
