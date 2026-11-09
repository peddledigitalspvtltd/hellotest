const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');

test('full web recording commits through real nested step transactions without changing its manual source or shared definition', {
  skip: process.env.WEB_RECORDER_POSTGRES_TEST !== '1', timeout: 120000
}, async t => {
  const target = new URL(process.env.DATABASE_URL);
  assert.match(target.pathname, /^\/agent_verify_web_recorder_[0-9]+$/);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname));
  assert.equal(process.env.DATABASE_URL, process.env.OBS_DATABASE_URL);
  const db = require('@hellotest/platform/backend/src/db'), obs = require('@hellotest/platform/backend/src/obsDb');
  try {
    assert.equal((await db.prepare("SELECT to_regclass('public.projects') AS present").get()).present, null, 'Use an empty disposable recorder database.');
    await db.query(fs.readFileSync(path.resolve(__dirname, '../../../platform/backend/instance-setup-data/schema-setup/schema.sql'), 'utf8'));
    await require('../../../platform/backend/src/db/bootstrap').ensureRuntimeSchema();
    await require('../../../platform/backend/src/obsDb/bootstrap').ensureRuntimeSchema();
    const author = randomUUID(), project = randomUUID(), app = randomUUID();
    await db.prepare("INSERT INTO users(id,email,password_hash,name,status,is_workspace_admin) VALUES(?,?,'no-login','Recorder fixture','active',TRUE)").run(author, `${author}@example.test`);
    await db.prepare("INSERT INTO projects(id,name) VALUES(?,'Disposable web recording')").run(project);
    await db.prepare("INSERT INTO app_types(id,project_id,name,type) VALUES(?,?,'Recorder fixture','web')").run(app, project);
    await db.prepare("INSERT INTO project_members(id,project_id,user_id,role_id) VALUES(?,?,?,'role-admin')").run(randomUUID(), project, author);
    const cases = require('@hellotest/testing/backend/services/testCase.service');
    const steps = require('@hellotest/testing/backend/services/testStep.service');
    const groups = require('../../../testing/backend/services/sharedStepGroup.service');
    const preparation = require('../../backend/services/automationCasePreparation.service');
    const filename = require.resolve('../../backend/services/aiAutomationBuilder.service'), loaded = { exports: {} };
    new Function('require', 'exports', 'module', `${fs.readFileSync(filename, 'utf8')}\nmodule.exports._applyRecorderSteps=applyRecorderSteps;`)(createRequire(filename), loaded.exports, loaded);
    const apply = loaded.exports._applyRecorderSteps;
    const read = id => db.prepare('SELECT * FROM test_steps WHERE test_case_id=? ORDER BY step_order,id').all(id);
    const source = await cases.createTestCase({ app_type_id: app, title: 'Manual account journey', automated: 'no', created_by: author, steps: [
      { action: 'Prepare account', step_type: 'api', api_request: { method: 'POST', url: 'https://fixture.test/account' } },
      { action: 'Remove account', step_type: 'api', api_request: { method: 'DELETE', url: 'https://fixture.test/account' } }
    ] });
    const shared = await groups.createSharedStepGroup({ app_type_id: app, name: 'Reusable manual sign-in', created_by: author, steps: [
      { action: 'Enter name', expected_result: 'Name entered', step_type: 'web' },
      { action: 'Enter password', expected_result: 'Password entered', step_type: 'web' },
      { action: 'Submit old flow', expected_result: 'Old confirmation', step_type: 'web' }
    ] });
    await steps.insertSharedStepGroup({ test_case_id: source.id, shared_step_group_id: shared.id, insert_after_step_id: (await read(source.id))[0].id });
    const manualBefore = await read(source.id);
    const prepared = await preparation.prepareAutomationTarget({ testCaseId: source.id, createdBy: author, startUrl: 'https://fixture.test/form' });
    const automation = await cases.getTestCase(prepared.test_case_id), initial = await read(automation.id);
    const sharedBefore = await groups.getSharedStepGroup(shared.id);
    const definition = ({ usage_count, used_test_cases, ...value }) => value;
    const assertSharedDefinition = async () => {
      const current = await groups.getSharedStepGroup(shared.id);
      assert.deepEqual(definition(current), definition(sharedBefore));
      assert.equal(current.usage_count, 1, 'The replaced automation rows no longer count as shared-group references.');
      assert.deepEqual(current.used_test_cases.map(row => row.id), [source.id]);
    };
    assert.equal(initial.filter(row => row.reusable_group_id === shared.id).length, 3);
    const candidate = index => ({ source_action_index: index, action: `Recorded action ${index}`, expected_result: '', step_type: 'web', keyword: 'web.click', automation_code: `await page.locator("#recorded-${index}").click();` });
    const save = async (candidates, expectedSteps) => apply({ testCase: automation, stepCandidates: candidates, expectedSteps: expectedSteps || await read(automation.id), createdBy: author });

    await t.test('replacement removes surplus web rows, detaches reused groups and retains API order and manual source', async () => {
      const result = await save([candidate(1), candidate(2)], initial), saved = await read(automation.id);
      assert.equal(result.length, 2);
      assert.deepEqual(saved.map(row => row.action), ['Prepare account', 'Recorded action 1', 'Recorded action 2', 'Remove account']);
      assert.deepEqual(saved.map(row => row.step_order), [1, 2, 3, 4]);
      assert.deepEqual(saved.filter(row => row.step_type === 'api').map(row => row.api_request), initial.filter(row => row.step_type === 'api').map(row => row.api_request));
      assert.ok(saved.filter(row => row.step_type === 'web').every(row => !row.group_id && !row.reusable_group_id && !row.expected_result));
      assert.equal((await cases.getTestCase(automation.id)).automation_status, 'ready');
      assert.deepEqual(await read(source.id), manualBefore);await assertSharedDefinition();
    });

    await t.test('expansion creates additional rows inside nested real transactions with stable final order', async () => {
      const before = await read(automation.id), result = await save([candidate(1), candidate(2), candidate(3), candidate(4)]), saved = await read(automation.id);
      assert.equal(result.filter(row => row.operation === 'created').length, 2);
      assert.deepEqual(saved.map(row => row.action), ['Prepare account', 'Recorded action 1', 'Recorded action 2', 'Recorded action 3', 'Recorded action 4', 'Remove account']);
      assert.deepEqual(saved.map(row => row.step_order), [1, 2, 3, 4, 5, 6]);
      assert.deepEqual(saved.filter(row => row.step_type === 'web').slice(0, 2).map(row => row.id), before.filter(row => row.step_type === 'web').map(row => row.id));
      assert.deepEqual(await read(source.id), manualBefore);await assertSharedDefinition();
    });

    await t.test('a deferred database commit failure rolls back updates, inserts, removals and readiness', async () => {
      const before = await read(automation.id), caseBefore = await cases.getTestCase(automation.id);
      await db.query(`CREATE FUNCTION fixture_reject_recorder_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.test_case_id='${automation.id}' THEN RAISE EXCEPTION 'Fixture rejects recorder commit' USING ERRCODE='23514'; END IF; RETURN NULL; END $$`);
      await db.query('CREATE CONSTRAINT TRIGGER fixture_recorder_commit AFTER INSERT OR UPDATE ON test_steps DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fixture_reject_recorder_commit()');
      try {
        await assert.rejects(save([candidate(91), candidate(92), candidate(93), candidate(94), candidate(95)]), /Fixture rejects recorder commit/);
        assert.deepEqual(await read(automation.id), before);
        assert.equal(String((await cases.getTestCase(automation.id)).updated_at), String(caseBefore.updated_at));
      } finally { await db.query('DROP TRIGGER fixture_recorder_commit ON test_steps');await db.query('DROP FUNCTION fixture_reject_recorder_commit()'); }
      assert.deepEqual(await read(source.id), manualBefore);await assertSharedDefinition();
    });

    await t.test('a changed plan is rejected before stale recording writes and empty capture preserves it', async () => {
      const stale = await read(automation.id);
      await steps.updateTestStep(stale[1].id, { action: 'Concurrent user edit' }, { syncSharedGroup: false });
      const latest = await read(automation.id);
      await assert.rejects(save([candidate(1)], stale), { code: 'AUTOMATION_RECORDER_CASE_CHANGED' });
      assert.deepEqual(await read(automation.id), latest);
      assert.deepEqual(await save([]), []);assert.deepEqual(await read(automation.id), latest);
    });

    const imports = require('../../backend/services/recordingImport.service').createRecordingImportService({ db });
    const identity = sessionId => ({ projectId: project, sourceCaseId: automation.id, userId: author, sessionId,
      transactionId: randomUUID(), parameterBindings: [], capture: { id: sessionId, status: 'stopped', actions: [{ index: 1, value: 'Private input only hashed in receipt identity' }] } });
    const importPlan = (input, candidates) => imports.commit(input, automation.id, async () => ({ test_case_id: automation.id,
      generated_step_count: candidates.length, step_updates: (await save(candidates)).map(({ automation_code, ...step }) => step) }));

    await t.test('a lost response replays the committed full-plan receipt after later edits without replacing those edits', async () => {
      const input = identity('full-save'), result = await importPlan(input, [candidate(101), candidate(102)]);
      const recorded = await read(automation.id), edited = recorded.find(row => row.step_type === 'web');
      await steps.updateTestStep(edited.id, { action: 'Edited after successful recording' }, { syncSharedGroup: false });
      const beforeReplay = await read(automation.id);
      assert.deepEqual(await importPlan(input, [candidate(999)]), { ...result, idempotent_replay: true });
      assert.deepEqual(await read(automation.id), beforeReplay);
      const receipt = await db.prepare('SELECT result FROM automation_recording_imports WHERE recorder_session_id=?').get('full-save');
      assert.ok(!JSON.stringify(receipt).includes('Private input only hashed'));
      assert.ok(!JSON.stringify(receipt).includes('automation_code'));
      await assert.rejects(importPlan({ ...input, parameterBindings: [{ source_action_index: 1, parameter_reference: '@r.changed' }] }, [candidate(999)]), { code: 'AUTOMATION_RECORDER_IMPORT_CONFLICT' });
      await assert.rejects(importPlan({ ...input, capture: { ...input.capture, actions: [{ index: 1, value: 'Conflicting replacement capture' }] } }, [candidate(999)]), { code: 'AUTOMATION_RECORDER_IMPORT_CONFLICT' });
      assert.deepEqual(await read(automation.id), beforeReplay);
    });

    await t.test('concurrent retries import the plan once and replay the same row identities', async () => {
      const input = identity('concurrent-save');let writes = 0;
      const commit = () => imports.commit(input, automation.id, async () => { writes++;return { step_updates: await save([candidate(201), candidate(202)]) }; });
      const results = await Promise.all([commit(), commit()]);
      assert.equal(writes, 1);assert.equal(results.filter(result => result.idempotent_replay).length, 1);
      assert.deepEqual(results[0].step_updates.map(row => row.step_id), results[1].step_updates.map(row => row.step_id));
    });

    await t.test('a selected-section import and its receipt are atomic, preserve its prose, reject stale snapshots, and replay safely', async () => {
      const initial = await read(automation.id), target = initial.find(row => row.step_type === 'web'), input = { ...identity('section-save'), targetStepId: target.id };
      const run = () => imports.commit(input, automation.id, async () => ({ step_updates: await apply({ testCase: automation,
        stepCandidates: [candidate(301), candidate(302)], expectedSteps: initial, targetStepId: target.id, createdBy: author }) }));
      const saved = await run(), after = await read(automation.id);
      assert.equal(saved.step_updates.length, 1);
      assert.equal(after.find(row => row.id === target.id).action, target.action);
      assert.match(after.find(row => row.id === target.id).automation_code, /recorded-301/);
      assert.match(after.find(row => row.id === target.id).automation_code, /recorded-302/);
      assert.deepEqual(await run(), { ...saved, idempotent_replay: true });
      await assert.rejects(apply({ testCase: automation, stepCandidates: [candidate(999)], expectedSteps: initial, targetStepId: target.id, createdBy: author }), { code: 'AUTOMATION_RECORDER_CASE_CHANGED' });
      assert.deepEqual(await read(automation.id), after);
      const failed = { ...identity('section-rollback'), targetStepId: target.id };
      await assert.rejects(imports.commit(failed, automation.id, async () => {
        await apply({ testCase: automation, stepCandidates: [candidate(999)], targetStepId: target.id, createdBy: author });
        throw new Error('Receipt commit rejected');
      }), /Receipt commit rejected/);
      assert.deepEqual(await read(automation.id), after);
      assert.equal(await imports.load(failed), null);
    });
  } finally { await Promise.all([db.close(), obs.close()]); }
});
