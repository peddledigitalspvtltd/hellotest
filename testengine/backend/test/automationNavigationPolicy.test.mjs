import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import {
 DEFAULT_AUTOMATION_NAVIGATION_TIMEOUT_MS,
 MIN_AUTOMATION_NAVIGATION_TIMEOUT_MS,
 MAX_AUTOMATION_NAVIGATION_TIMEOUT_MS,
 normalizeAutomationNavigationTimeoutMs,
 validAutomationNavigationTimeoutMs,
 nativeAutomationNavigationToolTimeoutMs
} from '../dist/lib/automationNavigationPolicy.js';

test('navigation policy source preserves Run integer parsing, fallback and bounds',()=>{
 assert.equal(DEFAULT_AUTOMATION_NAVIGATION_TIMEOUT_MS,30_000);
 assert.equal(MIN_AUTOMATION_NAVIGATION_TIMEOUT_MS,1000);
 assert.equal(MAX_AUTOMATION_NAVIGATION_TIMEOUT_MS,600_000);
 for(const value of [undefined,null,'', ' ',{},[],NaN,Infinity,'invalid'])assert.equal(normalizeAutomationNavigationTimeoutMs(value),30_000,String(value));
 for(const value of [0,-1,999,'999'])assert.equal(normalizeAutomationNavigationTimeoutMs(value),1000,String(value));
 for(const value of [600_001,900_000,'900000'])assert.equal(normalizeAutomationNavigationTimeoutMs(value),600_000,String(value));
 for(const value of [45_000,45_000.9,'45000',' 45000ms '])assert.equal(normalizeAutomationNavigationTimeoutMs(value),45_000,String(value));
 assert.equal(normalizeAutomationNavigationTimeoutMs('1500.9'),1500);
});

test('navigation policy source admits only frozen bounded wire integers',()=>{
 for(const value of [1000,45_000,600_000])assert.equal(validAutomationNavigationTimeoutMs(value),true);
 for(const value of [undefined,null,0,999,600_001,1000.5,'45000',true,NaN,Infinity,{}])assert.equal(validAutomationNavigationTimeoutMs(value),false,String(value));
});

test('navigation policy source adds a tool margin only to configured navigation',()=>{
 assert.equal(nativeAutomationNavigationToolTimeoutMs(),25_000);
 assert.equal(nativeAutomationNavigationToolTimeoutMs(1000),25_000);
 assert.equal(nativeAutomationNavigationToolTimeoutMs(30_000),35_000);
 assert.equal(nativeAutomationNavigationToolTimeoutMs(45_000),50_000);
 assert.equal(nativeAutomationNavigationToolTimeoutMs(600_000),605_000);
});

const endpoint='/api/v1/automation/mcp';
const rpc=(app,method,params={},session)=>app.inject({method:'POST',url:endpoint,headers:session?{'mcp-session-id':session}:{},
 payload:{jsonrpc:'2.0',id:1,method,params}});
const initialization=navigation=>({_meta:{hellotest:{start_url:'https://fixture.test/start',...(navigation===undefined?{}:{navigation_timeout_ms:navigation})}}});

test('MCP initialization echoes an explicit frozen navigation policy while omission preserves the legacy default',async t=>{
 const {registerAutomationMcp}=await import('../dist/lib/automationMcp.js');
 const app=Fastify();let launches=0;
 await registerAutomationMcp(app,async()=>{},{validateTarget:async()=>{},launchBrowser:async()=>{launches++;throw new Error('Policy negotiation cannot launch a browser');}});
 t.after(()=>app.close());
 for(const value of [undefined,1000,30_000,45_000,600_000]){
  const response=await rpc(app,'initialize',initialization(value)),body=response.json();
  assert.equal(response.statusCode,200);assert.ok(body.result,JSON.stringify(body));
  assert.equal(body.result._meta.hellotest.assertion_timeout_ms,10_000);
  assert.equal(body.result._meta.hellotest.navigation_timeout_ms,value);
  assert.equal(Object.hasOwn(body.result._meta.hellotest,'navigation_timeout_ms'),value!==undefined);
  await app.inject({method:'DELETE',url:endpoint,headers:{'mcp-session-id':response.headers['mcp-session-id']}});
 }
 assert.equal(launches,0);
});

test('MCP rejects malformed or unbounded navigation policy before validation or browser launch',async t=>{
 const {registerAutomationMcp}=await import('../dist/lib/automationMcp.js');
 const app=Fastify();let launches=0,validations=0;
 await registerAutomationMcp(app,async()=>{},{validateTarget:async()=>{validations++;},launchBrowser:async()=>{launches++;throw new Error('Invalid policy cannot launch a browser');}});
 t.after(()=>app.close());
 for(const value of [null,0,999,600_001,1000.5,'45000',true,{},[]]){
  const response=await rpc(app,'initialize',initialization(value));
  assert.equal(response.json().error?.code,-32602,JSON.stringify({value,body:response.json()}));
  assert.equal(response.headers['mcp-session-id'],undefined);
 }
 assert.equal(validations,0);assert.equal(launches,0);
});

test('native and CLI verification retain frozen navigation policy without extending the total request or changing source/data',async()=>{
 const {validateAutomationVerificationRequest}=await import('../dist/lib/automationVerification.js');
 const {compileRecordedProgram}=await import('../dist/lib/automationVerificationProgram.js');
 const operations=[{name:'browser_assert',arguments:{assertion:'visible',locator:'#ready'}}];
 const request={schema_version:1,verification_id:randomUUID(),lease_token:randomUUID(),start_url:'https://fixture.test/start',
  parameters:{'r.fixture':'unchanged'},sections:[{step_id:'ready',operations,automation_code:compileRecordedProgram(operations).source}],
  timeout_ms:60_000,replay_policy:{mode:'read_only'}};
 assert.equal(validateAutomationVerificationRequest(request).navigation_timeout_ms,undefined);
 for(const execution_driver of ['native','playwright_test_cli']){
  for(const navigation_timeout_ms of [1000,45_000,600_000]){
   const frozen={...request,execution_driver,navigation_timeout_ms};
   const validated=validateAutomationVerificationRequest(frozen);
   assert.deepEqual(validated,frozen);
   assert.equal(validated.timeout_ms,60_000);
   assert.deepEqual(validated.sections,request.sections);
   assert.deepEqual(validated.parameters,request.parameters);
  }
  for(const navigation_timeout_ms of [null,0,999,600_001,1000.5,'45000',true,{},[]]){
   assert.throws(()=>validateAutomationVerificationRequest({...request,execution_driver,navigation_timeout_ms}),{code:'AUTOMATION_VERIFICATION_CONTRACT_INVALID'});
  }
 }
});

test('the isolated verifier uses configured navigation for a recorded goto while preserving the15s absent-policy default',async t=>{
 const {runAutomationVerification}=await import('../dist/lib/automationVerification.js');
 const {compileRecordedProgram}=await import('../dist/lib/automationVerificationProgram.js');
 const directory=await mkdtemp(path.join(tmpdir(),'qaira-verifier-navigation-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 for(const configured of [undefined,1000,45_000]){
  const gotos=[];let defaultTimeout,currentUrl='https://fixture.test/start';
  const page={setDefaultTimeout(){},setDefaultNavigationTimeout:value=>{defaultTimeout=value;},url:()=>currentUrl,
   goto:async(url,options)=>{
    gotos.push({url,timeout:options?.timeout??defaultTimeout});
    if(gotos.length===2)throw new Error('Fixture stops after recording the actual recorded-navigation timeout');
    currentUrl=url;
   }};
  const context={route:async()=>{},newPage:async()=>page,on(){},tracing:{start:async()=>{},stop:async()=>{}}};
  const browser={newContext:async()=>context,close:async()=>{}};
  const operations=[{name:'browser_navigate',arguments:{url:'https://fixture.test/next'}},
   {name:'browser_assert',arguments:{assertion:'url',value:'https://fixture.test/next'}}];
  const request={schema_version:1,verification_id:randomUUID(),lease_token:randomUUID(),start_url:'https://fixture.test/start',parameters:{},
   sections:[{step_id:'next',operations,automation_code:compileRecordedProgram(operations).source}],timeout_ms:60_000,
   ...(configured===undefined?{}:{navigation_timeout_ms:configured}),replay_policy:{mode:'read_only'}};
  const before=structuredClone(request);
  const result=await runAutomationVerification(request,{artifactRoot:directory,validateTarget:async()=>{},
   createProxy:async()=>({server:'http://unused-fixture-proxy.test',close:async()=>{}}),launchBrowser:async()=>browser});
  assert.equal(result.status,'failed');assert.equal(result.failure.operation_kind,'browser_navigate');
  assert.equal(result.failure.operation_index,1);assert.equal(gotos.length,2);
  assert.ok(gotos[0].timeout>0&&gotos[0].timeout<=(configured??60_000));
  assert.equal(gotos[1].timeout,configured??15_000,'recorded navigation must not overwrite an explicit45s policy with15s');
  assert.equal(result.completed_interactions,0);assert.deepEqual(request,before);
 }
});

test('a later document route uses the frozen navigation timeout after the setup invocation deadline expires', {timeout:8000},async t=>{
 const {registerAutomationMcp}=await import('../dist/lib/automationMcp.js');
 const app=Fastify(),fetches=[],fulfilled=[];
 let routeHandler,routeInstalls=0,aborts=0,disposed=0,currentUrl='https://fixture.test/start',clockOffset=0;
 const realNow=Date.now.bind(Date);
 t.mock.method(Date,'now',()=>realNow()+clockOffset);
 const ready={loaded:true,loadState:'complete',usable:true,actionable:true,busy:false,signature:1};
 const page={isClosed:()=>false,url:()=>currentUrl,on(){},setDefaultTimeout(){},mainFrame:()=>page,evaluate:async()=>ready,
  goto:async url=>{
   const response={status:()=>200,headers:()=>({}),dispose:async()=>{disposed++;}};
   await routeHandler({request:()=>({url:()=>url,method:()=> 'GET',isNavigationRequest:()=>true,frame:()=>page}),
    fetch:async options=>{fetches.push(options);return response;},fulfill:async options=>{assert.equal(options.response,response);fulfilled.push(url);},
    abort:async()=>{aborts++;},continue:async()=>assert.fail('A document request must retain redirect inspection')});
   currentUrl=url;return response;
  }};
 const context={route:async(_pattern,handler)=>{routeInstalls++;routeHandler=handler;},newPage:async()=>page,on(){}};
 const browser={newContext:async()=>context,isConnected:()=>true,close:async()=>{}};
 await registerAutomationMcp(app,async()=>{},{toolTimeoutMs:2000,validateTarget:async()=>{},launchBrowser:async()=>browser,
  createProxy:async()=>({server:'http://unused-fixture-proxy.test',close:async()=>{}})});
 t.after(()=>app.close());
 const initialized=await rpc(app,'initialize',initialization(45_000)),session=initialized.headers['mcp-session-id'];
 assert.ok(session);
 for(const [index,url] of ['https://fixture.test/start','https://fixture.test/later'].entries()){
  if(index===1)clockOffset=60_000;
  const response=await rpc(app,'tools/call',{name:'browser_navigate',arguments:{url}},session),body=response.json();
  assert.notEqual(body.result?.isError,true,JSON.stringify(body));
  assert.equal(JSON.parse(body.result.content[0].text).action_outcome,'completed');
 }
 assert.equal(routeInstalls,1);assert.equal(aborts,0);assert.equal(disposed,2);
 assert.deepEqual(fulfilled,['https://fixture.test/start','https://fixture.test/later']);
 assert.deepEqual(fetches,[{maxRedirects:0,maxRetries:0,timeout:45_000},{maxRedirects:0,maxRetries:0,timeout:45_000}]);
});
