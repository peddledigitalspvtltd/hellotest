import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import Fastify from 'fastify';
import {registerAutomationMcp} from '../../dist/lib/automationMcp.js';
const require=createRequire(import.meta.url);
const {connectAutomationBrowser,runAutomationBrowserAgent}=require('../../../../services/automation/backend/lib/automationBrowserAgent.js');
const {inspectExecutablePlan}=require('../../../../services/automation/backend/services/automationReadiness.service.js');
const current=prompt=>JSON.parse(prompt.match(/^Current browser state and confirmed section progress .*?: (.+)$/m)[1]).current_snapshot;

test('real MCP rejects future login mutations in navigation/presence sections and input-only submission before dispatch',{timeout:90000},async t=>{
  const previous=process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;process.env.RECORDER_ALLOWED_PRIVATE_HOSTS='127.0.0.1';
  t.after(()=>{if(previous===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=previous;});
  const app=Fastify();let inputEvents=0,submissions=0,logouts=0;
  app.get('/login',async(_req,reply)=>reply.type('text/html').send('<!doctype html><title>Login fixture</title><form onsubmit="event.preventDefault();fetch(\'/submit\',{method:\'POST\'})"><label>Username<input id="username" oninput="fetch(\'/input\',{method:\'POST\'})"></label><label>Password<input id="password" type="password" oninput="fetch(\'/input\',{method:\'POST\'})"></label><button id="login" type="submit">Login</button></form>'));
  app.get('/navigation',async(_req,reply)=>reply.type('text/html').send('<!doctype html><title>Navigation fixture</title><nav><a href="/employees">Employee Management</a><button onclick="fetch(\'/logout\',{method:\'POST\'})">Log Out</button></nav>'));
  app.post('/input',async()=>{inputEvents++;return {ok:true};});app.post('/submit',async()=>{submissions++;return {ok:true};});app.post('/logout',async()=>{logouts++;return {ok:true};});
  await registerAutomationMcp(app,async()=>{});const base=await app.listen({host:'127.0.0.1',port:0});t.after(()=>app.close());
  for(const scenario of ['navigation','entry','presence']){
    const url=base+(scenario==='presence'?'/navigation':'/login'),browser=await connectAutomationBrowser({integration:{base_url:base},startUrl:url,allowBrowserActions:true});
    const original=browser.call,calls=[],observations=[];browser.call=async(name,args,...rest)=>{calls.push({name,args:structuredClone(args)});return original(name,args,...rest);};
    let actors=0,saves=0;const before=inputEvents;
    const action=scenario==='navigation'?'Navigate to @r.orangehrm_url.':scenario==='entry'?'Enter @r.username in the Username field.':'Verify Employee Management navigation and Log Out are visible.';
    const expected_result=scenario==='entry'?'The Username field contains the entered username.':scenario==='presence'?'Employee Management and Log Out are visible.':'The login page displays Username, Password and Login.';
    const obligations=[{id:'current',source:'section',action,expected_result},{id:'manual:linked:current',source:'manual_step',action,expected_result}];
    const result=await runAutomationBrowserAgent({browser,startUrl:url,prompt:'The whole case later fills credentials, logs in and checks Employee Management and Log Out. Only the current manual section is active.',
      execution:{required:true,step_id:'current',action,expected_result,source_obligations:obligations,future_actions:[{step_id:'later',action:'Click Login'}]},actorMode:true,parse:JSON.parse,maxTurns:4,maxCalls:12,
      onObservation:row=>observations.push(row),onPartialBuild:async payload=>{saves++;assert.equal(inspectExecutablePlan(payload.steps).length,0);return {generation_complete:true};},
      complete:async prompt=>{
        const page=current(prompt),target=name=>{const row=page.targets.find(target=>target.name===name);assert.ok(row,name);return row.ref;};
        const envelope=(tool_calls,section_complete=false)=>JSON.stringify({stage:'act',step_id:'current',section_complete,tool_calls});actors++;
        if(actors===1){
          const calls=scenario==='presence'?[{name:'browser_click',arguments:{locator:target('Log Out')}}]
            :[{name:'browser_fill',arguments:{locator:target('Username'),value:'fixture-user'}},{name:'browser_fill',arguments:{locator:target('Password'),value:'fixture-password'}},
              {name:'browser_click',arguments:{locator:target('Login')}},{name:'browser_press_key',arguments:{locator:target('Username'),key:'Enter'}}];
          return envelope(calls,true);
        }
        assert.equal(actors,2);assert.match(prompt,/AUTOMATION_BROWSER_ACTION_OUT_OF_ORDER/);
        assert.equal(calls.filter(row=>['browser_fill','browser_click','browser_press_key'].includes(row.name)).length,0,'the whole out-of-scope batch is rejected before any browser mutation');
        assert.equal(inputEvents,before);assert.equal(submissions,0);assert.equal(logouts,0);
        if(scenario==='navigation')return envelope([{name:'browser_assert',arguments:{assertion:'url',value:url}},
          ...['Username','Password','Login'].map(name=>({name:'browser_assert',arguments:{assertion:'visible',locator:target(name)}}))],true);
        if(scenario==='presence')return envelope(['Employee Management','Log Out'].map(name=>({name:'browser_assert',arguments:{assertion:'visible',locator:target(name)}})),true);
        return envelope([{name:'browser_fill',arguments:{locator:target('Username'),value:'fixture-user'}},
          {name:'browser_assert',arguments:{assertion:'value',locator:target('Username'),value:'fixture-user'}}],true);
      }});
    assert.equal(actors,2);assert.equal(saves,1);assert.equal(submissions,0);assert.equal(logouts,0);
    assert.equal(calls.filter(row=>row.name==='browser_navigate').length,1,'only the host Start URL bootstrap navigates');
    assert.equal(calls.filter(row=>row.name==='browser_click'||row.name==='browser_press_key').length,0);
    assert.equal(calls.filter(row=>row.name==='browser_fill').length,scenario==='entry'?1:0);
    assert.equal(inputEvents-before,scenario==='entry'?1:0);
    assert.ok(observations.some(row=>row.tool==='automation_action_order_feedback'&&row.mcp_call===false));
    assert.doesNotMatch(result.steps[0].automation_code,/\.click\(|\.press\(|fixture-password/);
    if(scenario!=='entry')assert.doesNotMatch(result.steps[0].automation_code,/\.fill\(/);
    await browser.close();
  }
});
