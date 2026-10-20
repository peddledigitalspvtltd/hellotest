const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

test('Start URL migration preserves legacy targets and domain writes retain versioned target identity', {
  skip: process.env.AUTOMATION_START_URL_POSTGRES !== '1', timeout: 120000
}, async t => {
  const target = new URL(process.env.DATABASE_URL);
  assert.match(target.pathname, /^\/agent_verify_automation_start_url$/);
  assert.ok(['localhost', '127.0.0.1'].includes(target.hostname));
  assert.equal(process.env.DATABASE_URL, process.env.OBS_DATABASE_URL);
  const db = require('@hellotest/platform/backend/src/db');
  const obs = require('@hellotest/platform/backend/src/obsDb');
  try {
    assert.equal((await db.prepare("SELECT to_regclass('public.projects') AS present").get()).present, null, 'Use an empty task-owned database.');
    await db.query(fs.readFileSync(path.resolve(__dirname, '../../../platform/backend/instance-setup-data/schema-setup/schema.sql'), 'utf8'));
    await require('../../../platform/backend/src/db/bootstrap').ensureRuntimeSchema();
    await require('../../../platform/backend/src/obsDb/bootstrap').ensureRuntimeSchema();
    assert.equal((await db.prepare("SELECT version FROM runtime_schema_receipts WHERE component='main'").get()).version, require('../../../platform/backend/src/db/schemaReadiness').REQUIRED_SCHEMA_VERSION);
    const project = randomUUID(), app = randomUUID(), author = randomUUID(), legacy = randomUUID();
    await db.prepare("INSERT INTO users(id,email,password_hash,name,status) VALUES(?,?,'no-login','Target fixture','active')").run(author, `${author}@example.test`);
    await db.prepare("INSERT INTO projects(id,name) VALUES(?,'Start URL fixture')").run(project);
    await db.prepare("INSERT INTO app_types(id,project_id,name,type) VALUES(?,?,'Fixture web','web')").run(app, project);
    const role = await db.prepare('SELECT id FROM roles LIMIT 1').get();
    await db.prepare('INSERT INTO project_members(id,project_id,user_id,role_id) VALUES(?,?,?,?)').run(randomUUID(), project, author, role.id);

    // Upgrade an existing table twice: nullable migration must not select an
    // environment, old object-repository page, or source-code URL as a target.
    await db.query('ALTER TABLE test_cases DROP COLUMN automation_start_url');
    await db.prepare("INSERT INTO test_cases(id,app_type_id,title,automated,created_by,author_id) VALUES(?,?,'Legacy browser case','yes',?,?)").run(legacy, app, author, author);
    for (let run = 0; run < 2; run++) for (const statement of require('../../../platform/backend/src/db/automationStartUrlSchema')) await db.query(statement);
    assert.equal((await db.prepare('SELECT automation_start_url FROM test_cases WHERE id=?').get(legacy)).automation_start_url, null);

    const cases = require('../../backend/services/testCase.service');
    const versions = require('../../backend/services/testCaseVersion.service');
    const restore = require('../../backend/services/testCaseVersionRestore.service');
    const input = { app_type_id: app, title: 'Targeted account journey', created_by: author, steps: [{ action: 'Open application', expected_result: 'Application ready', step_type: 'web' }] };
    await assert.rejects(cases.createTestCase({ ...input, automated: 'yes' }), error => error.code === 'AUTOMATION_START_URL_REQUIRED');
    const manual = await cases.createTestCase({ ...input, automated: 'no' });
    const automation = await cases.createTestCase({ ...input, automated: 'yes', automation_start_url: ' HTTPS://APP.EXAMPLE.TEST/signup ', manual_test_case_ids: [manual.id] });
    assert.match(automation.display_id, /^AT_/);
    assert.equal((await cases.getTestCase(automation.id)).automation_start_url, 'https://app.example.test/signup');
    assert.deepEqual((await cases.getTestCase(automation.id)).manual_test_case_ids, [manual.id]);
    await cases.updateTestCase(automation.id, { automation_start_url: 'https://app.example.test/profile', expected_revision: 1, updated_by: author });
    assert.equal((await versions.get(automation.id, 1)).content.automation_start_url, 'https://app.example.test/signup');
    await assert.rejects(cases.updateTestCase(automation.id, { automation_start_url: 'https://wrong.example.test', expected_revision: 1, updated_by: author }), error => error.code === 'REVISION_CONFLICT');
    assert.equal((await cases.getTestCase(automation.id)).automation_start_url, 'https://app.example.test/profile');
    await restore.restore({ testCaseId: automation.id, revision: 1, expectedRevision: 2, userId: author });
    assert.equal((await cases.getTestCase(automation.id)).automation_start_url, 'https://app.example.test/signup');

    await cases.updateTestCase(legacy, { title: 'Legacy metadata remains editable', updated_by: author, expected_revision: 1 });
    await cases.updateTestCase(legacy, { automation_start_url: 'https://app.example.test/', updated_by: author, expected_revision: 2 });
    await restore.restore({ testCaseId: legacy, revision: 2, expectedRevision: 3, userId: author });
    assert.equal((await cases.getTestCase(legacy)).automation_start_url, null);
    assert.equal((await cases.getTestCase(manual.id)).automation_start_url, null, 'Linking never rewrites the source manual target.');
    await db.prepare('UPDATE test_cases SET source_idempotency_key=? WHERE id=?').run('fixture-start-url-replay', legacy);
    const replay = await cases.createTestCase({ ...input, automated: 'yes', source_idempotency_key: 'fixture-start-url-replay' });
    assert.equal(replay.id, legacy, 'Replaying an existing authoring operation must not require or invent a new target.');
    assert.equal((await cases.getTestCase(legacy)).automation_start_url, null);
    await assert.rejects(cases.createTestCase({ ...input, automated: 'yes', source_idempotency_key: 'fixture-start-url-replay', automation_start_url: 'javascript:alert(1)' }), error => error.code === 'AUTOMATION_START_URL_INVALID');

    const batches = require('../../backend/services/batchProcess.service');
    const generator = require('../../../automation/backend/services/automationGenerator.service');
    t.mock.method(batches, 'triggerProcessing', () => {});
    const batchJob = await batches.queueAutomationBuild({ app_type_id: app, test_case_ids: [automation.id], created_by: author });
    const singleJob = await generator.queueGeneratorJob({ test_case_id: automation.id, created_by: author });
    const batchPayload = (await obs.prepare('SELECT payload FROM batch_process_jobs WHERE id=?').get(batchJob.job_id)).payload;
    const singlePayload = (await obs.prepare('SELECT payload FROM automation_generator_jobs WHERE id=?').get(singleJob.job_id)).payload;
    assert.equal(batchPayload.start_urls_by_case_id[automation.id], 'https://app.example.test/signup');
    assert.equal(singlePayload.start_url, 'https://app.example.test/signup');
    assert.deepEqual(singlePayload.start_url_review, { source_test_case_id: automation.id, automation_test_case_id: automation.id, automation_start_url: 'https://app.example.test/signup' });
    assert.deepEqual(batchPayload.start_url_reviews_by_case_id[automation.id], singlePayload.start_url_review);
    await cases.updateTestCase(automation.id, { automation_start_url: 'https://later.example.test/', updated_by: author, expected_revision: 3 });
    assert.equal((await obs.prepare('SELECT payload FROM batch_process_jobs WHERE id=?').get(batchJob.job_id)).payload.start_urls_by_case_id[automation.id], 'https://app.example.test/signup');
    assert.equal((await obs.prepare('SELECT payload FROM automation_generator_jobs WHERE id=?').get(singleJob.job_id)).payload.start_url, 'https://app.example.test/signup');
    const reviewed = await cases.getTestCase(automation.id);
    const versionCount = (await db.prepare('SELECT COUNT(*)::int AS count FROM test_case_versions WHERE test_case_id=?').get(automation.id)).count;
    await assert.rejects(cases.updateTestCase(automation.id, { automation_start_url: singlePayload.start_url, expected_revision: reviewed.revision, updated_by: author }, {
      expectedAutomationStartUrl: singlePayload.start_url_review.automation_start_url
    }), error => error.code === 'AUTOMATION_START_URL_CHANGED');
    assert.equal((await cases.getTestCase(automation.id)).automation_start_url, 'https://later.example.test/');
    assert.equal((await db.prepare('SELECT COUNT(*)::int AS count FROM test_case_versions WHERE test_case_id=?').get(automation.id)).count, versionCount);
    const queuedGuard = require('../../../automation/backend/services/automationQueuedStartUrl.service');
    await assert.rejects(queuedGuard.assertQueuedStartUrlReview({ sourceCaseId: automation.id, appTypeId: app, review: singlePayload.start_url_review, required: true }), error => error.code === 'AUTOMATION_START_URL_CHANGED');
    const beforeInvalid = (await obs.prepare("SELECT COUNT(*)::int AS count FROM workspace_transactions WHERE project_id=? AND category='automation_build'").get(project)).count;
    await assert.rejects(batches.queueAutomationBuild({ app_type_id: app, test_case_ids: [automation.id], start_url: '', created_by: author }), error => error.code === 'AUTOMATION_START_URL_REQUIRED');
    await assert.rejects(generator.queueGeneratorJob({ test_case_id: automation.id, start_url: 'javascript:alert(1)', created_by: author }), error => error.code === 'AUTOMATION_START_URL_INVALID');
    assert.equal((await obs.prepare("SELECT COUNT(*)::int AS count FROM workspace_transactions WHERE project_id=? AND category='automation_build'").get(project)).count, beforeInvalid);
  } finally {
    await Promise.all([db.close(), obs.close()]);
  }
});
