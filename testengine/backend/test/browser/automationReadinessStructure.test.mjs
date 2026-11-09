import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {chromium} from 'playwright';
import {waitForAutomationPageReadiness,registerAutomationMcp} from '../../dist/lib/automationMcp.js';

test('real live dashboard text does not prevent structural readiness and no input value is read',{timeout:12000},async t=>{
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();
  await page.goto('about:blank');
  await page.setContent('<!doctype html><main><a href="/employees">Employee Management</a><input id="private" value="PRIVATE_CREDENTIAL"><p id="clock">Clock</p><output id="progress">0%</output></main><script>Object.defineProperty(document.querySelector("#private"),"value",{get(){throw Error("No credential reads")}});setInterval(()=>{document.querySelector("#clock").textContent="Clock "+Date.now();document.querySelector("#progress").textContent=String(Date.now()%100)+"%"},20)</script>');
  const state={pendingRequests:new Set()},started=Date.now();
  const result=await waitForAutomationPageReadiness(page,{origin:new URL(page.url()).origin,deadline:Date.now()+2200,state});
  assert.equal(result.state,'ready');assert.ok(Date.now()-started<1800,'a continuously changing text clock must not reset structural settling');
  assert.equal(state.diagnostics.loaded,true);assert.equal(state.diagnostics.actionable,true);assert.equal(state.diagnostics.busy,false);assert.equal(state.diagnostics.signature_changes,0);
  assert.doesNotMatch(JSON.stringify(state.diagnostics),/PRIVATE|Clock|signature"|fingerprint|value|text/);
});

test('genuine document/regional busy, indeterminate progress and loading-only content still block with coarse private-safe diagnostics',{timeout:12000},async t=>{
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();await page.goto('about:blank');
  for(const [html,expected] of [
    ['<body aria-busy="true"><button>PRIVATE</button>',{busy:true,document_busy:true,busy_regions:0,indeterminate_progress:0}],
    ['<body><button>PRIVATE</button><section aria-busy="true">PRIVATE widget</section>',{busy:true,document_busy:false,busy_regions:1}],
    ['<body><button>PRIVATE</button><div role="progressbar" style="position:fixed;inset:0">PRIVATE progress</div>',{busy:true,document_busy:false,indeterminate_progress:1}],
    ['<body>Loading...</body>',{loaded:true,usable:false,actionable:false,busy:false}]
  ]){
    await page.setContent('<!doctype html>'+html);const state={pendingRequests:new Set()};
    await assert.rejects(waitForAutomationPageReadiness(page,{origin:'null',deadline:Date.now()+220,state}),error=>{
      assert.equal(error.code,'BROWSER_PAGE_NOT_READY');for(const [key,value] of Object.entries(expected))assert.equal(error.readiness_diagnostics[key],value,key);
      assert.ok(error.readiness_diagnostics.probe_count>=1);assert.equal(error.readiness_diagnostics.pending_requests,0);assert.doesNotMatch(JSON.stringify(error.readiness_diagnostics),/PRIVATE|widget|signature"|text|value/);return true;
    });
  }
});

test('hydrating control state resets quiet time even while unrelated dashboard text continues updating',{timeout:12000},async t=>{
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();
  await page.setContent('<!doctype html><button id="next" disabled>Next</button><p id="clock"></p><script>let changes=0;const hydration=setInterval(()=>{document.querySelector("#next").disabled=!document.querySelector("#next").disabled;if(++changes===6){clearInterval(hydration);document.querySelector("#next").disabled=false}},110);setInterval(()=>document.querySelector("#clock").textContent=Date.now(),20)</script>');
  const state={pendingRequests:new Set()},started=Date.now();await waitForAutomationPageReadiness(page,{origin:'null',deadline:Date.now()+2600,state});
  assert.ok(Date.now()-started>=950,'the final enabled state must settle before readiness');assert.ok(state.diagnostics.signature_changes>=3);assert.ok(state.diagnostics.quiet_ms>=450);assert.equal(state.diagnostics.actionable,true);
});

test('same-origin iframe discovery shells and their live-clock child retain independent structural readiness',{timeout:12000},async t=>{
  const app=Fastify();app.get('/shell',async(_r,reply)=>reply.type('text/html').send('<!doctype html><iframe id="embedded" src="/child" style="width:700px;height:300px"></iframe>'));
  app.get('/child',async(_r,reply)=>reply.type('text/html').send('<!doctype html><button>Next</button><p id="clock"></p><script>setInterval(()=>document.querySelector("#clock").textContent=Date.now(),20)</script>'));
  const origin=await app.listen({host:'127.0.0.1',port:0});t.after(()=>app.close());const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();await page.goto(origin+'/shell');
  const parent=await waitForAutomationPageReadiness(page,{origin,deadline:Date.now()+1800,state:{pendingRequests:new Set()}});assert.equal(parent.frame_discovery,true);
  const child=page.frames().find(frame=>frame.url()===origin+'/child');assert.ok(child);
  const state={pendingRequests:new Set()},result=await waitForAutomationPageReadiness(child,{origin,deadline:Date.now()+1800,state});assert.equal(result.state,'ready');assert.equal(state.diagnostics.signature_changes,0);
});

test('a native MCP readiness deadline retains coarse last-probe diagnostics after session quarantine',{timeout:12000},async t=>{
  const previous=process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;process.env.RECORDER_ALLOWED_PRIVATE_HOSTS='127.0.0.1';t.after(()=>{if(previous===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=previous;});
  const app=Fastify(),dependencies={};app.get('/block',async(_r,reply)=>reply.type('text/html').send('<!doctype html><button id="block" onclick="document.body.setAttribute(\'aria-busy\',\'true\')">Busy</button><p>PRIVATE_TEXT</p><input value="PRIVATE_VALUE">'));
  await registerAutomationMcp(app,async()=>{},dependencies);const origin=await app.listen({host:'127.0.0.1',port:0});t.after(()=>app.close());let session;
  const rpc=async(method,params={})=>{const response=await app.inject({method:'POST',url:'/api/v1/automation/mcp',headers:session?{'mcp-session-id':session}:{},payload:{jsonrpc:'2.0',id:1,method,params}});if(method==='initialize')session=response.headers['mcp-session-id'];return response.json();};
  const call=async(name,args={})=>(await rpc('tools/call',{name,arguments:args})).result;
  await rpc('initialize',{_meta:{hellotest:{start_url:origin+'/block',allow_browser_actions:true}}});assert.ok(!(await call('browser_navigate',{url:origin+'/block'})).isError);
  assert.ok(!(await call('browser_click',{locator:'#block'})).isError);dependencies.toolTimeoutMs=260;
  const response=await call('browser_snapshot');assert.equal(response.isError,true);const fault=JSON.parse(response.content[0].text);
  assert.equal(fault.code,'BROWSER_TOOL_DEADLINE');assert.equal(fault.tool_phase,'page_readiness');assert.equal(fault.session_disposition,'quarantined');
  const diagnostics=fault.readiness_diagnostics;assert.equal(diagnostics.loaded,true);assert.equal(diagnostics.usable,true);assert.equal(diagnostics.actionable,true);assert.equal(diagnostics.busy,true);assert.equal(diagnostics.document_busy,true);
  assert.equal(diagnostics.busy_regions,0);assert.equal(diagnostics.indeterminate_progress,0);assert.ok(diagnostics.probe_count>=1);assert.doesNotMatch(JSON.stringify(diagnostics),/PRIVATE|signature"|hash|text|value/);
});
