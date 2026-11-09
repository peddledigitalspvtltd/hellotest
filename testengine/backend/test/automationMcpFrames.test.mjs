import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {chromium} from 'playwright';
import {registerAutomationMcp, automationBrowserTools, validateAutomationBrowserAssertion, waitForAutomationPageReadiness} from '../dist/lib/automationMcp.js';

async function fixture(t) {
  const app=Fastify(); let browser,page,saves=0,foreignHits=0;
  const foreign=Fastify();foreign.get('/foreign',async(_r,reply)=>{foreignHits++;return reply.type('text/html').send('<button>Foreign action</button>');});
  const other=await foreign.listen({host:'127.0.0.1',port:0});
  app.get('/shell',async(_r,reply)=>reply.type('text/html').send('<!doctype html><title>Outer application</title><iframe id="outer" src="/frame" style="width:900px;height:650px"></iframe>'));
  app.get('/duplicates',async(_r,reply)=>reply.type('text/html').send('<!doctype html><title>Outer application</title><label>Name<input id="shared" value="parent"></label><iframe id="outer" src="/frame" style="width:900px;height:650px"></iframe>'));
  app.get('/frame',async(_r,reply)=>reply.type('text/html').send('<!doctype html><title>Embedded application</title><label>Name<input id="shared"></label><button id="save" onclick="fetch(\'/saved\',{method:\'POST\'}).then(()=>document.querySelector(\'#result\').textContent=\'Saved once\')">Save</button><p id="result"></p><button id="next" onclick="location.href=\'/frame-next\'">Next page</button><iframe id="nested" src="/nested" style="width:600px;height:240px"></iframe>'));
  app.get('/nested',async(_r,reply)=>reply.type('text/html').send('<!doctype html><title>Nested application</title><label>Name<input id="shared"></label><button>Nested action</button>'));
  app.get('/frame-next',async(_r,reply)=>reply.type('text/html').send('<!doctype html><title>Next embedded page</title><h1 id="arrived">Arrived</h1><button id="done">Done</button>'));
  app.post('/saved',async()=>{saves++;return {ok:true};});
  app.get('/boundaries',async(_r,reply)=>reply.type('text/html').send(`<!doctype html><title>Boundary fixture</title><h1>Frame boundaries</h1><iframe id="foreign" src="${other}/foreign"></iframe><iframe id="opaque" sandbox="allow-scripts" src="/nested"></iframe><iframe id="hidden" hidden src="/nested"></iframe><iframe id="outer" src="/frame" style="width:900px;height:650px"></iframe>`));
  await registerAutomationMcp(app,async()=>{}, {validateTarget:async()=>{},createProxy:async()=>({server:'http://unused.test',close:async()=>{}}),launchBrowser:async()=>{browser=await chromium.launch({headless:true});const original=browser.newContext.bind(browser);browser.newContext=async options=>{const context=await original(options);context.on('page',value=>page=value);return context;};return browser;}});
  const base=await app.listen({host:'127.0.0.1',port:0});
  t.after(async()=>{await app.close();await foreign.close();});
  let session;
  const rpc=async(method,params={})=>{const reply=await app.inject({method:'POST',url:'/api/v1/automation/mcp',headers:session?{'mcp-session-id':session}:{},payload:{jsonrpc:'2.0',id:1,method,params}});if(method==='initialize')session=reply.headers['mcp-session-id'];return reply.json();};
  await rpc('initialize',{_meta:{hellotest:{start_url:base+'/shell',allow_browser_actions:true}}});
  const raw=async(name,args={})=>(await rpc('tools/call',{name,arguments:args}));
  const call=async(name,args={})=>{const result=(await raw(name,args)).result;assert.ok(!result.isError,JSON.stringify(result));return JSON.parse(result.content[0].text);};
  const rejected=async(name,args,code)=>{const result=(await raw(name,args)).result;assert.equal(result.isError,true,JSON.stringify(result));const receipt=JSON.parse(result.content[0].text);assert.equal(receipt.code,code);assert.equal(receipt.action_outcome,'not_attempted');return receipt;};
  return {base,call,raw,rejected,page:()=>page,saves:()=>saves,foreignHits:()=>foreignHits};
}

test('same-origin iframe-only shell discovers scoped documents without pretending child goals passed',{timeout:60000},async t=>{
  const f=await fixture(t);
  const opened=await f.call('browser_navigate',{url:f.base+'/shell'});
  assert.equal(opened.readiness.frame_discovery,true);assert.equal(opened.readiness.state,'ready');
  await f.rejected('browser_snapshot',{frame:['#outer']},'BROWSER_FRAME_NOT_OBSERVED');
  const top=await f.call('browser_snapshot');
  assert.deepEqual(top.frames.map(row=>row.path),[['#outer'],['#outer','#nested']]);
  assert.equal(top.frames[0].url,f.base+'/frame');assert.equal(top.frames[0].title,'Embedded application');
  assert.equal(top.url,f.base+'/shell');assert.equal(top.title,'Outer application');assert.equal(top.frame_path,undefined);
  const child=await f.call('browser_snapshot',{frame:['#outer']});
  assert.deepEqual(child.frame_path,['#outer']);assert.equal(child.frame_url,f.base+'/frame');
  assert.equal(child.url,f.base+'/shell');assert.equal(child.title,'Outer application');
  assert.match(child.frame_document_id,/^[a-f0-9-]{36}$/);assert.equal(child.frame_document_id,top.frames[0].frame_document_id);
  assert.ok(child.elements.some(row=>row.attributes.id==='shared'&&row.locator_candidates.includes('#shared')));
  const filled=await f.call('browser_fill',{frame:['#outer'],locator:'#shared',value:'Frame-owned input'});
  assert.deepEqual(filled.frame_path,['#outer']);assert.equal(filled.frame_url,f.base+'/frame');assert.equal(filled.action_outcome,'completed');
  assert.equal(filled.frame_document_id,child.frame_document_id);
  await f.call('browser_assert',{frame:['#outer'],assertion:'value',locator:'#shared',value:'Frame-owned input'});
  await f.call('browser_assert',{frame:['#outer'],assertion:'editable',locator:'#shared'});
  await f.call('browser_assert',{frame:['#outer'],assertion:'input_type',locator:'#shared',value:'text'});
  await f.call('browser_click',{frame:['#outer'],locator:'#save'});
  await f.call('browser_assert',{frame:['#outer'],assertion:'text',locator:'#result',value:'Saved once'});
  assert.equal(f.saves(),1,'proof checks cannot repeat the embedded mutation');
  const nested=await f.call('browser_snapshot',{frame:['#outer','#nested']});assert.deepEqual(nested.frame_path,['#outer','#nested']);
  await f.call('browser_fill',{frame:['#outer','#nested'],locator:'#shared',value:'Nested input'});
  await f.call('browser_assert',{frame:['#outer','#nested'],assertion:'value',locator:'#shared',value:'Nested input'});
  assert.equal(await f.page().frameLocator('#outer').locator('#shared').inputValue(),'Frame-owned input');
});

test('frame scope is per operation and stale navigation, replacement and ambiguous owners require fresh inventory',{timeout:60000},async t=>{
  const f=await fixture(t);await f.call('browser_navigate',{url:f.base+'/duplicates'});const initial=await f.call('browser_snapshot');
  const refreshed=await f.call('browser_snapshot');assert.equal(refreshed.frames[0].frame_document_id,initial.frames[0].frame_document_id,'inventory refresh must preserve the same native document epoch');
  await f.rejected('browser_validate_locator',{frame:['iframe'],locator:'#shared'},'BROWSER_FRAME_NOT_OBSERVED');
  await f.call('browser_snapshot',{frame:['#outer']});
  await f.call('browser_fill',{frame:['#outer'],locator:'#shared',value:'child'});
  const parent=await f.call('browser_assert',{assertion:'value',locator:'#shared',value:'parent'});assert.equal(parent.frame_path,undefined);
  const navigated=await f.call('browser_click',{frame:['#outer'],locator:'#next'});assert.equal(navigated.frame_document_id,initial.frames[0].frame_document_id,'mutation identifies the document that received it');
  await f.rejected('browser_snapshot',{frame:['#outer']},'BROWSER_FRAME_STALE');
  await f.call('browser_snapshot');const next=await f.call('browser_snapshot',{frame:['#outer']});assert.equal(next.frame_url,f.base+'/frame-next');
  assert.notEqual(next.frame_document_id,initial.frames[0].frame_document_id,'navigation rotates the native document epoch');
  await f.call('browser_assert',{frame:['#outer'],assertion:'text',locator:'#arrived',value:'Arrived'});
  const frame=f.page().frames().find(frame=>frame.url()===f.base+'/frame-next');await frame.goto(frame.url(),{waitUntil:'domcontentloaded'});
  await f.rejected('browser_validate_locator',{frame:['#outer'],locator:'#done'},'BROWSER_FRAME_STALE');
  const reloaded=await f.call('browser_snapshot');assert.notEqual(reloaded.frames[0].frame_document_id,next.frame_document_id,'same-URL reload rotates native document identity too');
  await f.page().evaluate(()=>{const original=document.querySelector('#outer');original.replaceWith(original.cloneNode());});
  await f.rejected('browser_validate_locator',{frame:['#outer'],locator:'#done'},'BROWSER_FRAME_STALE');
  await f.call('browser_snapshot');
  await f.page().evaluate(()=>document.body.append(document.querySelector('#outer').cloneNode()));
  await f.rejected('browser_validate_locator',{frame:['#outer'],locator:'#shared'},'BROWSER_FRAME_STALE');
});

test('cross-origin, opaque and hidden documents grant no scope; child readiness retains real busy and HTTP guards',{timeout:45000},async t=>{
  const f=await fixture(t);await f.call('browser_navigate',{url:f.base+'/boundaries'});const top=await f.call('browser_snapshot');
  assert.ok(!top.frames.some(row=>['#foreign','#opaque','#hidden'].includes(row.path[0])));
  for(const frame of [['#foreign'],['#opaque'],['#hidden']])await f.rejected('browser_validate_locator',{frame,locator:'button'},'BROWSER_FRAME_NOT_OBSERVED');
  assert.equal(f.foreignHits(),0,'cross-origin frame navigation must be blocked before reaching its server');
  const frame=f.page().frames().find(frame=>frame.url()===f.base+'/frame');
  await frame.evaluate(()=>document.body.setAttribute('aria-busy','true'));
  await assert.rejects(waitForAutomationPageReadiness(frame,{deadline:Date.now()+150,origin:f.base}),{code:'BROWSER_PAGE_NOT_READY'});
  await frame.evaluate(()=>document.body.removeAttribute('aria-busy'));
  await assert.rejects(waitForAutomationPageReadiness(frame,{deadline:Date.now()+150,origin:f.base,state:{pendingRequests:new Set(),navigationStatus:403}}),error=>error.http_status===403);
  await assert.rejects(waitForAutomationPageReadiness(frame,{deadline:Date.now()+900,origin:f.base,state:{pendingRequests:new Set(),navigationStatus:401}}),error=>error.http_status===401);
});

test('frame contract is bounded and top-level URL/title checks cannot silently change subject',()=>{
  for(const frame of [[],[''],['#a','#b','#c','#d'],'#outer',[42]])assert.equal(validateAutomationBrowserAssertion({frame,assertion:'visible',locator:'#target'}),false);
  for(const assertion of ['url','url_contains','title','title_normalized'])assert.equal(validateAutomationBrowserAssertion({frame:['#outer'],assertion,value:'anything'}),false);
  for(const tool of automationBrowserTools.filter(tool=>tool.inputSchema.properties.locator))assert.equal(tool.inputSchema.properties.frame.maxItems,3);
  assert.equal(automationBrowserTools.find(tool=>tool.name==='browser_navigate').inputSchema.properties.frame,undefined);
});
