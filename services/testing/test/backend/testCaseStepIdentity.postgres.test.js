const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

test('whole-case PostgreSQL edits preserve referenced step identities, source and manual links within revision transactions', {
  skip: process.env.CASE_STEP_IDENTITY_POSTGRES !== '1', timeout: 120000
}, async () => {
  const target = new URL(process.env.DATABASE_URL);
  assert.match(target.pathname, /^\/agent_verify_case_step_identity_\d+$/);
  assert.ok(['localhost', '127.0.0.1'].includes(target.hostname));
  assert.equal(process.env.DATABASE_URL, process.env.OBS_DATABASE_URL);
  const db = require('@hellotest/platform/backend/src/db'), obs = require('@hellotest/platform/backend/src/obsDb');
  try {
    assert.equal((await db.prepare("SELECT to_regclass('public.projects') AS present").get()).present, null);
    await db.query(fs.readFileSync(path.resolve(__dirname, '../../../platform/backend/instance-setup-data/schema-setup/schema.sql'), 'utf8'));
    await require('../../../platform/backend/src/db/bootstrap').ensureRuntimeSchema();
    await require('../../../platform/backend/src/obsDb/bootstrap').ensureRuntimeSchema();
    const project = randomUUID(), app = randomUUID(), author = randomUUID();
    await db.prepare("INSERT INTO users(id,email,password_hash,name,status) VALUES(?,?,'no-login','Step identity fixture','active')").run(author, `${author}@example.test`);
    await db.prepare("INSERT INTO projects(id,name) VALUES(?,'Step identity fixture')").run(project);
    await db.prepare("INSERT INTO app_types(id,project_id,name,type) VALUES(?,?,'Fixture web','web')").run(app, project);
    const role = await db.prepare('SELECT id FROM roles LIMIT 1').get();
    await db.prepare('INSERT INTO project_members(id,project_id,user_id,role_id) VALUES(?,?,?,?)').run(randomUUID(), project, author, role.id);
    const cases = require('../../backend/services/testCase.service');
    const steps = require('../../backend/services/testStep.service');
    const versions = require('../../backend/services/testCaseVersion.service');
    const input = { app_type_id: app, created_by: author, title: 'Product details', steps: [{ action: 'Open selected product', expected_result: 'Product opens in same tab', step_type: 'web' }] };
    const manual = await cases.createTestCase({ ...input, automated: 'no' });
    const source = 'await web.switchTab({index:1,url:"https://shop.test/product"});\nawait expect(page.getByRole("heading")).toHaveText(params["r.product_name"]);';
    const automation = await cases.createTestCase({ ...input, automated: 'yes', manual_test_case_ids: [manual.id], automation_start_url: 'https://shop.test/',
      steps: [{ ...input.steps[0], automation_code: source, group_id: 'product-group', group_name: 'Product', group_kind: 'local' }] });
    const before = (await steps.getTestSteps({ test_case_id: automation.id }))[0], manualBefore = (await steps.getTestSteps({ test_case_id: manual.id }))[0];
    // A real dependent row proves this edit updates the existing step instead
    // of deleting/reinserting the same ID or breaking historical ownership.
    await db.query('CREATE TABLE fixture_step_references(step_id TEXT PRIMARY KEY REFERENCES test_steps(id) ON DELETE RESTRICT)');
    await db.prepare('INSERT INTO fixture_step_references(step_id) VALUES(?)').run(before.id);
    const result = await cases.updateTestCase(automation.id, { expected_revision: 1, updated_by: author,
      steps: [{ id: before.id, expected_result: 'Selected product details are displayed' }] });
    assert.equal(result.revision, 2);
    const after = (await steps.getTestSteps({ test_case_id: automation.id }))[0];
    assert.equal(after.id, before.id); assert.equal(after.automation_code, before.automation_code);
    assert.equal(after.group_id, before.group_id); assert.equal(after.group_name, before.group_name);
    assert.deepEqual((await cases.getTestCase(automation.id)).manual_test_case_ids, [manual.id]);
    assert.equal((await versions.get(automation.id, 1)).content.steps[0].expected_result, before.expected_result);
    await cases.updateTestCase(manual.id, { expected_revision: 1, updated_by: author,
      steps: [{ id: manualBefore.id, expected_result: after.expected_result }] });
    assert.equal((await steps.getTestSteps({ test_case_id: manual.id }))[0].id, manualBefore.id);
    const { groundedManualCoverage } = require("../../../automation/backend/lib/build/automationBuildCompletion");
    const coverage = groundedManualCoverage([after], [{ id: manual.id, steps: await steps.getTestSteps({ test_case_id: manual.id }) }]);
    assert.deepEqual(coverage.unmappedManualStepIds, []);
    const versionCount = (await db.prepare('SELECT count(*)::int AS count FROM test_case_versions WHERE test_case_id=?').get(automation.id)).count;
    for (const invalid of [[{ id: manualBefore.id, action: 'Cross-case row' }], [{ id: before.id }, { id: before.id }]]) {
      await assert.rejects(cases.updateTestCase(automation.id, { expected_revision: 2, updated_by: author, title: 'Must not commit', steps: invalid }), error => [400, 409].includes(error.statusCode));
      assert.deepEqual(await steps.getTestSteps({ test_case_id: automation.id }), [after]);
      assert.equal((await db.prepare('SELECT count(*)::int AS count FROM test_case_versions WHERE test_case_id=?').get(automation.id)).count, versionCount);
    }
    const literalRequest = { method: 'GET', url: 'https://api.example.test/health', validations: [{ kind: 'status', expected: '200', operator: null }] };
    const literalCase = await cases.createTestCase({ app_type_id: app, created_by: author, title: 'API health',
      automated: 'yes', automation_case_type: 'api', steps: [{ action: 'Check health', api_request: literalRequest }] });
    const apiStep = (await steps.getTestSteps({ test_case_id: literalCase.id }))[0];
    assert.equal(apiStep.step_type, 'api');
    assert.equal(apiStep.api_request.validations[0].expected, '200');
    assert.deepEqual((await cases.getTestCase(literalCase.id)).parameter_values, {});

    const draftRequest = { ...literalRequest, url: '@r.base_url/health', validations: [{ kind: 'status', expected: '@t.status' }],
      auth: { type: 'bearer' }, captures: [{ path: '$.requestId' }] };
    await cases.updateTestCase(literalCase.id, { expected_revision: 1, updated_by: author, steps: [{ id: apiStep.id, api_request: draftRequest }] });
    const updatedApiStep = await steps.getTestStep(apiStep.id);
    assert.equal(updatedApiStep.api_request.url, '@r.base_url/health');
    assert.equal(updatedApiStep.api_request.validations[0].expected, '@t.status');
    assert.deepEqual(updatedApiStep.api_request.captures, [{ path: '$.requestId', parameter: null }]);
    const legacy = { ...literalRequest, method: 'FETCH' };
    await db.prepare('UPDATE test_steps SET api_request=? WHERE id=?').run(legacy, apiStep.id);
    await cases.updateTestCase(literalCase.id, { expected_revision: 2, updated_by: author, steps: [{ id: apiStep.id, expected_result: 'Health is available', api_request: legacy }] });
    assert.deepEqual((await steps.getTestStep(apiStep.id)).api_request, legacy);

    const standalone = await steps.createTestStep({ test_case_id: manual.id, step_order: 2, action: 'Inspect API health', api_request: literalRequest });
    assert.equal((await steps.getTestStep(standalone.id)).step_type, 'api');
    await steps.updateTestStep(standalone.id, { api_request: draftRequest });
    const savedDraft = await steps.getTestStep(standalone.id);
    assert.equal(savedDraft.api_request.auth.type, 'bearer');
    assert.equal(savedDraft.api_request.validations[0].expected, '@t.status');
    await assert.rejects(steps.updateTestStep(standalone.id, { api_request: { ...literalRequest, method: 'FETCH' } }), { statusCode: 422, code: 'INVALID_API_REQUEST' });
    assert.deepEqual(await steps.getTestStep(standalone.id), savedDraft);
  } finally { await Promise.all([db.close(), obs.close()]); }
});
