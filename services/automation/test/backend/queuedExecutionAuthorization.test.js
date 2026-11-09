const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('@hellotest/platform/backend/src/db');
const obs = require('@hellotest/platform/backend/src/obsDb');
const dispatch = require('../../backend/services/testEngineDispatch.service');
const results = require('@hellotest/testing/backend/services/executionResult.service');
const telemetry = require('@hellotest/trace/backend/services/opsTelemetry.service');
const api = require('../../backend/services/apiRequestExecution.service');
test.after(() => Promise.all([db.close(), obs.close()]));

function fixture(t) {
  const job = {id:'job',execution_id:'run',test_case_id:'case',status:'running',leased_by:'worker',
    lease_expires_at:new Date(Date.now()+60_000).toISOString(),payload:{steps:[{id:'step',step_type:'web'}]},runtime_state:{logs:{stepStatuses:{step:'passed'}}}};
  const writes=[], resultWrites=[];
  let parent = {status:'running'};
  t.mock.method(obs.pool,'query',async()=>{throw new Error('Job authorization must use its locked transaction.');});
  t.mock.method(obs.pool,'connect',async()=>({release(){},async query(input,params){
    const text=typeof input==='string'?input:input.text,values=typeof input==='string'?params:input.values;
    if(['BEGIN','COMMIT','ROLLBACK'].includes(text))return{rows:[]};
    if(/SELECT id FROM test_engine_jobs.*FOR UPDATE/.test(text))return{rows:[{id:job.id}]};
    if(/FROM test_engine_jobs jobs/.test(text))return{rows:[structuredClone(job)]};
    if(/UPDATE test_engine_jobs/.test(text)){
      writes.push({text,values});
      if(/SET status = 'aborted'/.test(text)){job.status='aborted';job.completed_at=new Date().toISOString();}
      else if(/SET lease_expires_at/.test(text))job.lease_expires_at=values[0];
      else if(/runtime_state =/.test(text)){job.status=values[0];job.runtime_state=typeof values[1]==='string'?JSON.parse(values[1]):values[1];job.lease_expires_at=values[2];}
      else if(/SET status =/.test(text))[job.status,job.leased_by,job.lease_expires_at,job.started_at]=values;
      else throw new Error(text);
      return{rows:[],rowCount:1};
    }
    throw new Error(text);
  }}));
  t.mock.method(db.pool,'query',async input=>{
    const text=typeof input==='string'?input:input.text;
    assert.match(text,/SELECT status, ended_at FROM executions/);
    return{rows:parent?[parent]:[]};
  });
  t.mock.method(results,'upsertExecutionResult',async input=>{resultWrites.push(input);return{id:'result'};});
  t.mock.method(results,'findLatestExecutionResult',async()=>null);
  t.mock.method(telemetry,'emitExecutionHierarchyEvents',async()=>{});
  return{job,writes,resultWrites,setParent:value=>{parent=value;}};
}

test('heartbeat renews only the running lease owner and returns no executable payload or result writes',async t=>{
  const f=fixture(t),original=f.job.lease_expires_at;
  const receipt=await dispatch.heartbeatQueuedJob({job_id:'job',worker_id:'worker'});
  assert.equal(receipt.authorized,true);assert.equal(receipt.status,'running');
  assert.ok(Date.parse(receipt.lease_expires_at)>Date.parse(original));
  assert.deepEqual(Object.keys(receipt).sort(),['authorized','job_id','lease_expires_at','status']);
  assert.equal(f.resultWrites.length,0);assert.equal(f.writes.length,1);
  for(const worker_id of [undefined,'','other-worker']){
    const denied=await dispatch.heartbeatQueuedJob({job_id:'job',worker_id});
    assert.equal(denied.authorized,false);assert.equal(denied.code,'TESTENGINE_JOB_LEASE_LOST');
  }
  assert.equal(f.writes.length,1,'A stale worker cannot extend another worker’s authority.');
});

test('expired leases and finished jobs cannot be revived by heartbeat or late start',async t=>{
  const f=fixture(t);f.job.lease_expires_at=new Date(Date.now()-1).toISOString();
  assert.equal((await dispatch.heartbeatQueuedJob({job_id:'job',worker_id:'worker'})).code,'TESTENGINE_JOB_LEASE_EXPIRED');
  await assert.rejects(dispatch.startQueuedJob({job_id:'job',worker_id:'worker'}),{code:'TESTENGINE_JOB_LEASE_EXPIRED',statusCode:409});
  f.job.status='completed';
  assert.deepEqual(await dispatch.heartbeatQueuedJob({job_id:'job',worker_id:'worker'}),{job_id:'job',status:'completed',authorized:false,code:'TESTENGINE_JOB_FINISHED'});
  assert.equal(f.writes.length,0);assert.equal(f.resultWrites.length,0);
});

test('parent cancellation commits a terminal job control receipt without creating another result',async t=>{
  const f=fixture(t);f.setParent({status:'aborted',ended_at:new Date().toISOString()});
  const receipt=await dispatch.heartbeatQueuedJob({job_id:'job',worker_id:'worker'});
  assert.deepEqual(receipt,{job_id:'job',status:'aborted',authorized:false,code:'PARENT_RUN_NOT_RUNNING'});
  assert.equal(f.job.status,'aborted');assert.equal(f.writes.length,1);assert.equal(f.resultWrites.length,0);
  assert.equal((await dispatch.heartbeatQueuedJob({job_id:'job',worker_id:'worker'})).code,'TESTENGINE_JOB_FINISHED');
  assert.equal(f.writes.length,1);
});

test('start requires the unexpired lease owner and heartbeat does not authorize a merely leased job',async t=>{
  const f=fixture(t);f.job.status='leased';
  for(const worker_id of [undefined,'other-worker'])await assert.rejects(dispatch.startQueuedJob({job_id:'job',worker_id}),{code:'TESTENGINE_JOB_LEASE_LOST',statusCode:409});
  assert.equal((await dispatch.heartbeatQueuedJob({job_id:'job',worker_id:'worker'})).code,'TESTENGINE_JOB_NOT_STARTED');
  assert.equal(f.writes.length,0);assert.equal(f.resultWrites.length,0);
  assert.equal((await dispatch.startQueuedJob({job_id:'job',worker_id:'worker'})).status,'running');
  assert.equal(f.resultWrites.length,1);assert.equal((await dispatch.heartbeatQueuedJob({job_id:'job',worker_id:'worker'})).authorized,true);
});

test('owner-bound step and completion callbacks reject a reassigned or expired worker before writing results',async t=>{
  const f=fixture(t);
  for(const worker_id of ['old-worker','']){
    await assert.rejects(dispatch.reportQueuedStep({job_id:'job',worker_id,step_id:'step',status:'passed'}),{code:'TESTENGINE_JOB_LEASE_LOST',statusCode:409});
    await assert.rejects(dispatch.completeQueuedJob({job_id:'job',worker_id,status:'passed'}),{code:'TESTENGINE_JOB_LEASE_LOST',statusCode:409});
  }
  f.job.lease_expires_at=new Date(Date.now()-1).toISOString();
  await assert.rejects(dispatch.completeQueuedJob({job_id:'job',worker_id:'worker',status:'passed'}),{code:'TESTENGINE_JOB_LEASE_EXPIRED',statusCode:409});
  assert.equal(f.writes.length,0);assert.equal(f.resultWrites.length,0);
});

test('cancelled parents reject owner-bound callbacks while persisting the cancellation',async t=>{
  const f=fixture(t);f.setParent({status:'aborted'});
  assert.equal((await dispatch.reportQueuedStep({job_id:'job',worker_id:'worker',step_id:'step',status:'passed'})).case_status,'aborted');
  assert.equal(f.job.status,'aborted');assert.equal(f.resultWrites.length,0);
});

test('legacy API dispatch rejects expired, foreign and never-started leases before application requests',async t=>{
  const f=fixture(t);let calls=0;
  t.mock.method(api,'executeApiRequestStep',async()=>{calls++;throw Error('Unauthorized application request');});
  await assert.rejects(dispatch.executeQueuedApiStep({job_id:'job',step_id:'step',worker_id:'foreign'}),{code:'TESTENGINE_JOB_LEASE_LOST',statusCode:409});
  f.job.lease_expires_at=new Date(Date.now()-1).toISOString();
  await assert.rejects(dispatch.executeQueuedApiStep({job_id:'job',step_id:'step'}),{code:'TESTENGINE_JOB_LEASE_EXPIRED',statusCode:409});
  f.job.status='leased';
  await assert.rejects(dispatch.executeQueuedApiStep({job_id:'job',step_id:'step'}),{code:'TESTENGINE_JOB_NOT_STARTED',statusCode:409});
  f.job.status='running';f.job.lease_expires_at=new Date(Date.now()+60_000).toISOString();f.job.leased_by=null;
  await assert.rejects(dispatch.executeQueuedApiStep({job_id:'job',step_id:'step'}),{code:'TESTENGINE_JOB_LEASE_LOST',statusCode:409});
  assert.equal(calls,0);assert.equal(f.writes.length,0);assert.equal(f.resultWrites.length,0);
});

test('legacy API dispatch commits parent cancellation without application requests or new results',async t=>{
  const f=fixture(t);f.setParent({status:'aborted'});let calls=0;
  t.mock.method(api,'executeApiRequestStep',async()=>{calls++;throw Error('Cancelled application request');});
  const receipt=await dispatch.executeQueuedApiStep({job_id:'job',step_id:'step'});
  assert.equal(receipt.code,'PARENT_RUN_NOT_RUNNING');assert.equal(receipt.case_status,'aborted');
  assert.equal(f.job.status,'aborted');assert.equal(calls,0);assert.equal(f.resultWrites.length,0);
});

test('legacy API dispatch cannot replay any already reported section outcome',async t=>{
  const f=fixture(t);let calls=0;
  t.mock.method(api,'executeApiRequestStep',async()=>{calls++;throw Error('Duplicate application request');});
  for(const status of ['passed','failed','blocked','skipped']){
    f.job.runtime_state.logs.stepStatuses.step=status;
    await assert.rejects(dispatch.executeQueuedApiStep({job_id:'job',step_id:'step'}),{code:'TESTENGINE_STEP_ALREADY_REPORTED',statusCode:409});
  }
  assert.equal(calls,0);assert.equal(f.resultWrites.length,0);
});

test('a legacy API client without an explicit worker can execute its current active owner once',async t=>{
  const f=fixture(t);let calls=0;f.job.runtime_state.logs.stepStatuses={};
  f.job.payload.steps[0]={id:'step',step_type:'api',api_request:{method:'GET',url:'https://fixture.test/check'}};
  t.mock.method(api,'executeApiRequestStep',async()=>{calls++;return{status:'passed',note:'Fixture confirmed',captures:{'r.receipt':'saved'},detail:{assertions:[]},duration_ms:1};});
  const receipt=await dispatch.executeQueuedApiStep({job_id:'job',step_id:'step'});
  assert.equal(receipt.status,'passed');assert.equal(calls,1);assert.equal(f.resultWrites.length,1);
  await assert.rejects(dispatch.executeQueuedApiStep({job_id:'job',step_id:'step',worker_id:'worker'}),{code:'TESTENGINE_STEP_ALREADY_REPORTED',statusCode:409});
  assert.equal(calls,1);
});

test('internal heartbeat route authenticates and validates the worker before issuing a control receipt',async t=>{
  const routes=new Map();let authenticated=0,called=0;
  t.mock.method(dispatch,'heartbeatQueuedJob',async input=>{called++;assert.deepEqual(input,{job_id:'job',worker_id:'worker'});return{authorized:true,status:'running'};});
  await require('../../backend/routes/testEngineInternal.routes')({
    post:(path,...args)=>routes.set(path,args.at(-1)),get(){},
    authenticateTestEngine:async req=>{authenticated++;if(!req.trusted)throw Object.assign(new Error('Denied'),{statusCode:401});},
    validate:(schema,body)=>{assert.equal(schema.worker_id.required,true);if(typeof body.worker_id!=='string')throw Object.assign(new Error('Worker required'),{statusCode:400});}
  });
  const handler=routes.get('/testengine/internal/jobs/:id/heartbeat');
  await assert.rejects(handler({params:{id:'job'},body:{worker_id:'worker'}}),{statusCode:401});
  await assert.rejects(handler({trusted:true,params:{id:'job'},body:{}}),{statusCode:400});
  assert.deepEqual(await handler({trusted:true,params:{id:'job'},body:{worker_id:'worker'}}),{authorized:true,status:'running'});
  assert.equal(authenticated,3);assert.equal(called,1);
});
