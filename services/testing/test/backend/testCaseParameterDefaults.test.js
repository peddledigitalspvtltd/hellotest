const test=require('node:test'),assert=require('node:assert/strict');
const db=require('@hellotest/platform/backend/src/db'),obs=require('@hellotest/platform/backend/src/obsDb');
test.after(()=>Promise.all([db.close(),obs.close()]));
test('authorized effective dataset metadata preserves own links and exposes relationship IDs without copying source data rows',async()=>{
 const fs=require('node:fs'),source=fs.readFileSync(require.resolve('../../backend/services/testCase.service'),'utf8');
 const body=source.slice(source.indexOf('exports.withParameterDefaults ='),source.indexOf('exports.updateTestCase ='));
 const exported={},input={id:'automation',app_type_id:'app',automated:'yes',test_data_set_ids:[]};
 new Function('exports','require',body)(exported,name=>name.endsWith('linkedManualParameters.service')?{projectCases:async(rows,options)=>{assert.equal(options.projectId,'project');return rows;}}:{loadEffectiveCaseDataSets:async options=>{assert.deepEqual(options,{testCaseIds:['automation'],projectId:'project',appTypeId:'app'});return[{test_case_id:'automation',test_data_set_id:'inherited-data',rows:[{'r.secret':'must-not-copy'}]}];}});
 const result=await exported.withParameterDefaults(input,{projectId:'project'});
 assert.deepEqual(result.effective_test_data_set_ids,['inherited-data']);assert.deepEqual(result.test_data_set_ids,[]);assert.equal(input.effective_test_data_set_ids,undefined);assert.doesNotMatch(JSON.stringify(result),/must-not-copy|rows/);
});
test('automation detail exposes live manual values only after project/case and data authorization',async t=>{
 const app=require('fastify')();t.after(()=>app.close());
 const service=require('../../backend/services/testCase.service'),scopes=require('../../backend/services/testCaseScope.service'),projects=require('@hellotest/platform/backend/public/projectAccess'),optional=require('@hellotest/platform/backend/services/optionalEvidenceAccess.service');
 let allowed=false,member=true,reads=0;const checks=[];
 t.mock.method(service,'getTestCase',async()=>({id:'automation',automated:'yes',parameter_values:{'t.email':'explicit'}}));t.mock.method(scopes,'resolveTestCaseProjectIds',async()=>['project']);t.mock.method(projects,'getProject',async()=>{if(!member)throw Object.assign(new Error('Forbidden'),{statusCode:403});});
 t.mock.method(optional,'getOptionalEvidenceAccess',async(user,project,codes)=>{assert.equal(user.id,'author');assert.equal(project,'project');assert.deepEqual(codes,['data.view']);return {'data.view':allowed};});
 t.mock.method(service,'withParameterDefaults',async(row,options)=>{reads++;assert.equal(options.projectId,'project');return {...row,inherited_parameter_values:{'t.password':'private-manual'},effective_parameter_values:{'t.password':'private-manual','t.email':'explicit'},effective_test_data_set_ids:['linked-data-set'],parameter_sources:{'t.password':{kind:'linked_manual',test_case_id:'manual'}}};});
 app.decorate('authenticate',async req=>{req.user={id:'author',role:'member'};});app.decorate('validate',()=>{});app.decorate('requirePermission',(code,scope)=>async()=>{checks.push([code,scope.projectId]);});await app.register(require('../../backend/routes/testCases.routes'));
 let response=await app.inject({method:'GET',url:'/test-cases/automation'});assert.equal(response.statusCode,200);assert.equal(response.json().parameter_defaults_access,'restricted');assert.equal(response.json().inherited_parameter_values,undefined);assert.doesNotMatch(response.body,/private-manual/);assert.equal(reads,0);
 allowed=true;response=await app.inject({method:'GET',url:'/test-cases/automation'});assert.equal(response.statusCode,200);assert.equal(response.json().effective_parameter_values['t.password'],'private-manual');assert.deepEqual(response.json().effective_test_data_set_ids,['linked-data-set']);assert.equal(response.json().parameter_defaults_access,'allowed');assert.equal(reads,1);
 member=false;response=await app.inject({method:'GET',url:'/test-cases/automation'});assert.equal(response.statusCode,403);assert.equal(reads,1);assert.ok(checks.every(([code,project])=>code==='testcase.view'&&project==='project'));
});
