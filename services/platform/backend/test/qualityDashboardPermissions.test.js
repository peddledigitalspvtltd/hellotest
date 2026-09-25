const assert = require('node:assert/strict');
const test = require('node:test');
const Fastify = require('fastify');
const projectService = require('../services/project.service');
const analytics = require('../../../dashboard/backend/services/qualityAnalytics.service');
const dashboards = require('../../../dashboard/backend/services/qualityDashboard.service');
const reports = require('../../../dashboard/backend/services/qualityDashboardReport.service');
const permissions = require('../../../dashboard/backend/services/qualityDashboardPermissions');

test('every supported native query declares its contributing permission sources', () => {
  for (const metric of analytics.NATIVE_DASHBOARD_METRICS) assert.ok(permissions({metric}).length, metric);
  assert.deepEqual(permissions({metric:'storyTestPassRate'}),['requirement.view','testcase.view','run.view','result.view']);
  assert.deepEqual(permissions({metric:'storiesWithOpenDefects'}),['requirement.view','testcase.view','feedback.view']);
  assert.ok(permissions({metric:'testCases',release:'r'}).includes('requirement.view'));
});

test('read-only source grants allow visible queries while joins and exports enforce every contributor', async t => {
  const checks=[]; let evaluations=0; let exports=0;
  t.mock.method(projectService,'getProject',async id=>({id}));
  t.mock.method(analytics,'evaluateGadget',async ({projectId,gadget})=>{evaluations++;return {project:{id:projectId},gadget,value:7};});
  t.mock.method(dashboards,'get',async()=>({id:'d',project_id:'p',name:'Report',gadgets:[{metric:'storyTestPassRate'}]}));
  t.mock.method(reports,'renderPdf',async()=>{exports++;return {pdf:Buffer.from('report')};});
  t.mock.method(reports,'share',async()=>{exports++;return {sent:true};});
  const app=Fastify({logger:false});
  app.decorate('authenticate',async req=>{req.user={id:'reader'};});
  app.decorate('validate',()=>{});
  app.decorate('requirePermission',(permission,{projectId})=>async()=>{
    checks.push({permission,projectId});
    if(!['requirement.view','testcase.view','run.view'].includes(permission)) throw Object.assign(new Error('Source access denied.'),{statusCode:403});
  });
  try {
    await app.register(require('../../../dashboard/backend/routes/qualityAnalytics.routes'));
    const visible=await app.inject({method:'POST',url:'/analytics/query',payload:{project_id:'p',gadget:{metric:'stories'}}});
    assert.equal(visible.statusCode,200);assert.equal(visible.json().value,7);
    const denied=await app.inject({method:'POST',url:'/analytics/query',payload:{project_id:'p',gadget:{metric:'storyTestPassRate'}}});
    assert.equal(denied.statusCode,403);assert.equal(evaluations,1);
    const batch=await app.inject({method:'POST',url:'/analytics/query-batch',payload:{project_id:'p',gadgets:[{id:'visible',metric:'stories'},{id:'denied',metric:'linkedDefects'}]}});
    assert.equal(batch.statusCode,200); assert.equal(batch.json().results[0].result.value,7);
    assert.equal(batch.json().results[1].error.status,403); assert.equal(batch.json().results[1].result,undefined);
    for(const request of [{method:'GET',url:'/quality-dashboards/d/report.pdf'},{method:'POST',url:'/quality-dashboards/d/share-report',payload:{recipients:['reviewer@example.test']}}]) assert.equal((await app.inject(request)).statusCode,403);
    assert.equal(exports,0);assert.ok(checks.every(check=>check.projectId==='p'));
  } finally {await app.close();}
});
