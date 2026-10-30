import test from 'node:test';
import assert from 'node:assert/strict';
import { getAutomationRuntimeTypes, getAutomationBuildRuntimeTypes, inferAutomationBuildRuntime, getDefaultAutomationStepType, getRecorderPlatform, getAllowedAutomationStepTypes, resolveAutomationCaseType, incompatibleAutomationRuntimes } from '../../frontend/lib/automationRuntime.ts';
test('runtime identity and targeted recording preserve mixed plans and native platforms', () => {
  const steps = [{ id: 'api', step_type: 'api' }, { id: 'native', step_type: 'ios' }];
  assert.deepEqual(getAutomationRuntimeTypes(steps), ['api', 'ios']);
  assert.equal(getRecorderPlatform(steps, 'native'), 'ios');
  assert.equal(getRecorderPlatform(steps, 'api'), 'api');
  assert.equal(getRecorderPlatform(steps, ''), 'ios');
  assert.equal(getRecorderPlatform([{id:'api',step_type:'api'},{id:'web',step_type:'web'}], ''), 'web');
  assert.equal(getRecorderPlatform([{id:'native',step_type:'android'},{id:'web',step_type:'web'}], ''), 'unified');
  assert.deepEqual(getAutomationRuntimeTypes([], 'android'), ['android']);
  assert.deepEqual(getAutomationRuntimeTypes([], 'unified'), ['web']);
});
const { parseApiRequestSource } = await import('../../frontend/lib/apiRequestSource.ts');
test('API source edits produce executable requests and reject browser/code fragments',()=>{
 const request=parseApiRequestSource('{"method":"POST","url":"@r.base/orders","validations":[{"kind":"status","expected":"201"}]}');
 assert.equal(request.method,'POST');assert.equal(request.validations[0].expected,'201');
 assert.throws(()=>parseApiRequestSource('await api.request("GET /orders");'),/JSON request/);
 assert.throws(()=>parseApiRequestSource('{}'),/URL/);
 assert.throws(()=>parseApiRequestSource('{"url":{"path":"/orders"}}'),/URL/);
 assert.throws(()=>parseApiRequestSource('{"url":"/orders","headers":{"Authorization":"abc"}}'),/key\/value/);
 assert.throws(()=>parseApiRequestSource('{"url":"/orders","validations":[{"kind":"unknown"}]}'),/validation kind/);
});

test('new steps keep application runtime and ignore API setup in a unified native plan', () => {
  assert.equal(getDefaultAutomationStepType([], 'ios'), 'ios');
  assert.equal(getDefaultAutomationStepType([], 'api'), 'api');
  assert.equal(getDefaultAutomationStepType([{ step_type: 'api' }, { step_type: 'android' }], 'unified'), 'android');
  assert.equal(getDefaultAutomationStepType([{ step_type: 'api' }], 'unified'), 'api');
});

test('build runtime inference recognizes API prose while recorder identity and saved Web code stay unchanged',()=>{
 for(const action of ['POST /orders','I GET /orders','Send a POST request to @r.base_url/orders','When send an HTTP GET request to https://api.fixture/orders','Call the API endpoint to create an order'])assert.equal(inferAutomationBuildRuntime({action,step_type:'web'}),'api');
 const steps=[{id:'api',step_type:'web',action:'POST /orders'},{id:'web',step_type:'web',action:'Click the API docs link'}];
 assert.deepEqual(getAutomationBuildRuntimeTypes(steps),['api','web']);
 assert.deepEqual(getAutomationBuildRuntimeTypes([steps[0]]),['api']);
 assert.deepEqual(getAutomationRuntimeTypes([steps[0]]),['web']);
 assert.equal(getRecorderPlatform([steps[0]],''),'web');
 assert.equal(inferAutomationBuildRuntime({...steps[0],automation_code:'await page.click("#post");'}),'web');
 assert.equal(inferAutomationBuildRuntime({step_type:'ios',action:'POST /orders'}),'ios');
 assert.equal(inferAutomationBuildRuntime({action:'Create an order'},'api'),'api');
});

test('saved automation case platform limits every authoring mode without conflating functional category', () => {
  assert.deepEqual(getAllowedAutomationStepTypes("web"), ["web", "api"]);
  assert.deepEqual(getAllowedAutomationStepTypes("api"), ["api"]);
  assert.deepEqual(getAllowedAutomationStepTypes("android"), ["android", "api"]);
  assert.deepEqual(getAllowedAutomationStepTypes("ios"), ["ios", "api"]);
  assert.deepEqual(getAllowedAutomationStepTypes("unified"), ["web", "api", "android", "ios"]);
  assert.deepEqual(getAllowedAutomationStepTypes(""), []);
  assert.deepEqual(getAllowedAutomationStepTypes("android", false), ["api"]);
  assert.equal(resolveAutomationCaseType({automation_case_type:"api"}, [{step_type:"web"}]), "api", "saved type stays authoritative and invalid steps are reported separately");
  assert.equal(resolveAutomationCaseType({test_data_options:{automation_case_type:"ios"}}, []), "ios");
  assert.equal(resolveAutomationCaseType({}, [], "unified"), "unified");
  assert.equal(resolveAutomationCaseType({}, [{step_type:"web"}, {step_type:"api"}]), "web");
  assert.equal(resolveAutomationCaseType({}, [{step_type:"android"}, {step_type:"api"}]), "android");
  assert.equal(resolveAutomationCaseType({}, [{step_type:"web"}, {step_type:"ios"}]), "unified");
  assert.deepEqual(incompatibleAutomationRuntimes("api", [{step_type:"web", action:"Click Submit"}]), ["web"]);
  assert.deepEqual(incompatibleAutomationRuntimes("api", [{step_type:"web", action:"GET /orders"}]), []);
  assert.deepEqual(incompatibleAutomationRuntimes("web", [{step_type:"android"}]), ["android"]);
});
