import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
import Fastify from 'fastify';
import {registerAutomationMcp,assertAutomationBrowserCondition} from '../../dist/lib/automationMcp.js';
const require=createRequire(import.meta.url);
const {connectAutomationBrowser}=require('../../../../services/automation/backend/lib/automationBrowserAgent.js');
const receipt=result=>JSON.parse(result.content.find(block=>block.type==='text').text);
const success=async(browser,name,args={})=>{const result=await browser.call(name,args);assert.notEqual(result.isError,true,JSON.stringify(result));return receipt(result);};

test('post-predicate completion rejects late origin, cancellation, closure, deadline and frame-owner changes',async t=>{
 let clock=1000;t.mock.method(Date,'now',()=>clock);
 for(const scenario of ['healthy','origin','cancelled','closed','deadline','scope-origin','scope-cancelled','scope-deadline','scope-stale']){
  clock=1000;let url='https://fixture.test/start',cancelled=false,closed=false,scopeCalls=0,predicates=0;
  const change=kind=>{if(kind==='origin')url='about:blank';if(kind==='cancelled')cancelled=true;if(kind==='closed')closed=true;if(kind==='deadline')clock=1100;};
  const page={url:()=>url,isClosed:()=>closed,title:async()=>{predicates++;if(!scenario.startsWith('scope-'))change(scenario);return 'Ready';}};
  const run=()=>assertAutomationBrowserCondition(page,{assertion:'title',value:'Ready'},{origin:'https://fixture.test',deadline:1100,cancelled:()=>cancelled,validateScope:async()=>{
   scopeCalls++;if(scopeCalls===2){if(scenario==='scope-stale')throw Object.assign(new Error('Changed frame document'),{code:'BROWSER_FRAME_STALE'});if(scenario.startsWith('scope-'))change(scenario.slice(6));}
  }});
  if(scenario==='healthy'){assert.equal((await run()).assertion_outcome,'satisfied');assert.equal(scopeCalls,2);}
  else{const expected=scenario.includes('stale')?'BROWSER_FRAME_STALE':scenario.includes('origin')?'BROWSER_ASSERTION_INVALID':scenario.includes('deadline')?'BROWSER_ASSERTION_NOT_SATISFIED':'BROWSER_ASSERTION_CANCELLED';await assert.rejects(run(),error=>error.code===expected,scenario);}
  assert.equal(predicates,1,'The guard checks completion of an actual awaited predicate');
 }
});

test('targeted positive native assertions admit a real loading document while negative reads, mutations and frame/origin guards remain strict',{timeout:90000},async t=>{
 const previous=process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;process.env.RECORDER_ALLOWED_PRIVATE_HOSTS='127.0.0.1';
 t.after(()=>{if(previous===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=previous;});
 const app=Fastify(),heldScripts=new Set();let native;
 app.get('/loading',async(_request,reply)=>reply.type('text/html').send('<!doctype html><title>Before loading</title><button id="go" onclick="document.open();document.write(\'<title>Loading outcome</title><body aria-busy=&quot;true&quot;><h1 id=&quot;ready&quot;>Ready</h1>\')">Go</button>'));
 app.get('/busy',async(_request,reply)=>reply.type('text/html').send('<!doctype html><title>Busy fixture</title><script>window.effects=0;window.effectWhileBusy=false;function busy(){clearTimeout(window.busyTimer);document.body.setAttribute("aria-busy","true");window.busyTimer=setTimeout(()=>document.body.removeAttribute("aria-busy"),1400)}</script><button id="start" onclick="busy()">Start busy state</button><button id="effect" onclick="window.effects++;window.effectWhileBusy=document.body.getAttribute(\'aria-busy\')===\'true\'">Effect</button><h1 id="ready">Ready</h1>'));
 app.get('/frames',async(_request,reply)=>reply.type('text/html').send('<!doctype html><title>Frame shell</title><iframe id="child" src="/child" style="width:700px;height:300px"></iframe>'));
 app.get('/child',async(_request,reply)=>reply.type('text/html').send('<!doctype html><title>Embedded fixture</title><h1 id="ready">Ready</h1><button id="busy" onclick="document.body.setAttribute(\'aria-busy\',\'true\');setTimeout(()=>document.body.removeAttribute(\'aria-busy\'),1400)">Busy child</button><button id="next" onclick="location.href=\'/child-next\'">Next document</button>'));
 app.get('/child-next',async(_request,reply)=>reply.type('text/html').send('<!doctype html><title>New child</title><h1 id="new-ready">New ready</h1>'));
 app.get('/stream-document',async(_request,reply)=>reply.type('text/html').send('<!doctype html><title>Streaming outcome</title><h1 id="stream-ready">Stream ready</h1><script src="/hold.js"></script>'));
 app.get('/hold.js',async(_request,reply)=>{reply.hijack();reply.raw.writeHead(200,{'content-type':'text/javascript'});reply.raw.write('/* parser-blocking fixture stream');heldScripts.add(reply.raw);reply.raw.on('close',()=>heldScripts.delete(reply.raw));});
 app.get('/signin401',async(_request,reply)=>reply.code(401).type('text/html').send('<!doctype html><title>Sign in</title><form onsubmit="event.preventDefault();location.href=\'/dashboard-busy\'"><label>Username<input name="username"></label><label>Password<input name="password" type="password"></label><button type="submit">Login</button></form>'));
 app.get('/dashboard-busy',async(_request,reply)=>reply.type('text/html').send('<!doctype html><title>Dashboard</title><body aria-busy="true"><h1 id="dashboard">Dashboard ready</h1>'));
 await registerAutomationMcp(app,async()=>{},{launchBrowser:async options=>{native=await chromium.launch(options);return native;}});
 const base=await app.listen({host:'127.0.0.1',port:0});t.after(()=>{for(const stream of heldScripts)stream.end('*/');return app.close();});
 const open=async path=>{const browser=await connectAutomationBrowser({integration:{base_url:base},startUrl:base+path,allowBrowserActions:true});await success(browser,'browser_navigate',{url:base+path});await success(browser,'browser_snapshot');return {browser,page:native.contexts()[0].pages()[0]};};

 await t.test('URL/title/visible inspect a genuinely loading document; a mismatch remains bounded and never grants foreign origin',async()=>{
  const {browser,page}=await open('/loading');try{
   await success(browser,'browser_click',{locator:'#go'});
   assert.equal(await page.evaluate(()=>document.readyState),'loading','The fixture must reproduce loaded=false, not only an application busy flag');
   const began=Date.now();
   for(const args of [{assertion:'url',value:base+'/loading'},{assertion:'url_contains',value:'/loading'},
    {assertion:'title',value:'Loading outcome'},{assertion:'title_normalized',value:'Loading outcome'},{assertion:'visible',locator:'#ready'}]){
    const checked=await success(browser,'browser_assert',args);assert.equal(checked.assertion_outcome,'satisfied');
   }
   assert.ok(Date.now()-began<5000,'Exact positive oracles do not enter the twenty-five-second global readiness wait');
   assert.equal(await page.evaluate(()=>document.readyState),'loading');
   const mismatchBegan=Date.now(),mismatch=await browser.call('browser_assert',{assertion:'visible',locator:'#missing'});
   assert.equal(mismatch.isError,true);assert.equal(receipt(mismatch).code,'BROWSER_ASSERTION_NOT_SATISFIED');assert.ok(Date.now()-mismatchBegan<14000);
   assert.notEqual(receipt(mismatch).session_disposition,'quarantined');
   await success(browser,'browser_assert',{assertion:'url',value:base+'/loading'});
   // Fixture-only setup commits a real document with a streaming parser-
   // blocking script. MCP still owns this exact page, origin and session.
   await page.goto(base+'/stream-document',{waitUntil:'commit'});await page.locator('#stream-ready').waitFor({state:'visible'});
   assert.ok(heldScripts.size>0);assert.equal(await page.evaluate(()=>document.readyState),'loading');
   await success(browser,'browser_assert',{assertion:'url',value:base+'/stream-document'});
   await success(browser,'browser_assert',{assertion:'title',value:'Streaming outcome'});
   await success(browser,'browser_assert',{assertion:'visible',locator:'#stream-ready'});
   assert.equal(await page.evaluate(()=>document.readyState),'loading','The parser-blocking stream is still active after the actual predicates');
   const foreign=await browser.call('browser_assert',{assertion:'url',value:'https://foreign.example.invalid/result'});
   assert.equal(foreign.isError,true);assert.equal(receipt(foreign).code,'BROWSER_TOOL_INVALID_ARGUMENTS');
   const navigation=await browser.call('browser_navigate',{url:'https://foreign.example.invalid/result'});
   assert.equal(navigation.isError,true);assert.equal(receipt(navigation).code,'BROWSER_FLOW_UNSUPPORTED');
  }finally{await browser.close();}
 });

 await t.test('hidden/count and an effectful click keep functional readiness admission',async()=>{
  const {browser,page}=await open('/busy');try{
   for(const args of [{assertion:'hidden',locator:'#absent'},{assertion:'count',locator:'#absent',value:'0'}]){
    await success(browser,'browser_click',{locator:'#start'});assert.equal(await page.locator('body').getAttribute('aria-busy'),'true');
    const began=Date.now();await success(browser,'browser_assert',args);
    assert.ok(Date.now()-began>=1000,'A negative/count check waits for the actual busy state to finish');assert.equal(await page.locator('body').getAttribute('aria-busy'),null);
   }
   await success(browser,'browser_click',{locator:'#start'});const began=Date.now();await success(browser,'browser_click',{locator:'#effect'});
   assert.ok(Date.now()-began>=1000,'Mutation admission retains the busy gate');
   assert.deepEqual(await page.evaluate(()=>({effects:window.effects,whileBusy:window.effectWhileBusy})),{effects:1,whileBusy:false});
  }finally{await browser.close();}
 });

 await t.test('positive child visibility bypasses settling while native frame owner/document identity stays authoritative',async()=>{
  const {browser,page}=await open('/frames');try{
   const frame=['#child'];await success(browser,'browser_snapshot',{frame});const child=page.frames().find(row=>row.url()===base+'/child');assert.ok(child);
   await success(browser,'browser_click',{frame,locator:'#busy'});assert.equal(await child.locator('body').getAttribute('aria-busy'),'true');
   const began=Date.now(),visible=await success(browser,'browser_assert',{frame,assertion:'visible',locator:'#ready'});
   assert.equal(visible.assertion_outcome,'satisfied');assert.ok(Date.now()-began<1000,'A positive child predicate does not wait for child readiness');assert.equal(await child.locator('body').getAttribute('aria-busy'),'true');
   await success(browser,'browser_click',{frame,locator:'#next'});await child.waitForURL(base+'/child-next');
   const stale=await browser.call('browser_assert',{frame,assertion:'visible',locator:'#new-ready'});
   assert.equal(stale.isError,true);assert.equal(receipt(stale).code,'BROWSER_FRAME_STALE');assert.equal(receipt(stale).action_outcome,'not_attempted');
  }finally{await browser.close();}
 });

 await t.test('a fresh successful dashboard response clears the earlier admitted sign-in 401 before positive checks',async()=>{
  const {browser,page}=await open('/signin401');try{
   await success(browser,'browser_click',{locator:'getByRole("button", {name:"Login",exact:true})'});await page.waitForURL(base+'/dashboard-busy');
   assert.equal(await page.locator('body').getAttribute('aria-busy'),'true');
   const began=Date.now();await success(browser,'browser_assert',{assertion:'url',value:base+'/dashboard-busy'});await success(browser,'browser_assert',{assertion:'visible',locator:'#dashboard'});
   assert.ok(Date.now()-began<5000,'The previous 401 cannot force broad readiness on the new 200 document');assert.equal(await page.locator('body').getAttribute('aria-busy'),'true');
  }finally{await browser.close();}
 });

 await t.test('a real native title read cannot publish success after its page changes to an opaque origin',async()=>{
  const {browser,page}=await open('/busy');const title=page.title.bind(page);
  try{
   page.title=async()=>{const observed=await title();await page.goto('about:blank');return observed;};
   const result=await browser.call('browser_assert',{assertion:'title',value:'Busy fixture'});
   assert.equal(result.isError,true);assert.equal(receipt(result).code,'BROWSER_ASSERTION_INVALID');assert.equal(receipt(result).action_outcome,'not_attempted');
  }finally{page.title=title;await browser.close();}
 });
});
