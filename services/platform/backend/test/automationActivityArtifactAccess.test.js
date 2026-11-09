const test = require('node:test');
const assert = require('node:assert/strict');
const Fastify = require('fastify');
const db = require('../src/db');
const obs = require('../src/obsDb');
const projects = require('../services/project.service');
const transactions = require('../services/workspaceTransaction.service');

test.after(() => Promise.all([db.close(), obs.close()]));

test('generic artifact downloads cannot bypass automation content permissions or artifact ownership', async t => {
  const app = Fastify();
  t.after(() => app.close());
  let denied = '', foreign = false;
  let artifact = {transaction_id:'activity',mime_type:'application/vnd.hellotest.automation-section-preview+json',content:'{"automation_code":"private source"}'};
  const checks = [];
  t.mock.method(projects, 'getProject', async id => {
    assert.equal(id, 'project');
    if (foreign) throw Object.assign(new Error('Forbidden'), {statusCode:403});
    return {id};
  });
  t.mock.method(transactions, 'getTransaction', async () => ({id:'activity',project_id:'project',category:'automation_build',metadata:{agent_activity:true}}));
  t.mock.method(transactions, 'getTransactionArtifact', async () => artifact);
  app.decorate('authenticate', async req => { req.user = {id:'author',role:'member'}; });
  app.decorate('requirePermission', (code, scope) => async () => {
    checks.push([code, scope.projectId]);
    if (code === denied) throw Object.assign(new Error('Forbidden'), {statusCode:403});
  });
  await app.register(require('../routes/workspaceTransactions.routes'));
  const url='/workspace-transactions/activity/artifacts/content/download';
  for(const mime of ['application/vnd.hellotest.automation-section-preview+json','application/vnd.hellotest.automation-browser-evidence+json','application/vnd.hellotest.automation-browser-diagnostic+json','image/jpeg','image/png','text/javascript; charset=utf-8','application/javascript','text/plain']) {
    artifact={...artifact,mime_type:mime};
    for(const code of ['automation.view','automation.code.view','automation.build','automation.ai']) {
      denied=code;
      const response=await app.inject({method:'GET',url});
      assert.equal(response.statusCode,403);
      assert.doesNotMatch(response.body,/private source/);
    }
    denied='';assert.equal((await app.inject({method:'GET',url})).statusCode,200);
  }
  foreign=true;assert.equal((await app.inject({method:'GET',url})).statusCode,403);foreign=false;
  artifact={...artifact,mime_type:'application/vnd.hellotest.automation-build-data+json'};
  denied='data.view';assert.equal((await app.inject({method:'GET',url})).statusCode,403);
  denied='';assert.equal((await app.inject({method:'GET',url})).statusCode,200);
  artifact={...artifact,transaction_id:'another'};assert.equal((await app.inject({method:'GET',url})).statusCode,404);
  t.mock.method(transactions, 'getTransaction', async () => ({id:'activity',project_id:'project',category:'automation_build',metadata:{}}));
  artifact={...artifact,transaction_id:'activity',mime_type:'application/vnd.hellotest.automation-browser-diagnostic+json'};
  denied='automation.code.view';assert.equal((await app.inject({method:'GET',url})).statusCode,403);
  denied='';assert.equal((await app.inject({method:'GET',url})).statusCode,200);
  artifact={...artifact,mime_type:'application/vnd.hellotest.automation-used-objects+json'};
  denied='automation.code.view';assert.equal((await app.inject({method:'GET',url})).statusCode,403);
  denied='';assert.equal((await app.inject({method:'GET',url})).statusCode,200);
  assert.ok(checks.every(([,project])=>project==='project'));
  // Unrelated background-job text keeps its existing transaction permission contract.
  t.mock.method(transactions, 'getTransaction', async () => ({id:'activity',project_id:'project',category:'import',metadata:{}}));
  artifact={...artifact,transaction_id:'activity',mime_type:'text/plain',content:'ordinary log'};
  denied='automation.ai';assert.equal((await app.inject({method:'GET',url})).statusCode,200);
});

test('quarantined browser images are forbidden through both readers while other exact images remain accessible', async t => {
  const app=Fastify();t.after(()=>app.close());
  const transaction={id:'activity',project_id:'project',category:'automation_build',metadata:{agent_activity:true,artifact_quarantine:{blocked:{quarantined:true}}}};
  let artifact={id:'blocked',transaction_id:'activity',mime_type:'image/jpeg',content:Buffer.from([255,216,255,1,2,3]).toString('base64')};
  t.mock.method(projects,'getProject',async()=>({id:'project'}));
  t.mock.method(transactions,'getTransaction',async()=>transaction);
  t.mock.method(transactions,'getTransactionArtifact',async()=>artifact);
  app.decorate('authenticate',async req=>{req.user={id:'author',role:'member'};});
  app.decorate('requirePermission',()=>async()=>{});
  app.decorate('validate',()=>{});
  await app.register(require('../routes/workspaceTransactions.routes'));
  await app.register(require('../../../testing/backend/routes/testCases.routes'));
  const activity=require('@hellotest/automation/backend/services/automationAgentActivity.service');
  for(const id of ['blocked','unaffected']){
    artifact={...artifact,id};
    const response=await app.inject({method:'GET',url:`/workspace-transactions/activity/artifacts/${id}/download`});
    assert.equal(response.statusCode,id==='blocked'?403:200);
    const imageResponse=await app.inject({method:'GET',url:`/test-cases/automation/jobs/activity/screenshots/${id}`});
    assert.equal(imageResponse.statusCode,id==='blocked'?403:200,'The protected browser-image HTTP route uses the same quarantine authority');
    if(id==='blocked'){
      assert.equal(response.json().code,'ARTIFACT_PRIVACY_QUARANTINED');assert.doesNotMatch(response.body,/\/9j/);
      await assert.rejects(activity.screenshot(transaction,id),error=>error.statusCode===403&&error.code==='ARTIFACT_PRIVACY_QUARANTINED');
    }else assert.match((await activity.screenshot(transaction,id)).data_url,/^data:image\/jpeg;base64,/);
  }
  artifact={...artifact,id:'blocked',transaction_id:'foreign'};
  assert.equal((await app.inject({method:'GET',url:'/workspace-transactions/activity/artifacts/blocked/download'})).statusCode,404);
  await assert.rejects(activity.screenshot(transaction,'blocked'),error=>error.statusCode===404);
});
