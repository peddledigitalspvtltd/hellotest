import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
process.env.HELLOTEST_API_BASE_URL='http://control.test';process.env.TESTENGINE_SHARED_SECRET='queue-control-test-secret';process.env.NODE_ENV='development';
const {executeQueuedJob}=await import('../dist/lib/queueWorker.js');
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const logger={info(){},error(){}};
const api=(id,path)=>({id,order:id==='first'?1:2,step_type:'api',api_request:{method:'POST',url:'http://target.test/'+path}});
function job(id){return{id,test_case_id:'case',test_case_title:'Controlled case',runtime_state:{},payload:{engine_run_id:id,hellotest_test_case_id:'case',run_timeout_seconds:30,artifact_policy:{video_mode:'off'},steps:[api('first','first'),api('second','second')],hooks:[{id:'cleanup',name:'Cleanup',scope:'test',phase:'post',steps:[api('cleanup','cleanup')]}]}};}

test('cancellation after a completed action fences the next action and teardown',async t=>{
 const actions=[],reports=[],completions=[];let cancelled=false;
 t.mock.method(globalThis,'fetch',async(input,init={})=>{
  const url=new URL(String(input)),body=init.body?JSON.parse(init.body):{};
  if(url.hostname==='target.test'){actions.push(url.pathname);cancelled=true;return json({ok:true});}
  if(url.pathname.endsWith('/heartbeat'))return json({job_id:'cancel-between',status:cancelled?'aborted':'running',authorized:!cancelled});
  if(url.pathname.endsWith('/report')){reports.push(body);assert.equal(body.worker_id,'owner');return json({status:body.status,case_status:'running',captures:{}});}
  if(url.pathname.endsWith('/complete'))completions.push(body);
  return json({status:'running'});
 });
 await executeQueuedJob(job('cancel-between'),'owner',logger);
 assert.deepEqual(actions,['/first']);assert.equal(reports.length,1);assert.deepEqual(completions,[]);
});

test('periodic control aborts an active HTTP action and does not run another mutation',async t=>{
 const actions=[];let active=false,aborted=false;
 const actualFetch=globalThis.fetch;let requestClosed;
 const closed=new Promise(resolve=>requestClosed=resolve);
 const server=createServer((req,res)=>{active=true;req.on('close',()=>{aborted=true;requestClosed();});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>{server.closeAllConnections();server.close();});
 const base='http://127.0.0.1:'+server.address().port;
 t.mock.method(globalThis,'fetch',async(input,init={})=>{
  const url=new URL(String(input));
  if(url.hostname==='target.test'){
   actions.push(url.pathname);
   return actualFetch(base+url.pathname,init);
  }
  if(url.pathname.endsWith('/heartbeat'))return json({job_id:'cancel-active',status:active?'aborted':'running',authorized:!active});
  if(url.pathname.endsWith('/complete')||url.pathname.endsWith('/report'))throw new Error('Revoked work must not publish another completion.');
  return json({status:'running'});
 });
 await executeQueuedJob(job('cancel-active'),'owner',logger,undefined,{controlIntervalMs:10});
 await closed;
 assert.equal(aborted,true);assert.deepEqual(actions,['/first']);
});

test('a failed report is resolved before the next application side effect',async t=>{
 const actions=[];let failed=false;
 t.mock.method(globalThis,'fetch',async(input,init={})=>{
  const url=new URL(String(input));
  if(url.hostname==='target.test'){actions.push(url.pathname);return json({ok:true});}
  if(url.pathname.endsWith('/heartbeat'))return json({job_id:'report-rejected',status:failed?'aborted':'running',authorized:!failed});
  if(url.pathname.endsWith('/report')){failed=true;return new Response('{}',{status:409});}
  return json({status:'running'});
 });
 await executeQueuedJob(job('report-rejected'),'owner',logger);
 assert.deepEqual(actions,['/first']);
});

test('an unacknowledged failed action cannot dispatch a cleanup mutation',async t=>{
 const actions=[];const current=job('failed-report-cleanup');
 t.mock.method(globalThis,'fetch',async(input)=>{
  const url=new URL(String(input));
  if(url.hostname==='target.test'){actions.push(url.pathname);return new Response('{}',{status:500});}
  if(url.pathname.endsWith('/heartbeat'))return json({job_id:current.id,status:'running',authorized:true});
  if(url.pathname.endsWith('/report'))return new Response('{}',{status:503});
  return json({status:'running'});
 });
 await executeQueuedJob(current,'owner',logger);
 assert.deepEqual(actions,['/first'],'even teardown must wait for a durable step acknowledgement');
});

test('a fully reported attempt never repeats post hooks on a completion-only receipt',async t=>{
 const actions=[];const current=job('already-complete');current.runtime_state={logs:{stepStatuses:{first:'passed',second:'passed'}}};
 t.mock.method(globalThis,'fetch',async(input,init={})=>{
  const url=new URL(String(input));
  if(url.hostname==='target.test'){actions.push(url.pathname);return json({ok:true});}
  if(url.pathname.endsWith('/heartbeat'))return json({job_id:current.id,status:'running',authorized:true});
  if(url.pathname.endsWith('/complete'))return json({job_id:current.id,status:'passed'});
  return json({status:'running'});
 });
 await executeQueuedJob(current,'owner',logger);assert.deepEqual(actions,[]);
});

test('a cancellation receipt racing final completion cannot become a local pass',async t=>{
 const {getRun}=await import('../dist/lib/runStore.js');
 const current=job('cancel-at-completion');current.payload.hooks=[];
 t.mock.method(globalThis,'fetch',async(input,init={})=>{
  const url=new URL(String(input)),body=init.body?JSON.parse(init.body):{};
  if(url.hostname==='target.test')return json({ok:true});
  if(url.pathname.endsWith('/heartbeat'))return json({job_id:current.id,status:'running',authorized:true});
  if(url.pathname.endsWith('/report'))return json({status:body.status,case_status:'running',captures:{}});
  if(url.pathname.endsWith('/complete'))return json({job_id:current.id,status:'aborted',code:'PARENT_RUN_NOT_RUNNING'});
  return json({status:'running'});
 });
 await executeQueuedJob(current,'owner',logger);
 assert.equal(getRun(current.id)?.state,'failed');
 assert.match(getRun(current.id)?.summary||'',/did not accept the requested completion/);
});
