const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const C=require('../../backend/services/qualityAgentContracts');
const {createQualityAgentService}=require('../../backend/services/qualityAgents.service');
const {createQualityAgentStore}=require('../../backend/services/qualityAgentStore');
const clone=value=>structuredClone(value);
const user={id:'actor-a',role:'admin'},input={project_id:'project-a',kind:'web',target_url:'https://qa.example.test/search?q=mobile',execution_mode:'checks'};
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
test('unreviewed goal cannot silently become a smoke test or an empty plan when the model is unavailable',async()=>{
  const f=fixture();await assert.rejects(()=>f.service.plan({...input,goal:'Verify checkout'},user),e=>e.code==='QUALITY_AGENT_MODEL_REQUIRED');
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
  const queries=[],writes=[];const db={prepare:sql=>({get:async(...args)=>{queries.push({sql,args});return {id:'transaction-a',metadata:{}};},run:async()=>({changes:1})}),transaction:fn=>async()=>{writes.push('begin');const result=await fn();writes.push('commit');return result;},query:async()=>{}};
  const store=createQualityAgentStore({db,workspace:{createTransaction:async()=>({id:'transaction-a'}),createTransactionArtifact:async()=>{writes.push('png');return {id:'stored-a'};}}});
  await store.updateClaim({id:'transaction-a',metadata:{lease_token:'lease-a'}},{run_status:'completed'},'completed');assert.match(queries[0].sql,/metadata->>'lease_token' = \?/);assert.match(queries[0].sql,/status IN \('queued','running'\)/);
  await store.cancel({id:'transaction-a'});assert.ok(queries.some(query=>/status IN \('queued','running'\)/.test(query.sql)));
  writes.length=0;
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
 const run=await f.service.createRun({...input,execution_mode:'agent',goal:'Open product details',options:{mission:{max_actions:3,allow_form_submission:false}}},user);
 await f.service.processQueuedRuns();await f.service.processQueuedRuns();assert.equal(decisions,1);assert.equal(posted,2);assert.equal((await f.service.getRun(run.id,user)).status,'running');
});
test('cancellation during browser model latency prevents action dispatch',async()=>{
 let f,run,posted=0;
 f=fixture({decideMission:async(r,actor,observation,history,trace)=>{assert.equal(trace.signal.aborted,false);await f.service.cancelRun(run.id,user);assert.equal(trace.signal.aborted,true);return {action:'complete',summary:'Done'};},http:async(url,init)=>{if(url.endsWith('/capabilities'))return Response.json({missions:{supported:true}});if(url.endsWith('/decision')){posted++;return Response.json({accepted:true});}if(url.endsWith('/cancel'))return Response.json({cancelled:true});const value=JSON.parse(init.body);return Response.json({contract_version:'1.0',id:'engine-mission-1234',client_run_id:value.client_run_id,kind:'web',target_url:input.target_url,scope:value.scope,state:'running',outcome:null,stages:[],findings:[],metrics:{},artifacts:[],limitations:[],decision_request:{sequence:1,url:input.target_url,title:'Shop',text:'Ready',elements:[]}});}});
 run=await f.service.createRun({...input,execution_mode:'agent',goal:'Read the page',options:{mission:{max_actions:3,allow_form_submission:false}}},user);await f.service.processQueuedRuns();assert.equal(posted,0);assert.equal((await f.service.getRun(run.id,user)).status,'cancelled');
});
test('real decision phases are durable and visible while the bounded model loop is running',async()=>{
 let f,run;const phases=[];
 f=fixture({decideMission:async(r,actor,observation,history,trace)=>{
  for(const phase of ['deciding','revising']) {
   await trace.onProgress({phase,message:phase==='deciding'?'Choosing a current control.':'Correcting its observed outcome.',revision:phase==='revising'?1:0});
   const current=await f.service.getRun(run.id,user);phases.push(current.mission_progress.phase);assert.equal(current.mission_progress.sequence,1);assert.equal(current.task_brief.goal,'Review the visible catalogue');assert.equal(current.task_brief.agent_id,'browser-web');
  }
  return {action:'assert_text',text:'Ready',summary:'Check the visible result.'};
 },http:async(url,init)=>{
  if(url.endsWith('/capabilities'))return Response.json({missions:{supported:true}});
  if(url.endsWith('/decision')){const current=await f.service.getRun(run.id,user);assert.equal(current.mission_progress.phase,'dispatching');return Response.json({accepted:true});}
  const value=JSON.parse(init.body);return Response.json({contract_version:'1.0',id:'engine-mission-1234',client_run_id:value.client_run_id,kind:'web',target_url:input.target_url,scope:value.scope,state:'running',outcome:null,stages:[],findings:[],metrics:{},artifacts:[],limitations:[],decision_request:{sequence:1,url:input.target_url,title:'Catalogue',text:'Ready',elements:[]}});
 }});
 run=await f.service.createRun({...input,execution_mode:'agent',goal:'Review the visible catalogue',options:{mission:{max_actions:3,allow_form_submission:false}}},user);await f.service.processQueuedRuns();assert.deepEqual(phases,['deciding','revising']);
});

test('all five Quality Agents default to scoped LLM missions with specialist goals and model preflight',async()=>{
  const preflight=[];
  const f=fixture({resolveMissionModel:async request=>preflight.push(request.kind),decideMission:async()=>({action:'blocked',summary:'Not dispatched by this acceptance test.'}),http:async url=>{assert.match(url,/capabilities$/);return Response.json({missions:{supported:true}});}});
  for(const kind of C.KINDS){const {execution_mode,...request}=input;const run=await f.service.createRun({...request,kind},user);assert.equal(run.execution_mode,'agent');assert.equal(run.agent_runtime.mode,'llm_observation_action_loop');assert.equal(run.options.mission.max_actions,6);assert.equal(run.options.mission.allow_form_submission,false);assert.ok(run.goal.length>20);assert.equal(run.task_brief.skill_profile.id,`quality.${kind}`);}
  assert.deepEqual(preflight,[...C.KINDS]);
});

test('model calls and token reservations are durable before dispatch, streamed text is coalesced and final evidence is assessed',async()=>{
  let f,run,launch,sequence=1;const text='Observed output '.repeat(50),stream=[];
  const observed=()=>({sequence,url:input.target_url,title:'Catalogue',text:'Visible product',elements:[]});
  const completed=()=>({contract_version:'1.0',id:'engine-mission-1234',client_run_id:launch.client_run_id,kind:'security',target_url:input.target_url,scope:launch.scope,state:sequence>1?'completed':'running',outcome:sequence>1?'findings':null,stages:[],findings:sequence>1?[{id:'header-a',category:'headers',severity:'low',title:'Missing header',description:'Observed response lacks the reviewed header.',evidence:'No X-Content-Type-Options header.'}]:[],metrics:{http_status:200},artifacts:[],limitations:['Passive browser evidence only.'],...(sequence>1?{mission_report:{status:'completed',summary:'Page observed.',actions:[{sequence:1,action:'complete',summary:'Page observed.',url:input.target_url,status:'completed'}]}}:{decision_request:observed()})});
  f=fixture({resolveMissionModel:async()=>({id:'model'}),decideMission:async(request,actor,observation,history,trace)=>{
    await trace.beforeDispatch({call_id:'call-decision',payload:{max_tokens:100},phase:'decision',revision:0});
    const saved=await f.service.getRun(run.id,user);assert.equal(saved.model_usage.calls,1);assert.equal(saved.model_usage.reserved_output_tokens,100);
    await trace.onEvent('model_start',{call_id:'call-decision',stage:'decision'});
    for(const part of [text.slice(0,100),text.slice(100,300),text.slice(300)])await trace.onEvent('text',{call_id:'call-decision',text:part});
    await trace.onUsage({prompt_tokens:30,completion_tokens:10});await trace.onEvent('model_done',{call_id:'call-decision',finish_reason:'stop'});
    return {action:'complete',summary:'Page observed.'};
  },assessQualityRun:async(request,actor,engine,trace)=>{
    assert.equal(engine.findings[0].id,'header-a');assert.equal((await f.service.getRun(run.id,user)).status,'running');
    await trace.beforeDispatch({call_id:'call-assessment',payload:{max_tokens:200},phase:'assessment',revision:0});
    await trace.onUsage({prompt_tokens:50,completion_tokens:20});
    return {title:'Observed posture',summary:'Review the missing header.',conclusion:'observed_findings',generation_mode:'llm',observations:[{finding_id:'header-a',analysis:'Observed absence.',recommendation:'Review response policy.',artifact_ids:[]}],metric_notes:[],limitations:[],next_steps:[],skill_reference_ids:[]};
  },http:async(url,init)=>{
    if(url.endsWith('/capabilities'))return Response.json({missions:{supported:true}});
    if(url.endsWith('/decision')){sequence++;return Response.json({accepted:true});}
    if(init.body)launch=JSON.parse(init.body);return Response.json(completed());
  }});
  f.store.appendStreamEvent=async(row,event)=>{const saved=f.rows.get(row.related_id);if(saved.metadata.lease_token!==row.metadata.lease_token&&!['done','error'].includes(event.type))return null;stream.push(event);return {seq:stream.length};};
  run=await f.service.createRun({...input,execution_mode:'agent',kind:'security',goal:'Review browser security posture'},user);
  await f.service.processQueuedRuns();await f.service.processQueuedRuns();
  const saved=await f.service.getRun(run.id,user);assert.equal(saved.status,'completed');assert.equal(saved.outcome,'findings');assert.equal(saved.agent_assessment.conclusion,'observed_findings');assert.deepEqual(saved.findings.map(item=>item.id),['header-a']);
  assert.equal(saved.model_usage.calls,2);assert.equal(saved.model_usage.reserved_output_tokens,300);assert.equal(saved.model_usage.prompt_tokens,80);assert.equal(saved.model_usage.completion_tokens,30);
  assert.equal(stream.filter(event=>event.type==='text').map(event=>event.data.text).join(''),text);assert.ok(stream.filter(event=>event.type==='text').length<3);
  assert.ok(stream.some(event=>event.type==='tool_start'));assert.ok(stream.some(event=>event.type==='tool_result'));assert.equal(stream.at(-1).type,'done');
});

test('unknown model generation cannot be replayed after worker recovery and engine evidence stays visible',async()=>{
  let decisions=0;const f=fixture({decideMission:async()=>{decisions++;throw new Error('Must not redispatch');},resolveMissionModel:async()=>({}),http:async url=>{if(url.endsWith('/capabilities'))return Response.json({missions:{supported:true}});if(url.endsWith('/cancel'))return Response.json({cancelled:true});throw new Error('Unexpected browser dispatch');}});
  const run=await f.service.createRun({...input,execution_mode:'agent'},user),row=f.rows.get(run.id);
  row.metadata.model_dispatch={call_id:'previous-billed-call',state:'in_flight'};row.metadata.findings=[{id:'retained'}];
  await f.service.processQueuedRuns();const failed=await f.service.getRun(run.id,user);
  assert.equal(failed.status,'failed');assert.equal(failed.error.code,'QUALITY_AGENT_MODEL_OUTCOME_UNKNOWN');assert.equal(decisions,0);assert.deepEqual(failed.findings,[{id:'retained'}]);
});

test('model budget failure prevents another dispatch',async()=>{
  let run,f,called=0;f=fixture({resolveMissionModel:async()=>({}),decideMission:async(request,actor,observation,history,trace)=>{await trace.beforeDispatch({call_id:'budget-call',payload:{max_tokens:4096},phase:'decision'});called++;return {action:'blocked',summary:'Blocked.'};},http:async(url,init)=>{
    if(url.endsWith('/capabilities'))return Response.json({missions:{supported:true}});if(url.endsWith('/cancel'))return Response.json({cancelled:true});const body=JSON.parse(init.body);return Response.json({contract_version:'1.0',id:'engine-mission-1234',client_run_id:body.client_run_id,kind:body.kind,target_url:body.target_url,scope:body.scope,state:'running',outcome:null,stages:[],findings:[],metrics:{},artifacts:[],limitations:[],decision_request:{sequence:1,url:input.target_url,title:'Page',text:'Observed',elements:[]}});
  }});
  run=await f.service.createRun({...input,execution_mode:'agent'},user);f.rows.get(run.id).metadata.model_usage.calls=f.rows.get(run.id).metadata.model_usage.max_calls;
  await f.service.processQueuedRuns();const failed=await f.service.getRun(run.id,user);assert.equal(failed.error.code,'QUALITY_AGENT_MODEL_BUDGET');assert.equal(called,0);
});

test('cancellation during final model assessment keeps observed evidence and discards its late result',async()=>{
  let f,run;f=fixture({resolveMissionModel:async()=>({}),assessQualityRun:async(request,actor,engine,trace)=>{
    assert.equal(trace.signal.aborted,false);assert.equal((await f.service.getRun(run.id,user)).metrics.pages_visited,1);
    await f.service.cancelRun(run.id,user);assert.equal(trace.signal.aborted,true);
    return {title:'Late assessment',summary:'Must not publish after cancellation.'};
  }});
  run=await f.service.createRun({...input,execution_mode:'agent',goal:'Observe the selected page',reviewed_plan:{reviewed:true,steps:[{action:'assert_url',url:input.target_url}]}},user);
  await f.service.processQueuedRuns();const stopped=await f.service.getRun(run.id,user);
  assert.equal(stopped.status,'cancelled');assert.equal(stopped.agent_assessment,null);assert.equal(stopped.metrics.pages_visited,1);
});

test('an impossible one-call mission budget is rejected before model work or durable run creation',async()=>{
  let modelChecks=0;const f=fixture({resolveMissionModel:async()=>{modelChecks++;return {};}});
  const configured={...input,execution_mode:'agent',ai_configuration:{agent_execution:{max_model_calls:1,max_revision_rounds:0,max_followups:0,timeout_ms:20000}}};
  await assert.rejects(f.service.createRun(configured,user),error=>error.code==='QUALITY_AGENT_MODEL_BUDGET');assert.equal(modelChecks,0);assert.equal(f.rows.size,0);
  const reviewed=await f.service.createRun({...configured,goal:'Review the selected page',reviewed_plan:{reviewed:true,steps:[{action:'assert_url',url:input.target_url}]}},user);
  assert.equal(reviewed.model_usage.max_calls,1);assert.equal(modelChecks,1);
});

test('checks-only mode rejects mission settings before model selection or run creation',async()=>{
  let modelChecks=0;const f=fixture({resolveMissionModel:async()=>{modelChecks++;return {};}});
  await assert.rejects(f.service.createRun({...input,execution_mode:'checks',options:{mission:{max_actions:3,allow_form_submission:false}}},user),/require AI agent mode/);
  assert.equal(modelChecks,0);assert.equal(f.rows.size,0);assert.equal(f.calls.length,0);
});

test('saved agent timeout includes queue time and prevents expired browser/model dispatch',async()=>{
  let modelCalls=0,starts=0;const f=fixture({resolveMissionModel:async()=>({}),decideMission:async()=>{modelCalls++;return {action:'blocked',summary:'Must not execute.'};},http:async(url)=>{
    if(url.endsWith('/capabilities'))return Response.json({missions:{supported:true}});if(url.endsWith('/cancel'))return Response.json({cancelled:true});starts++;throw new Error('Expired runs must not start a browser.');
  }});
  const run=await f.service.createRun({...input,execution_mode:'agent',ai_configuration:{agent_execution:{max_model_calls:3,max_revision_rounds:0,max_followups:0,timeout_ms:10000}}},user),row=f.rows.get(run.id);
  row.metadata.queued_at=new Date(Date.now()-11000).toISOString();row.metadata.findings=[{id:'retained-before-timeout'}];
  await f.service.processQueuedRuns();const failed=await f.service.getRun(run.id,user);
  assert.equal(failed.status,'failed');assert.equal(failed.error.code,'QUALITY_AGENT_DEADLINE');assert.equal(modelCalls,0);assert.equal(starts,0);assert.deepEqual(failed.findings,[{id:'retained-before-timeout'}]);
});

test('the saved run deadline aborts a pending model turn and blocks a late paid admission',async()=>{
  let f,run,admissions=0,actions=0,sawDeadline=false;
  f=fixture({resolveMissionModel:async()=>({}),decideMission:async(request,actor,observed,history,trace)=>{
    assert.ok(Date.parse(trace.deadline_at)-Date.now()<=2500);
    await new Promise((resolve,reject)=>{const safety=setTimeout(()=>reject(new Error('The model deadline did not abort.')),6000);trace.signal.addEventListener('abort',()=>{clearTimeout(safety);resolve();},{once:true});});
    sawDeadline=trace.signal.reason?.code==='QUALITY_AGENT_DEADLINE';
    await trace.beforeDispatch({payload:{max_tokens:100},call_id:'late-admission',phase:'decision'});admissions++;return {action:'blocked',summary:'Too late.'};
  },http:async(url)=>{
    if(url.endsWith('/capabilities'))return Response.json({missions:{supported:true}});if(url.endsWith('/cancel'))return Response.json({cancelled:true});if(url.endsWith('/decision')){actions++;return Response.json({accepted:true});}
    return Response.json({contract_version:'1.0',id:'engine-mission-1234',client_run_id:run.id,kind:'web',target_url:input.target_url,scope:{project_id:'project-a',app_type_id:null},state:'running',outcome:null,stages:[],findings:[],metrics:{},artifacts:[],limitations:[],decision_request:{sequence:1,url:input.target_url,title:'Page',text:'Observed',elements:[]}});
  }});
  run=await f.service.createRun({...input,execution_mode:'agent',ai_configuration:{agent_execution:{max_model_calls:3,max_revision_rounds:0,max_followups:0,timeout_ms:10000}}},user);
  const row=f.rows.get(run.id);row.metadata.engine_run_id='engine-mission-1234';row.metadata.queued_at=new Date(Date.now()-7500).toISOString();
  await f.service.processQueuedRuns();const failed=await f.service.getRun(run.id,user);
  assert.equal(sawDeadline,true);assert.equal(failed.error.code,'QUALITY_AGENT_DEADLINE');assert.equal(admissions,0);assert.equal(actions,0);assert.equal(failed.model_usage.calls,0);
});
