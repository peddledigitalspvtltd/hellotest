const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectExecutablePlan, prepareExecutablePlan } = require('../../backend/services/automationReadiness.service');
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
    require: name => { assert.equal(name, './automationReadiness.service'); return { inspectExecutablePlan, prepareExecutablePlan }; },
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

test('saved locator compatibility prepares identical strict source for both dispatch paths without editing snapshots or inventing checks', async () => {
  const saved = [{ id: 'entry', order: 1, step_type: 'web', expected_result: 'The entered value is retained',
    automation_code: `await page.locator('getByLabel("Email", {exact:true})').fill('@r.email');\nawait expect(page.locator('getByLabel("Email", {exact:true})')).toHaveValue('@r.email');` }];
  const before = JSON.stringify(saved), prepared = await prepareExecutablePlan(saved);
  assert.deepEqual(prepared.issues, []);
  assert.equal(prepared.normalizedLocatorCount, 2);
  assert.match(prepared.steps[0].automation_code, /page\.getByLabel\("Email", \{ exact: true \}\)/);
  assert.doesNotMatch(prepared.steps[0].automation_code, /\.locator\(['"]getBy/);
  assert.equal(JSON.stringify(saved), before);
  const actionOnly = [{ ...saved[0], automation_code: `await page.locator('getByLabel("Email")').fill('@r.email');` }];
  assert.deepEqual((await prepareExecutablePlan(actionOnly)).issues, []);
  assert.match((await prepareExecutablePlan(actionOnly, { requireExpectedAssertions: true })).issues[0], /expected result needs an executable assertion/);
  const unsupported = await prepareExecutablePlan([{ ...saved[0], automation_code: `await page.locator('getByRole("textbox", { name: sideEffect() })').fill('@r.email');` }]);
  assert.match(unsupported.issues[0], /locator expression.*selector string/);
});

test('build quality requires saved checks for expected outcomes and validates API fields before normalization', () => {
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

test('Run admits linked action sections and preserves a later saved assertion without executing or rewriting the source', async () => {
  global.__automationPreflightExecuted = false;
  const sources = [
    'global.__automationPreflightExecuted = true; await page.goto("https://app.test/login");',
    'await page.getByLabel("Email").fill(params["r.email"]);',
    'await page.getByLabel("Password").fill(params["r.password"]);',
    'await page.getByRole("button", { name: "Login" }).click();',
    'await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();'
  ];
  const saved = sources.map((automation_code, index) => ({ id: `section-${index + 1}`, order: index + 1,
    step_type: 'web', action: `Saved section ${index + 1}`, expected_result: `Authored expectation ${index + 1}`, automation_code }));
  const original = structuredClone(saved);
  try {
    const prepared = await prepareExecutablePlan(saved);
    assert.deepEqual(prepared.issues, []);
    assert.deepEqual(prepared.steps, original);
    assert.deepEqual(saved, original);
    assert.equal(global.__automationPreflightExecuted, false);
    const buildIssues = inspectExecutablePlan(saved);
    assert.equal(buildIssues.length, 4);
    assert.ok(buildIssues.every(issue => /expected result needs an executable assertion/.test(issue)));
    assert.deepEqual((await prepareExecutablePlan(saved, { requireExpectedAssertions: true })).issues, buildIssues);

    for (const automation_code of ['', '// instructions have not been linked', 'await page.;']) {
      const broken = saved.map(step => step.order === 3 ? { ...step, automation_code } : step);
      const result = await prepareExecutablePlan(broken);
      assert.equal(result.issues.length, 1);
      assert.match(result.issues[0], /^Step 3:.*(?:instructions are missing|invalid JavaScript)/);
    }
  } finally {
    delete global.__automationPreflightExecuted;
  }
});

test('Run accepts saved API requests without inventing checks and still validates authored request fields', async () => {
  const step = { id: 'api', order: 1, step_type: 'api', expected_result: 'An order is created', api_request: { method: 'POST', url: '/orders' } };
  const original = structuredClone(step);
  assert.deepEqual((await prepareExecutablePlan([step])).issues, []);
  assert.deepEqual(step, original);
  assert.match(inspectExecutablePlan([step])[0], /explicit response assertions/);
  for (const api_request of [
    { method: 'FETCH', url: '/orders' },
    { method: 'POST' },
    { method: 'POST', url: '/orders', validations: [{ kind: 'invented', expected: 'true' }] },
    { method: 'GET', url: '/orders', body_mode: 'json', body: '{}' }
  ]) assert.ok((await prepareExecutablePlan([{ ...step, api_request }])).issues.length);
});

test('legacy untyped Web source keeps strict build checks and uses the same inferred runtime for Run', async () => {
  for (const type of [undefined, null, '', 'manual', ' WEB ']) {
    const step = { id: 'legacy', order: 1, step_type: type, expected_result: 'The account is visible', automation_code: 'await page.locator("#login").click();' };
    assert.match(inspectExecutablePlan([step])[0], /executable assertion/, String(type));
    const actionOnly = await prepareExecutablePlan([step]);
    assert.deepEqual(actionOnly.issues, []);assert.equal(actionOnly.steps[0].step_type, 'web');
    const withCheck = { ...step, automation_code: step.automation_code + '\nawait expect(page.locator("#account")).toBeVisible();' };
    assert.deepEqual(inspectExecutablePlan([withCheck]), []);
    const saved = { ...withCheck, automation_code: `await page.locator('getByLabel("Email")').fill('@r.email');\nawait expect(page.locator("#account")).toBeVisible();` };
    const before = JSON.stringify(saved), prepared = await prepareExecutablePlan([saved]);
    assert.deepEqual(prepared.issues, []);assert.equal(prepared.steps[0].step_type, 'web');assert.equal(prepared.normalizedLocatorCount, 1);
    assert.equal(JSON.stringify(saved), before);
  }
  assert.match(inspectExecutablePlan([{ step_type: 'unknown-runtime', automation_code: 'await page.locator("#login").click();' }])[0], /unsupported automation runtime/);
});

test('recorder readiness accepts untouched compatible legacy instructions without weakening new source validation', async () => {
  const { recordedPlanIssues } = require('../../backend/lib/automationRecorderReadiness');
  const saved = { id: 'existing', order: 1, step_type: 'web', expected_result: 'The account name is retained',
    automation_code: `await page.locator('getByLabel("Account")').fill('@r.account');\nawait expect(page.locator('getByLabel("Account")')).toHaveValue('@r.account');` };
  const recorded = { id: 'recorded', order: 2, step_type: 'web', expected_result: '', automation_code: 'await page.locator("#save").click();' };
  const before = JSON.stringify(saved);
  assert.deepEqual(await recordedPlanIssues([saved, recorded]), []);
  assert.match(inspectExecutablePlan([saved])[0], /locator expression.*selector string/, 'new generated source remains strict');
  assert.equal(JSON.stringify(saved), before);
  assert.deepEqual(await recordedPlanIssues([{ ...saved, automation_code: `await page.locator('getByLabel("Account")').fill('@r.account');` }, recorded]), []);
  assert.match((await recordedPlanIssues([{ ...saved, automation_code: '// no linked instructions' }, recorded]))[0], /instructions are missing/);
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

test('snapshot runner capability fails preflight before preceding actions with actionable source-only correction',()=>{
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;let clicks=0;
  for(const [matcher,subject,argument]of [['toMatchAriaSnapshot','page.locator("body")','`- list:\n  - listitem: Rows per page`'],['toHaveScreenshot','page','"baseline.png"'],['toMatchSnapshot','"actual"','"baseline.txt"']]){
    const source=`await page.locator("#menu").click();await expect(${subject}).${matcher}(${argument});`;
    const issues=inspectExecutablePlan([{id:'native',step_order:13,step_type:'web',expected_result:'The embedded results are visible',automation_code:source}]);
    assert.equal(issues.length,1);assert.match(issues[0],new RegExp(matcher));assert.match(issues[0],/Playwright Test testInfo/);
    assert.match(issues[0],/observed iframe target/);assert.match(issues[0],/without replaying browser actions/);assert.doesNotMatch(issues[0],/expected result needs an executable assertion|invalid JavaScript/);
    const run=()=>{const {normalizeGeneratedProgram}=require('../../backend/lib/automationGeneratedProgram');return new AsyncFunction('page','expect',normalizeGeneratedProgram(source))({locator:()=>({click:async()=>{clicks++;}})},()=>({}));};
    assert.throws(run,{code:'AUTOMATION_RUNNER_MATCHER_UNSUPPORTED'});
  }
  assert.equal(clicks,0);
});
