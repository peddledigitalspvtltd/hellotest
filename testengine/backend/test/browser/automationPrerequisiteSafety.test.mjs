import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {createRequire} from 'node:module';
import {registerAutomationMcp} from '../../dist/lib/automationMcp.js';
import {createPrivilegedRunGuard,resolveTestEngineSharedSecret} from '../../dist/lib/testEngineSecurity.js';

const require=createRequire(import.meta.url);
const {connectAutomationBrowser}=require('../../../../services/automation/backend/lib/automationBrowserAgent.js');
const {createAutomationCaseJourney}=require('../../../../services/automation/backend/lib/automationCaseJourney.js');
const {projectModelSnapshot,modelTargetForLocator}=require('../../../../services/automation/backend/lib/automationBrowserModelTargets.js');
const {reviewAutomationPrerequisite,approvedAutomationPrerequisite}=require('../../../../services/automation/backend/lib/automationPrerequisiteRecovery.js');
const allow={decision:'allow',reason:'The observed disclosure is needed to reach the current login form.',necessary_for_current_step:true,changes_expected_result:false,executes_later_step:false,requires_new_data:false};
const payload=result=>JSON.parse(result.content.find(part=>part.type==='text').text);

async function fixture(t){
 const old=process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;process.env.RECORDER_ALLOWED_PRIVATE_HOSTS='127.0.0.1';
 t.after(()=>{if(old===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=old;});
 const app=Fastify();let disclosures=0,otherVisits=0;
 app.get('/fixture',async(_request,reply)=>reply.type('text/html').send(`<!doctype html><title>Missing prerequisite safety</title><main>
  <button id="open" type="button" aria-controls="login-panel" aria-expanded="false" onclick="document.querySelector('#login-panel').hidden=false;this.setAttribute('aria-expanded','true');fetch('/disclosed',{method:'POST'})">Open sign in</button>
  <section id="login-panel" hidden><label>Email<input id="email" type="email"></label></section>
  <a id="blank" href="/other" target="_blank">Sign in new tab</a><a id="download" href="/other" download>Download sign in</a>
  <button id="submit" type="submit" aria-controls="login-panel">Submit sign in</button>
  <button id="ordinary" type="button">Create account</button>
  <button id="disabled" type="button" disabled aria-controls="login-panel">Disabled disclosure</button>
  <button id="truncated" type="button" aria-controls="${'panel-'.repeat(100)}">Truncated disclosure</button>
  <div id="tab" role="tab" tabindex="0" aria-controls="login-panel">Sign in tab</div>
 </main>`));
 app.post('/disclosed',async()=>{disclosures++;return {};});
 app.get('/other',async()=>{otherVisits++;return 'Unexpected visit';});
 await registerAutomationMcp(app,createPrivilegedRunGuard(resolveTestEngineSharedSecret()));
 const base=await app.listen({host:'127.0.0.1',port:0});t.after(()=>app.close());
 const browser=await connectAutomationBrowser({integration:{base_url:base},startUrl:base+'/fixture',allowBrowserActions:true});t.after(()=>browser.close());
 const calls=[],call=browser.call;browser.call=async(name,args)=>{calls.push({name,args});return call(name,args);};
 await browser.call('browser_navigate',{url:base+'/fixture'});
 const snapshot={tool:'browser_snapshot',result:await browser.call('browser_snapshot',{})};
 const page=payload(snapshot.result);projectModelSnapshot(snapshot);
 const step={id:'current',step_type:'web',action:'Navigate to '+base+'/fixture',expected_result:'The login form is visible'};
 const journey=createAutomationCaseJourney({testCase:{title:'Invalid credentials sign in'},steps:[step,{id:'later',step_type:'web',action:'Enter @r.email',expected_result:'The configured value is retained'}],activeStepId:step.id,projectText:value=>value});
 const execution={required:true,step_id:step.id,action:step.action,expected_result:step.expected_result,case_journey:journey};
 const element=id=>page.elements.find(row=>row.attributes?.id===id);
 const review=(id,complete)=>{
  const locator=element(id).locator_candidates[0],ref=modelTargetForLocator(locator,snapshot);assert.ok(ref);
  return reviewAutomationPrerequisite({proposal:{reason:'One observed missing UI disclosure is required to reach the current login form.',evidence_refs:[page.observation_id,ref],tool_call:{name:'browser_click',arguments:{locator:ref}}},
   execution,snapshot,observations:[snapshot],tool:browser.tools.find(tool=>tool.name==='browser_click'),complete,parse:JSON.parse,projectText:value=>value,deadlineMs:Date.now()+10000});
 };
 return {browser,calls,snapshot,page,execution,element,review,get disclosures(){return disclosures;},get otherVisits(){return otherVisits;}};
}

// Scripted review; DOM capture, MCP schemas, target binding and click are real.
test('real MCP disclosure attributes permit one independently reviewed non-submit UI prerequisite', {timeout:60000},async t=>{
 const state=await fixture(t);let reviews=0;
 assert.equal(state.element('open').attributes['aria-controls'],'login-panel');
 assert.equal(state.element('open').attributes['aria-expanded'],'false');
 const recovered=await state.review('open',async prompt=>{reviews++;const packet=JSON.parse(prompt.split('\n\n').at(-1));assert.equal(packet.proposed.target.name,'Open sign in');return JSON.stringify(allow);});
 assert.equal(reviews,1);assert.equal(approvedAutomationPrerequisite(recovered.approval,recovered.request,state.snapshot,state.execution.step_id),true);
 assert.equal(state.calls.filter(call=>call.name==='browser_click').length,0,'review does not execute the proposed click');
 const clicked=await state.browser.call(recovered.request.name,recovered.request.arguments);assert.ok(!clicked.isError,JSON.stringify(clicked));
 const observed=payload(await state.browser.call('browser_snapshot',{}));
 const field=observed.elements.find(row=>row.attributes?.id==='email');assert.equal(field.displayed,true);
 const check=await state.browser.call('browser_assert',{assertion:'visible',locator:field.locator_candidates[0]});assert.ok(!check.isError);
 assert.equal(state.calls.filter(call=>call.name==='browser_click').length,1);assert.equal(state.disclosures,1);assert.equal(state.otherVisits,0);
});

test('real native new-tab/download/submit/ordinary/disabled/truncated controls stop before model review or clicks', {timeout:60000},async t=>{
 const state=await fixture(t);let reviews=0;
 assert.equal(state.element('blank').attributes.target,'_blank');
 assert.equal(state.element('download').attributes.download,'');
 assert.ok(state.element('truncated').truncated_attributes.includes('aria-controls'));
 for(const id of ['blank','download','submit','ordinary','disabled','truncated']){
  await assert.rejects(state.review(id,async()=>{reviews++;return JSON.stringify(allow);}),error=>/^AUTOMATION_PREREQUISITE_/.test(error.code),id);
 }
 assert.equal(reviews,0);assert.equal(state.calls.filter(call=>call.name==='browser_click').length,0);
 assert.equal(state.disclosures,0);assert.equal(state.otherVisits,0);
 const after=payload(await state.browser.call('browser_snapshot',{}));
 assert.equal(after.elements.find(row=>row.attributes?.id==='open').attributes['aria-expanded'],'false');
 assert.equal(after.elements.find(row=>row.attributes?.id==='email').displayed,false);
});
