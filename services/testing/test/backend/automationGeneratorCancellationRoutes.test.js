const test=require('node:test'),assert=require('node:assert/strict');
const db=require('@hellotest/platform/backend/src/db'),obs=require('@hellotest/platform/backend/src/obsDb');
test.after(()=>Promise.all([db.close(),obs.close()]));

test('generator cancellation checks authenticated project membership and current build/AI permission before scoped domain work',async t=>{
 const app=require('fastify')();t.after(()=>app.close());
 const projects=require('@hellotest/platform/backend/public/projectAccess'),transactions=require('@hellotest/platform/backend/services/workspaceTransaction.service');
 const generator=require('@hellotest/automation/backend/services/automationGenerator.service');
 let denied='',foreign=false,category='automation_build',authenticated=true;const received=[],permissions=[];
 t.mock.method(transactions,'getTransaction',async id=>({id,project_id:'project',category}));
 t.mock.method(projects,'getProject',async(projectId,userId)=>{
  assert.equal(projectId,'project');assert.equal(userId,'signed-in-author');
  if(foreign)throw Object.assign(new Error('Not a project member'),{statusCode:403});return {id:projectId};
 });
 t.mock.method(generator,'cancelGeneratorJob',async input=>{received.push(input);return {transaction_id:input.transactionId,status:'cancelled',cancelled:true};});
 app.decorate('authenticate',async req=>{if(!authenticated)throw Object.assign(new Error('Sign in required'),{statusCode:401});req.user={id:'signed-in-author',role:'member'};});
 app.decorate('validate',()=>{});
 app.decorate('requirePermission',(code,scope)=>async()=>{permissions.push([code,scope.projectId]);if(code===denied)throw Object.assign(new Error('Permission revoked'),{statusCode:403});});
 await app.register(require('../../backend/routes/testCases.routes'));
 const request={method:'POST',url:'/test-cases/automation/jobs/activity/cancel',payload:{userId:'forged-actor',projectId:'foreign-project',jobId:'other-job'}};
 for(const permission of ['automation.build','automation.ai']){denied=permission;assert.equal((await app.inject(request)).statusCode,403);assert.equal(received.length,0);}
 denied='';foreign=true;assert.equal((await app.inject(request)).statusCode,403);assert.equal(received.length,0);
 foreign=false;authenticated=false;assert.equal((await app.inject(request)).statusCode,401);assert.equal(received.length,0);
 authenticated=true;category='other_activity';assert.equal((await app.inject(request)).statusCode,404);assert.equal(received.length,0);
 category='automation_build';const stopped=await app.inject(request);assert.equal(stopped.statusCode,200);
 assert.deepEqual(received,[{transactionId:'activity',projectId:'project',userId:'signed-in-author'}]);
 assert.deepEqual(stopped.json(),{transaction_id:'activity',status:'cancelled',cancelled:true});
 assert.ok(permissions.every(([,projectId])=>projectId==='project'));
 assert.equal(require('@hellotest/platform/backend/src/security/permissions.catalog').ROUTE_PERMISSIONS.get('POST /test-cases/automation/jobs/:transactionId/cancel'),'automation.build');
});
