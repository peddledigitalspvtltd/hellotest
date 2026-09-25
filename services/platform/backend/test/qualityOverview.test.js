const assert = require('node:assert/strict');
const test = require('node:test');
const Fastify = require('fastify');
const db = require('../src/db');
const overview = require('../../../dashboard/backend/services/qualityOverview.service');
const projectService = require('../services/project.service');
const permissions = require('../services/permission.service');
const flags = require('../services/featureFlag.service');
const now = Date.parse('2026-09-10T00:30Z');
const visible = { stories: true, cases: true, suites: true, runs: true, bugs: true, automation: true };

function evidence(t, { failure } = {}) {
  const reads = [];
  t.mock.method(db, 'prepare', sql => ({
    get: async (...args) => {
      reads.push({sql,args});
      if (failure && sql.includes(failure)) throw new Error('Source unavailable');
      if (sql.includes('FROM requirements')) return { stories: 240, covered_stories: 200 };
      if (/FROM test_cases (?:LEFT )?JOIN/.test(sql)) return { cases: 350, designed_cases: 300, automated_cases: 100 };
      if (sql.includes('FROM test_suites')) return { suites: 8 };
      if (sql.includes('FROM feedback')) return { open_defects: 7 };
      throw new Error('Unexpected evidence query: ' + sql);
    },
    all: async (...args) => { reads.push({sql,args}); assert.match(sql, /WITH scoped_runs/); return []; }
  }));
  return reads;
}

test('overview uses UTC calendar boundaries across timezone offsets and rejects unsupported windows before reads', async (t) => {
  t.mock.method(db, 'prepare', () => assert.fail('Invalid windows must fail before any evidence read'));
  assert.deepEqual(overview.windowFor(14, Date.parse('2026-09-10T01:00+05:30')), { days: 14, from: '2026-08-27T00:00:00.000Z', to: '2026-09-09T19:30:00.000Z' });
  for (const days of [0, 15, -1, '30x', 400, null]) await assert.rejects(overview.getOverview({projectId:'p', days, visibility:visible, now}), {statusCode:400});
});

test('full inventory is independent of run windows and has a fixed five-read aggregate cost', async (t) => {
  const reads = evidence(t);
  const result = await overview.getOverview({projectId:'p', project:{name:'Project'}, days:30, visibility:visible, now});
  assert.equal(reads.length, 5);
  assert.equal(result.inventory.stories, 240);
  assert.equal(result.inventory.cases, 350);
  assert.equal(result.trend.length, 30);
  assert.equal(result.execution.total, 0);
  assert.equal(result.execution.latest_evidence_at, null);
  assert.equal(result.evidence.complete, true);
  assert.equal(result.attention.some(item=>item.id==='coverage-gaps'), true);
  assert.ok(result.attention.every(item=>item.to.startsWith('/') && !item.to.includes('?coverage=')));
  assert.deepEqual(reads.at(-1).args, [new Date(now).toISOString(),'p',result.window.from,result.window.to]);
});

test('unavailable sources are not queried, leak no metrics and do not masquerade as empty evidence', async (t) => {
  const reads = evidence(t);
  const result = await overview.getOverview({projectId:'p',visibility:{stories:true},now});
  assert.equal(reads.length,1);
  assert.doesNotMatch(reads[0].sql,/FROM requirement_test_cases|JOIN test_cases/);
  assert.equal(result.inventory.covered_stories,null);
  assert.equal(result.inventory.designed_cases,null);
  assert.equal(result.execution.total,null);
  assert.deepEqual(result.trend,[]);
  assert.deepEqual(result.attention,[]);
  const none = await overview.getOverview({projectId:'p',visibility:{},now});
  assert.equal(reads.length,1);
  assert.equal(none.evidence.limitations.length,6);
});

test('a permitted source failure rejects the overview instead of reporting partial success or false zero', async (t) => {
  evidence(t,{failure:'FROM feedback'});
  await assert.rejects(overview.getOverview({projectId:'p',visibility:visible,now}), /Source unavailable/);
});

test('lifecycle freshness uses actual valid events, including pause, and tolerates legacy malformed timestamps', () => {
  assert.equal(overview.evidenceTime({created_at:'2026-09-01',started_at:'2026-09-02',lifecycle_history:[{at:'invalid'},{at:'2026-09-03T12:30:00Z'}]}), '2026-09-03T12:30:00.000Z');
  assert.equal(overview.evidenceTime({created_at:'invalid', lifecycle_history:[{at:'invalid'}]}),null);
});

async function appFixture(t, { denied = [], disabled = [], apiKeyScope = null } = {}) {
  const reads = evidence(t);
  const checked = [];
  t.mock.method(projectService,'getProject',async id => ({id,name:'Project'}));
  t.mock.method(permissions,'hasPermission',async (user, permission, projectId) => { checked.push({permission,projectId}); return !denied.includes(permission); });
  t.mock.method(flags,'areEnabled',async keys => !keys.some(key=>disabled.includes(key)));
  const app = Fastify({logger:false});
  t.after(()=>app.close());
  await app.register(require('../src/plugins/errorHandler'));
  await app.register(require('../src/plugins/accessControl'));
  app.addHook('onRequest',async req=>{req.user={id:'reader',role:'member'};if(apiKeyScope) req.apiKey={scope:apiKeyScope};});
  await app.register(require('../../../dashboard/backend/routes/qualityAnalytics.routes'));
  await app.ready();
  return {app,reads,checked};
}

test('overview requires dashboard permission in the actual project before accessing evidence', async (t) => {
  const {app,reads,checked} = await appFixture(t,{denied:['dashboard.view']});
  const response = await app.inject('/analytics/overview?project_id=project-a');
  assert.equal(response.statusCode,403);
  assert.equal(reads.length,0);
  assert.deepEqual(checked,[{permission:'dashboard.view',projectId:'project-a'}]);
});

test('overview checks source grants and disabled source features without exposing their inventory', async (t) => {
  const {app,reads,checked} = await appFixture(t,{denied:['feedback.view'],disabled:['hellotest.manual.test_cases']});
  const response = await app.inject('/analytics/overview?project_id=project-a&days=14');
  assert.equal(response.statusCode,200,response.body);
  assert.equal(response.headers['cache-control'],'private, no-store');
  const result = response.json();
  assert.equal(result.visibility.bugs,false);
  assert.equal(result.visibility.cases,false);
  assert.equal(result.inventory.covered_stories,null);
  assert.equal(result.inventory.cases,null);
  assert.equal(result.inventory.open_defects,null);
  assert.equal(reads.some(({sql})=>sql.includes('FROM feedback')||/FROM test_cases (?:LEFT )?JOIN/.test(sql)),false);
  assert.ok(checked.every(item=>item.projectId==='project-a'));
});

test('overview rejects malformed window values through the HTTP contract', async (t) => {
  const {app,reads} = await appFixture(t);
  const response = await app.inject('/analytics/overview?project_id=project-a&days=365');
  assert.equal(response.statusCode,400);
  assert.equal(response.json().code,'INVALID_ANALYTICS_WINDOW');
  assert.equal(reads.length,0);
});

test('Explain cannot bypass a denied source permission through quality_insight.view',async t=>{
  const {app,reads}=await appFixture(t,{denied:['feedback.view']});
  const response=await app.inject('/ai/quality-insights?project_id=project-a');
  assert.equal(response.statusCode,403);
  assert.equal(reads.length,0,'All source grants must be checked before the legacy record-rich insight reads');
});

test('quality explanations retain actual per-run outcomes when a case has newer evidence in another run',async t=>{
  const analytics=require('../../../dashboard/backend/services/qualityAnalytics.service');
  const reads=[];
  t.mock.method(db,'prepare',sql=>({
    get:async()=>({id:'p',name:'Project'}),
    all:async(...args)=>{
      reads.push({sql,args});
      if(sql.includes('WITH ranked_run_results')) return [
        {execution_id:'old-run',result_count:'3',passed_count:'1',failed_count:'1',blocked_count:'1'},
        {execution_id:'new-run',result_count:'1',passed_count:'1',failed_count:'0',blocked_count:'0'}
      ];
      if(sql.includes('FROM execution_results')) return [{id:'latest-result',execution_id:'new-run',test_case_id:'case',status:'passed'}];
      if(sql.includes('FROM execution_case_snapshots')) return [{test_case_id:'case'}];
      if(sql.includes('FROM requirements WHERE')) return [{id:'story',priority:1,test_case_ids:['case','deleted']}];
      if(/FROM test_cases (?:LEFT )?JOIN/.test(sql)) return [{id:'case',requirement_ids:['story']}];
      if(sql.includes('FROM executions LEFT')) return [{id:'old-run',name:'Old evidence',status:'failed',created_at:'2026-09-01'},{id:'new-run',name:'New evidence',status:'passed',created_at:'2026-09-02'}];
      return [];
    }
  }));
  const result=await analytics.qualityInsights({projectId:'p'});
  const older=result.execution_evidence.find(run=>run.id==='old-run');
  assert.equal(older.result_count,3);
  assert.equal(older.failed_count,1);
  assert.equal(older.blocked_count,1);
  assert.equal(older.started_at,null,'A creation timestamp must not impersonate actual execution start');
  assert.match(result.summary,/1 scoped stories, 1 cases and 2 runs/);
  assert.doesNotMatch(result.summary,/%/);
  assert.equal(result.release_summary,result.summary);
  assert.equal(result.project.id,'p');
  assert.equal(result.scope.kind,'project');
  assert.deepEqual(result.insights.find(item=>item.id==='runs').evidence.map(item=>item.id),['old-run']);
  assert.equal(result.insights.find(item=>item.id==='runs').recommended_action,result.findings.find(item=>item.id==='runs').action);
  assert.equal(result.traceability[0].test_case_count,1,'Deleted case links do not contribute to coverage');
  assert.equal(reads.length,9,'Eight context collection reads plus one run aggregate; the project lookup is separate');
});

test('future completions are excluded from the trailing completed-run count',()=>{
  const analytics=require('../../../dashboard/backend/services/qualityAnalytics.service');
  const metrics=analytics.calculateMetrics({requirements:[],testCases:[],suites:[],results:[],issues:[],executions:[{status:'completed',ended_at:'2026-09-11'},{status:'completed',ended_at:'2026-09-09'}]},now);
  assert.equal(metrics.completedRuns30d,1);
});
