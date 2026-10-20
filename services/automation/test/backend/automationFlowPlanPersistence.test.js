const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {normalizeFlowPlan}=require('../../backend/lib/automationFlowPlanning');

const baseline={id:'automation',automated:'yes',app_type_id:'app',app_type_kind:'web',project_id:'project',revision:4,
 automation_start_url:'https://selected.example/',automation_status:'ready'};
const flow=[{action:'Enter @t.email',expected_result:'The supplied email appears',step_type:'web',id:'model-id',step_order:99},
 {action:'Continue',expected_result:'Review displays @t.email',step_type:'web'}];

function fixture(){
 let state={current:structuredClone(baseline),steps:[]},active=false,sourceChecked=false;
 const events=[],created=[],settings={allowed:true,lease:true,source:async()=>{},afterCreate:async()=>{},statusFailure:false,commitFailure:false};
 const leaseError=()=>Object.assign(new Error('Worker lease lost'),{code:'BATCH_JOB_LEASE_LOST',nonRetryable:true});
 const ensureOwnership=async()=>{events.push('lease');if(!settings.lease)throw leaseError();};
 const db={transaction:callback=>async()=>{
  assert.equal(active,false);const before=structuredClone(state);active=true;events.push('begin');
  try{const result=await callback();if(settings.commitFailure)throw Object.assign(new Error('Commit rejected'),{code:'40001'});events.push('commit');return result;}
  catch(error){state=before;events.push('rollback');throw error;}finally{active=false;}
 },prepare:sql=>({
  get:async id=>{assert.equal(active,true);assert.equal(id,'automation');assert.match(sql,/FOR UPDATE OF tc FOR SHARE OF app/);events.push('lock-case');return state.current&&structuredClone(state.current);},
  all:async id=>{assert.equal(active,true);assert.equal(id,'automation');if(sql.includes('SELECT id ')){assert.match(sql,/FOR UPDATE/);events.push('lock-steps');return state.steps.map(({id})=>({id}));}events.push('read-saved');return structuredClone(state.steps);},
  run:async id=>{assert.equal(active,true);assert.equal(id,'automation');assert.match(sql,/automation_status='incomplete'/);events.push('status');state.current.automation_status='incomplete';if(settings.statusFailure)throw new Error('Status update rejected');}
 })};
 const testSteps={createTestSteps:async input=>{
  assert.equal(active,true);assert.equal(sourceChecked,true,'Source guards must run after locks and before draft writes.');
  events.push('create');created.push(structuredClone(input));
  state.steps.push(...input.steps.map((row,index)=>({...row,id:`saved-${index+1}`,test_case_id:input.test_case_id})));
  await settings.afterCreate();
 }};
 const module={exports:{}};
 new Function('require','module',fs.readFileSync(require.resolve('../../backend/services/automationFlowPlan.service'),'utf8'))(id=>{
  if(id.endsWith('/db'))return db;
  if(id.endsWith('optionalEvidenceAccess.service'))return{getOptionalEvidenceAccess:async(user,project,permissions)=>{assert.equal(active,true);assert.equal(user.id,'author');assert.equal(project,'project');events.push('access');return Object.fromEntries(permissions.map(code=>[code,settings.allowed===true||settings.allowed?.[code]===true]));}};
  if(id.endsWith('testStep.service'))return testSteps;
  if(id.endsWith('automationFlowPlanning'))return{normalizeFlowPlan};
  throw new Error(`Unexpected fixture dependency ${id}`);
 },module);
 return {...module.exports,settings,events,created,get state(){return state;},save:(overrides={})=>module.exports.saveFlowPlan({testCase:structuredClone(baseline),steps:flow,userId:'author',executionGuard:{ensureOwnership},assertSources:async()=>{assert.equal(active,true);assert.ok(events.includes('lock-case')&&events.includes('lock-steps'));events.push('sources');sourceChecked=true;await settings.source();},...overrides})};
}

test('flow persistence locks the reviewed empty case and atomically stores ordered manual drafts without executable payloads',async()=>{
 const f=fixture(),before=JSON.stringify(flow),saved=await f.save();
 assert.deepEqual(saved.map(row=>[row.id,row.step_order,row.action]),[['saved-1',1,'Enter @t.email'],['saved-2',2,'Continue']]);
 assert.equal(f.state.current.automation_status,'incomplete');
 assert.equal(f.created.length,1);assert.equal(f.created[0].test_case_id,'automation');assert.equal(f.created[0].insertion_index,0);
 assert.ok(f.created[0].steps.every(row=>!Object.hasOwn(row,'id')&&!Object.hasOwn(row,'automation_code')&&!Object.hasOwn(row,'api_request')));
 assert.ok(f.events.indexOf('sources')>f.events.indexOf('lock-steps'));assert.ok(f.events.indexOf('create')>f.events.indexOf('sources'));
 assert.equal(f.events.at(-1),'commit');assert.equal(JSON.stringify(flow),before);
});

test('changed identity, application, revision, URL or new user-authored steps abort before any draft insert',async()=>{
 const mutations=[f=>{f.state.current=null;},f=>{f.state.current.automated='no';},f=>{f.state.current.app_type_id='different';},
  f=>{f.state.current.project_id='different';},f=>{f.state.current.revision++;},f=>{f.state.current.automation_start_url='https://different.example/';},
  f=>{f.state.steps.push({id:'user-step',action:'User edit'});}];
 for(const mutate of mutations){const f=fixture();mutate(f);const before=JSON.stringify(f.state);
  await assert.rejects(f.save(),error=>error.code==='AUTOMATION_FLOW_BASELINE_CHANGED'&&error.statusCode===409&&error.nonRetryable===true);
  assert.equal(f.created.length,0);assert.equal(JSON.stringify(f.state),before);assert.equal(f.events.at(-1),'rollback');
 }
});

test('revoked build, AI or case-update permission and a lost initial lease never reach draft writes',async()=>{
 for(const denied of ['automation.ai','automation.build','testcase.update']){
  const f=fixture();f.settings.allowed=Object.fromEntries(['automation.ai','automation.build','testcase.update'].map(code=>[code,code!==denied]));
  await assert.rejects(f.save(),error=>error.statusCode===403);assert.equal(f.created.length,0);assert.equal(f.state.steps.length,0);
 }
 const f=fixture();f.settings.lease=false;await assert.rejects(f.save(),error=>error.code==='BATCH_JOB_LEASE_LOST');assert.equal(f.created.length,0);
});

test('locked link/parameter baseline conflicts and source authorization/cancellation errors retain their exact failure',async()=>{
 for(const error of [Object.assign(new Error('Linked case or parameters changed'),{code:'AUTOMATION_FLOW_BASELINE_CHANGED',statusCode:409}),
  Object.assign(new Error('Context revoked'),{statusCode:403}),Object.assign(new Error('Cancelled'),{name:'AbortError'})]){
  const f=fixture();f.settings.source=async()=>{throw error;};
  await assert.rejects(f.save(),value=>value===error);assert.equal(f.created.length,0);assert.equal(f.state.steps.length,0);assert.equal(f.events.at(-1),'rollback');
 }
});

test('partial domain writes, status failure and rejected commit roll back the whole draft flow',async()=>{
 for(const stage of ['create','status','commit']){
  const f=fixture();if(stage==='create')f.settings.afterCreate=async()=>{throw new Error('Second insert rejected');};
  if(stage==='status')f.settings.statusFailure=true;if(stage==='commit')f.settings.commitFailure=true;
  await assert.rejects(f.save());assert.equal(f.state.steps.length,0);assert.equal(f.state.current.automation_status,'ready');assert.equal(f.events.at(-1),'rollback');
 }
});

test('invalid executable or incomplete proposals are rejected before opening a persistence transaction',async()=>{
 for(const steps of [[],[{...flow[0],automation_code:'await page.click("#submit");'}],[{action:'Continue'}]]){
  const f=fixture();await assert.rejects(f.save({steps}),error=>error.code==='AUTOMATION_FLOW_PLAN_INVALID');assert.deepEqual(f.events,[]);assert.equal(f.created.length,0);
 }
});

test('lease or permission lost while source checks wait aborts before mutation',async()=>{
 const lease=fixture();lease.settings.source=async()=>{lease.settings.lease=false;};
 await assert.rejects(lease.save(),error=>error.code==='BATCH_JOB_LEASE_LOST');assert.equal(lease.created.length,0);
 const access=fixture();access.settings.source=async()=>{access.settings.allowed=false;};
 await assert.rejects(access.save(),error=>error.statusCode===403);assert.equal(access.created.length,0);
});

test('a lease lost during domain insertion rolls back draft rows before returning success',async()=>{
 const f=fixture();f.settings.afterCreate=async()=>{f.settings.lease=false;};
 await assert.rejects(f.save(),error=>error.code==='BATCH_JOB_LEASE_LOST');assert.equal(f.state.steps.length,0);assert.equal(f.state.current.automation_status,'ready');
});

test('permission revoked during domain insertion also rolls back every manual draft and its status update',async()=>{
 const f=fixture();f.settings.afterCreate=async()=>{f.settings.allowed=false;};
 await assert.rejects(f.save(),error=>error.statusCode===403);assert.equal(f.state.steps.length,0);assert.equal(f.state.current.automation_status,'ready');
 assert.equal(f.events.at(-1),'rollback');
});

test('mobile flow steps in a unified application require current mobile management permission',async()=>{
 const mobile=[{action:'Open the account screen',expected_result:'Account screen appears',step_type:'android'}];
 const denied=fixture();denied.settings.allowed={'automation.ai':true,'automation.build':true,'testcase.update':true,'mobile.manage':false};
 await assert.rejects(denied.save({testCase:{...baseline,app_type_kind:'unified'},steps:mobile}),error=>error.statusCode===403);
 assert.equal(denied.created.length,0);
 const allowed=fixture();const result=await allowed.save({testCase:{...baseline,app_type_kind:'unified'},steps:mobile});
 assert.equal(result[0].step_type,'android');assert.equal(result[0].automation_code,undefined);
 const web=fixture();await assert.rejects(web.save({steps:mobile}),error=>error.code==='AUTOMATION_FLOW_PLAN_INVALID');assert.deepEqual(web.events,[]);
});
