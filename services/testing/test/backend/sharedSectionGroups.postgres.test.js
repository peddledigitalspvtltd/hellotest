const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('shared section authoring preserves identity, ordered instructions and private defaults through linked case synchronization', {
  skip: process.env.SHARED_SECTION_GROUP_POSTGRES !== '1', timeout: 120000
}, async context => {
  assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/agent_verify_shared_sections_[a-z0-9_]+$/);
  const db = require('@hellotest/platform/backend/src/db');
  try {
    assert.equal((await db.prepare("SELECT to_regclass('public.projects') AS present").get()).present, null);
    await db.query(fs.readFileSync(path.resolve(__dirname, '../../../platform/backend/instance-setup-data/schema-setup/schema.sql'), 'utf8'));
    await require('../../../platform/backend/src/db/bootstrap').ensureRuntimeSchema();
    await db.query(`INSERT INTO users(id,email,password_hash,name,is_workspace_admin) VALUES ('actor','shared-sections@example.test','not-a-login','Shared sections',TRUE);
      INSERT INTO projects(id,name,created_by) VALUES ('project','Shared sections','actor');
      INSERT INTO app_types(id,project_id,name,type) VALUES ('app','project','Web','web'),('foreign-app','project','Other web','web');
      INSERT INTO test_cases(id,app_type_id,title,automated,parameter_values,test_data_options) VALUES
        ('first-case','app','First case','yes','{}','{}'), ('second-case','app','Second case','yes','{}','{}'), ('repeat-case','app','Repeated groups','yes','{}','{}'),
        ('source-case','app','Source defaults','yes','{"t.email":"user@example.test","t.blank":"","t.unused":"ignore","t.custom":"private"}','{"private_parameter_names":["t.custom"]}');
      INSERT INTO test_steps(id,test_case_id,step_order,action,step_type) VALUES
        ('setup','first-case',1,'Local setup','web'),('teardown','first-case',2,'Local teardown','web'),
        ('source-step','source-case',1,'Use @t.email, @t.blank and @t.custom','web');`);
    const groups = require('../../backend/services/sharedStepGroup.service');
    const steps = require('../../backend/services/testStep.service');
    const snapshots = require('../../backend/services/sharedStepDataSnapshot.service');
    const created = await groups.createSharedStepGroup({ app_type_id: 'app', name: 'Login', created_by: 'actor', parameter_values: { 't.email': 'group@example.test' },
      steps: [{ action: 'Open login', automation_code: 'await page.goto("https://example.test/login");' }, { action: 'Request account', step_type: 'api', api_request: { method: 'GET', url: 'https://example.test/account' } }] });
    let group = await groups.getSharedStepGroup(created.id);
    const [open, request] = group.steps;
    assert.ok(open.id && request.id && open.id !== request.id);
    assert.deepEqual((await groups.getSharedStepGroup(created.id)).steps.map(step => step.id), [open.id, request.id]);
    await steps.insertSharedStepGroup({ test_case_id: 'first-case', shared_step_group_id: group.id, insert_after_step_id: 'setup' });
    await steps.insertSharedStepGroup({ test_case_id: 'second-case', shared_step_group_id: group.id });
    await steps.insertSharedStepGroup({ test_case_id: 'repeat-case', shared_step_group_id: group.id });
    await steps.insertSharedStepGroup({ test_case_id: 'repeat-case', shared_step_group_id: group.id });
    await steps.createTestStep({ test_case_id: 'repeat-case', step_order: 5, action: 'Repeated teardown' });
    const firstOriginal = await steps.getTestSteps({ test_case_id: 'first-case' });
    const secondOriginal = await steps.getTestSteps({ test_case_id: 'second-case' });
    const firstOpenId = firstOriginal[1].id, firstRequestId = firstOriginal[2].id;

    await context.test('group reorder and insertion retain the existing case section IDs and adjacent sections', async () => {
      await groups.updateSharedStepGroup(group.id, { name: 'Reusable login', steps: [
        { ...request, step_order: 1 }, { id: 'local-draft', step_order: 2, action: 'Submit login', automation_code: 'await page.getByRole("button", { name: "Submit" }).click();' }, { ...open, step_order: 3 }
      ] });
      group = await groups.getSharedStepGroup(group.id);
      assert.deepEqual(group.steps.map(step => step.id), [request.id, group.steps[1].id, open.id]);
      assert.notEqual(group.steps[1].id, 'local-draft');
      const current = await steps.getTestSteps({ test_case_id: 'first-case' });
      assert.deepEqual(current.map(step => step.action), ['Local setup', 'Request account', 'Submit login', 'Open login', 'Local teardown']);
      assert.deepEqual(current.map(step => step.step_order), [1, 2, 3, 4, 5]);
      assert.equal(current[1].id, firstRequestId);
      assert.equal(current[3].id, firstOpenId);
      assert.equal(current[3].automation_code, open.automation_code);
      assert.deepEqual(current[1].api_request, request.api_request);
      assert.ok(current.slice(1, -1).every(step => step.group_name === 'Reusable login'));
      const second = await steps.getTestSteps({ test_case_id: 'second-case' });
      assert.equal(second[0].id, secondOriginal[1].id);
      assert.equal(second[2].id, secondOriginal[0].id);
      const repeated = await steps.getTestSteps({ test_case_id: 'repeat-case' });
      assert.deepEqual(repeated.map(step => step.action), ['Request account', 'Submit login', 'Open login', 'Request account', 'Submit login', 'Open login', 'Repeated teardown']);
      assert.deepEqual(repeated.map(step => step.step_order), [1, 2, 3, 4, 5, 6, 7]);
    });

    await context.test('deleting and reordering sections keeps source and linked case identity aligned', async () => {
      await groups.updateSharedStepGroup(group.id, { steps: group.steps.slice(1).map((step, index) => ({ ...step, step_order: index + 1 })) });
      group = await groups.getSharedStepGroup(group.id);
      const first = await steps.getTestSteps({ test_case_id: 'first-case' });
      assert.deepEqual(first.map(step => step.action), ['Local setup', 'Submit login', 'Open login', 'Local teardown']);
      assert.equal(first[2].id, firstOpenId);
      assert.equal(first.some(step => step.id === firstRequestId), false);
      const oldCanonicalIds = group.steps.map(step => step.id);
      await steps.reorderTestSteps('first-case', [first[0].id, first[2].id, first[1].id, first[3].id]);
      group = await groups.getSharedStepGroup(group.id);
      assert.deepEqual(group.steps.map(step => step.id), oldCanonicalIds.toReversed());
      const reordered = await steps.getTestSteps({ test_case_id: 'first-case' });
      assert.equal(reordered[1].id, firstOpenId);
      const second = await steps.getTestSteps({ test_case_id: 'second-case' });
      assert.equal(second[0].id, secondOriginal[0].id);
      assert.deepEqual(second.map(step => step.action), ['Open login', 'Submit login']);
    });

    await context.test('insertions and reorder cannot split a reusable group and leave partial changes', async () => {
      const before = await steps.getTestSteps({ test_case_id: 'first-case' });
      await assert.rejects(steps.insertSharedStepGroup({ test_case_id: 'first-case', shared_step_group_id: group.id, insert_after_step_id: before[1].id }), { code: 'SHARED_GROUP_INSERT_TARGET_SPLIT' });
      await assert.rejects(steps.reorderTestSteps('first-case', [before[0].id, before[1].id, before[3].id, before[2].id]), { code: 'SHARED_GROUP_REORDER_SPLIT' });
      assert.deepEqual(await steps.getTestSteps({ test_case_id: 'first-case' }), before);
      await assert.rejects(groups.updateSharedStepGroup(group.id, { app_type_id: 'foreign-app' }), { code: 'SHARED_GROUP_SCOPE_REFERENCED' });
      assert.equal((await groups.getSharedStepGroup(group.id)).app_type_id, 'app');
    });

    await context.test('converting selected sections copies only their referenced public defaults', async () => {
      const converted = await steps.groupTestSteps({ test_case_id: 'source-case', step_ids: ['source-step'], name: 'Copied source', create_shared_group: true, created_by: 'actor' });
      const saved = await groups.getSharedStepGroup(converted.reusable_group_id);
      assert.deepEqual(saved.parameter_values, { 't.email': 'user@example.test', 't.blank': '' });
    });

    await context.test('a stale authorization fingerprint cannot restore old source over a concurrent edit', async () => {
      const { sharedStepImplementationFingerprint } = require('../../backend/domain/sharedStepAutomationAccess');
      const before = await groups.getSharedStepGroup(group.id);
      const expected = sharedStepImplementationFingerprint(before.steps);
      await groups.updateSharedStepGroup(group.id, { steps: before.steps.map((step, index) => index ? step : { ...step, automation_code: 'await page.goto("https://example.test/latest");' }) });
      const latest = await groups.getSharedStepGroup(group.id);
      await assert.rejects(groups.updateSharedStepGroup(group.id, { description: 'Stale metadata', steps: before.steps }, { expectedImplementationFingerprint: expected }), { code: 'SHARED_SECTION_SOURCE_CONFLICT', statusCode: 409 });
      const retained = await groups.getSharedStepGroup(group.id);
      assert.deepEqual(retained.steps, latest.steps);
      assert.notEqual(retained.description, 'Stale metadata');
    });

    await context.test('hidden fallback omission, replacement and clear survive group saves and frozen execution data', async () => {
      await db.prepare('INSERT INTO test_data_sets(id,project_id,app_type_id,name,mode,columns,rows) VALUES (?,?,?,?,?,?,?)').run('private-data', 'project', 'app', 'Credentials', 'key_value', [], [{ key: 'r.password', value: 'private-data-value', is_secret: true }]);
      const result = await groups.createSharedStepGroup({ app_type_id: 'app', name: 'Private defaults', parameter_values: { password: 'hidden-default', alias: 'hidden-default', username: 'user' }, test_data_set_id: 'private-data', steps: [{ action: 'Use @r.password' }] });
      const detail = await groups.getSharedStepGroup(result.id);
      const catalog = (await groups.listSharedStepGroups({ app_type_id: 'app' })).find(row => row.id === result.id);
      for (const item of [detail, catalog]) {
        assert.doesNotMatch(JSON.stringify(item), /hidden-default|private-data-value/);
        assert.deepEqual(item.parameter_sensitive_names, ['r.alias', 'r.password']);
      }
      await groups.updateSharedStepGroup(result.id, { parameter_values: { username: 'edited' } });
      let stored = await db.prepare('SELECT parameter_values FROM shared_step_groups WHERE id = ?').get(result.id);
      assert.equal(stored.parameter_values['r.password'], 'hidden-default');
      assert.equal(stored.parameter_values['r.alias'], 'hidden-default');
      const [rawFrozen] = await snapshots.freezeSharedStepData([{ app_type_id: 'app', reusable_group_id: result.id }], { materialize: false });
      assert.equal(rawFrozen.shared_parameter_values['r.alias'], 'hidden-default');
      assert.ok(rawFrozen.shared_parameter_sensitive_names.includes('r.alias'));
      assert.doesNotMatch(JSON.stringify(snapshots.redactSharedStepData(rawFrozen)), /hidden-default|private-data-value/);
      await groups.updateSharedStepGroup(result.id, { parameter_values: { password: 'replacement', alias: '', username: 'edited' } });
      const [frozen] = await snapshots.freezeSharedStepData([{ app_type_id: 'app', reusable_group_id: result.id }], { materialize: false });
      assert.equal(frozen.shared_parameter_values['r.password'], 'private-data-value');
      assert.equal(frozen.shared_parameter_values['r.alias'], '');
      await assert.rejects(groups.updateSharedStepGroup(result.id, { test_data_set_id: null }), { code: 'SHARED_PARAMETER_PRIVACY_CONFLICT' });
      await groups.updateSharedStepGroup(result.id, { parameter_values: { password: '', alias: '', username: 'edited' } });
      await groups.updateSharedStepGroup(result.id, { test_data_set_id: null });
      const unlinked = await groups.getSharedStepGroup(result.id);
      assert.equal(unlinked.parameter_values['r.password'], '');
      assert.equal(unlinked.test_data_set_id, null);
    });

    await context.test('removing the last private reference removes its omitted fallback and allows a later data unlink', async () => {
      const created = await groups.createSharedStepGroup({ app_type_id: 'app', name: 'Remove private input', test_data_set_id: 'private-data', parameter_values: { 'r.password': 'obsolete-private-default' },
        steps: [{ action: 'Use @r.password', automation_code: 'await page.getByLabel("Input").fill(params["r.password"]);' }] });
      await groups.updateSharedStepGroup(created.id, { description: 'Metadata only' });
      assert.equal((await db.prepare('SELECT parameter_values FROM shared_step_groups WHERE id = ?').get(created.id)).parameter_values['r.password'], 'obsolete-private-default');
      const group = await groups.getSharedStepGroup(created.id);
      await groups.updateSharedStepGroup(created.id, { steps: group.steps, parameter_values: {} });
      assert.equal((await db.prepare('SELECT parameter_values FROM shared_step_groups WHERE id = ?').get(created.id)).parameter_values['r.password'], 'obsolete-private-default', 'An actual source reference keeps an omitted hidden default');
      await groups.updateSharedStepGroup(created.id, { steps: [{ ...group.steps[0], action: 'Public action', automation_code: null }], parameter_values: {} });
      const stored = await db.prepare('SELECT parameter_values FROM shared_step_groups WHERE id = ?').get(created.id);
      assert.equal(Object.hasOwn(stored.parameter_values, 'r.password'), false);
      await groups.updateSharedStepGroup(created.id, { test_data_set_id: null });
      assert.equal((await groups.getSharedStepGroup(created.id)).test_data_set_id, null);
    });
  } finally { await db.close(); }
});
