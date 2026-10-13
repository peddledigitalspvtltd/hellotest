const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('repository installer validates before writes, retries a file atomically and resumes durable jobs', { skip: process.env.INSTANCE_SETUP_INSTALLER_POSTGRES !== '1', timeout: 120000 }, async t => {
  assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/agent_verify_instance_installer_[a-z0-9_]+$/);
  const db = require('../../src/db'), obs = require('../../src/obsDb');
  const service = require('../../services/adminPortal.service');
  const repository = require('../../services/sampleData/repository');
  const originalPrepare = db.prepare;
  const jobs = require('../../services/instanceSetup.service').createInstanceSetupService({ logger: { error() {} } });
  const actorId = 'setup-validation-admin';
  const input = { modules: ['workspace'], actorId };
  const workspaceRecordCount = repository.getInstallPlan(input.modules).files.reduce((sum, file) => sum + file.record_count, 0);
  const root = repository.loadManifest().root;
  let temporary;
  try {
    assert.equal((await db.prepare("SELECT to_regclass('public.projects') AS present").get()).present, null);
    await db.query(fs.readFileSync(path.resolve(__dirname, '../../instance-setup-data/schema-setup/schema.sql'), 'utf8'));
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
    await t.test('unsupported native choices fail during preflight before project writes', async () => {
      temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'instance-native-contract-'));
      fs.cpSync(root, temporary, { recursive: true });
      const manifestPath = path.join(temporary, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const file = manifest.files.find(file => file.key === 'planning.v8_requirement_iterations');
      const filename = path.join(temporary, file.path);
      const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
      data.records[0].state = 'planned';
      const bytes = Buffer.from(JSON.stringify(data));
      fs.writeFileSync(filename, bytes);
      file.sha256 = require('node:crypto').createHash('sha256').update(bytes).digest('hex');
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));
      process.env.HELLOTEST_INSTANCE_SETUP_DATA_DIR = temporary;
      try {
        await assert.rejects(service.seedSampleData({ ...input, modules:['planning'] }), error => error.code === 'SETUP_RECORD_CONTRACT');
        assert.equal((await db.prepare('SELECT COUNT(*)::int AS count FROM projects').get()).count, 0);
      } finally { delete process.env.HELLOTEST_INSTANCE_SETUP_DATA_DIR; fs.rmSync(temporary, { recursive:true, force:true }); temporary = null; }
    });
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
      assert.equal(result.inserted_records, workspaceRecordCount);
      assert.equal(result.administrator_memberships, 1);
      assert.equal(saved.phase, 'verifying');
      assert.ok(saved.files.every(file => file.status === 'completed'));
    });
    await t.test('completed checkpoints retain receipts and user changes', async () => {
      await db.prepare("UPDATE projects SET name = 'Retained title' WHERE id = 'sample-project'").run();
      const result = await service.seedSampleData({ ...input, checkpoints: saved.files, expectedManifestHash: saved.manifest_hash });
      assert.equal(result.inserted_records, workspaceRecordCount, 'Receipt retains work committed earlier by this job');
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


    await t.test('configured startup installs the current dataset once and preserves failed receipts', async () => {
      await db.query('DELETE FROM instance_setup_jobs');
      assert.equal(await jobs.startConfigured(''), null);
      await assert.rejects(jobs.startConfigured('unknown-module'), /module/i);
      const accepted = await Promise.all(Array.from({ length: 5 }, () => jobs.startConfigured('all')));
      assert.equal(new Set(accepted.map(result => result.job.id)).size, 1);
      const id = accepted[0].job.id;
      await jobs.processNext();
      const completed = await jobs.getStatus({ jobId: id });
      assert.equal(completed.job.status, 'completed', JSON.stringify(completed.job.error));
      assert.equal(completed.job.completed_files, repository.loadManifest().manifest.files.length);
      assert.equal((await jobs.startConfigured('all')).job.id, id, 'Restart must reuse the receipt');
      assert.equal((await jobs.startConfigured('workspace')).job.id, id, 'An installed superset covers smaller selections');
      await db.prepare("UPDATE instance_setup_jobs SET status='failed', attempts=3 WHERE id=?").run(id);
      assert.equal((await jobs.startConfigured('all')).job.status, 'failed', 'Restart must not reset exhausted retries');
      await jobs.retry({ jobId: id, actorId });
      await jobs.processNext();
      assert.equal((await jobs.getStatus({ jobId: id })).job.status, 'completed');
      await db.prepare('UPDATE users SET is_workspace_admin=FALSE WHERE id=?').run(actorId);
      await assert.rejects(jobs.startConfigured('all'), error => error.code === 'INSTANCE_SETUP_ACTOR_REQUIRED');
      await db.prepare('UPDATE users SET is_workspace_admin=TRUE WHERE id=?').run(actorId);
    });


    await t.test('section grouping is atomic, scoped and reversible without changing snapshots', async () => {
      const steps = require('@hellotest/testing/backend/services/testStep.service');
      const cases = ['section-review-case', 'section-other-case'];
      for (const id of cases) await db.prepare("INSERT INTO test_cases(id,app_type_id,title) VALUES (?, 'sample-app-web', ?)").run(id, id);
      for (let index = 1; index <= 3; index++) await db.prepare("INSERT INTO test_steps(id,test_case_id,step_order,action,expected_result,step_type,automation_code) VALUES (?, ?, ?, ?, 'Visible outcome', 'web', 'await page.reload();')").run(`section-review-${index}`, cases[0], index, `Action ${index}`);
      await db.prepare("INSERT INTO test_steps(id,test_case_id,step_order,action) VALUES ('section-foreign', ?, 1, 'Foreign')").run(cases[1]);
      const snapshotBefore = await db.prepare('SELECT COUNT(*)::int AS count FROM execution_step_snapshots').get();
      const input = {test_case_id:cases[0], step_ids:['section-review-1','section-review-2'], name:'Reviewed flow', create_shared_group:true, created_by:actorId};
      const before = await db.prepare('SELECT COUNT(*)::int AS count FROM shared_step_groups').get();
      const sharedService = require(require.resolve('@hellotest/testing/backend/services/testStep.service').replace('testStep.service.js','sharedStepGroup.service.js'));
      const originalCreate = sharedService.createSharedStepGroup;
      sharedService.createSharedStepGroup = async body => { await originalCreate(body); throw new Error('Injected library failure'); };
      try { await assert.rejects(steps.groupTestSteps(input), /Injected library failure/); }
      finally { sharedService.createSharedStepGroup = originalCreate; }
      assert.deepEqual(await db.prepare('SELECT COUNT(*)::int AS count FROM shared_step_groups').get(), before);
      assert.equal((await steps.getTestStep('section-review-1')).group_id, null);
      await assert.rejects(steps.groupTestSteps({...input,step_ids:['section-review-1','section-review-3']}), /continuous/);
      await assert.rejects(steps.groupTestSteps({...input,step_ids:['section-review-1','section-foreign']}), /selected test case/);
      const grouped = await steps.groupTestSteps(input);
      const source = await sharedService.getSharedStepGroup(grouped.reusable_group_id);
      assert.equal(source.steps.length, 2);
      assert.equal(source.steps[0].automation_code, 'await page.reload();');
      await assert.rejects(steps.groupTestSteps({...input,create_shared_group:false,kind:'local',step_ids:['section-review-1']}), /entire Shared Section Group/);
      const apiGroup = await db.prepare("SELECT id FROM shared_step_groups WHERE app_type_id='sample-app-api' LIMIT 1").get();
      await assert.rejects(steps.groupTestSteps({...input,create_shared_group:false,kind:'reusable',reusable_group_id:apiGroup.id}), /same application/);
      const local = await steps.groupTestSteps({...input,create_shared_group:false,kind:'local',group_id:grouped.group_id});
      assert.equal((await steps.getTestStep('section-review-1')).group_kind, 'local');
      assert.equal((await steps.getTestStep('section-review-1')).reusable_group_id, null);
      assert.equal((await sharedService.getSharedStepGroup(source.id)).steps.length, 2);
      await steps.ungroupTestSteps({test_case_id:cases[0],group_id:local.group_id});
      assert.equal((await steps.getTestStep('section-review-1')).group_id, null);
      assert.equal((await steps.getTestStep('section-review-2')).automation_code, 'await page.reload();');
      assert.deepEqual(await db.prepare('SELECT COUNT(*)::int AS count FROM execution_step_snapshots').get(), snapshotBefore);
    });

  } finally {
    db.prepare = originalPrepare;
    delete process.env.HELLOTEST_INSTANCE_SETUP_DATA_DIR;
    if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
    await jobs.close();
    await Promise.all([db.close(), obs.close()]);
  }
});
