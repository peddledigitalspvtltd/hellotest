import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_AUTOMATION_ASSERTION_TIMEOUT_MS,FIXED_NATIVE_PREDICATE_TIMEOUT_MS,nativeAutomationAssertionTimeoutMs,
 normalizeAutomationAssertionTimeoutMs,validAutomationAssertionTimeoutMs,nativeAutomationAssertionToolTimeoutMs} from '../dist/lib/automationAssertionPolicy.js';
import {compileRecordedProgram} from '../dist/lib/automationVerificationProgram.js';
import {validateAutomationVerificationRequest} from '../dist/lib/automationVerification.js';
import {randomUUID} from 'node:crypto';
import Fastify from 'fastify';
import {registerAutomationMcp} from '../dist/lib/automationMcp.js';

test('the shared native default covers delayed arrival while explicit fixed predicate programs retain their exact budget',()=>{
 assert.equal(DEFAULT_AUTOMATION_ASSERTION_TIMEOUT_MS,10000);
 for(const assertion of ['url','url_contains','title','title_normalized','visible','hidden','value','editable','count','text'])assert.equal(nativeAutomationAssertionTimeoutMs(assertion),DEFAULT_AUTOMATION_ASSERTION_TIMEOUT_MS);
 for(const assertion of ['valid','invalid','field_valid','input_type']){
  assert.equal(nativeAutomationAssertionTimeoutMs(assertion),FIXED_NATIVE_PREDICATE_TIMEOUT_MS);
  const source=compileRecordedProgram([{name:'browser_assert',arguments:{assertion,locator:'#field',...(assertion==='input_type'?{value:'password'}:{})}}]).source;
  assert.match(source,/timeout: 8000/,'an explicit existing source timeout is not rewritten by the new default');
 }
});

test('configured assertion policy matches Run normalization while only assertion tool budgets extend',()=>{
 for(const [input,expected]of [[undefined,10000],[null,10000],['',10000],[0,250],[-1,250],[2000.9,2000],['45000',45000],['1200ms',1200],[Infinity,10000],[200000,120000]])assert.equal(normalizeAutomationAssertionTimeoutMs(input),expected);
 for(const mode of ['url','url_contains','visible','value','title']){
  assert.equal(nativeAutomationAssertionTimeoutMs(mode,45000),45000);
  assert.equal(nativeAutomationAssertionToolTimeoutMs(mode,45000),50000);
  assert.equal(nativeAutomationAssertionToolTimeoutMs(mode),25000);
  assert.equal(nativeAutomationAssertionTimeoutMs(mode,1000),1000);
 }
 for(const mode of ['valid','invalid','field_valid','input_type']){
  assert.equal(nativeAutomationAssertionTimeoutMs(mode,45000),8000);
  assert.equal(nativeAutomationAssertionToolTimeoutMs(mode,45000),25000);
 }
 for(const value of [250,45000,120000])assert.equal(validAutomationAssertionTimeoutMs(value),true);
 for(const value of [undefined,0,249,120001,1.5,'45000',NaN])assert.equal(validAutomationAssertionTimeoutMs(value),false);
});

test('isolated and CLI requests accept only a bounded frozen assertion policy before browser launch',()=>{
 const operations=[{name:'browser_assert',arguments:{assertion:'visible',locator:'#ready'}}];
 const request={schema_version:1,verification_id:randomUUID(),lease_token:randomUUID(),start_url:'https://fixture.test/',parameters:{},
  sections:[{step_id:'ready',operations,automation_code:compileRecordedProgram(operations).source}],timeout_ms:60000,replay_policy:{mode:'read_only'}};
 assert.equal(validateAutomationVerificationRequest(request).assertion_timeout_ms,undefined);
 for(const driver of ['native','playwright_test_cli'])assert.equal(validateAutomationVerificationRequest({...request,execution_driver:driver,assertion_timeout_ms:45000}).assertion_timeout_ms,45000);
 for(const value of [0,249,120001,1.5,'45000',null])assert.throws(()=>validateAutomationVerificationRequest({...request,assertion_timeout_ms:value}));
});

test('MCP initialization echoes its accepted frozen budget and rejects invalid policies before launching a browser',async()=>{
 let launches=0;const app=Fastify();
 await registerAutomationMcp(app,async()=>{},{validateTarget:async()=>{},launchBrowser:async()=>{launches++;throw new Error('No browser may launch during policy negotiation.');}});
 try{
  for(const value of [undefined,10000,45000]){
   const response=await app.inject({method:'POST',url:'/api/v1/automation/mcp',payload:{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',_meta:{hellotest:{start_url:'https://fixture.test/',...(value===undefined?{}:{assertion_timeout_ms:value})}}}}});
   assert.equal(response.statusCode,200);assert.equal(response.json().result._meta.hellotest.assertion_timeout_ms,value??10000);
   await app.inject({method:'DELETE',url:'/api/v1/automation/mcp',headers:{'mcp-session-id':response.headers['mcp-session-id']}});
  }
  for(const value of [0,249,120001,'45000',1.5]){
   const response=await app.inject({method:'POST',url:'/api/v1/automation/mcp',payload:{jsonrpc:'2.0',id:1,method:'initialize',params:{_meta:{hellotest:{start_url:'https://fixture.test/',assertion_timeout_ms:value}}}}});
   assert.equal(response.json().error.code,-32602);
  }
  assert.equal(launches,0);
 }finally{await app.close();}
});
