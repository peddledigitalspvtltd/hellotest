import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import Fastify from 'fastify';
import {registerAutomationMcp} from '../../dist/lib/automationMcp.js';

const require=createRequire(import.meta.url);
const {connectAutomationBrowser}=require('../../../../services/automation/backend/lib/automationBrowserAgent.js');
const payload=result=>JSON.parse(result.content.find(block=>block.type==='text').text);
const success=async(browser,name,args={},options)=>{
 const result=await browser.call(name,args,options);assert.notEqual(result.isError,true,JSON.stringify(result));return payload(result);
};

test('configured navigation crosses the old25s limit once and shorter authority stops without replay',{timeout:65_000},async t=>{
 const priorHosts=process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;
 process.env.RECORDER_ALLOWED_PRIVATE_HOSTS='127.0.0.1';
 const app=Fastify(),requests=new Map(),started=new Map(),echoes=[],pendingResponses=new Set();
 app.addHook('onSend',async(request,_reply,body)=>{
  if(request.body?.method==='initialize'&&typeof body==='string')echoes.push(JSON.parse(body).result?._meta?.hellotest);
  return body;
 });
 app.get('/ready/:scenario',async(_request,reply)=>reply.type('text/html').send('<!doctype html><title>Ready navigation</title><h1 id="ready">Ready</h1>'));
 app.get('/delayed/:scenario',async(request,reply)=>{
  const scenario=request.params.scenario,delay=scenario==='long'?27_000:8000;
  requests.set(scenario,(requests.get(scenario)||0)+1);started.get(scenario)?.();
  await new Promise(resolve=>{
   const finish=()=>{clearTimeout(timer);pendingResponses.delete(finish);resolve();};
   const timer=setTimeout(finish,delay);pendingResponses.add(finish);
   request.raw.once('aborted',finish);reply.raw.once('close',finish);
  });
  if(reply.raw.destroyed)return;
  return reply.type('text/html').send('<!doctype html><title>Delayed destination</title><h1 id="arrival">Destination ready</h1>');
 });
 await registerAutomationMcp(app,async()=>{});
 const base=await app.listen({host:'127.0.0.1',port:0});
 t.after(async()=>{
  for(const finish of [...pendingResponses])finish();
  app.server.closeAllConnections();
  await app.close();
  if(priorHosts===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=priorHosts;
 });
 const connect=(scenario,navigationTimeout=45_000,signal)=>connectAutomationBrowser({
  integration:{base_url:base,config:{navigation_timeout_ms:navigationTimeout}},startUrl:`${base}/ready/${scenario}`,allowBrowserActions:true,signal
 });

 await t.test('a frozen45s policy completes one27s GET then fresh native snapshot and URL assertion',async()=>{
  const browser=await connect('long');
  try{
   assert.equal(echoes.at(-1).navigation_timeout_ms,45_000,'the real runtime must explicitly accept the frozen policy');
   const url=`${base}/delayed/long`,before=Date.now();
   const receipt=await success(browser,'browser_navigate',{url});
   const elapsed=Date.now()-before;
   assert.equal(receipt.action_outcome,'completed');assert.equal(receipt.url,url);
   assert.ok(elapsed>=26_500,`The response must actually exceed the old25s limit; observed ${elapsed}ms`);
   assert.ok(elapsed<50_000,`The result must stay inside the configured50s tool/55s host allowance; observed ${elapsed}ms`);
   const snapshot=await success(browser,'browser_snapshot');
   assert.equal(snapshot.partial,false);assert.ok(snapshot.elements.find(row=>row.attributes?.id==='arrival')?.locators_validated);
   assert.equal((await success(browser,'browser_assert',{assertion:'url',value:url})).assertion_outcome,'satisfied');
   assert.equal(requests.get('long'),1,'navigation readiness and subsequent reads cannot repeat the original GET');
  }finally{await browser.close();}
 });

 await t.test('an explicit1s navigation policy reports unknown and never invites replay',async()=>{
  const browser=await connect('short',1000);
  try{
   const before=Date.now(),result=await browser.call('browser_navigate',{url:`${base}/delayed/short`});
   assert.equal(result.isError,true);const receipt=payload(result);
   assert.equal(receipt.code,'BROWSER_ACTION_OUTCOME_UNKNOWN');assert.equal(receipt.action_outcome,'unknown');assert.equal(receipt.retry_safe,false);
   assert.ok(Date.now()-before<6000,'a1s navigation cannot silently inherit the45s configured path');
   assert.equal(requests.get('short'),1);
  }finally{await browser.close();}
 });

 await t.test('the original host deadline still bounds configured45s navigation after one request dispatch',async()=>{
  const browser=await connect('deadline');
  try{
   await success(browser,'browser_navigate',{url:`${base}/ready/deadline`});
   const before=Date.now();
   await assert.rejects(browser.call('browser_navigate',{url:`${base}/delayed/deadline`},{deadlineMs:Date.now()+1000}),
    error=>error.code==='BROWSER_TRANSPORT_TIMEOUT');
   assert.ok(Date.now()-before<3000);assert.equal(requests.get('deadline'),1);
  }finally{await browser.close();}
 });

 await t.test('cancellation during one dispatched GET propagates the original reason without retrying',async()=>{
  const controller=new AbortController(),reason=Object.assign(new Error('Fixture parent authority ended'),{code:'FIXTURE_CANCELLED'});
  const browser=await connect('cancel',45_000,controller.signal);
  try{
   await success(browser,'browser_navigate',{url:`${base}/ready/cancel`});
   let markStarted;const dispatched=new Promise(resolve=>{markStarted=resolve;});started.set('cancel',markStarted);
   const navigation=browser.call('browser_navigate',{url:`${base}/delayed/cancel`});
   await dispatched;controller.abort(reason);
   await assert.rejects(navigation,error=>error===reason||error.code===reason.code);
   assert.equal(requests.get('cancel'),1);
  }finally{await browser.close();}
 });
});
