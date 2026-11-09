import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {createRequire} from 'node:module';
import {registerAutomationMcp} from '../../dist/lib/automationMcp.js';
import {createPrivilegedRunGuard,resolveTestEngineSharedSecret} from '../../dist/lib/testEngineSecurity.js';

const require=createRequire(import.meta.url);
const {connectAutomationBrowser,runAutomationBrowserAgent}=require('../../../../services/automation/backend/lib/automationBrowserAgent.js');
const read=result=>JSON.parse(result.content.find(part=>part.type==='text').text);
const login=`<!doctype html><title>Account sign in</title><main><h1>Sign in</h1><form method="post" action="/session">
  <label>Username<input name="username" autocomplete="username"></label>
  <label>Password<input name="password" type="password" autocomplete="current-password"></label>
  <button type="submit">Log in</button></form></main>`;

async function fixture(t){
  const previous=process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;
  process.env.RECORDER_ALLOWED_PRIVATE_HOSTS='127.0.0.1';
  t.after(()=>{if(previous===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=previous;});
  const app=Fastify();let navigations=0,submissions=0;
  app.addContentTypeParser('application/x-www-form-urlencoded',{parseAs:'string'},(_request,body,done)=>done(null,body));
  const route=(path,status,html)=>app.get(path,async(_request,reply)=>{navigations++;return reply.code(status).type('text/html').send(html);});
  route('/login',401,login);
  route('/changing-login',401,login.replace('</form>','<button type="button" id="replace-form" onclick="document.querySelector(\'main\').innerHTML=\'<h1>Unauthorized</h1>\'">Replace form</button></form>'));
  route('/denied',401,'<!doctype html><title>Denied</title><main><h1>Unauthorized</h1><a href="/help">Help</a></main>');
  route('/newsletter',401,'<!doctype html><title>Unavailable</title><main><form><label>Email<input type="email"></label><button>Subscribe</button></form></main>');
  route('/separate-controls',401,'<!doctype html><title>Unavailable</title><main><form><label>Account<input></label><button>Save</button></form><form><label>Password<input type="password"></label><button>Save</button></form></main>');
  route('/registration',401,'<!doctype html><title>Create account</title><main><form><label>Account<input></label><label>Password<input type="password" autocomplete="new-password"></label><button>Register</button></form></main>');
  route('/disabled',401,login.replace('type="password"','type="password" disabled'));
  route('/forbidden-login',403,login);
  route('/unavailable-login',503,login);
  app.post('/session',async(_request,reply)=>{submissions++;return reply.header('set-cookie','fixture_auth=ok; Path=/; HttpOnly').redirect('/account',303);});
  app.get('/account',async(request,reply)=>reply.type('text/html').send(`<!doctype html><title>Account</title><p role="status">${request.headers.cookie==='fixture_auth=ok'?'Signed in':'Missing session'}</p>`));
  await registerAutomationMcp(app,createPrivilegedRunGuard(resolveTestEngineSharedSecret()));
  const base=await app.listen({host:'127.0.0.1',port:0});
  t.after(()=>app.close());
  const browser=await connectAutomationBrowser({integration:{base_url:base},startUrl:base+'/login',allowBrowserActions:true});
  t.after(()=>browser.close());
  return{browser,base,counts:()=>({navigations,submissions})};
}

test('Engineer admits an observed401 sign-in document without claiming authentication, then uses its live form once',{timeout:60_000},async t=>{
  const f=await fixture(t),observations=[];let models=0;
  const generated=await runAutomationBrowserAgent({browser:f.browser,startUrl:f.base+'/login',prompt:'Inspect the login form',parse:JSON.parse,
    onObservation:observation=>observations.push(observation),complete:async prompt=>{models++;assert.match(prompt,/Username/);return JSON.stringify({steps:[]});}});
  assert.deepEqual(generated,{steps:[]});assert.equal(models,1);
  const navigation=read(observations.find(observation=>observation.tool==='browser_navigate').result);
  assert.equal(navigation.action_outcome,'completed');assert.equal(navigation.readiness.state,'ready');
  assert.equal(navigation.readiness.http_status,401);assert.equal(navigation.readiness.authentication_required,true);
  assert.match(navigation.readiness.warning,/Authentication remains required/);
  assert.equal(read(await f.browser.call('browser_fill',{locator:'input[name="username"]',value:'fixture-user'})).action_outcome,'completed');
  assert.equal(read(await f.browser.call('browser_fill',{locator:'input[name="password"]',value:'fixture-password'})).action_outcome,'completed');
  const click=read(await f.browser.call('browser_click',{locator:'button[type="submit"]'}));
  assert.equal(click.action_outcome,'completed');assert.equal(click.url,f.base+'/account');
  const checked=read(await f.browser.call('browser_assert',{assertion:'text',locator:'[role="status"]',value:'Signed in'}));
  assert.equal(checked.assertion_outcome,'satisfied');assert.deepEqual(f.counts(),{navigations:1,submissions:1});
});

test('401 form admission is rechecked after an action and cannot authorize a replacement error document',{timeout:60_000},async t=>{
  const f=await fixture(t);
  assert.equal(read(await f.browser.call('browser_navigate',{url:f.base+'/changing-login'})).readiness.authentication_required,true);
  assert.equal((await f.browser.call('browser_snapshot',{})).isError,undefined);
  const changed=read(await f.browser.call('browser_click',{locator:'#replace-form'}));
  assert.equal(changed.code,'BROWSER_ACTION_OUTCOME_UNKNOWN');assert.equal(changed.http_status,401);
  assert.equal(changed.action_outcome,'unknown');assert.equal(changed.retry_safe,false);
  const snapshot=await f.browser.call('browser_snapshot',{});
  assert.equal(snapshot.isError,true);assert.equal(read(snapshot).http_status,401);
  assert.deepEqual(f.counts(),{navigations:1,submissions:0});
});

for(const path of ['denied','newsletter','separate-controls','registration','disabled','forbidden-login','unavailable-login']){
  test(`${path} HTTP error cannot become login evidence or admit an Engineer model turn`,{timeout:60_000},async t=>{
    const f=await fixture(t);let models=0;
    await assert.rejects(runAutomationBrowserAgent({browser:f.browser,startUrl:f.base+'/'+path,prompt:'Inspect sign in',parse:JSON.parse,
      complete:async()=>{models++;return '{}';}}),error=>error.code==='AUTOMATION_BROWSER_NAVIGATION_HTTP_ERROR'&&error.http_status===(path==='forbidden-login'?403:path==='unavailable-login'?503:401));
    assert.equal(models,0);assert.deepEqual(f.counts(),{navigations:1,submissions:0});
    const snapshot=await f.browser.call('browser_snapshot',{});assert.equal(snapshot.isError,true);
  });
}
