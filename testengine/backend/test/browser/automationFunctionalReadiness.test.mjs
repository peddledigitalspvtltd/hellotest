import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import Fastify from 'fastify';
import {registerAutomationMcp} from '../../dist/lib/automationMcp.js';
import {createPrivilegedRunGuard,resolveTestEngineSharedSecret} from '../../dist/lib/testEngineSecurity.js';
const require=createRequire(import.meta.url);
const {connectAutomationBrowser}=require('../../../../services/automation/backend/lib/automationBrowserAgent.js');
const read=result=>JSON.parse(result.content.find(part=>part.type==='text').text);

for(const status of[200,401])test(`functional${status} login readiness does not wait for an external image or background stream load`,{timeout:60_000},async t=>{
  const previous=process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;process.env.RECORDER_ALLOWED_PRIVATE_HOSTS='127.0.0.1';
  let images=0,polls=0,browser;
  const asset=createServer((_request,response)=>{images++;response.writeHead(200,{'content-type':'image/gif'});response.write('GIF89a');});
  await new Promise(resolve=>asset.listen(0,'127.0.0.1',resolve));
  const app=Fastify();
  app.get('/poll',async(_request,reply)=>{polls++;reply.hijack();reply.raw.writeHead(200,{'content-type':'text/plain'});reply.raw.write('pending');});
  app.get('/login',async(_request,reply)=>reply.code(status).type('text/html').send(`<!doctype html><title>Sign in</title><main>
    <form><label>Username<input name="username"></label><label>Password<input type="password" name="password"></label><button type="submit">Sign in</button></form>
    <p role="status" id="load-state">Load pending</p><img src="http://127.0.0.1:${asset.address().port}/external.gif">
    <script>window.pollBody=fetch('/poll').then(response=>response.text());window.addEventListener('load',()=>document.querySelector('#load-state').textContent='Load completed');</script></main>`));
  await registerAutomationMcp(app,createPrivilegedRunGuard(resolveTestEngineSharedSecret()));
  const base=await app.listen({host:'127.0.0.1',port:0});
  t.after(async()=>{await browser?.close();asset.closeAllConnections();await new Promise(resolve=>asset.close(resolve));await app.close();if(previous===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=previous;});
  browser=await connectAutomationBrowser({integration:{base_url:base},startUrl:base+'/login',allowBrowserActions:false});
  const result=await browser.call('browser_navigate',{url:base+'/login'}),navigation=read(result);
  assert.equal(result.isError,undefined,JSON.stringify(navigation));assert.equal(navigation.readiness.state,'ready');
  assert.equal(navigation.readiness.load_state,'interactive','The resource stream still prevents the document load event');
  assert.equal(navigation.readiness.application_requests,'background_active','The application-request grace remains bounded');
  if(status===401){assert.equal(navigation.readiness.http_status,401);assert.equal(navigation.readiness.authentication_required,true);}
  assert.equal(images,1);assert.equal(polls,1);
  const snapshot=await browser.call('browser_snapshot',{});assert.equal(snapshot.isError,undefined);
  const checked=read(await browser.call('browser_assert',{assertion:'text',locator:'#load-state',value:'Load pending'}));
  assert.equal(checked.assertion_outcome,'satisfied','The outcome check remains independent of readiness and verifies load is still pending');
});
