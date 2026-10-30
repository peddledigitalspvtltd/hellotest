const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectExecutablePlan } = require('../../backend/services/automationReadiness.service');
const fs = require('node:fs');
const path = require('node:path');
const { resolveAutomationCaseSteps } = require('../../../platform/backend/src/utils/automationCaseType');

test('engine preflight compiles source without evaluating it and blocks incomplete or invalid programs', () => {
  global.__automationPreflightExecuted = false;
  const valid = [{ id: 's', order: 1, step_type: 'web', automation_code: 'global.__automationPreflightExecuted = true; await page.goto("https://app.test");' }];
  assert.deepEqual(inspectExecutablePlan(valid), []);
  assert.equal(global.__automationPreflightExecuted, false);
  delete global.__automationPreflightExecuted;
  assert.match(inspectExecutablePlan([{ ...valid[0], automation_code: 'await page.;' }])[0], /invalid JavaScript/);
  assert.match(inspectExecutablePlan([{ ...valid[0], automation_code: '// no implementation' }])[0], /missing/);
  assert.match(inspectExecutablePlan([{ ...valid[0], automation_code: '// @hellotest-options skip' }])[0], /All.*skipped/);
  assert.deepEqual(inspectExecutablePlan([{ ...valid[0], automation_code: '// @hellotest-options skip' }, { id: 'api', order: 2, step_type: 'api', api_request: { method: 'POST', url: '/orders' } }]), []);
  assert.match(inspectExecutablePlan([{ id: 'api', order: 1, step_type: 'api', api_request: { method: 'FETCH', url: '/orders' } }])[0], /supported method/);
});

test('dispatch planning never allocates eligible jobs for malformed frozen automation despite a ready summary badge', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../../backend/services/testEngineDispatch.service.js'), 'utf8');
  const body = source.slice(source.indexOf('async function planExecutionDispatch('), source.indexOf('\nasync function settleExecutionIfComplete('));
  const dependencies = {
    require: name => { assert.equal(name, './automationReadiness.service'); return { inspectExecutablePlan }; },
    selectProject: { get: async () => ({ id: 'p' }) }, selectAppType: { get: async () => ({ id: 'app', type: 'web' }) },
    selectTestCaseDispatchMetadata: { get: async () => ({ automated: 'yes', automation_status: 'ready' }) },
    resolveExecutionDataSetIterations: () => [{ index: 0, key: 'default:1', total: 1 }],
    normalizeText: value => value == null ? null : String(value).trim(), normalizeRichText: value => value || '',
    resolveEngineStepType: value => ['api', 'web', 'android', 'ios'].includes(value) ? value : null,
    resolveStepEngineClass: step => step.step_type,
    resolveAutomationCaseSteps,
    normalizeApiRequest: value => value, normalizeStringRecord: value => value || {},
    summarizeWarnings: value => value, uuid: () => 'engine-run'
  };
  const plan = new Function(...Object.keys(dependencies), `${body}\nreturn planExecutionDispatch;`)(...Object.values(dependencies));
  const execution = {
    project_id: 'p', app_type_id: 'app',
    case_snapshots: ['valid', 'missing', 'syntax', 'api'].map(id => ({ test_case_id: id, test_case_title: id })),
    step_snapshots: [
      { test_case_id: 'valid', snapshot_step_id: 'v', step_order: 1, step_type: 'ios', automation_code: 'await ios.tap("~submit");' },
      { test_case_id: 'missing', snapshot_step_id: 'm', step_order: 1, step_type: 'web', automation_code: '' },
      { test_case_id: 'syntax', snapshot_step_id: 's', step_order: 1, step_type: 'web', automation_code: 'await page.;' },
      { test_case_id: 'api', snapshot_step_id: 'a', step_order: 1, step_type: 'api', api_request: { method: 'GET', url: '/health' } }
    ]
  };
  const result = await plan(execution);
  assert.deepEqual(result.eligibleCases.map(item => item.case_snapshot.test_case_id), ['valid', 'api']);
  assert.equal(result.unsupported_automated_case_count, 2);
  assert.ok(result.warnings.some(warning => /missing.*instructions are missing/.test(warning)));
  assert.ok(result.warnings.some(warning => /syntax.*invalid JavaScript/.test(warning)));
});

test('readiness requires saved checks for expected outcomes and validates API fields before normalization', () => {
  const step = { id: 'web', order: 1, step_type: 'web', expected_result: 'The saved message is visible', automation_code: 'await page.locator("button").click();' };
  assert.match(inspectExecutablePlan([step])[0], /executable assertion/);
  assert.deepEqual(inspectExecutablePlan([{ ...step, automation_code: step.automation_code + '\nawait expect(page.locator("h1")).toHaveText("Saved");' }]), []);
  const api = { id: 'api', order: 2, step_type: 'api', expected_result: 'HTTP 201 and a created ID', api_request: { method: 'POST', url: '/orders' } };
  assert.match(inspectExecutablePlan([api])[0], /explicit response assertions/);
  assert.deepEqual(inspectExecutablePlan([{ ...api, api_request: { ...api.api_request, validations: [{ kind: 'status', expected: '201' }, { kind: 'json_path', target: '$.id', operator: 'exists' }] } }]), []);
  for (const request of [
    { method: 'FETCH', url: '/orders' },
    { method: 'GET', url: '/orders', validations: [{ kind: 'invented', expected: 'true' }] },
    { method: 'GET', url: '/orders', body_mode: 'json', body: '{}' }
  ]) assert.ok(inspectExecutablePlan([{ ...api, api_request: request }]).length);
});

test('dispatch readiness accepts the same plain JS and canonical Playwright wrappers as the engine',()=>{
  for(const source of [
    'import {test,expect} from "@playwright/test"; test("flow",async({page})=>{await expect(page.locator("h1")).toHaveText("Ready");});',
    '// @hellotest-options optional\nexport default async function ({page}) { await page.locator("button").click(); }',
    'module.exports = async ({page}) => { await page.locator("button").click(); };',
    'async function ({page}) { await page.locator("button").click(); }',
    'function helper(){return "Ready";} await expect(page.locator("h1")).toHaveText(helper());',
    'await test.step("flow",async()=>{await page.locator("button").click();});'
  ]) assert.deepEqual(inspectExecutablePlan([{id:'s',order:1,step_type:'web',automation_code:source}]),[],source);
  for(const source of ['page.locator("button").click();','expect(page.locator("h1")).toHaveText("Ready");','Promise.all([page.locator("button").click()]);'])
    assert.match(inspectExecutablePlan([{id:'s',order:1,step_type:'web',automation_code:source}])[0],/detached|promise/);
  assert.match(inspectExecutablePlan([{id:'s',order:1,step_type:'web',automation_code:'test.beforeEach(async({page})=>{await page.goto("/");});'}])[0],/hooks|workspace/);
});
