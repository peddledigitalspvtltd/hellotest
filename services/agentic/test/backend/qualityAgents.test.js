const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const C=require('../../backend/services/qualityAgentContracts');
const {createQualityAgentService}=require('../../backend/services/qualityAgents.service');
const {createQualityAgentStore}=require('../../backend/services/qualityAgentStore');
const clone=value=>structuredClone(value);
const user={id:'actor-a',role:'admin'},input={project_id:'project-a',kind:'web',target_url:'https://qa.example.test/search?q=mobile'};
function fixture(extra={}) {
  const rows=new Map(),baselines=new Map(),savedArtifacts=new Map(),calls=[],events=[];
  const store={
    findRun:async id=>clone(rows.get(id)),findBaseline:async id=>clone(baselines.get(id)),
    listRuns:async scope=>[...rows.values()].filter(r=>r.project_id===scope.project_id&&(!scope.app_type_id||r.app_type_id===scope.app_type_id)).map(clone),
    listBaselines:async scope=>[...baselines.values()].filter(r=>r.project_id===scope.project_id&&(!scope.app_type_id||r.app_type_id===scope.app_type_id)).map(clone),
    async create(r,u,m,key){const prior=[...rows.values()].find(row=>row.project_id===r.project_id&&row.created_by===u.id&&key&&row.metadata.request_key===key);if(prior)return {row:clone(prior),existing:true};const row={id:randomUUID(),related_id:m.id,project_id:r.project_id,app_type_id:r.app_type_id,created_by:u.id,status:'queued',created_at:new Date().toISOString(),updated_at:new Date().toISOString(),metadata:clone(m)};rows.set(m.id,row);return {row:clone(row)};},
    async claim(){const row=[...rows.values()].find(r=>['queued','running'].includes(r.status)&&!r.metadata.lease_token);if(!row)return null;row.metadata.lease_token=randomUUID();return clone(row);},
    async checkpoint(row,patch){const current=rows.get(row.related_id);if(!['queued','running'].includes(current.status)||current.metadata.lease_token!==row.metadata.lease_token)return null;current.metadata={...current.metadata,...clone(patch)};return clone(current);},
    async updateClaim(row,patch,status){const current=rows.get(row.related_id);if(!['queued','running'].includes(current.status)||current.metadata.lease_token!==row.metadata.lease_token)return null;current.metadata={...current.metadata,...clone(patch),lease_token:null};current.status=status;return clone(current);},
    async cancel(row){const current=rows.get(row.related_id);if(!['queued','running'].includes(current.status))return null;current.status='failed';current.metadata={...current.metadata,run_status:'cancelled',cancellation_requested:true,lease_token:null};return clone(current);},
    event:async(row,e)=>events.push({row,e}),
    async saveBaseline(row,m,bytes){const prior=[...baselines.values()].find(b=>b.metadata.source_run_id===m.source_run_id&&b.metadata.source_artifact_id===m.source_artifact_id);if(prior)return clone(prior);const b={id:randomUUID(),project_id:row.project_id,app_type_id:row.app_type_id,created_at:new Date().toISOString(),metadata:{...clone(m),stored_artifact_id:randomUUID()}};savedArtifacts.set(b.metadata.stored_artifact_id,{transaction_id:b.id,mime_type:'image/png',content:bytes.toString('base64')});baselines.set(m.id,b);return clone(b);},
    artifact:async id=>clone(savedArtifacts.get(id))
  };
  const scope=async(project,app,actor,permission='agentic_workflow.view')=>{if(project!=='project-a'||(app&&app!=='app-a')||actor?.id!=='actor-a'||actor.denied===permission)throw C.fail('Forbidden project or capability.',403);};
  const integration=async(id,project)=>{if(project!=='project-a'||(id&&id!=='engine-a'))throw C.fail('Incorrectly scoped integration.',403);return {id:'engine-a',name:'QA Engine',base_url:'https://engine.example.test',config:{}};};
  const http=async(url,init,policy)=>{calls.push({url,init,policy});const body=JSON.parse(init.body||'null');return Response.json({contract_version:'1.0',id:'engine-run-1234',client_run_id:body.client_run_id,kind:body.kind,target_url:body.target_url,scope:body.scope,state:'completed',outcome:'passed',created_at:new Date().toISOString(),finished_at:new Date().toISOString(),stages:[{id:'analysis',label:'Observed analysis',status:'completed'}],findings:[],metrics:{pages_visited:1},artifacts:[],limitations:['Bounded checks only']});};
  const service=createQualityAgentService({store,scope,integration,http,secret:()=> 'secret',workerUser:async()=>user,...extra});
  return {service,store,rows,baselines,savedArtifacts,calls,events};
}
test('durable acceptance is idempotent by actor/project/key; changed payload conflicts',async()=>{
  const f=fixture();const one=await f.service.createRun(input,user,{requestKey:'request-1'}),two=await f.service.createRun(input,user,{requestKey:'request-1'});
  assert.equal(one.id,two.id);assert.equal(f.rows.size,1);assert.equal(f.calls.length,0);
  await assert.rejects(()=>f.service.createRun({...input,target_url:'https://qa.example.test/changed'},user,{requestKey:'request-1'}),e=>e.statusCode===409);
  await assert.rejects(()=>f.service.createRun({...input,idempotency_key:'different'},user,{requestKey:'request-1'}),/must match/);
});
test('run, history, catalog and artifact scope is checked before remote access',async()=>{
  const f=fixture(),run=await f.service.createRun(input,user);
  for(const operation of [()=>f.service.getRun(run.id,{id:'other'}),()=>f.service.listRuns({project_id:'project-b'},user),()=>f.service.catalog({project_id:'project-b'},user),()=>f.service.getArtifact(run.id,'evidence',{id:'other'}),()=>f.service.createRun({...input,app_type_id:'app-b'},user)])await assert.rejects(operation,e=>e.statusCode===403);
  assert.equal(f.calls.length,0);
});
test('catalog probes engine capabilities within a bounded deadline and distinguishes configured from available',async()=>{
  const checks={web:'reviewed_playwright_journeys',security:'passive_browser_posture',performance:'single_navigation_metrics',accessibility:'axe-core',visual:'reviewed_baseline_pixel_diff'};
  const f=fixture({http:async(url,init,policy)=>{assert.equal(policy.deadlineMs,3000);assert.match(url,/capabilities$/);return Response.json({contract_version:'1.0',available:true,browser:{available:true},checks});}});
  assert.equal((await f.service.catalog({project_id:'project-a'},user)).runtime.available,true);
  const unavailable=fixture({http:async()=>{throw new Error('unreachable');}});const catalog=await unavailable.service.catalog({project_id:'project-a'},user);assert.equal(catalog.runtime.configured,true);assert.equal(catalog.runtime.available,false);assert.equal(catalog.agents.every(a=>!a.available),true);
});
test('run capability is enforced at creation and again during worker dispatch',async()=>{
  const f=fixture({workerUser:async()=>({...user,denied:'agentic_workflow.run'})});
  await assert.rejects(()=>f.service.createRun(input,{...user,denied:'agentic_workflow.run'}),e=>e.statusCode===403);
  const run=await f.service.createRun(input,user);await f.service.processQueuedRuns();assert.equal((await f.service.getRun(run.id,user)).status,'failed');assert.equal(f.calls.length,0);
});
test('worker dispatch preserves query target and nullable application; steps execute only for web',async()=>{
  const f=fixture(),run=await f.service.createRun(input,user);await f.service.processQueuedRuns();
  const observed=await f.service.getRun(run.id,user);assert.equal(observed.status,'completed');assert.equal(observed.target_url,input.target_url);assert.equal(observed.app_type_id,null);
  const body=JSON.parse(f.calls[0].init.body);assert.equal(body.target_url,input.target_url);assert.equal(body.scope.app_type_id,null);assert.deepEqual(body.options.approved_steps,[]);assert.equal(body.options.timeout_ms,undefined);assert.equal(body.limits.max_duration_ms,60000);assert.equal(f.calls[0].policy.maxAttempts,1);
  const security=await f.service.createRun({...input,kind:'security'},user);await f.service.processQueuedRuns();assert.equal((await f.service.getRun(security.id,user)).status,'completed');assert.equal(Object.hasOwn(JSON.parse(f.calls[1].init.body).options,'approved_steps'),false);
});
test('typed 12-step plan is preserved and excessive or arbitrary-code plans rejected',async()=>{
  const steps=Array.from({length:12},(_,i)=>({action:'assert_text',selector:'#summary',text:`Expected ${i}`}));const f=fixture();
  const run=await f.service.createRun({...input,goal:'Verify result summaries',reviewed_plan:{reviewed:true,goal:'Verify result summaries',steps}},user);assert.equal(run.plan.steps.length,12);await f.service.processQueuedRuns();assert.equal(JSON.parse(f.calls[0].init.body).options.approved_steps.length,12);
  assert.throws(()=>C.normalizeSteps([...steps,steps[0]],input.target_url),/twelve/);assert.throws(()=>C.normalizeSteps([{action:'evaluate',code:'arbitrary()'}],input.target_url),/supported/);
});
test('unreviewed goal cannot silently become a smoke test; unavailable planner returns editable empty plan',async()=>{
  const f=fixture();const plan=await f.service.plan({...input,goal:'Verify checkout'},user);assert.equal(plan.source,'preset');assert.deepEqual(plan.steps,[]);assert.match(plan.limitations.join(' '),/no executable steps/);
  await assert.rejects(()=>f.service.createRun({...input,goal:'Verify checkout'},user),e=>e.code==='QUALITY_AGENT_PLAN_REQUIRED');
  const preset=await f.service.plan(input,user);assert.equal(preset.steps[0].action,'assert_url');
});
test('model proposals are normalized typed plans and their unobserved nature is disclosed',async()=>{
  const f=fixture({proposePlan:async()=>({steps:[{action:'click',selector:'#search'}],grounding:[{source:'object_repository',id:'locator-a',selector:'#search'}]})});
  const plan=await f.service.plan({...input,goal:'Click search'},user);assert.equal(plan.source,'model');assert.equal(plan.steps[0].selector,'#search');assert.match(plan.limitations.join(' '),/remain unverified/);
});
test('cancel is durable before remote acknowledgement and late dispatch cannot overwrite it',async()=>{
  let release,posted;const pending=new Promise(resolve=>release=resolve);const entered=new Promise(resolve=>posted=resolve);
  const stopCalls=[];const f=fixture({http:async(url,init)=>{if(url.endsWith('/cancel')){stopCalls.push(url);return Response.json({state:'cancelled'});}const b=JSON.parse(init.body);posted();await pending;return Response.json({contract_version:'1.0',id:'engine-run-1234',client_run_id:b.client_run_id,kind:b.kind,target_url:b.target_url,scope:b.scope,state:'completed',outcome:'passed',stages:[],findings:[],artifacts:[],limitations:[],metrics:{}});}});
  const run=await f.service.createRun(input,user),processing=f.service.processQueuedRuns();await entered;const cancelled=await f.service.cancelRun(run.id,user);assert.equal(cancelled.status,'cancelled');release();await processing;assert.equal((await f.service.getRun(run.id,user)).status,'cancelled');assert.ok(stopCalls.some(url=>url.endsWith(`/by-client/${run.id}/cancel`)));assert.ok(stopCalls.some(url=>url.endsWith('/engine-run-1234/cancel')));
});
test('cancellation requests bounded remote stop for known engine runs',async()=>{
  const f=fixture(),run=await f.service.createRun(input,user),row=f.rows.get(run.id);row.metadata.run_status='running';row.metadata.engine_run_id='engine-run-1234';row.status='running';
  await f.service.cancelRun(run.id,user);assert.match(f.calls[0].url,/engine-run-1234\/cancel$/);assert.equal(f.calls[0].policy.deadlineMs,5000);
});
test('malformed/truncated or incorrectly scoped engine results fail without partial findings',async()=>{
  for(const response of [new Response('{"contract_version":'),Response.json({contract_version:'1.0',scope:{project_id:'project-b'},state:'completed'})]){
    const f=fixture({http:async()=>response}),run=await f.service.createRun(input,user);await f.service.processQueuedRuns();const result=await f.service.getRun(run.id,user);assert.equal(result.status,'failed');assert.equal(result.error.code,'QUALITY_AGENT_ENGINE_CONTRACT');assert.deepEqual(result.findings,[]);
  }
});
test('uncertain POST acknowledgement retries saved client id; no duplicate platform run',async()=>{
  let attempt=0;const ids=[];const f=fixture({http:async(url,init)=>{ids.push(JSON.parse(init.body).client_run_id);attempt++;throw Object.assign(new Error('Timeout'),{retryable:true});}}),run=await f.service.createRun(input,user);
  await f.service.processQueuedRuns();await f.service.processQueuedRuns();assert.equal(attempt,2);assert.deepEqual(ids,[run.id,run.id]);assert.equal(f.rows.size,1);assert.equal((await f.service.getRun(run.id,user)).status,'queued');
});
test('transport deadline fails instead of indefinitely retrying unavailable engine',async()=>{
  const f=fixture(),run=await f.service.createRun(input,user);f.rows.get(run.id).metadata.queued_at=new Date(Date.now()-300000).toISOString();await f.service.processQueuedRuns();const result=await f.service.getRun(run.id,user);assert.equal(result.error.code,'QUALITY_AGENT_DEADLINE');assert.match(f.calls[0].url,/by-client\/.+\/cancel$/);
});
test('artifact download verifies declared type, bytes and content SHA256',async()=>{
  const bytes=Buffer.from('observed evidence');const f=fixture({http:async()=>new Response(bytes,{headers:{'content-type':'image/png'}})}),run=await f.service.createRun(input,user),row=f.rows.get(run.id);
  row.metadata.engine_run_id='engine-run-1234';row.metadata.artifacts=[{id:'artifact-a',name:'Evidence.png',type:'screenshot',content_type:'image/png',bytes:bytes.length,sha256:C.hash(bytes)}];
  assert.deepEqual((await f.service.getArtifact(run.id,'artifact-a',user)).bytes,bytes);
  row.metadata.artifacts[0].sha256='0'.repeat(64);await assert.rejects(()=>f.service.getArtifact(run.id,'artifact-a',user),e=>e.code==='QUALITY_AGENT_ARTIFACT_INTEGRITY');
  await assert.rejects(()=>f.service.getArtifact(run.id,'../../another',user),e=>e.statusCode===404);
});
test('engine contract accepts 12-step stage evidence and 8 MiB artifact boundary, rejects larger',()=>{
  const expected={id:'platform-id-123',kind:'web',project_id:'project-a',app_type_id:null,target_url:input.target_url};
  const value={contract_version:'1.0',id:'engine-run-1234',client_run_id:expected.id,kind:expected.kind,scope:{project_id:'project-a',app_type_id:null},target_url:input.target_url,state:'completed',outcome:'passed',findings:[],metrics:{},limitations:[],stages:Array.from({length:17},(_,i)=>({id:`stage-${i}`,label:'Observed step',status:'completed'})),artifacts:[{id:'artifact-a',name:'Screenshot.png',type:'screenshot',content_type:'image/png',bytes:8*1024*1024,sha256:'a'.repeat(64)}]};
  assert.equal(C.validateEngineRun(value,expected),value);assert.throws(()=>C.validateEngineRun({...value,artifacts:[{...value.artifacts[0],bytes:8*1024*1024+1}]},expected),/manifest/);assert.throws(()=>C.validateEngineRun(value,{...expected,engine_run_id:'different-run'}),/scoped/);
});
test('reviewed baseline repeated approval is idempotent, scoped, durable and hash verified',async()=>{
  const bytes=Buffer.from('png screenshot evidence'),f=fixture({http:async(url,init)=>url.endsWith('/baselines')?Response.json({id:'engine-baseline-1234',source_run_id:'engine-run-1234',artifact_id:'artifact-a',scope:{project_id:'project-a',app_type_id:null},target_url:input.target_url,viewport:{width:1280,height:800},masks:[],sha256:C.hash(bytes)}):new Response(bytes,{headers:{'content-type':'image/png'}})});
  const run=await f.service.createRun({...input,kind:'visual'},user),row=f.rows.get(run.id);row.status='completed';row.metadata.run_status='completed';row.metadata.engine_run_id='engine-run-1234';row.metadata.artifacts=[{id:'artifact-a',name:'Candidate.png',type:'screenshot',content_type:'image/png',bytes:bytes.length,sha256:C.hash(bytes)}];
  const first=await f.service.approveBaseline(run.id,{artifact_id:'artifact-a'},user),second=await f.service.approveBaseline(run.id,{artifact_id:'artifact-a'},user);assert.equal(first.id,second.id);assert.equal(f.baselines.size,1);assert.deepEqual((await f.service.getBaselineArtifact(first.id,user)).bytes,bytes);
  await assert.rejects(()=>f.service.approveBaseline(run.id,{artifact_id:'artifact-a'},{...user,denied:'agentic_workflow.manage'}),e=>e.statusCode===403);
  await assert.rejects(()=>f.service.getBaselineArtifact(first.id,{id:'other'}),e=>e.statusCode===403);
  await assert.rejects(()=>f.service.createRun({...input,kind:'visual',baseline_id:first.id,app_type_id:'app-a'},user),e=>e.code==='QUALITY_AGENT_BASELINE_SCOPE');
  await f.service.createRun({...input,kind:'visual',baseline_id:first.id},user);
  const b=f.baselines.get(first.id);f.savedArtifacts.get(b.metadata.stored_artifact_id).content=Buffer.from('corrupt').toString('base64');await assert.rejects(()=>f.service.getBaselineArtifact(first.id,user),/integrity/);
});
test('secret input, off-origin assertion and fractional bounded configuration rejected before persistence',()=>{
  for(const step of [{action:'fill',selector:'input[type=password]',value:'secret'},{action:'fill',selector:'#field',value:'Bearer confidential-value'},{action:'assert_url',url:'https://another.example.test'}])assert.throws(()=>C.normalizeSteps([step],input.target_url));
  assert.throws(()=>C.targetUrl('https://qa.example.test?access_token=secret'));assert.throws(()=>C.normalizeOptions({max_pages:1.5},'web'));assert.throws(()=>C.normalizeOptions({budgets:{resource_count:251}},'performance'));
});
test('PostgreSQL store guards write leases and cancellation; baseline image is written inside transaction',async()=>{
  const queries=[],writes=[];const db={prepare:sql=>({get:async(...args)=>{queries.push({sql,args});return {id:'transaction-a',metadata:{}};}}),transaction:fn=>async()=>{writes.push('begin');const result=await fn();writes.push('commit');return result;},query:async()=>{}};
  const store=createQualityAgentStore({db,workspace:{createTransaction:async()=>({id:'transaction-a'}),createTransactionArtifact:async()=>{writes.push('png');return {id:'stored-a'};}}});
  await store.updateClaim({id:'transaction-a',metadata:{lease_token:'lease-a'}},{run_status:'completed'},'completed');assert.match(queries[0].sql,/metadata->>'lease_token' = \?/);assert.match(queries[0].sql,/status IN \('queued','running'\)/);
  await store.cancel({id:'transaction-a'});assert.match(queries[1].sql,/status IN \('queued','running'\)/);
  db.prepare=sql=>({get:async()=>{if(sql.startsWith('SELECT'))return null;return {id:'transaction-a',metadata:{}};}});
  await store.saveBaseline({related_id:'run-a',project_id:'project-a'}, {source_run_id:'run-a',source_artifact_id:'artifact-a'},Buffer.from('image'));assert.deepEqual(writes,['begin','png','commit']);
});

test('autonomous missions checkpoint decisions before dispatch and reuse the same decision after lost acknowledgement',async()=>{
 let f,launch,decisions=0,posted=0;
 const observed={sequence:1,url:input.target_url,title:'Shop',text:'Product details',elements:[{id:'element-1',tag:'a',label:'Product details',type:'',sensitive:false,href:'https://qa.example.test/product'}]};
 f=fixture({decideMission:async()=>{decisions++;return {action:'click',element_id:'element-1',summary:'Open product details'};},http:async(url,init)=>{
  if(url.endsWith('/capabilities'))return Response.json({missions:{supported:true}});
  if(url.endsWith('/decision')){posted++;assert.equal(f.rows.get(launch.client_run_id).metadata.last_decision.sequence,1,'Decision is durable before releasing a browser action');if(posted===1)throw Object.assign(new Error('lost acknowledgement'),{retryable:true});return Response.json({accepted:true});}
  launch=init.body?JSON.parse(init.body):launch;
  return Response.json({contract_version:'1.0',id:'engine-mission-1234',client_run_id:launch.client_run_id,kind:'web',target_url:input.target_url,scope:launch.scope,state:'running',outcome:null,stages:[],findings:[],metrics:{},artifacts:[],limitations:[],decision_request:observed});
 }});
 const run=await f.service.createRun({...input,goal:'Open product details',options:{mission:{max_actions:3,allow_form_submission:false}}},user);
 await f.service.processQueuedRuns();await f.service.processQueuedRuns();assert.equal(decisions,1);assert.equal(posted,2);assert.equal((await f.service.getRun(run.id,user)).status,'running');
});
test('cancellation during browser model latency prevents action dispatch',async()=>{
 let f,run,posted=0;
 f=fixture({decideMission:async()=>{await f.service.cancelRun(run.id,user);return {action:'complete',summary:'Done'};},http:async(url,init)=>{if(url.endsWith('/capabilities'))return Response.json({missions:{supported:true}});if(url.endsWith('/decision')){posted++;return Response.json({accepted:true});}if(url.endsWith('/cancel'))return Response.json({cancelled:true});const value=JSON.parse(init.body);return Response.json({contract_version:'1.0',id:'engine-mission-1234',client_run_id:value.client_run_id,kind:'web',target_url:input.target_url,scope:value.scope,state:'running',outcome:null,stages:[],findings:[],metrics:{},artifacts:[],limitations:[],decision_request:{sequence:1,url:input.target_url,title:'Shop',text:'Ready',elements:[]}});}});
 run=await f.service.createRun({...input,goal:'Read the page',options:{mission:{max_actions:3,allow_form_submission:false}}},user);await f.service.processQueuedRuns();assert.equal(posted,0);assert.equal((await f.service.getRun(run.id,user)).status,'cancelled');
});
