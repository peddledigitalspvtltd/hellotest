const assert=require('node:assert/strict');const test=require('node:test');const Fastify=require('fastify');
const service=require('../src/services/sharedStepMetrics.service');const appTypes=require('../src/services/appType.service');const projects=require('../src/services/project.service');
for(const denied of [null,'shared_step.view','testcase.view','run.view','result.view','feedback.view']) test(`Shared Step metrics enforce source permissions: ${denied || 'all allowed'}`,async t=>{
  const reads=[];t.mock.method(appTypes,'getAppType',async()=>({id:'app',project_id:'project'}));t.mock.method(projects,'getProject',async(id,user)=>{assert.equal(id,'project');assert.equal(user,'reader');});
  t.mock.method(service,'getSharedStepMetrics',async input=>{reads.push(input);return {execution_visible:input.include_execution};});
  const app=Fastify();t.after(()=>app.close());app.decorate('authenticate',async req=>{req.user={id:'reader'};});app.decorate('validate',()=>{});app.decorate('requirePermission',(code,{projectId})=>async()=>{assert.equal(projectId,'project');if(code===denied)throw Object.assign(new Error('Denied'),{statusCode:403});});await app.register(require('../src/routes/sharedStepGroups.routes'));
  const response=await app.inject('/shared-step-groups/metrics?app_type_id=app&project_id=foreign');
  if(['shared_step.view','testcase.view'].includes(denied)){assert.equal(response.statusCode,403);assert.equal(reads.length,0);}else{assert.equal(response.statusCode,200,response.body);assert.deepEqual(reads,[{app_type_id:'app',project_id:'project',include_execution:!['run.view','result.view'].includes(denied),include_defects:!denied}]);}
});
test('Shared Step catalog does not expose case usage when test case access is denied',async t=>{
 const groups=require('../src/services/sharedStepGroup.service');t.mock.method(groups,'listSharedStepGroups',async()=>[{id:'g',name:'Shared',usage_count:2,used_test_cases:[{id:'private',title:'Private'}]}]);t.mock.method(groups,'getSharedStepGroup',async()=>({id:'g',app_type_id:'app',name:'Shared',usage_count:2,used_test_cases:[{id:'private'}]}));
 t.mock.method(appTypes,'getAppType',async()=>({id:'app',project_id:'project'}));t.mock.method(projects,'getProject',async()=>({id:'project'}));
 const app=Fastify();t.after(()=>app.close());app.decorate('authenticate',async req=>{req.user={id:'reader'}});app.decorate('validate',()=>{});app.decorate('requirePermission',permission=>async()=>{if(permission==='testcase.view')throw Object.assign(new Error('Denied'),{statusCode:403})});await app.register(require('../src/routes/sharedStepGroups.routes'));
 for(const url of ['/shared-step-groups?app_type_id=app','/shared-step-groups/g']){const response=await app.inject(url);assert.equal(response.statusCode,200,response.body);assert.doesNotMatch(response.body,/private|usage_count|used_test_cases/);}
});
