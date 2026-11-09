import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import Fastify from 'fastify';
import {chromium} from 'playwright';
import {captureAutomationUrlAssertionDiagnostics,registerAutomationMcp} from '../../dist/lib/automationMcp.js';

const require=createRequire(import.meta.url);
const {connectAutomationBrowser}=require('../../../../services/automation/backend/lib/automationBrowserAgent.js');
const receipt=result=>JSON.parse(result.content.find(block=>block.type==='text').text);
const expectedKeys=['authentication_form_visible','document_busy','document_state','same_origin','visible_alert_count'];
const clean={same_origin:true,document_state:'complete',authentication_form_visible:true,document_busy:false,visible_alert_count:1};

test('a late optional DOM read cannot publish diagnostics when its timer callback was delayed',async t=>{
 let now=1_000;t.mock.method(Date,'now',()=>now);
 const page={isClosed:()=>false,url:()=>'https://fixture.test/login',evaluate:async()=>{now=1_500;return clean;}};
 assert.equal(await captureAutomationUrlAssertionDiagnostics(page,{origin:'https://fixture.test',deadline:5_000}),undefined);
});

test('optional URL failure diagnostics omit foreign, closed, cancelled, late, failed and unknown reads without exposing extra fields',async()=>{
 for(const scenario of ['healthy','foreign','closed','cancelled','short-deadline','read-failed','read-unknown','late-origin','late-cancel','invalid-count','invalid-state']){
  let reads=0,url='https://fixture.test/login',cancelled=scenario==='cancelled';
  if(scenario==='foreign')url='https://foreign.test/private';
  const page={isClosed:()=>scenario==='closed',url:()=>url,evaluate:async()=>{
   reads++;
   if(scenario==='read-failed')throw new Error('PRIVATE failure text');
   if(scenario==='read-unknown')return new Promise(()=>{});
   if(scenario==='late-origin')url='https://foreign.test/private';
   if(scenario==='late-cancel')cancelled=true;
   return {...clean,...(scenario==='invalid-count'?{visible_alert_count:201}:{}),...(scenario==='invalid-state'?{document_state:'PRIVATE'}:{}),value:'PRIVATE value',url:'PRIVATE URL',text:'PRIVATE text'};
  }};
  const began=Date.now(),result=await captureAutomationUrlAssertionDiagnostics(page,{origin:'https://fixture.test',deadline:Date.now()+(scenario==='short-deadline'?100:2_000),cancelled:()=>cancelled});
  if(scenario==='healthy')assert.deepEqual(result,clean);
  else assert.equal(result,undefined,scenario);
  if(['foreign','closed','cancelled','short-deadline'].includes(scenario))assert.equal(reads,0,'Known unsafe context never starts a DOM read');
  if(scenario==='read-unknown')assert.ok(Date.now()-began<1_200,'The optional read has its own half-second allowance');
  assert.doesNotMatch(JSON.stringify(result)||'',/PRIVATE|value|url|text/i);
 }
});

test('failed native URL oracles retain only safe sign-in/loading state and do not inspect values, mutate DOM or change the original failure',{timeout:60_000},async t=>{
 const previous=process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;process.env.RECORDER_ALLOWED_PRIVATE_HOSTS='127.0.0.1';
 const app=Fastify(),streams=new Set();let native;
 const form=`<form><label>Account<input id="account" value="PRIVATE_ACCOUNT"></label><label>Password<input type="password" value="PRIVATE_PASSWORD"></label><button>Sign in</button></form><p role="alert">PRIVATE_ERROR_TEXT</p><p role="alert" hidden>PRIVATE_HIDDEN_ERROR</p>`;
 app.get('/form',async(_request,reply)=>reply.type('text/html').send(`<!doctype html><title>PRIVATE_TITLE</title>${form}<script>window.effects={input:0,change:0,submit:0,mutation:0};for(const name of ['input','change','submit'])document.addEventListener(name,()=>window.effects[name]++);new MutationObserver(rows=>window.effects.mutation+=rows.length).observe(document.body,{attributes:true,childList:true,subtree:true,characterData:true});</script>`));
 app.get('/stream',async(_request,reply)=>reply.type('text/html').send('<!doctype html><title>PRIVATE_STREAM_TITLE</title><body aria-busy="true"><h1 id="loading" role="alert">PRIVATE_LOADING_TEXT</h1><script src="/held.js"></script>'));
 app.get('/held.js',async(_request,reply)=>{reply.hijack();reply.raw.writeHead(200,{'content-type':'text/javascript'});reply.raw.write('/* unfinished fixture script');streams.add(reply.raw);reply.raw.on('close',()=>streams.delete(reply.raw));});
 await registerAutomationMcp(app,async()=>{},{launchBrowser:async options=>{native=await chromium.launch(options);return native;}});
 const base=await app.listen({host:'127.0.0.1',port:0});
 t.after(async()=>{for(const stream of streams)stream.end('*/');await app.close();if(previous===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=previous;});
 const browser=await connectAutomationBrowser({integration:{base_url:base},startUrl:base+'/form',allowBrowserActions:false});
 try{
  const navigation=await browser.call('browser_navigate',{url:base+'/form'});assert.notEqual(navigation.isError,true,JSON.stringify(navigation));
  const page=native.contexts()[0].pages()[0],before=await page.evaluate(()=>window.effects);
  const authFailure=await browser.call('browser_assert',{assertion:'url_contains',value:'/dashboard'}),auth=receipt(authFailure);
  assert.equal(authFailure.isError,true);assert.equal(auth.code,'BROWSER_ASSERTION_NOT_SATISFIED');assert.equal(auth.assertion_outcome,'not_satisfied');assert.equal(auth.action_outcome,'not_attempted');assert.equal(auth.retry_safe,true);
  assert.deepEqual(auth.assertion_diagnostics,clean);assert.deepEqual(Object.keys(auth.assertion_diagnostics).sort(),expectedKeys);
  assert.doesNotMatch(JSON.stringify(authFailure),/PRIVATE_ACCOUNT|PRIVATE_PASSWORD|PRIVATE_ERROR_TEXT|PRIVATE_HIDDEN_ERROR|PRIVATE_TITLE/);
  assert.deepEqual(await page.evaluate(()=>window.effects),before,'The diagnostic cannot trigger browser events or DOM mutations');
  // The exact same native credential-form qualification rejects registration
  // and hidden password controls; no values are needed to make this decision.
  await page.locator('input[type=password]').evaluate(element=>element.setAttribute('autocomplete','new-password'));
  assert.equal((await captureAutomationUrlAssertionDiagnostics(page,{origin:base,deadline:Date.now()+2_000})).authentication_form_visible,false);
  await page.locator('input[type=password]').evaluate(element=>{element.removeAttribute('autocomplete');element.hidden=true;});
  assert.equal((await captureAutomationUrlAssertionDiagnostics(page,{origin:base,deadline:Date.now()+2_000})).authentication_form_visible,false);
  // Fixture-only navigation leaves a genuine parser-blocking loading document
  // in this same MCP-owned page. The failed goal still receives no URL data.
  await page.goto(base+'/stream',{waitUntil:'commit'});await page.locator('#loading').waitFor({state:'visible'});assert.equal(await page.evaluate(()=>document.readyState),'loading');
  const loadingFailure=await browser.call('browser_assert',{assertion:'url',value:base+'/dashboard'}),loading=receipt(loadingFailure);
  assert.equal(loadingFailure.isError,true);assert.equal(loading.code,'BROWSER_ASSERTION_NOT_SATISFIED');assert.equal(loading.assertion_outcome,'not_satisfied');assert.equal(loading.action_outcome,'not_attempted');
  assert.deepEqual(loading.assertion_diagnostics,{same_origin:true,document_state:'loading',authentication_form_visible:false,document_busy:true,visible_alert_count:1});
  assert.deepEqual(Object.keys(loading.assertion_diagnostics).sort(),expectedKeys);assert.doesNotMatch(JSON.stringify(loadingFailure),/PRIVATE_STREAM_TITLE|PRIVATE_LOADING_TEXT/);
  assert.equal(await page.evaluate(()=>document.readyState),'loading');
  await page.goto('about:blank');assert.equal(await captureAutomationUrlAssertionDiagnostics(page,{origin:base,deadline:Date.now()+2_000}),undefined);
 }finally{await browser.close();}
});
