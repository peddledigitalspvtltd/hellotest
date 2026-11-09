import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import {chromium} from 'playwright';
import {registerAutomationMcp,assertAutomationBrowserCondition} from '../../dist/lib/automationMcp.js';
import {runAutomationVerification} from '../../dist/lib/automationVerification.js';
import {compileRecordedProgram} from '../../dist/lib/automationVerificationProgram.js';
import {createWebRunSession} from '../../dist/lib/webEngine.js';

const require=createRequire(import.meta.url);
const {connectAutomationBrowser}=require('../../../../services/automation/backend/lib/automationBrowserAgent.js');
const {compileRecordedProgram:compileSavedProgram}=require('../../../../services/automation/backend/lib/automationRecordedProgram.js');
const receipt=result=>JSON.parse(result.content.find(block=>block.type==='text').text);
const success=async(browser,name,args={})=>{const result=await browser.call(name,args);assert.notEqual(result.isError,true,JSON.stringify(result));return receipt(result);};
const op=(name,args)=>({name,arguments:args});
const ARRIVAL_MS=8_400;

test('Build, isolated verification and saved native playback share a bounded arrival wait beyond eight seconds without replaying Login',{timeout:100_000},async t=>{
 const previousHosts=process.env.RECORDER_ALLOWED_PRIVATE_HOSTS,previousRoot=process.env.ARTIFACT_ROOT;
 const directory=await mkdtemp(path.join(tmpdir(),'qaira-assertion-arrival-'));
 process.env.RECORDER_ALLOWED_PRIVATE_HOSTS='127.0.0.1';process.env.ARTIFACT_ROOT=directory;
 const effects=new Map(),app=Fastify();let native;
 app.get('/login/:scenario',async(request,reply)=>{
  const scenario=request.params.scenario;
  return reply.type('text/html').send(`<!doctype html><title>Arrival fixture</title><button id="login" onclick="window.clicks=(window.clicks||0)+1;fetch('/effect/${scenario}',{method:'POST'});setTimeout(()=>{history.pushState({},'','/dashboard/${scenario}');document.querySelector('#status').textContent='Dashboard'},${ARRIVAL_MS})">Login</button><h1 id="status">Sign in</h1>`);
 });
 app.post('/effect/:scenario',async request=>{const key=request.params.scenario;effects.set(key,(effects.get(key)||0)+1);return {ok:true};});
 await registerAutomationMcp(app,async()=>{},{launchBrowser:async options=>{native=await chromium.launch(options);return native;}});
 const base=await app.listen({host:'127.0.0.1',port:0});
 t.after(async()=>{
  await app.close();await rm(directory,{recursive:true,force:true});
  if(previousHosts===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=previousHosts;
  if(previousRoot===undefined)delete process.env.ARTIFACT_ROOT;else process.env.ARTIFACT_ROOT=previousRoot;
 });
 const operations=scenario=>[op('browser_click',{locator:'#login'}),op('browser_assert',{assertion:'url',value:base+'/dashboard/'+scenario}),op('browser_assert',{assertion:'url_contains',value:'/dashboard/'+scenario})];
 const verificationRequest=(scenario,rows=operations(scenario),timeout=20_000)=>({schema_version:1,verification_id:randomUUID(),lease_token:randomUUID(),start_url:base+'/login/'+scenario,parameters:{},sections:[{step_id:'login',automation_code:compileRecordedProgram(rows).source,operations:rows}],timeout_ms:timeout,replay_policy:{mode:'authorized_run',allow_mutations:true}});
 const runSession=(scenario,timeouts)=>createWebRunSession({engine_run_id:randomUUID(),browser:'chromium',headless:true,web_engine:{active:'playwright'},environment:{base_url:base+'/login/'+scenario},...(timeouts?{timeouts}:{}),run_timeout_seconds:30,max_repair_attempts:2,parameters_frozen:true,case_parameters:{},artifact_policy:{video_mode:'off',trace_mode:'off',screenshot_on_success:false,screenshot_on_failure:false,capture_console:false,capture_network:false},steps:[]});
 const step=rows=>({id:'login',order:1,step_type:'web',action:'Click Login once',expected_result:'The exact Dashboard URL is reached',automation_code:compileSavedProgram(rows).source});

 await t.test('the real MCP URL predicate waits for the late exact arrival; wrong goals, cancellation and shorter deadlines fail closed',async()=>{
  const scenario='build',browser=await connectAutomationBrowser({integration:{base_url:base},startUrl:base+'/login/'+scenario,allowBrowserActions:true});
  try{
   await success(browser,'browser_navigate',{url:base+'/login/'+scenario});await success(browser,'browser_snapshot');
   const began=Date.now();await success(browser,'browser_click',{locator:'#login'});
   const checked=await success(browser,'browser_assert',{assertion:'url',value:base+'/dashboard/'+scenario});
   assert.equal(checked.assertion_outcome,'satisfied');assert.ok(Date.now()-began>=8_000,'The expected URL actually appears beyond the previous eight-second limit');
   await success(browser,'browser_assert',{assertion:'url_contains',value:'/dashboard/'+scenario});
   const page=native.contexts()[0].pages()[0];assert.equal(await page.evaluate(()=>window.clicks),1);assert.equal(effects.get(scenario),1);
   const wrong=await browser.call('browser_assert',{assertion:'url_contains',value:'/wrong-dashboard'});
   assert.equal(wrong.isError,true);assert.equal(receipt(wrong).code,'BROWSER_ASSERTION_NOT_SATISFIED');assert.notEqual(receipt(wrong).session_disposition,'quarantined');
   const short=Date.now();await assert.rejects(assertAutomationBrowserCondition(page,{assertion:'url_contains',value:'/wrong-dashboard'},{origin:base,deadline:Date.now()+300}),error=>error.code==='BROWSER_ASSERTION_NOT_SATISFIED');assert.ok(Date.now()-short<2_000);
   let cancelled=false;const timer=setTimeout(()=>{cancelled=true;},150);
   try{await assert.rejects(assertAutomationBrowserCondition(page,{assertion:'url_contains',value:'/wrong-dashboard'},{origin:base,deadline:Date.now()+10_000,cancelled:()=>cancelled}),error=>error.code==='BROWSER_ASSERTION_CANCELLED');}finally{clearTimeout(timer);}
   await success(browser,'browser_assert',{assertion:'url',value:base+'/dashboard/'+scenario});assert.equal(effects.get(scenario),1,'Failed reads cannot repeat Login');
  }finally{await browser.close();}
 });

 await t.test('the independent verifier executes the same unchanged URL program and one Login',async()=>{
  const scenario='verify',input=verificationRequest(scenario),before=Date.now();
  assert.equal(input.sections[0].automation_code,compileSavedProgram(input.sections[0].operations).source,'Saved and independent compilers preserve the same exact URL oracles');
  const result=await runAutomationVerification(input,{artifactRoot:directory});
  assert.equal(result.status,'passed',JSON.stringify(result));assert.equal(result.verification_status,'verified');assert.equal(result.completed_interactions,1);assert.equal(result.assertion_count,2);assert.ok(Date.now()-before>=8_000);assert.equal(effects.get(scenario),1);
 });

 await t.test('a shorter verifier request deadline and cancellation retain the one completed Login and cannot pass or replay',async()=>{
  const shortScenario='verify-short',short=await runAutomationVerification(verificationRequest(shortScenario,operations(shortScenario),3_000),{artifactRoot:directory});
  // Native expect.poll may exhaust the remaining poll schedule just before
  // the enclosing request timer fires. Both outcomes are a failed original
  // oracle, with the completed Login preserved and no authority to replay it.
  assert.ok(['failed','timed_out'].includes(short.status),JSON.stringify(short));assert.equal(short.completed_interactions,1);assert.equal(short.assertion_count,0);assert.equal(short.failure.operation_kind,'browser_assert');assert.ok(['AUTOMATION_VERIFICATION_ASSERTION_FAILED','AUTOMATION_VERIFICATION_TIMEOUT'].includes(short.failure.code));assert.equal(effects.get(shortScenario),1);
  const scenario='verify-cancel',controller=new AbortController();let abortTimer;
  const timer=setInterval(()=>{if(effects.get(scenario)&&!abortTimer)abortTimer=setTimeout(()=>controller.abort(),250);},20);
  try{
   const result=await runAutomationVerification(verificationRequest(scenario),{artifactRoot:directory,signal:controller.signal});
   assert.equal(result.status,'cancelled');assert.equal(result.completed_interactions,1);assert.equal(result.assertion_count,0);assert.equal(effects.get(scenario),1);
  }finally{clearInterval(timer);clearTimeout(abortTimer);}
 });

 await t.test('ordinary saved native playback inherits the same ten-second default and respects a smaller configured assertion limit without mutation recovery',async()=>{
  const scenario='playback',rows=operations(scenario),session=runSession(scenario);
  try{
   await session.start();const before=Date.now(),result=await session.runStep(step(rows));
   assert.equal(result.status,'passed',result.note);assert.ok(Date.now()-before>=8_000);assert.equal(result.recovery_attempted,false);assert.equal(effects.get(scenario),1);
  }finally{await session.stop();}
  const shortScenario='playback-short',shortSession=runSession(shortScenario,{assertion_timeout_ms:300});
  try{
   await shortSession.start();const before=Date.now(),result=await shortSession.runStep(step(operations(shortScenario)));
   assert.equal(result.status,'failed');assert.equal(result.recovery_attempted,false,'A section with a completed Login is never retried for a read failure');assert.equal(result.web_detail.recovery.attempts,1);assert.ok(Date.now()-before<3_000);assert.equal(effects.get(shortScenario),1);
  }finally{await shortSession.stop();}
 });
});
