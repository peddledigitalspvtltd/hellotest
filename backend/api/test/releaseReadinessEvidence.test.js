const assert = require('node:assert/strict');
const test = require('node:test');
const Fastify = require('fastify');
const db = require('../src/db');
const projectService = require('../src/services/project.service');

async function fixture(t,{denyRun=false,denyResult=false,executions,nativeScope=false}={}) {
  const reads=[];
  const grants=[];
  t.mock.method(projectService,'getProject',async id=>({id}));
  t.mock.method(db,'prepare',sql=>({get:async(...args)=>{
    reads.push({sql,args});
    if(nativeScope && sql.includes('FROM requirement_releases')) return args[0]==='release-id' && args[1]==='p' ? {id:'release-id'} : undefined;
    if(nativeScope && sql.includes('FROM requirement_iterations')) return args[0]==='sprint-id' && args[1]==='p' ? {id:'sprint-id',name:'Current sprint'} : undefined;
    throw new Error('Unexpected lookup');
  },all:async(...args)=>{
    reads.push({sql,args});
    if(sql.includes('FROM executions WHERE')) return executions || [{id:'run-a',project_id:'p',release:'Release A'},{id:'run-b',project_id:'p'}];
    if(sql.includes('FROM execution_results')) return [
      {id:'result-a',execution_id:'run-a',test_case_id:'case-a',status:'paused',created_at:'2026-09-01',lifecycle_history:[{at:'2026-09-10T10:00Z'}]},
      {id:'result-b',execution_id:'run-a',test_case_id:'case-a',status:'passed',data_set_iteration_index:1}
    ];
    if(sql.includes('FROM execution_case_snapshots')) return [{execution_id:'run-a',test_case_id:'case-a',expected_iterations:3}];
    throw new Error('Unexpected query');
  }}));
  const app=Fastify({logger:false});t.after(()=>app.close());
  app.decorate('authenticate',async req=>{req.user={id:'reader'};});
  app.decorate('validate',()=>{});
  app.decorate('requirePermission',(permission,{projectId}={})=>async()=>{grants.push({permission,projectId});if((denyRun&&permission==='run.view')||(denyResult&&permission==='result.view'))throw Object.assign(new Error('Denied'),{statusCode:403});});
  await app.register(require('../src/routes/executionResults.routes'));
  await app.ready();
  return {app,reads,grants};
}

test('Release readiness ignores stale Sprint restrictions, uses minimal snapshots and truthful lookahead limits',async t=>{
  const {app,reads,grants}=await fixture(t);
  const response=await app.inject('/execution-results/release-readiness?project_id=p&release=%20Release%20A%20&sprint=%20Sprint%202%20&run_limit=1&result_limit=1');
  assert.equal(response.statusCode,200,response.body);
  const body=response.json();
  assert.deepEqual(grants,[{permission:'result.view',projectId:'p'},{permission:'run.view',projectId:'p'}]);
  assert.deepEqual(reads[0].args,['p','release a',2]);
  assert.doesNotMatch(reads[0].sql,/OR build|SELECT \*/);
  assert.match(reads[0].sql,/LOWER\(TRIM\(COALESCE\(release/);
  assert.match(reads[1].sql,/ROW_NUMBER\(\) OVER \(PARTITION BY execution_id, test_case_id/);
  assert.deepEqual(reads[1].args,['run-a',2]);
  assert.deepEqual(reads[2].args,['run-a']);
  assert.equal(body.complete,false);
  assert.equal(body.reasons.length,2);
  assert.equal(body.runs_scanned,1);
  assert.equal(body.candidate_runs,2);
  assert.equal(body.candidate_results,2);
  assert.equal(body.results.length,1);
  assert.equal(body.results[0].updated_at,'2026-09-10T10:00:00.000Z');
  assert.deepEqual(body.executions[0].case_snapshots,[{test_case_id:'case-a',expected_iterations:3}]);
  assert.ok(body.evaluated_at);
  assert.doesNotMatch(reads[2].sql,/SELECT \*|parameter_values|jsonb_agg\(test_data_set_snapshot/);
});

test('native readiness filters retain canonical relations and reject IDs from another project',async t=>{
  const {app,reads,grants}=await fixture(t,{nativeScope:true});
  const response=await app.inject('/execution-results/release-readiness?project_id=p&release_id=release-id&iteration_id=sprint-id&release=Stale%20release&sprint=Stale%20sprint');
  assert.equal(response.statusCode,200,response.body);
  const runRead=reads.find(read=>read.sql.includes('FROM executions WHERE'));
  assert.match(runRead.sql,/executions.release_id = rel.id/);
  assert.match(runRead.sql,/requirement_release_sprints/);
  assert.deepEqual(runRead.args,['p','release-id',101]);
  assert.ok(grants.some(grant=>grant.permission==='requirement_iteration.view'));
  const before=reads.filter(read=>read.sql.includes('FROM executions WHERE')).length;
  const denied=await app.inject('/execution-results/release-readiness?project_id=p&release_id=foreign-release');
  assert.equal(denied.statusCode,404);
  assert.equal(reads.filter(read=>read.sql.includes('FROM executions WHERE')).length,before);
});

test('readiness cannot expose run metadata through result-only permission',async t=>{
  const {app,reads}=await fixture(t,{denyRun:true});
  const response=await app.inject('/execution-results/release-readiness?project_id=p');
  assert.equal(response.statusCode,403);
  assert.equal(reads.length,0);
});

test('readiness shows frozen context labels after resources change or disappear without loading their payloads',async t=>{
  const {app,reads,grants}=await fixture(t,{executions:[
    {id:'run-a',project_id:'p',test_environment_id:'env',test_environment_name:'Saved staging',saved_environment_id:'env',saved_environment_name:'Snapshot staging',test_configuration_id:'config',test_configuration_name:'Saved Chromium',saved_configuration_id:'config',saved_configuration_name:'Snapshot Chromium'},
    {id:'run-b',project_id:'p',test_environment_id:null,test_environment_name:null,saved_environment_id:'deleted-env',saved_environment_name:'Archived staging',test_configuration_id:null,test_configuration_name:null,saved_configuration_id:'deleted-config',saved_configuration_name:'Archived Firefox',test_data_set_id:null,saved_data_set_id:'deleted-data',saved_data_set_name:'Archived rows'},
    {id:'run-c',project_id:'p',test_environment_id:null,test_environment_name:null,saved_environment_id:null,saved_environment_name:null,test_configuration_id:null,test_configuration_name:null,saved_configuration_id:null,saved_configuration_name:null}
  ]});
  const response=await app.inject('/execution-results/release-readiness?project_id=p');
  assert.equal(response.statusCode,200,response.body);
  const runs=response.json().executions;
  assert.deepEqual(runs[0].test_environment,{id:'env',name:'Saved staging',snapshot:null});
  assert.deepEqual(runs[0].test_configuration,{id:'config',name:'Saved Chromium',snapshot:null});
  assert.deepEqual(runs[1].test_environment,{id:'deleted-env',name:'Archived staging',snapshot:null});
  assert.deepEqual(runs[1].test_configuration,{id:'deleted-config',name:'Archived Firefox',snapshot:null});
  assert.deepEqual(runs[1].test_data_set,{id:'deleted-data',name:'Archived rows'});
  assert.equal(runs[2].test_environment,null);
  assert.equal(runs[2].test_configuration,null);
  assert.equal(runs[2].test_data_set,null);
  assert.deepEqual(grants.map(grant=>grant.permission),['result.view','run.view'],'historical labels retain run/result access without requiring optional resource catalogs');
  assert.match(reads[0].sql,/test_environment_snapshot->>'name'/);
  assert.match(reads[0].sql,/test_configuration_snapshot->>'name'/);
  assert.match(reads[0].sql,/test_data_set_snapshot->>'name'/);
  assert.doesNotMatch(reads[0].sql,/JOIN\s+test_(environments|configurations)|snapshot\s*,|variables|credentials|SELECT\s+\*/i);
  assert.ok(runs.every(run=>!Object.keys(run).some(key=>key.startsWith('saved_')||key.endsWith('_snapshot'))),'internal projections and full snapshots are absent from the summary');
});

test('readiness context remains inaccessible without result permission',async t=>{
  const {app,reads}=await fixture(t,{denyResult:true});
  const response=await app.inject('/execution-results/release-readiness?project_id=p');
  assert.equal(response.statusCode,403);
  assert.equal(reads.length,0);
});

 test('standalone Sprint readiness keeps an exact native Sprint scope', async t => {
 const {app,reads}=await fixture(t,{nativeScope:true});
 const response=await app.inject('/execution-results/release-readiness?project_id=p&iteration_id=sprint-id&sprint=Old');
 assert.equal(response.statusCode,200,response.body);
 const read=reads.find(item=>item.sql.includes('FROM executions WHERE'));
 assert.deepEqual(read.args,['p','sprint-id','current sprint','current sprint',101]);
 assert.match(read.sql,/iteration_id = \?/);
 });
