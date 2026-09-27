import test from 'node:test';
import assert from 'node:assert/strict';
process.env.HELLOTEST_API_BASE_URL = 'http://control.test';
process.env.TESTENGINE_SHARED_SECRET = 'hellotest-testengine-dev-secret';
process.env.MOBILE_ENGINE_URL = 'http://mobile.test';
process.env.MOBILE_ENGINE_SHARED_SECRET = 'hellotest-mobile-engine-dev-secret';
process.env.NODE_ENV = 'development';
const { executeQueuedJob } = await import('../dist/lib/queueWorker.js');
const json = (data) => new Response(JSON.stringify(data), {headers:{'content-type':'application/json'}});
for (const failCase of [false,true]) test(`queued setup/case/cleanup keeps iOS session and reports evidence (${failCase?'failure':'success'})`,async(t)=>{
 const order=[], reports=[], keys=[];let completion;
 t.mock.method(globalThis,'fetch',async(input,options={})=>{
   const url = new URL(String(input)), body=options.body ? JSON.parse(options.body) : {};
   if(url.hostname==='mobile.test') {
     if(options.method==='DELETE'){order.push('close');return json({});}
     keys.push(body.execution_session_key);assert.equal(body.platform_name,'ios');
     const step=body.steps[0];order.push(step.id.split(':').at(-1));
     return json({status:failCase && step.id==='case-step'?'failed':'passed',results:body.steps.map(s=>({step_id:s.id,status:failCase && s.id==='case-step'?'failed':'passed',note:'native result',evidence:{dataUrl:'data:image/png;base64,cG5n'},captures:{'r.receipt':'created'}}))});
   }
   if(url.hostname==='app.test'){order.push(url.pathname);assert.equal(url.pathname,'/verify/created');return json({ok:true});}
   if(url.pathname.endsWith('/report'))reports.push({path:url.pathname,...body});
   if(url.pathname.endsWith('/complete'))completion=body;
   return json({status:'running',captures:body.captures||{}});
 });
 const mobile=(id)=>({id,order:1,step_type:'ios',automation_code:'await ios.tap("~save");'});
 const job={id:'hook-job-'+failCase,test_case_id:'case',test_case_title:'Native checkout',runtime_state:{},payload:{engine_run_id:'hooks-'+failCase,hellotest_test_case_id:'case',artifact_policy:{video_mode:'off'},steps:[mobile('case-step')],hooks:[
  {id:'setup',name:'Sign in',scope:'test',phase:'pre',steps:[mobile('before')]},
  {id:'cleanup',name:'Release account',scope:'test',phase:'post',fail_behavior:'fail-run',steps:[{id:'verify',order:1,step_type:'api',api_request:{url:'http://app.test/verify/@r.receipt'}},mobile('after')]}
 ]}};
 const errors=[];await executeQueuedJob(job,'worker',{info(){},error:(...args)=>errors.push(args)});
 assert.deepEqual(order,['before','case-step','/verify/created','after','close']);assert.equal(new Set(keys).size,1);
 assert.equal(completion.status,failCase?'failed':'passed');assert.equal(reports.length,4);
 assert.ok(reports[0].path.includes('/test:pre:setup:before/'));assert.match(reports[0].note,/Before test/);
 assert.equal(reports[1].evidence.dataUrl,'data:image/png;base64,cG5n');assert.deepEqual(errors,[]);
});
test('unpersisted evidence prevents a passing queue completion',async(t)=>{
 let completion;
 t.mock.method(globalThis,'fetch',async(input,options={})=>{
  const url=new URL(String(input)); if(url.hostname==='app.test')return json({ok:true});
  if(url.pathname.endsWith('/report'))return new Response('storage unavailable',{status:503});
  if(url.pathname.endsWith('/complete'))completion=JSON.parse(options.body);
  return json({status:'running'});
 });
 await executeQueuedJob({id:'report-failure',test_case_title:'API case',payload:{engine_run_id:'report-failure',hellotest_test_case_id:'case',artifact_policy:{video_mode:'off'},steps:[{id:'api',step_type:'api',order:1,api_request:{url:'http://app.test/check'}}]}},'worker',{info(){},error(){}});
 assert.notEqual(completion?.status,'passed');
});
