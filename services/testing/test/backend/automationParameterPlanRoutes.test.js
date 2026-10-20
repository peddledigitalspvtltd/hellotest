const test=require('node:test'),assert=require('node:assert/strict');
const db=require('@hellotest/platform/backend/src/db'),obs=require('@hellotest/platform/backend/src/obsDb');
test.after(()=>Promise.all([db.close(),obs.close()]));
async function appFixture(t){
 const app=require('fastify')();t.after(()=>app.close());
 const cases=require('../../backend/services/testCase.service'),scopes=require('../../backend/services/testCaseScope.service'),projects=require('@hellotest/platform/backend/public/projectAccess');
 const checks=[];let dataAllowed=true,suiteAllowed=true;
 t.mock.method(cases,'getTestCase',async()=>({id:'case',app_type_id:'app',automated:'yes',parameter_values:{},revision:3}));
 t.mock.method(scopes,'resolveTestCaseProjectIds',async()=>['project']);t.mock.method(projects,'getProject',async()=>({id:'project'}));
 app.decorate('authenticate',async req=>{req.user={id:'author',role:'member'};});app.decorate('validate',()=>{});
 app.decorate('requirePermission',(code,scope)=>async()=>{checks.push({code,projectId:scope.projectId});if(code==='data.view'&&!dataAllowed||code==='suite.view'&&!suiteAllowed)throw Object.assign(new Error('Forbidden'),{statusCode:403});});
 await app.register(require('../../backend/routes/testCases.routes'));
 return{app,checks,get dataAllowed(){return dataAllowed;},setDataAllowed:value=>dataAllowed=value,setSuiteAllowed:value=>suiteAllowed=value};
}
test('parameter preview checks project/build/data access and returns only the governed plan',async t=>{
 const f=await appFixture(t),plans=require('@hellotest/automation/backend/services/automationBuildParameterPlan.service');let reads=0;
 t.mock.method(plans,'load',async input=>{if(!f.dataAllowed)throw Object.assign(new Error('Test data access required'),{statusCode:403});reads++;assert.equal(input.projectId,'project');assert.equal(input.caseId,'case');assert.equal(input.userId,'author');assert.equal(input.testCase,undefined);assert.equal(input.expectedKey,undefined);assert.equal(input.test_environment_id,'env');return{test_case_id:'case',parameter_values:{'t.name':'Reader'},private_parameter_references:['t.password'],missing_parameter_references:['r.optional'],parameter_plan_key:'receipt'};});
 const response=await f.app.inject({method:'POST',url:'/test-cases/case/automation/parameter-plan',payload:{test_environment_id:'env',testCase:{id:'other-case',project_id:'project'},expectedKey:'untrusted-extra-property'}});
 assert.equal(response.statusCode,200);assert.equal(response.json().parameter_values['t.name'],'Reader');assert.equal(reads,1);
 assert.deepEqual(f.checks.map(row=>row.code),['automation.build']);assert.equal(response.headers['cache-control'],'no-store');
 f.setDataAllowed(false);const denied=await f.app.inject({method:'POST',url:'/test-cases/case/automation/parameter-plan',payload:{}});assert.equal(denied.statusCode,403);assert.equal(reads,1);
});
test('single direct and queued builds retain explicit empty and scoped reviewed inputs with their source receipt',async t=>{
 const f=await appFixture(t),builder=require('@hellotest/automation/backend/services/aiAutomationBuilder.service'),generator=require('@hellotest/automation/backend/services/automationGenerator.service'),received=[];
 t.mock.method(builder,'buildAutomationForCase',async input=>{received.push(input);return{accepted:true};});t.mock.method(generator,'queueGeneratorJob',async input=>{received.push(input);return{accepted:true};});
 const payload={parameter_values:{'t.name':'Reader','r.optional':''},parameter_plan_key:'reviewed-source',allow_browser_actions:true};
 for(const suffix of ['build','generator-jobs']){
  const response=await f.app.inject({method:'POST',url:`/test-cases/case/automation/${suffix}`,payload});assert.equal(response.statusCode,200);
 }
 assert.equal(received.length,2);for(const input of received){assert.deepEqual(input.parameter_values,payload.parameter_values);assert.equal(input.parameter_plan_key,'reviewed-source');assert.equal(input.created_by,'author');}
});
test('selected suite survives preview, direct and durable routes with suite access checked before domain work',async t=>{
 const f=await appFixture(t),plans=require('@hellotest/automation/backend/services/automationBuildParameterPlan.service'),builder=require('@hellotest/automation/backend/services/aiAutomationBuilder.service'),generator=require('@hellotest/automation/backend/services/automationGenerator.service'),received=[];
 t.mock.method(plans,'load',async input=>{received.push(input);return{test_case_id:'case',test_suite_id:input.test_suite_id,parameter_plan_key:'reviewed'};});
 t.mock.method(builder,'buildAutomationForCase',async input=>{received.push(input);return{accepted:true};});
 t.mock.method(generator,'queueGeneratorJob',async input=>{received.push(input);return{accepted:true};});
 for(const suffix of ['parameter-plan','build','generator-jobs']){
  const response=await f.app.inject({method:'POST',url:`/test-cases/case/automation/${suffix}`,payload:{test_suite_id:'selected-suite',parameter_plan_key:'reviewed'}});
  assert.equal(response.statusCode,200);assert.equal(received.at(-1).test_suite_id,'selected-suite');
 }
 assert.equal(received.length,3);assert.deepEqual(f.checks.filter(row=>row.code==='suite.view'),Array.from({length:3},()=>({code:'suite.view',projectId:'project'})));
 f.setSuiteAllowed(false);
 for(const suffix of ['parameter-plan','build','generator-jobs']){
  const denied=await f.app.inject({method:'POST',url:`/test-cases/case/automation/${suffix}`,payload:{test_suite_id:'selected-suite'}});assert.equal(denied.statusCode,403);
 }
 assert.equal(received.length,3);
});
test('batch route forwards per-case suite map without replacing explicit empty selection or leaking the active suite',async t=>{
 const f=await appFixture(t),apps=require('@hellotest/platform/backend/public/applicationAccess'),batches=require('../../backend/services/batchProcess.service'),received=[];
 t.mock.method(apps,'getAppType',async()=>({id:'app',project_id:'project',type:'web'}));
 t.mock.method(batches,'queueAutomationBuild',async input=>{received.push(input);return{accepted:true};});
 const payload={app_type_id:'app',test_case_ids:['case','other-case'],test_suite_id:'active-suite',test_suite_ids_by_case:{case:'case-suite','other-case':null}};
 const response=await f.app.inject({method:'POST',url:'/test-cases/automation/build-batch',payload});
 assert.equal(response.statusCode,200);assert.deepEqual(received[0].test_suite_ids_by_case,payload.test_suite_ids_by_case);assert.equal(received[0].test_suite_id,'active-suite');assert.equal(received[0].created_by,'author');
 assert.deepEqual(f.checks.filter(row=>row.code==='suite.view'),[{code:'suite.view',projectId:'project'}]);
 f.setSuiteAllowed(false);
 const denied=await f.app.inject({method:'POST',url:'/test-cases/automation/build-batch',payload});assert.equal(denied.statusCode,403);assert.equal(received.length,1);
 const empty=await f.app.inject({method:'POST',url:'/test-cases/automation/build-batch',payload:{app_type_id:'app',test_case_ids:['case'],test_suite_ids_by_case:{case:null}}});
 assert.equal(empty.statusCode,200);assert.equal(received[1].test_suite_id,undefined);assert.deepEqual(received[1].test_suite_ids_by_case,{case:null});
});
