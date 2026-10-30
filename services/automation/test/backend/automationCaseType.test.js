const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAutomationCaseType, resolveAutomationCaseType, resolveAutomationCaseSteps } = require('../../../platform/backend/src/utils/automationCaseType');
const { normalizeDataOptions } = require('../../../platform/backend/src/utils/scopedTestData');
const { requiresAutomationStartUrl } = require('../../../platform/backend/src/utils/automationStartUrl');
const { buildAutomationCaseBlueprint } = require('../../../platform/backend/src/utils/automationCaseBlueprint');

test('automation platform is a separate required choice and survives independently edited data controls', () => {
  for (const platform of ['web','api','android','ios','unified']) {
    assert.equal(normalizeAutomationCaseType(platform, {required:true}), platform);
    const options = normalizeDataOptions({automation_case_type:platform,override_shared_steps:false,parameter_overrides:['email']});
    assert.equal(options.automation_case_type, platform);
    assert.equal(normalizeDataOptions({...options,override_suite_data:false}).automation_case_type, platform);
    assert.equal(resolveAutomationCaseType({test_case_type:'security',test_data_options:JSON.stringify(options)}), platform);
  }
  assert.throws(()=>normalizeAutomationCaseType(undefined,{required:true}),{code:'AUTOMATION_CASE_TYPE_REQUIRED'});
  assert.throws(()=>normalizeDataOptions({automation_case_type:'functional'}),{code:'AUTOMATION_CASE_TYPE_INVALID'});
});

test('Web delegates HTTP actions to API while API-only never converts browser or native work into requests', () => {
  const source = [{id:'http',step_order:1,step_type:'web',action:'POST https://api.example.test/orders'}, {id:'web',step_order:2,step_type:'web',action:'Click Checkout'}];
  const before = structuredClone(source);
  const web = resolveAutomationCaseSteps({automation_case_type:'web'},source,{appTypeKind:'api'});
  assert.deepEqual(web.steps.map(step=>step.step_type),['api','web']);
  assert.deepEqual(source,before);
  const api = resolveAutomationCaseSteps({automation_case_type:'api'},source.slice(0,1),{appTypeKind:'web'});
  assert.deepEqual(api.steps.map(step=>step.step_type),['api']);
  assert.equal(requiresAutomationStartUrl({appTypeKind:api.automation_case_type,steps:api.steps}),false);
  for (const step of [source[1],{step_type:'web',automation_code:'await page.getByRole("button").click();'}, {step_type:'android',action:'Tap Save'}]) {
    assert.throws(()=>resolveAutomationCaseSteps({automation_case_type:'api'},[step]),error=>error.code==='AUTOMATION_CASE_TYPE_MISMATCH'&&error.generation_provider_requests===0&&error.browser_actions===0);
  }
  assert.equal(requiresAutomationStartUrl({appTypeKind:'api',steps:[]}),false);
});

test('device platforms permit native and API work while Unified preserves a cross-platform sequence', () => {
  const steps = ['web','api','android','ios'].map((step_type,index)=>({id:step_type,step_order:index+1,step_type,automation_code:step_type==='web'?'await page.goBack();':null}));
  assert.deepEqual(resolveAutomationCaseSteps({automation_case_type:'unified'},steps).steps.map(step=>step.step_type),['web','api','android','ios']);
  for (const type of ['android','ios']) {
    assert.deepEqual(resolveAutomationCaseSteps({automation_case_type:type},steps.filter(step=>[type,'api'].includes(step.step_type))).steps.map(step=>step.step_type),['api',type]);
    assert.throws(()=>resolveAutomationCaseSteps({automation_case_type:type},steps),{code:'AUTOMATION_CASE_TYPE_MISMATCH'});
  }
  assert.throws(()=>resolveAutomationCaseSteps({automation_case_type:'unified'},[{step_type:'banana'}]),{code:'AUTOMATION_STEP_TYPE_INVALID'});
});

test('legacy inference and manual conversion retain real saved runtimes, data and functional classification', () => {
  const source = {id:'manual',title:'API creation',app_type_id:'app',app_type_kind:'unified',test_case_type:'security',parameter_values:{name:'edited'},test_data_options:{override_shared_steps:false}};
  const steps = [{step_type:'api',action:'POST /orders',expected_result:'Order created'}];
  assert.equal(resolveAutomationCaseType(source,{steps}),'api');
  const clone = buildAutomationCaseBlueprint({source,steps,createdBy:'author'});
  assert.equal(clone.automation_case_type,'api');
  assert.equal(clone.test_case_type,'security');
  assert.deepEqual(clone.parameter_values,{});
  assert.deepEqual(source.parameter_values,{name:'edited'});
  assert.deepEqual(clone.manual_test_case_ids,['manual']);
  assert.equal(resolveAutomationCaseType({app_type_kind:'api'},{steps:[{step_type:'web',automation_code:'await page.goBack();'},{step_type:'api'}]}),'web');
});
