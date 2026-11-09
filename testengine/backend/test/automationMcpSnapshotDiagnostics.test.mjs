import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {chromium} from 'playwright';
import {registerAutomationMcp} from '../dist/lib/automationMcp.js';

test('native failed scoped reads report typed zero/many causes and allow a fresh document read without actions', {timeout:30000}, async t => {
  const app=Fastify(); let mutations=0;
  app.get('/main', async (_request,reply)=>reply.type('text/html').send('<!doctype html><title>Scope diagnostics</title><a href="#employees">Employee Management</a><span>Employee Management</span><button onclick="fetch(\'/mutate\',{method:\'POST\'})">Save</button><iframe id="child" src="/child" style="width:700px;height:300px"></iframe>'));
  app.get('/child', async (_request,reply)=>reply.type('text/html').send('<!doctype html><title>Embedded scope</title><label>Name<input></label><span class="duplicate">One</span><span class="duplicate">Two</span><p id="unique">Unique</p>'));
  app.post('/mutate', async ()=>{mutations++;return {ok:true};});
  await registerAutomationMcp(app,async()=>{},{validateTarget:async()=>{},createProxy:async()=>({server:'http://unused.test',close:async()=>{}}),launchBrowser:async()=>chromium.launch({headless:true})});
  const base=await app.listen({host:'127.0.0.1',port:0});t.after(()=>app.close());
  let session;
  const rpc=async(method,params={})=>{
    const response=await app.inject({method:'POST',url:'/api/v1/automation/mcp',headers:session?{'mcp-session-id':session}:{},payload:{jsonrpc:'2.0',id:1,method,params}});
    if(method==='initialize')session=response.headers['mcp-session-id'];
    return response.json();
  };
  await rpc('initialize',{_meta:{hellotest:{start_url:base+'/main',allow_browser_actions:true}}});
  const call=async(name,args={})=>{
    const response=await rpc('tools/call',{name,arguments:args});assert.equal(response.error,undefined);
    return {result:response.result,receipt:JSON.parse(response.result.content.find(block=>block.type==='text').text)};
  };
  assert.equal((await call('browser_navigate',{url:base+'/main'})).result.isError,undefined);
  const root=await call('browser_snapshot');assert.equal(root.result.isError,undefined);
  assert.ok(root.receipt.frames.some(frame=>frame.path.length===1&&frame.path[0]==='#child'));
  for(const [args,code,count] of [
    [{locator:'page.getByText("Employee Management", {exact:true})'},'BROWSER_SNAPSHOT_SCOPE_AMBIGUOUS',2],
    [{locator:'#missing'},'BROWSER_SNAPSHOT_SCOPE_NOT_FOUND',0],
    [{frame:['#child'],locator:'.duplicate'},'BROWSER_SNAPSHOT_SCOPE_AMBIGUOUS',2]
  ]){
    const failed=await call('browser_snapshot',args);
    assert.equal(failed.result.isError,true);assert.equal(failed.receipt.code,code);assert.equal(failed.receipt.match_count,count);
    assert.equal(failed.receipt.action_outcome,'not_attempted');assert.equal(failed.receipt.retry_safe,true);
    assert.equal(failed.receipt.elements,undefined);assert.equal(failed.receipt.accessibility,undefined);
    assert.doesNotMatch(JSON.stringify(failed.receipt),/page\.getByText|#missing|\.duplicate/);
  }
  const refreshed=await call('browser_snapshot');assert.equal(refreshed.result.isError,undefined);
  assert.ok(refreshed.receipt.elements.some(row=>row.text==='Employee Management'&&row.tag==='a'&&row.locators_validated===true));
  const scoped=await call('browser_snapshot',{frame:['#child'],locator:'#unique'});
  assert.equal(scoped.result.isError,undefined);assert.deepEqual(scoped.receipt.frame_path,['#child']);
  assert.equal(mutations,0,'Reading and correcting a scope must not dispatch or replay an action');
});
