const test=require('node:test'),assert=require('node:assert/strict');
const db=require('@hellotest/platform/backend/src/db'),obs=require('@hellotest/platform/backend/src/obsDb');
test.after(()=>Promise.all([db.close(),obs.close()]));
test('activity history, screenshot, draft source and evidence reads recheck membership and generation-content permissions',async t=>{
 const Fastify=require('fastify'),app=Fastify();t.after(()=>app.close());
 const projects=require('@hellotest/platform/backend/public/projectAccess'),apps=require('@hellotest/platform/backend/public/applicationAccess');
 const activity=require('@hellotest/automation/backend/services/automationAgentActivity.service'),transactions=require('@hellotest/platform/backend/services/workspaceTransaction.service');
 let denied='',foreign=false,reads=0;const checked=[];
 t.mock.method(projects,'getProject',async id=>{assert.equal(id,'project');if(foreign)throw Object.assign(new Error('Forbidden'),{statusCode:403});return {id};});
 t.mock.method(apps,'getAppType',async id=>({id,project_id:'project'}));
 t.mock.method(transactions,'getTransaction',async id=>({id,project_id:'project',app_type_id:'app',category:'automation_build'}));
 t.mock.method(activity,'history',async(scope,query)=>{reads++;assert.deepEqual(scope,{projectId:'project',appTypeId:'app',caseId:'case'});assert.equal(query.limit,'2');return {items:[],next_cursor:null};});
 t.mock.method(activity,'screenshot',async(transaction,id)=>{reads++;assert.equal(transaction.id,'activity');assert.equal(id,'image');return {id,mime_type:'image/jpeg',data_url:'data:image/jpeg;base64,/9j/'};});
 for(const method of ['preview','evidence','buildData'])t.mock.method(activity,method,async(transaction,id)=>{reads++;assert.equal(transaction.id,'activity');assert.equal(id,'protected-content');return {id};});
 app.decorate('authenticate',async req=>{req.user={id:'author',role:'member'};});app.decorate('validate',()=>{});
 app.decorate('requirePermission',(code,scope)=>async()=>{checked.push([code,scope.projectId]);if(code===denied)throw Object.assign(new Error('Forbidden'),{statusCode:403});});
 await app.register(require('../../backend/routes/testCases.routes'));
 const urls=['/test-cases/automation/agent-activities?app_type_id=app&test_case_id=case&limit=2','/test-cases/automation/jobs/activity/screenshots/image','/test-cases/automation/jobs/activity/previews/protected-content','/test-cases/automation/jobs/activity/evidence/protected-content'];
 for(const url of urls){for(const permission of ['automation.build','automation.view','automation.code.view','automation.ai']){denied=permission;const before=reads;assert.equal((await app.inject({method:'GET',url})).statusCode,403);assert.equal(reads,before);}
 denied='';foreign=true;const before=reads;assert.equal((await app.inject({method:'GET',url})).statusCode,403);assert.equal(reads,before);foreign=false;assert.equal((await app.inject({method:'GET',url})).statusCode,200);}
 assert.ok(checked.every(([,project])=>project==='project'));
 const catalog=require('@hellotest/platform/backend/src/security/permissions.catalog').ROUTE_PERMISSIONS;
 assert.equal(catalog.get('GET /test-cases/automation/agent-activities'),'automation.build');assert.equal(catalog.get('GET /test-cases/automation/jobs/:transactionId/screenshots/:artifactId'),'automation.build');
 for(const resource of ['previews','evidence'])assert.equal(catalog.get(`GET /test-cases/automation/jobs/:transactionId/${resource}/:artifactId`),'automation.build');
 const dataUrl='/test-cases/automation/jobs/activity/build-data/protected-content';
 for(const permission of ['automation.build','automation.view','automation.code.view','automation.ai','data.view']){denied=permission;const before=reads;assert.equal((await app.inject({method:'GET',url:dataUrl})).statusCode,403);assert.equal(reads,before);}
 denied='';assert.equal((await app.inject({method:'GET',url:dataUrl})).statusCode,200);
 assert.equal(catalog.get('GET /test-cases/automation/jobs/:transactionId/build-data/:artifactId'),'automation.build');
});
