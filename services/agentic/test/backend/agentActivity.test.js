const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {createRequire}=require('node:module');
const filename=path.resolve(__dirname,'../../backend/services/agentActivity.service.js');
function fixture({permission=true,feature=true,foreignApp=false,sourceMissing=false}={}){
 const native=createRequire(filename),queries=[];const run={id:'repository:run',system:'repository',source_run_id:'run',project_id:'p',app_type_id:'a',payload:{},status:'succeeded'};
 const source={id:'run',project_id:'p',app_type_id:'a',agent_type:'api_tests',status:'completed',created_at:'2026-11-17T00:00:00Z',updated_at:'2026-11-17T00:00:00Z'};
 const db={prepare:sql=>({get:async(...args)=>{queries.push({sql,args});if(sql.includes('FROM app_types'))return {project_id:foreignApp?'foreign':'p'};if(sql.includes('repository_agent_runs'))return sourceMissing?null:source;return null;},all:async()=>sourceMissing?[]:[source],run:async()=>({changes:1})})};
 const obs={prepare:sql=>({get:async()=>sql.includes('SELECT * FROM agent_runs')?run:run,all:async()=>[],run:async()=>({changes:1})})};
 const mock={'@hellotest/platform/backend/src/db':db,'@hellotest/platform/backend/src/obsDb':obs,'@hellotest/platform/backend/services/permission.service':{hasPermission:async()=>permission},'@hellotest/platform/backend/services/featureFlag.service':{getFeatureKeysForPermission:()=>['feature'],areEnabled:async()=>feature},'@hellotest/platform/backend/public/projectAccess':{getProject:async(p,u)=>{assert.equal(p,'p');assert.equal(u,'u');return{id:p};}}};
 const module={exports:{}};new Function('require','module','exports',fs.readFileSync(filename,'utf8'))(id=>mock[id]||native(id),module,module.exports);
 return {service:module.exports,queries,source,run};
}
test('canonical adapters use shared statuses and source references across all four families',()=>{
 const {service}=fixture();
 for(const[system,extra,status]of [['repository',{agent_type:'api_tests'},'completed'],['workflow',{metadata:{agent_id:'story-architect'}},'interrupted'],['quality',{metadata:{request:{kind:'web'},run_status:'cancelled'}},'failed'],['automation',{metadata:{},category:'automation_build'},'running']]){
  const run=service.adapted(system,{id:'r',project_id:'p',status,...extra});assert.equal(run.system,system);assert.equal(run.descriptor.schema_version,'agent-descriptor/1');assert.equal(run.descriptor.output.review_required,true);assert.equal(run.status,{repository:'succeeded',workflow:'unknown',quality:'cancelled',automation:'running'}[system]);assert.ok(run.payload.requires_human_review);
 }
});
test('project access, current permission and feature availability gate activity',async()=>{
 for(const extra of [{permission:false},{feature:false}]){
  const f=fixture(extra);assert.deepEqual(await f.service.authorize('p','a',{id:'u'}),[]);await assert.rejects(f.service.detail(f.run.id,{id:'u'}),{statusCode:404});
 }
 await assert.rejects(fixture({foreignApp:true}).service.authorize('p','a',{id:'u'}),{statusCode:404});
});
test('canonical history does not confer access after the native source is removed or moved',async()=>{
 const missing=fixture({sourceMissing:true});await assert.rejects(missing.service.detail(missing.run.id,{id:'u'}),{statusCode:404});
 const moved=fixture();moved.source.app_type_id='foreign';await assert.rejects(moved.service.detail(moved.run.id,{id:'u'}),{statusCode:404});
});
test('activity rejects an unbounded or malformed pagination cursor before running ledger query',async()=>{
 const f=fixture();await assert.rejects(f.service.list({project_id:'p',app_type_id:'a',system:'repository',cursor:'malformed'},{id:'u'}),{statusCode:400});
});

test('history listing checks native source scope in bounded batches after source deletion or movement',async()=>{const ok=fixture();assert.equal((await ok.service.availableSources([ok.run])).length,1);ok.source.project_id='foreign';assert.deepEqual(await ok.service.availableSources([ok.run]),[]);const missing=fixture({sourceMissing:true});assert.deepEqual(await missing.service.availableSources([missing.run]),[]);});
test('scorecards report accepted drafts and measured usage without treating missing tokens as zero', () => {
  const { service } = fixture();
  const started_at = '2026-11-24T00:00:00.000Z';
  const payload = (metrics, source_kind = 'agentic_assistant_session') => ({ source_kind, metrics });
  const source = { system: 'workflow', agent_id: 'test-designer', started_at };
  const summaries = service.scorecardRows([
    { ...source, status: 'succeeded', source_run_id: 'done', completed_at: '2026-11-24T00:00:10.000Z', payload: payload({ tokens: 1200, drafts: 2 }) },
    { ...source, status: 'failed', source_run_id: 'failed', completed_at: '2026-11-24T00:00:30.000Z', payload: payload({ tokens: null, failure_code: 'AGENT_OUTPUT_INVALID' }) },
    { ...source, status: 'succeeded', source_run_id: 'whole-workflow', payload: payload({ tokens: 0 }, 'workflow') }
  ], new Map([['done', 1]]));
  assert.deepEqual(summaries, [{ key:'workflow:test-designer', runs:2, completed:1, drafts:2, accepted:1,
    median_duration_ms:20000, duration_samples:2, median_tokens:1200, token_samples:1, failure_codes:{ AGENT_OUTPUT_INVALID:1 } }]);
});
