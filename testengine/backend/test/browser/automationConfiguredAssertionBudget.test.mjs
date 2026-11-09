import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import {chromium} from 'playwright';
import {registerAutomationMcp} from '../../dist/lib/automationMcp.js';
import {runAutomationVerification} from '../../dist/lib/automationVerification.js';
import {runAutomationVerificationCli} from '../../dist/lib/automationVerificationCli.js';
import {compileRecordedProgram} from '../../dist/lib/automationVerificationProgram.js';

const require=createRequire(import.meta.url);
const {connectAutomationBrowser}=require('../../../../services/automation/backend/lib/automationBrowserAgent.js');
const receipt=result=>JSON.parse(result.content.find(block=>block.type==='text').text);
const success=async(browser,name,args={})=>{
 const result=await browser.call(name,args);
 assert.notEqual(result.isError,true,JSON.stringify(result));
 return receipt(result);
};
const op=(name,args)=>({name,arguments:args});

test('configured native assertion budgets cross Build transport and independent verifier boundaries without replay',{timeout:85_000},async t=>{
 const priorHosts=process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;
 process.env.RECORDER_ALLOWED_PRIVATE_HOSTS='127.0.0.1';
 const directory=await mkdtemp(path.join(tmpdir(),'qaira-configured-assertion-'));
 const app=Fastify(),effects=new Map(),browsers=[];
 app.get('/login/:scenario',async(request,reply)=>{
  const scenario=request.params.scenario;
  const arrival=Number(request.query.delay)||0;
  assert.match(scenario,/^[a-z-]+$/);
  return reply.type('text/html').send(`<!doctype html><title>Configured arrival</title><button id="login" onclick="window.clicks=(window.clicks||0)+1;fetch('/effect/${scenario}',{method:'POST'});setTimeout(()=>{history.pushState({},'','/dashboard/${scenario}');document.querySelector('#status').textContent='Dashboard'},${arrival})">Login</button><h1 id="status">Sign in</h1>`);
 });
 app.post('/effect/:scenario',async request=>{
  const scenario=request.params.scenario;
  effects.set(scenario,(effects.get(scenario)||0)+1);
  return {ok:true};
 });
 await registerAutomationMcp(app,async()=>{},{launchBrowser:async options=>{
  const browser=await chromium.launch(options);browsers.push(browser);return browser;
 }});
 const base=await app.listen({host:'127.0.0.1',port:0});
 t.after(async()=>{
  await app.close();await rm(directory,{recursive:true,force:true});
  if(priorHosts===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=priorHosts;
 });
 const url=(scenario,delay)=>`${base}/login/${scenario}?delay=${delay}`;
 const operations=scenario=>[
  op('browser_click',{locator:'#login'}),
  op('browser_assert',{assertion:'url',value:`${base}/dashboard/${scenario}`})
 ];
 const verificationRequest=(scenario,delay,assertionTimeout,driver='native')=>{
  const rows=operations(scenario);
  return {schema_version:1,verification_id:randomUUID(),lease_token:randomUUID(),start_url:url(scenario,delay),
   parameters:{},sections:[{step_id:'login',automation_code:compileRecordedProgram(rows).source,operations:rows}],
   timeout_ms:10_000,assertion_timeout_ms:assertionTimeout,execution_driver:driver,
   replay_policy:{mode:'authorized_run',allow_mutations:true}};
 };
 const build=async(scenario,delay,assertionTimeout)=>connectAutomationBrowser({
  integration:{base_url:base,config:{assertion_timeout_ms:assertionTimeout}},
  startUrl:url(scenario,delay),allowBrowserActions:true
 });

 await t.test('a configured45s Build assertion reaches the exact URL after32s through real MCP and host transport',async()=>{
  const scenario='build-long',start=url(scenario,32_000),browser=await build(scenario,32_000,45_000);
  try{
   await success(browser,'browser_navigate',{url:start});
   await success(browser,'browser_snapshot');
   const began=Date.now();
   const action=await success(browser,'browser_click',{locator:'#login'});
   assert.equal(action.action_outcome,'completed');
   const checked=await success(browser,'browser_assert',{assertion:'url',value:`${base}/dashboard/${scenario}`});
   const elapsed=Date.now()-began;
   assert.equal(checked.assertion_outcome,'satisfied');
   assert.ok(elapsed>=31_000,`The fixture must actually arrive beyond30s; observed${elapsed}ms`);
   assert.ok(elapsed<50_000,`The configured assertion must stay inside its50s tool/55s host allowance; observed${elapsed}ms`);
   assert.equal(effects.get(scenario),1,'The host cannot replay Login while waiting for the original URL oracle');
   const native=browsers.at(-1),page=native.contexts()[0].pages()[0];
   assert.equal(await page.evaluate(()=>window.clicks),1);
  }finally{await browser.close();}
 });

 await t.test('short configured native budgets pass on arrival and fail an unchanged late URL without replay',async()=>{
  for(const [scenario,delay,assertionTimeout,passed] of [
   ['build-short-pass',1_200,2_000,true],
   ['build-short-fail',4_000,1_000,false]
  ]){
   const start=url(scenario,delay),browser=await build(scenario,delay,assertionTimeout);
   try{
    await success(browser,'browser_navigate',{url:start});await success(browser,'browser_snapshot');
    await success(browser,'browser_click',{locator:'#login'});
    const began=Date.now(),result=await browser.call('browser_assert',{assertion:'url',value:`${base}/dashboard/${scenario}`});
    if(passed){assert.notEqual(result.isError,true,JSON.stringify(result));assert.equal(receipt(result).assertion_outcome,'satisfied');}
    else{
     assert.equal(result.isError,true);assert.equal(receipt(result).code,'BROWSER_ASSERTION_NOT_SATISFIED');
     assert.ok(Date.now()-began<3_000,'A configured1s read cannot silently use the10s default');
    }
    assert.equal(effects.get(scenario),1);
   }finally{await browser.close();}
  }
 });

 await t.test('independent native and CLI verification honor the configured2s pass and1s failure policy',async()=>{
  for(const [driver,run] of [['native',runAutomationVerification],['playwright_test_cli',runAutomationVerificationCli]]){
   for(const [suffix,delay,assertionTimeout,passed] of [['pass',1_200,2_000,true],['fail',4_000,1_000,false]]){
    const scenario=`verify-${driver==='native'?'native':'cli'}-${suffix}`;
    const result=await run(verificationRequest(scenario,delay,assertionTimeout,driver),{artifactRoot:directory,temporaryRoot:directory});
    assert.equal(result.status,passed?'passed':'failed',JSON.stringify(result));
    assert.equal(result.execution_driver,driver);
    assert.equal(result.completed_interactions,1);assert.equal(result.assertion_count,passed?1:0);
    if(!passed){
     assert.equal(result.failure.operation_kind,'browser_assert');
     assert.equal(result.failure.code,'AUTOMATION_VERIFICATION_ASSERTION_FAILED');
    }
    assert.equal(effects.get(scenario),1,'Each isolated verifier runs the single authorized Login once');
   }
  }
 });
});
