const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');

test('validated Plan sections and generated defaults persist progressively without losing concurrent edits or advancing failed commits', {
  skip: process.env.AUTOMATION_PROGRESSIVE_PLAN_POSTGRES !== '1', timeout: 120000
}, async t => {
  const target = new URL(process.env.DATABASE_URL);
  assert.equal(target.pathname, '/agent_verify_progressive_plan');
  assert.ok(['localhost', '127.0.0.1'].includes(target.hostname));
  assert.equal(process.env.DATABASE_URL, process.env.OBS_DATABASE_URL);
  const db = require('@hellotest/platform/backend/src/db');
  const obs = require('@hellotest/platform/backend/src/obsDb');
  try {
    assert.equal((await db.prepare("SELECT to_regclass('public.projects') AS present").get()).present, null, 'Use an empty task-owned fixture database.');
    await db.query(fs.readFileSync(path.resolve(__dirname, '../../../platform/backend/instance-setup-data/schema-setup/schema.sql'), 'utf8'));
    await require('../../../platform/backend/src/db/bootstrap').ensureRuntimeSchema();
    await require('../../../platform/backend/src/obsDb/bootstrap').ensureRuntimeSchema();
    const project = randomUUID(), app = randomUUID(), author = randomUUID();
    await db.prepare("INSERT INTO users(id,email,password_hash,name,status) VALUES(?,?,'no-login','Progressive fixture','active')").run(author, `${author}@example.test`);
    await db.prepare("INSERT INTO projects(id,name) VALUES(?,'Disposable progressive Plan')").run(project);
    await db.prepare("INSERT INTO app_types(id,project_id,name,type) VALUES(?,?,'Fixture web','web')").run(app, project);
    await db.prepare("INSERT INTO project_members(id,project_id,user_id,role_id) VALUES(?,?,?,'role-admin')").run(randomUUID(), project, author);
    const cases = require('@hellotest/testing/backend/services/testCase.service');
    const testSteps = require('@hellotest/testing/backend/services/testStep.service');
    const context = require('../../backend/lib/automationBuildContext');
    const snapshots = require('../../backend/lib/automationBuildDataSnapshot');
    const { completeAutomationBuild } = require('../../backend/lib/automationBuildCompletion');
    const filename = require.resolve('../../backend/services/aiAutomationBuilder.service');
    const loaded = { exports: {} };
    new Function('require', 'exports', 'module', `${fs.readFileSync(filename, 'utf8')}\nmodule.exports._applyBuild=applyBuild;module.exports._normalizeLlmBuild=normalizeLlmBuild;`)(createRequire(filename), loaded.exports, loaded);
    const applyBuild = loaded.exports._applyBuild;
    let writes = 0;
    const updateStep = testSteps.updateTestStep;
    t.mock.method(testSteps, 'updateTestStep', async (...args) => { writes++; return updateStep(...args); });
    const readSteps = caseId => db.prepare('SELECT * FROM test_steps WHERE test_case_id=? ORDER BY step_order,id').all(caseId);
    const versionCount = async caseId => (await db.prepare('SELECT COUNT(*)::int AS count FROM test_case_versions WHERE test_case_id=?').get(caseId)).count;

    async function fixture(name) {
      const manual = await cases.createTestCase({ app_type_id: app, title: name, created_by: author, automated: 'no',
        parameter_values: { 't.email': '{{randomString:8}}' }, steps: [
          { action: 'Enter @t.email', expected_result: 'Email entered', step_type: 'web' },
          { action: 'Read verification email', expected_result: 'Code is available', step_type: 'web' }
        ] });
      const automation = await cases.createTestCase({ app_type_id: app, title: name, created_by: author, automated: 'yes',
        automation_start_url: 'https://app.example.test/signup', manual_test_case_ids: [manual.id], steps: [
          { action: 'Enter @t.email', expected_result: 'Email entered', step_type: 'web' },
          { action: 'Read verification email', expected_result: 'Code is available', step_type: 'web' }
        ] });
      const targetCase = await cases.getTestCase(automation.id);
      const steps = await readSteps(automation.id);
      const manualContext = await context.loadAutomationManualContext({ caseId: automation.id, projectId: project, userId: author });
      const parameters = await context.loadAutomationParameterContext({ testCase: targetCase, projectId: project, userId: author });
      const snapshot = await snapshots.prepareBuildDataSnapshot({ testCase: targetCase, projectId: project, userId: author, generatedValues: { 't.email': 'resolved@example.test' } });
      const state = { steps: structuredClone(steps), parameter_context_key: parameters.source_key, data_snapshot: snapshot };
      const guards = { project_id: project, app_type_id: app, case_start_url: targetCase.automation_start_url,
        manual_context: manualContext, manual_link_ids: [manual.id], parameter_context_key: parameters.source_key, data_snapshot: snapshot };
      const updates = steps.map((step, index) => ({ step, step_type: 'web', api_request: null,
        automation_code: index ? 'await expect(page.getByText("Verification code")).toBeVisible();' : 'await page.getByLabel("Email").fill(params["t.email"]);' }));
      return { manual, automation, state, guards, updates, steps, manualContext };
    }

    const first = await fixture('Retained partial Plan');
    const transactions = require('@hellotest/platform/backend/services/workspaceTransaction.service');
    const activities = require('../../backend/services/automationAgentActivity.service');
    const preparation = require('../../backend/services/automationCasePreparation.service');
    const targets = require('../../backend/services/automationBuildTargets.service');
    const activity = await transactions.createTransaction({ project_id: project, app_type_id: app,
      category: 'automation_build', action: 'single_case_automation_build', status: 'running', title: 'Manual-source partial build', created_by: author,
      metadata: { agent_activity: true, input_test_case_ids: [first.manual.id], output_test_case_ids: [first.automation.id], fixture_marker: 'preserved' } });
    const prepared = await preparation.prepareAutomationTarget({ testCaseId: first.manual.id, createdBy: author, aiGenerated: true, startUrl: 'https://app.example.test/signup' });
    assert.notEqual(prepared.test_case_id, first.manual.id);
    await Promise.all([targets.registerTarget(activity.id, prepared.test_case_id), targets.registerTarget(activity.id, prepared.test_case_id)]);
    const registered = await transactions.getTransaction(activity.id);
    assert.deepEqual(registered.metadata.input_test_case_ids, [first.manual.id]);
    assert.deepEqual(registered.metadata.output_test_case_ids, [first.automation.id, prepared.test_case_id]);
    assert.equal(registered.metadata.fixture_marker, 'preserved');
    assert.equal(registered.status, 'running');
    assert.equal((await activities.latest({ projectId: project, appTypeId: app, caseId: prepared.test_case_id })).id, activity.id);
    assert.ok((await activities.history({ projectId: project, appTypeId: app, caseId: prepared.test_case_id })).items.some(item => item.id === activity.id));
    assert.equal((await activities.latest({ projectId: project, appTypeId: app, caseId: first.manual.id })).id, activity.id);
    assert.equal((await readSteps(prepared.test_case_id)).filter(step => step.automation_code).length, 0, 'Prepared-case activity discovery must work before any complete generation or code save.');
    const originalKey = first.state.parameter_context_key;
    await assert.rejects(completeAutomationBuild({ steps: first.steps,
      manualSteps: first.manualContext.flatMap(row => row.steps.map(step => ({ ...step, test_case_id: row.id }))), sequential: true,
      validate: (payload, required) => loaded.exports._normalizeLlmBuild(payload, required, [], 'https://app.example.test/signup'),
      onSaveSection: async ({ normalized }) => { await applyBuild({ build: { ...first.guards, updates: normalized.updates }, createdBy: author, progressiveState: first.state, partial: true }); },
      generate: async ({ activeStepId }) => activeStepId === first.steps[0].id
        ? { steps: [{ step_id: activeStepId, automation_code: first.updates[0].automation_code }] }
        : { steps: [], blocked_steps: [{ step_id: activeStepId, dependency_type: 'mailbox', reason: 'A configured inbox is required.', required_context: ['Authorized test mailbox'], required_parameters: [] }] }
    }), error => error.code === 'AUTOMATION_DEPENDENCY_MISSING' && error.saved_sections === 1 && error.saved_step_ids[0] === first.steps[0].id);
    let savedSteps = await readSteps(first.automation.id);
    assert.equal(savedSteps[0].automation_code, first.updates[0].automation_code);
    assert.equal(savedSteps[1].automation_code, null);
    assert.equal((await cases.getTestCase(first.automation.id)).automation_status, 'incomplete');
    assert.equal((await cases.getTestCase(first.automation.id)).parameter_values['t.email'], 'resolved@example.test');
    assert.equal((await cases.getTestCase(first.manual.id)).parameter_values['t.email'], '{{randomString:8}}');
    assert.equal(first.state.data_snapshot, null);
    assert.notEqual(first.state.parameter_context_key, originalKey);
    assert.equal(await versionCount(first.automation.id), 1, 'Generated defaults must be captured once with the first saved section.');

    await applyBuild({ build: { ...first.guards, updates: [first.updates[1]] }, createdBy: author, progressiveState: first.state, partial: true });
    assert.equal((await cases.getTestCase(first.automation.id)).automation_status, 'incomplete', 'Final coverage must succeed before a fully filled Plan becomes ready.');
    const writesBeforeFinal = writes;
    const final = await applyBuild({ build: { ...first.guards, updates: first.updates }, createdBy: author, progressiveState: first.state });
    assert.equal(final.length, 2);
    assert.equal(writes, writesBeforeFinal, 'Final application must not rewrite already-saved instructions.');
    assert.equal((await cases.getTestCase(first.automation.id)).automation_status, 'ready');
    assert.equal(await versionCount(first.automation.id), 1);

    const stateBeforeUserEdit = structuredClone(first.state);
    await testSteps.updateTestStep(first.steps[0].id, { automation_code: 'await page.getByLabel("Email").fill("user-edited@example.test");' }, { syncSharedGroup: false });
    await assert.rejects(applyBuild({ build: { ...first.guards, updates: [first.updates[1]] }, createdBy: author, progressiveState: first.state, partial: true }), /case changed/);
    assert.deepEqual(first.state, stateBeforeUserEdit);
    assert.match((await readSteps(first.automation.id))[0].automation_code, /user-edited/);

    const rollback = await fixture('Deferred commit rollback');
    const beforeRollback = structuredClone(rollback.state);
    await db.query(`CREATE FUNCTION fixture_reject_progressive_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.test_case_id='${rollback.automation.id}' THEN RAISE EXCEPTION 'Fixture rejects progressive commit' USING ERRCODE='23514'; END IF; RETURN NULL; END $$`);
    await db.query('CREATE CONSTRAINT TRIGGER fixture_progressive_commit AFTER UPDATE ON test_steps DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fixture_reject_progressive_commit()');
    let modelRequests = 0, previews = 0;
    const failedSaveEvents = [];
    await assert.rejects(completeAutomationBuild({ steps: rollback.steps,
      manualSteps: rollback.manualContext.flatMap(row => row.steps.map(step => ({ ...step, test_case_id: row.id }))), sequential: true,
      validate: (payload, required) => loaded.exports._normalizeLlmBuild(payload, required, [], 'https://app.example.test/signup'),
      onSaveSection: async ({ normalized }) => { await applyBuild({ build: { ...rollback.guards, updates: normalized.updates }, createdBy: author, progressiveState: rollback.state, partial: true }); },
      onValidatedSection: async () => { previews++; },
      onProgress: async event => failedSaveEvents.push(event),
      generate: async ({ activeStepId }) => { modelRequests++; return { steps: [{ step_id: activeStepId, automation_code: rollback.updates[0].automation_code }] }; }
    }), error => /Fixture rejects progressive commit/.test(error.message) && error.saved_sections === 0 && error.nonRetryable === true);
    assert.equal(modelRequests, 1, 'A rejected critical save must stop before any later model request or section action.');
    assert.equal(previews, 0, 'A failed commit must not publish an accepted section preview.');
    assert.equal(failedSaveEvents.filter(event => ['automation.agent.section.ready', 'automation.agent.coverage'].includes(event.phase)).length, 0);
    assert.deepEqual(rollback.state, beforeRollback, 'A rejected COMMIT must leave the previous in-memory baseline and pending data snapshot intact.');
    assert.equal((await readSteps(rollback.automation.id))[0].automation_code, null);
    assert.deepEqual((await cases.getTestCase(rollback.automation.id)).parameter_values, {});
    assert.equal(await versionCount(rollback.automation.id), 0, 'Generated defaults and history must roll back with the failed instruction commit.');
    await db.query('DROP TRIGGER fixture_progressive_commit ON test_steps');
    await db.query('DROP FUNCTION fixture_reject_progressive_commit()');
    await applyBuild({ build: { ...rollback.guards, updates: [rollback.updates[0]] }, createdBy: author, progressiveState: rollback.state, partial: true });
    assert.equal((await cases.getTestCase(rollback.automation.id)).parameter_values['t.email'], 'resolved@example.test');
    assert.equal(await versionCount(rollback.automation.id), 1);

    const parameterState = structuredClone(rollback.state);
    const caseBeforeParameterEdit = await cases.getTestCase(rollback.automation.id);
    await cases.updateTestCase(rollback.automation.id, { parameter_values: { 't.email': 'reviewed@example.test' }, expected_revision: caseBeforeParameterEdit.revision, updated_by: author });
    await assert.rejects(applyBuild({ build: { ...rollback.guards, updates: [rollback.updates[1]] }, createdBy: author, progressiveState: rollback.state, partial: true }), error => error.code === 'AUTOMATION_PARAMETERS_CHANGED');
    assert.deepEqual(rollback.state, parameterState);
    assert.equal((await readSteps(rollback.automation.id))[1].automation_code, null);

    const { saveFlowPlan } = require('../../backend/services/automationFlowPlan.service');
    const plannedFlow = [
      { action: 'Enter @t.email', expected_result: 'The supplied email appears', step_type: 'web' },
      { action: 'Continue to review', expected_result: 'Review displays @t.email', step_type: 'web' }
    ];
    async function emptyFlowFixture(name) {
      const manual = await cases.createTestCase({ app_type_id: app, title: `${name} manual`, created_by: author, automated: 'no',
        parameter_values: { 't.email': 'fixture@example.test' }, steps: plannedFlow });
      const automation = await cases.createTestCase({ app_type_id: app, title: name, created_by: author, automated: 'yes',
        automation_start_url: 'https://app.example.test/signup', manual_test_case_ids: [manual.id], steps: [] });
      const baseline = { ...await cases.getTestCase(automation.id), app_type_kind: 'web', project_id: project };
      const manualBefore = { value: await cases.getTestCase(manual.id), steps: await readSteps(manual.id) };
      return { manual, automation, baseline, manualBefore };
    }

    await t.test('new manual flow commits two code-free Plan steps through the real nested domain transaction and rejects stale replay', async () => {
      const flow = await emptyFlowFixture('Planned empty automation');
      let sourceChecks = 0;
      const saved = await saveFlowPlan({ testCase: flow.baseline, steps: plannedFlow, userId: author,
        assertSources: async () => { sourceChecks++; } });
      assert.equal(sourceChecks, 1);
      assert.deepEqual(saved.map(step => [step.step_order, step.action, step.expected_result, step.step_type]),
        plannedFlow.map((step, index) => [index + 1, step.action, step.expected_result, step.step_type]));
      assert.ok(saved.every(step => step.test_case_id === flow.automation.id && step.automation_code === null && step.api_request === null));
      assert.equal((await cases.getTestCase(flow.automation.id)).automation_status, 'incomplete');
      assert.equal((await cases.getTestCase(flow.automation.id)).status, flow.baseline.status);
      const beforeReplay = await readSteps(flow.automation.id);
      await assert.rejects(saveFlowPlan({ testCase: flow.baseline, steps: plannedFlow, userId: author }),
        error => error.code === 'AUTOMATION_FLOW_BASELINE_CHANGED' && error.statusCode === 409);
      assert.deepEqual(await readSteps(flow.automation.id), beforeReplay);
      assert.deepEqual({ value: await cases.getTestCase(flow.manual.id), steps: await readSteps(flow.manual.id) }, flow.manualBefore);
    });

    for (const failure of ['lease', 'access']) {
      await t.test(`loss of ${failure} after real domain insertion rolls back the entire manual flow and retains its source`, async st => {
        const flow = await emptyFlowFixture(`Rollback planned ${failure}`);
        const before = await cases.getTestCase(flow.automation.id);
        const createSteps = testSteps.createTestSteps;
        let leaseOwned = true, inserted = 0;
        st.mock.method(testSteps, 'createTestSteps', async input => {
          const result = await createSteps(input);
          inserted = (await readSteps(flow.automation.id)).length;
          if (failure === 'lease') leaseOwned = false;
          else await db.prepare('DELETE FROM project_members WHERE project_id=? AND user_id=?').run(project, author);
          return result;
        });
        await assert.rejects(saveFlowPlan({ testCase: flow.baseline, steps: plannedFlow, userId: author,
          executionGuard: { ensureOwnership: async () => {
            if (!leaseOwned) throw Object.assign(new Error('Fixture lease lost'), { code: 'BATCH_JOB_LEASE_LOST', nonRetryable: true });
          } } }), error => failure === 'lease' ? error.code === 'BATCH_JOB_LEASE_LOST' : error.statusCode === 403);
        assert.equal(inserted, 2, 'Failure is injected after actual nested domain SQL has inserted both steps.');
        assert.deepEqual(await readSteps(flow.automation.id), []);
        assert.deepEqual(await cases.getTestCase(flow.automation.id), before, 'The failed outer transaction must also roll back its status change.');
        assert.ok(await db.prepare('SELECT id FROM project_members WHERE project_id=? AND user_id=?').get(project, author), 'Access revocation inside the failed transaction must roll back.');
        assert.deepEqual({ value: await cases.getTestCase(flow.manual.id), steps: await readSteps(flow.manual.id) }, flow.manualBefore);
      });
    }
  } finally {
    await Promise.all([db.close(), obs.close()]);
  }
});
