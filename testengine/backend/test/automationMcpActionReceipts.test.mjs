import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {registerAutomationMcp} from '../dist/lib/automationMcp.js';

async function protocol(app,startUrl){
  let session;
  const rpc=async(method,params={})=>{
    const response=await app.inject({method:'POST',url:'/api/v1/automation/mcp',headers:session?{'mcp-session-id':session}:{},payload:{jsonrpc:'2.0',id:1,method,params}});
    if(method==='initialize')session=response.headers['mcp-session-id'];
    return {status:response.statusCode,...response.json()};
  };
  await rpc('initialize',{_meta:{hellotest:{start_url:startUrl,allow_browser_actions:true}}});
  const raw=(name,args={})=>rpc('tools/call',{name,arguments:args});
  const call=async(name,args={})=>{const response=await raw(name,args);assert.ok(!response.error&&!response.result.isError,JSON.stringify(response));return JSON.parse(response.result.content[0].text);};
  return {raw,call};
}

test('a resolved real Chromium click returns its receipt before delayed page readiness, then read-only settling proves the result once',{timeout:30000},async t=>{
  const previous=process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;process.env.RECORDER_ALLOWED_PRIVATE_HOSTS='127.0.0.1';
  t.after(()=>{if(previous===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=previous;});
  const app=Fastify();let effects=0;
  app.get('/start',async(_r,reply)=>reply.type('text/html').send('<!doctype html><title>Start</title><button id="advance" onclick="location.href=\'/delayed\'">Advance once</button>'));
  app.get('/delayed',async(_r,reply)=>{effects++;return reply.type('text/html').send('<!doctype html><title>Delayed page</title><body aria-busy="true"><h1 id="result">Loading result</h1><script>setTimeout(()=>{document.body.removeAttribute("aria-busy");document.querySelector("#result").textContent="Ready"},5000)</script>');});
  await registerAutomationMcp(app,async()=>{});const base=await app.listen({host:'127.0.0.1',port:0});t.after(()=>app.close());
  const mcp=await protocol(app,base+'/start');await mcp.call('browser_navigate',{url:base+'/start'});await mcp.call('browser_snapshot');
  const started=Date.now(),clicked=await mcp.call('browser_click',{locator:'#advance'});
  assert.equal(clicked.action_outcome,'completed');assert.equal(clicked.url,base+'/delayed');assert.equal(clicked.title,undefined,'a completed action never waits for a title or claims unobserved metadata');
  assert.ok(Date.now()-started<3000,'the completed click must not wait five seconds for post-action readiness');assert.equal(effects,1);
  const readStarted=Date.now(),snapshot=await mcp.call('browser_snapshot');assert.ok(Date.now()-readStarted>=1500,'read-only observation must retain functional readiness');
  assert.match(snapshot.accessibility,/Ready/);await mcp.call('browser_assert',{assertion:'text',locator:'#result',value:'Ready'});assert.equal(effects,1,'readiness and assertion do not replay the navigation action');
});

test('a genuine pending native click remains unknown and never invites replay',{timeout:20000},async t=>{
  const previous=process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;process.env.RECORDER_ALLOWED_PRIVATE_HOSTS='127.0.0.1';
  t.after(()=>{if(previous===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=previous;});
  const app=Fastify(),dependencies={};let effects=0;
  app.get('/disabled',async(_r,reply)=>reply.type('text/html').send('<!doctype html><title>Pending click</title><button id="pending" disabled onclick="fetch(\'/effect\',{method:\'POST\'})">Submit</button>'));
  app.post('/effect',async()=>{effects++;return {ok:true};});
  await registerAutomationMcp(app,async()=>{},dependencies);const base=await app.listen({host:'127.0.0.1',port:0});t.after(()=>app.close());
  const mcp=await protocol(app,base+'/disabled');await mcp.call('browser_navigate',{url:base+'/disabled'});await mcp.call('browser_snapshot');
  dependencies.toolTimeoutMs=1400;
  const started=Date.now(),response=await mcp.raw('browser_click',{locator:'#pending'});assert.equal(response.result.isError,true);
  const failure=JSON.parse(response.result.content[0].text);assert.equal(failure.code,'BROWSER_ACTION_OUTCOME_UNKNOWN');assert.equal(failure.tool_phase,'interaction');
  assert.equal(failure.action_outcome,'unknown');assert.equal(failure.retry_safe,false);assert.ok(Date.now()-started<2300);assert.equal(effects,0);
  const observed=await mcp.raw('browser_snapshot');
  if(failure.session_disposition==='quarantined')assert.equal(observed.status,404,'a hard-deadline session cannot be reopened');
  else assert.equal(observed.status,200,'a native action timeout may retain its existing context for read-only reconciliation');
  assert.equal(effects,0,'only a read was attempted; the unknown click is never replayed');
});

test('a never-settling pre-action read is bounded, removes its admission slot and cannot dispatch a late click',{timeout:10000},async t=>{
  const app=Fastify();let hang=false,clicks=0,closes=0,releaseRead;
  const ready={loaded:true,loadState:'complete',usable:true,actionable:true,busy:false,signature:1};
  const never=new Promise(resolve=>releaseRead=resolve);
  const page={isClosed:()=>false,url:()=>'https://fixture.test/start',on(){},setDefaultTimeout(){},goto:async()=>({status:()=>200}),
    evaluate:async()=>hang?never:ready,locator:()=>({count:async()=>1,click:async()=>{clicks++;}})};
  const context={route:async()=>{},newPage:async()=>page,on(){}},browser={newContext:async()=>context,isConnected:()=>true,close:async()=>{closes++;await new Promise(()=>{});}};
  const dependencies={toolTimeoutMs:2000,validateTarget:async()=>{},launchBrowser:async()=>browser,createProxy:async()=>({server:'http://fixture-proxy.test',close:async()=>{}})};
  await registerAutomationMcp(app,async()=>{},dependencies);t.after(()=>app.close());
  const mcp=await protocol(app,'https://fixture.test/start');await mcp.call('browser_navigate',{url:'https://fixture.test/start'});
  hang=true;dependencies.toolTimeoutMs=120;
  const started=Date.now(),response=await mcp.raw('browser_click',{locator:'#submit'});assert.equal(response.result.isError,true);
  const failure=JSON.parse(response.result.content[0].text);assert.equal(failure.code,'BROWSER_TOOL_DEADLINE');assert.equal(failure.tool_phase,'page_readiness');assert.equal(failure.action_outcome,'not_attempted');
  assert.ok(Date.now()-started<600,'a hanging browser.close cannot withhold the structured deadline receipt');assert.equal(clicks,0);assert.ok(closes>=1);
  assert.equal((await mcp.raw('browser_click',{locator:'#submit'})).status,404);assert.equal(clicks,0);
  // A brand-new session can be admitted despite the old read/close never
  // settling. Neither it nor a late resolution can reopen the old session.
  await protocol(app,'https://fixture.test/new');
  assert.equal(clicks,0);releaseRead(ready);await new Promise(resolve=>setTimeout(resolve,50));assert.equal(clicks,0);
});

test('a late startup microtask quarantines admission even before its expired timer callback can run',{timeout:5000},async t=>{
  const app=Fastify();let closes=0,navigations=0;
  const dependencies={toolTimeoutMs:70,validateTarget:async()=>{},createProxy:async()=>({server:'http://fixture-proxy.test',close:async()=>{}}),launchBrowser:async()=>{
    const end=Date.now()+110;while(Date.now()<end){} // Deliberately starve the deadline timer.
    return {close:async()=>{closes++;await new Promise(()=>{});},newContext:async()=>{navigations++;throw Error('Late startup must not continue');}};
  }};
  await registerAutomationMcp(app,async()=>{},dependencies);t.after(()=>app.close());
  const mcp=await protocol(app,'https://fixture.test/start'),started=Date.now();
  const response=await mcp.raw('browser_navigate',{url:'https://fixture.test/start'});assert.equal(response.result.isError,true);
  assert.ok(Date.now()-started<700,'neither a starved timer nor hung late cleanup may withhold the bounded receipt');
  assert.equal(JSON.parse(response.result.content[0].text).action_outcome,'not_attempted');
  assert.equal((await mcp.raw('browser_snapshot')).status,404);assert.ok(closes>=1);assert.equal(navigations,0);
});

test('an optional real viewport screenshot observes a busy page within five seconds while native checks retain readiness',{timeout:20000},async t=>{
  const previous=process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;process.env.RECORDER_ALLOWED_PRIVATE_HOSTS='127.0.0.1';
  t.after(()=>{if(previous===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=previous;});
  const app=Fastify();let effects=0;
  app.get('/busy-dashboard',async(_r,reply)=>reply.type('text/html').send('<!doctype html><title>Busy dashboard</title><button id="save" onclick="document.body.setAttribute(\'aria-busy\',\'true\');document.querySelector(\'#result\').textContent=\'Saved once\';fetch(\'/effect\',{method:\'POST\'});setTimeout(()=>document.body.removeAttribute(\'aria-busy\'),5000)">Save once</button><p id="result">Ready</p>'));
  app.post('/effect',async()=>{effects++;return {ok:true};});
  await registerAutomationMcp(app,async()=>{});const base=await app.listen({host:'127.0.0.1',port:0});t.after(()=>app.close());
  const mcp=await protocol(app,base+'/busy-dashboard');await mcp.call('browser_navigate',{url:base+'/busy-dashboard'});await mcp.call('browser_snapshot');
  const clicked=await mcp.call('browser_click',{locator:'#save'});assert.equal(clicked.action_outcome,'completed');
  const began=Date.now(),image=await mcp.raw('browser_screenshot');assert.ok(Date.now()-began<5000,'optional images cannot repeat functional page settling');
  assert.ok(!image.result.isError,JSON.stringify(image.result));assert.ok(image.result.content.some(block=>block.type==='image'));
  const metadata=JSON.parse(image.result.content.find(block=>block.type==='text').text);assert.equal(metadata.optional,true);assert.equal(metadata.capture_scope,'viewport');
  const checkStarted=Date.now(),checked=await mcp.call('browser_assert',{assertion:'text',locator:'#result',value:'Saved once'});
  assert.ok(Date.now()-checkStarted>=1000,'native outcome checks retain their own functional readiness gate');assert.equal(checked.assertion_outcome,'satisfied');assert.equal(effects,1,'screenshots/checks cannot replay the completed business action');
});

test('a never-settling screenshot preserves its hard native deadline and quarantined disposition',{timeout:5000},async t=>{
  const app=Fastify(),ready={loaded:true,loadState:'complete',usable:true,actionable:true,busy:false,signature:1};let images=0;
  const page={isClosed:()=>false,url:()=>'https://fixture.test/start',on(){},setDefaultTimeout(){},goto:async()=>({status:()=>200}),evaluate:async()=>ready,
    screenshot:async options=>{images++;assert.ok(options.timeout>0&&options.timeout<=5000);await new Promise(()=>{});}};
  page.frames=()=>[page];page.mainFrame=()=>page;page.locator=selector=>({selector});
  const browser={isConnected:()=>true,newContext:async()=>({route:async()=>{},newPage:async()=>page,on(){}}),close:async()=>{await new Promise(()=>{});}};
  const dependencies={toolTimeoutMs:2000,validateTarget:async()=>{},launchBrowser:async()=>browser,createProxy:async()=>({server:'http://fixture-proxy.test',close:async()=>{}})};
  await registerAutomationMcp(app,async()=>{},dependencies);t.after(()=>app.close());const mcp=await protocol(app,'https://fixture.test/start');
  await mcp.call('browser_navigate',{url:'https://fixture.test/start'});dependencies.toolTimeoutMs=120;
  const began=Date.now(),response=await mcp.raw('browser_screenshot');assert.ok(Date.now()-began<700);assert.equal(response.result.isError,true);
  const fault=JSON.parse(response.result.content[0].text);assert.equal(fault.code,'BROWSER_TOOL_DEADLINE');assert.equal(fault.tool_phase,'screenshot');assert.equal(fault.session_disposition,'quarantined');
  assert.equal(fault.action_outcome,'not_attempted');assert.equal(fault.retry_safe,false);assert.equal(fault.optional,true);assert.equal(images,1);assert.equal((await mcp.raw('browser_snapshot')).status,404);
});
