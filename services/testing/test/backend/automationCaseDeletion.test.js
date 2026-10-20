const test=require('node:test'),assert=require('node:assert/strict');
const deletion=require('../../backend/services/automationCaseDeletion.service');
const db=require('@hellotest/platform/backend/src/db'),obs=require('@hellotest/platform/backend/src/obsDb');
test.after(()=>Promise.all([db.close(),obs.close()]));

test('bulk deletion requires a bounded explicit selection and never infers all cases',()=>{
 const scope={project_id:'project',app_type_id:'app'};
 for(const test_case_ids of [undefined,[],[''],[null],[{}],Array(10001).fill('case')])assert.throws(()=>deletion.normalizeSelection({...scope,test_case_ids}),{statusCode:400});
 assert.throws(()=>deletion.normalizeSelection({test_case_ids:['case']}),{statusCode:400});
 assert.deepEqual(deletion.normalizeSelection({...scope,test_case_ids:[' b ','a','b']}),{...scope,test_case_ids:['a','b']});
});

test('bulk deletion is registered in route permission and feature policy catalogs',()=>{
 assert.equal(require('@hellotest/platform/backend/src/security/permissions.catalog').ROUTE_PERMISSIONS.get('POST /test-cases/automation/bulk-delete'),'testcase.delete');
 assert.deepEqual(require('@hellotest/platform/backend/services/featureFlag.service').getFeatureKeysForRoute('POST','/test-cases/automation/bulk-delete'),['hellotest.automation.builder']);
});

test('bulk route checks project access, deletion permission and application scope before writing',async t=>{
 const Fastify=require('fastify'),app=Fastify();t.after(()=>app.close());
 const projects=require('@hellotest/platform/backend/public/projectAccess'),apps=require('@hellotest/platform/backend/public/applicationAccess');
 let denied=false,foreign=false,writes=0;const checked=[];
 t.mock.method(projects,'getProject',async id=>{checked.push(['project',id]);return{id};});
 t.mock.method(apps,'getAppType',async id=>({id,project_id:foreign?'other-project':'project'}));
 t.mock.method(deletion,'deleteAutomationCases',async(input,actor)=>{writes++;assert.equal(actor.actorId,'user');return{deleted:true,deleted_ids:input.test_case_ids};});
 app.decorate('authenticate',async req=>{req.user={id:'user',role:'member'};});
 app.decorate('validate',()=>{});
 app.decorate('requirePermission',(code,scope)=>async()=>{checked.push([code,scope.projectId]);if(denied)throw Object.assign(new Error('Forbidden'),{statusCode:403});});
 await app.register(require('../../backend/routes/testCases.routes'));
 const input={method:'POST',url:'/test-cases/automation/bulk-delete',payload:{project_id:'project',app_type_id:'app',test_case_ids:['case']}};
 denied=true;assert.equal((await app.inject(input)).statusCode,403);assert.equal(writes,0);
 denied=false;foreign=true;assert.equal((await app.inject(input)).statusCode,403);assert.equal(writes,0);
 foreign=false;assert.equal((await app.inject(input)).statusCode,200);assert.equal(writes,1);
 assert.ok(checked.some(([permission,project])=>permission==='testcase.delete'&&project==='project'));
});
