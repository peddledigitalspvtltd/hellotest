const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const readiness = require('../../backend/services/automationReadiness.service');
const { configurationTargetsForRead } = require('../../../platform/backend/src/utils/configurationTargets');
const { resolveAutomationCaseType } = require('../../../platform/backend/src/utils/automationCaseType');
const source = fs.readFileSync(path.resolve(__dirname, '../../backend/services/testEngineDispatch.service.js'), 'utf8');
const normalizeText = value => value == null ? null : String(value).trim();

function singleStepFixture() {
  const allocations = [], envelopes = [], jobs = [];
  const dependencies = {
    require: name => { assert.equal(name, './automationReadiness.service'); return readiness; },
    selectProject: { get: async () => ({ id: 'project' }) }, selectAppType: { get: async () => ({ id: 'app', type: 'web' }) },
    resolveEngineStepType: value => value || 'web', normalizeText, normalizeRichText: value => value || '', normalizeStringRecord: value => value || {},
    uuid: () => { const id = `allocated-${allocations.length + 1}`;allocations.push(id);return id; },
    listObjectRepositoryForEnvelope: async () => [], buildEngineEnvelope: async input => { envelopes.push(input);return {steps: input.steps, hooks: [], web_engine: { active: 'playwright' }}; },
    resolveOrchestrationClass: () => 'web', resolveStepEngineClasses: () => ['web'], resolveIntegrationEngineWorkerCaps: () => ({ web: 1 }), getQueueMaxWorkers: () => 1,
    buildProviderLiveViewUrl: () => null, normalizeEngineHostUrl: () => 'https://engine.test', parseStructuredLogs: () => ({ stepStatuses: {} }), normalizeFrozenCapturedValues: value => value,
    workspaceTransactionService: { createTransaction: async input => ({ ...input, id: 'transaction' }), appendTransactionEvent: async () => {} },
    insertJob: { run: async (...args) => jobs.push(args) }
  };
  const body = source.slice(source.indexOf('async function queueSingleStepDispatch('), source.indexOf('\nasync function getQueuedJob('));
  const queue = new Function(...Object.keys(dependencies), `${body}\nreturn queueSingleStepDispatch;`)(...Object.values(dependencies));
  const input = { execution: { id: 'execution', project_id: 'project', app_type_id: 'app' }, caseSnapshot: { test_case_id: 'case', test_case_title: 'Login' }, integration: { id: 'engine', config: {} },
    stepSnapshot: { snapshot_step_id: 'step', step_order: 1, step_type: 'web', expected_result: 'The entered account is retained',
      automation_code: `await page.locator('getByLabel("Account")').fill('@r.account');\nawait expect(page.locator('getByLabel("Account")')).toHaveValue('@r.account');` } };
  return { queue, input, allocations, envelopes, jobs };
}

test('execution-console single-step handoff uses the same prepared saved source as complete runs', async () => {
  const f = singleStepFixture(), before = JSON.stringify(f.input);
  const result = await f.queue(f.input);
  assert.equal(f.jobs.length, 1);assert.equal(result.transaction_id, 'transaction');
  const step = f.envelopes[0].steps[0];
  assert.match(step.automation_code, /page\.getByLabel\("Account", \{ exact: true \}\)/);
  assert.doesNotMatch(step.automation_code, /\.locator\(['"]getBy/);
  assert.match(step.automation_code, /toHaveValue\('@r.account'\)/);
  assert.equal(step.expected_result, f.input.stepSnapshot.expected_result);
  assert.equal(JSON.stringify(f.input), before, 'The frozen source is not rewritten during handoff.');
});

test('single-step handoff runs a linked action without requiring an inline expected-result assertion', async () => {
  const f = singleStepFixture();
  f.input.stepSnapshot.automation_code = 'await page.locator("#login").click();';
  const before = structuredClone(f.input.stepSnapshot);
  await f.queue(f.input);
  assert.equal(f.jobs.length, 1);
  assert.equal(f.envelopes[0].steps[0].automation_code, before.automation_code);
  assert.equal(f.envelopes[0].steps[0].expected_result, before.expected_result);
  assert.deepEqual(f.input.stepSnapshot, before);
});

test('single-step missing instructions or unsupported selector programs fail before job allocation', async () => {
  for (const code of [
    '',
    '// no linked instruction',
    'await page.;',
    `await page.locator('getByRole("button", { name: sideEffect() })').click();`
  ]) {
    const f = singleStepFixture();f.input.stepSnapshot.automation_code = code;
    await assert.rejects(f.queue(f.input), error => error.code === 'AUTOMATION_SAVED_PLAN_INVALID' && error.statusCode === 422 && error.validation_feedback.length > 0);
    assert.deepEqual(f.allocations, []);assert.deepEqual(f.envelopes, []);assert.deepEqual(f.jobs, []);
  }
});

test('the common envelope adapts saved Web hooks without adding setup assertions or changing frozen metadata', async () => {
  const hook = { id: 'before', phase: 'pre', scope: 'test', fail_behavior: 'mark-blocked', steps: [
    { id: 'setup', order: 1, step_type: 'web', expected_result: 'Open the sign-in page', automation_code: `await page.locator('getByText("Login").nth(1)').click();`, source_case_parameters: {'r.account': 'fixture'} },
    { id: 'native', order: 2, step_type: 'ios', automation_code: 'await ios.tap("~Login");' }
  ] };
  const before = JSON.stringify(hook);
  const dependencies = {
    executionWithCaseEnvironment: require('../../backend/lib/automationExecutionEnvironment').executionWithCaseEnvironment,
    configurationTargetsForRead, resolveAutomationCaseType, normalizeText, normalizeEngineBrowser: value => value,
    normalizeInteger: (value, fallback) => value == null ? fallback : Number(value), normalizeSessionMode: (_value, fallback) => fallback,
    resolveExecutionPolicy: async () => ({}), resolveCaseDataSetContext: () => null, resolveExecutionHooks: () => [hook], preserveFrozenEngineEnvelope: value => value,
    normalizeStoredReferenceList: () => [], normalizeTestEngineWebEngine: () => 'playwright', buildManualSpec: () => ({}), configuredRepairBrief: async () => ({}),
    normalizeStringRecord: value => value || {}, toEngineKeyValueEntries: value => value || [],
    require: name => { assert.equal(name, '../lib/automationMobileConfiguration');return require('../../backend/lib/automationMobileConfiguration'); }
  };
  const body = source.slice(source.indexOf('const buildEngineEnvelope ='), source.indexOf('const summarizeWarnings ='));
  const buildEnvelope = new Function(...Object.keys(dependencies), `${body}\nreturn buildEngineEnvelope;`)(...Object.values(dependencies));
  const envelope = await buildEnvelope({ engineRunId: 'run', execution: {id: 'execution'}, project: {id: 'project'}, appType: {type: 'web'},
    caseSnapshot: {test_case_id: 'case', test_case_title: 'Login'}, steps: [{step_type: 'web'}], integration: {config: {}} });
  assert.equal(envelope.hooks[0].steps[0].automation_code, 'await page.getByText("Login", { exact: true }).nth(1).click();');
  assert.equal(envelope.hooks[0].steps[0].expected_result, hook.steps[0].expected_result);
  assert.deepEqual(envelope.hooks[0].steps[0].source_case_parameters, hook.steps[0].source_case_parameters);
  assert.equal(envelope.hooks[0].fail_behavior, 'mark-blocked');assert.deepEqual(envelope.hooks[0].steps[1], hook.steps[1]);
  assert.equal(JSON.stringify(hook), before);
});
