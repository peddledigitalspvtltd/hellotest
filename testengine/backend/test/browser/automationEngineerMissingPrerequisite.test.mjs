import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { registerAutomationMcp } from '../../dist/lib/automationMcp.js';
import { runAutomationVerificationCli } from '../../dist/lib/automationVerificationCli.js';
import { createPrivilegedRunGuard, resolveTestEngineSharedSecret } from '../../dist/lib/testEngineSecurity.js';
const require=createRequire(import.meta.url);
const {connectAutomationBrowser,runAutomationBrowserAgent}=require('../../../../services/automation/backend/lib/automationBrowserAgent');
const {createAutomationCaseJourney}=require('../../../../services/automation/backend/lib/automationCaseJourney');
const {recordedSectionRequests,recordedSectionObjectTargets}=require('../../../../services/automation/backend/lib/automationBrowserRecording');
const {runVerificationPipeline}=require('../../../../services/automation/backend/lib/automationVerificationPipeline');
const current=prompt=>JSON.parse(prompt.match(/^Current browser state and confirmed section progress .*?: (.+)$/m)[1]);
const allowed={decision:'allow',reason:'The observed login link is needed to reach the login form expected by this current section.',necessary_for_current_step:true,changes_expected_result:false,executes_later_step:false,requires_new_data:false};

async function fixture(t){
 const previous=process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;process.env.RECORDER_ALLOWED_PRIVATE_HOSTS='127.0.0.1';
 const root=await mkdtemp(path.join(tmpdir(),'qaira-missing-prerequisite-'));
 let submissions=0,homeVisits=0,loginVisits=0;
 const app=Fastify();
 app.get('/home',async(_request,reply)=>{homeVisits++;return reply.type('text/html').send('<!doctype html><title>Application home</title><main><h1>Home</h1><a href="/login">Sign in</a></main>');});
 app.get('/login',async(_request,reply)=>{loginVisits++;return reply.type('text/html').send('<!doctype html><title>Login</title><main><form onsubmit="event.preventDefault();fetch(\'/submitted\',{method:\'POST\'})"><label>Email<input type="email"></label><button type="submit">Sign in</button></form></main>');});
 app.post('/submitted',async()=>{submissions++;return {};});
 await registerAutomationMcp(app,createPrivilegedRunGuard(resolveTestEngineSharedSecret()));
 const base=await app.listen({host:'127.0.0.1',port:0});
 const session=await connectAutomationBrowser({integration:{base_url:base},startUrl:base+'/home',allowBrowserActions:true});
 session.projectPromptText=value=>value;session.projectPrivateText=value=>value;
 t.after(async()=>{await session.close();await app.close();await rm(root,{recursive:true,force:true});if(previous===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=previous;});
 const step={id:'open-login',step_type:'web',action:'Navigate to '+base+'/home',expected_result:'The login form and its Email field are visible'};
 const journey=createAutomationCaseJourney({testCase:{title:'Invalid credentials must not sign in'},steps:[step,{id:'enter-email',step_type:'web',action:'Enter @r.email',expected_result:'The input is retained'}],activeStepId:step.id,projectText:text=>text});
 const execution={...step,required:true,step_id:step.id,semantic_review_required:true,case_journey:journey,source_obligations:[{id:step.id,source:'section',action:step.action,expected_result:step.expected_result}]};
 const calls=[],observations=[],events=[],call=session.call;session.call=async(name,args)=>{calls.push({name,args});return call(name,args);};
 return {base,root,session,step,execution,calls,observations,events,counters:()=>({submissions,homeVisits,loginVisits})};
}

// Model choices are scripted. The complete actor, native discovery/navigation,
// receipts, compilation, object evidence and isolated Test CLI run are real.
test('whole agent adds one missing observed navigation and its compiled source passes fresh Playwright Test CLI verification',{timeout:90000},async t=>{
 const state=await fixture(t);let actors=0,prerequisiteReviews=0,reviews=0,saves=0;
 const built=await runAutomationBrowserAgent({browser:state.session,startUrl:state.base+'/home',execution:state.execution,actorMode:true,generationMode:'sequential',prompt:'Open the application and reach the expected login form before entering data.',maxTurns:5,maxCalls:8,parse:JSON.parse,
  onObservation:row=>state.observations.push(row),onProgress:event=>state.events.push(event),onPartialBuild:async()=>{saves++;return {generation_complete:true};},
  complete:async(prompt,_timeout,trace)=>{
   if(trace?.generationScope==='section_prerequisite_review'){prerequisiteReviews++;const packet=JSON.parse(prompt.split('\n\n').at(-1));assert.equal(packet.requirements.future[0].action,'Enter @r.email');return JSON.stringify(allowed);}
   if(trace?.generationScope==='section_semantic_review'){reviews++;const packet=JSON.parse(prompt.split('\n\n').at(-1));return JSON.stringify({decision:'accept',obligations:[{id:state.step.id,action_operations:[1,2],assertion_operations:[3]}],issues:[]});}
   actors++;const page=current(prompt).current_snapshot;
   if(actors===1){const link=page.targets.find(target=>target.role==='link'&&target.name==='Sign in');assert.ok(link?.ref);return JSON.stringify({prerequisite_request:{reason:'The current page lacks the login form; its observed Sign in link opens that required form.',evidence_refs:[page.observation_id,link.ref],tool_call:{name:'browser_click',arguments:{locator:link.ref}}}});}
   const email=page.targets.find(target=>target.name==='Email');assert.ok(email?.ref);return JSON.stringify({stage:'act',step_id:state.step.id,section_complete:true,tool_calls:[{name:'browser_assert',arguments:{assertion:'visible',locator:email.ref}}]});
  }});
 assert.equal(actors,2);assert.equal(prerequisiteReviews,1);assert.equal(reviews,1);assert.equal(saves,1);
 assert.deepEqual(state.counters(),{submissions:0,homeVisits:1,loginVisits:1});
 assert.equal(state.calls.filter(call=>call.name==='browser_click').length,1);
 assert.equal(state.calls.filter(call=>call.name==='browser_fill').length,0);
 const operations=recordedSectionRequests(state.observations,state.step.id);
 assert.deepEqual(operations.map(operation=>operation.name),['browser_navigate','browser_click','browser_assert']);
 assert.equal(recordedSectionObjectTargets(state.observations,state.step.id).length,2,'actual link and input targets can be saved with this section');
 const verified=await runVerificationPipeline({mode:'verify',executionDriver:'playwright_test_cli',startUrl:state.base+'/home',parameters:{},sections:[{step_id:state.step.id,action:state.step.action,expected_result:state.step.expected_result,automation_code:built.steps[0].automation_code,operations}],run:request=>runAutomationVerificationCli(request,{artifactRoot:state.root})});
 assert.equal(verified.status,'passed',JSON.stringify(verified));assert.equal(verified.execution_driver,'playwright_test_cli');
 assert.equal(state.counters().submissions,0);assert.equal(state.counters().loginVisits,2,'the independent authorized run repeats the saved closed program once');
});

test('inaccurate intent produces the observed prerequisite rejection without a click, save or altered expectation',{timeout:60000},async t=>{
 const state=await fixture(t);let actors=0,reviews=0,saves=0;
 await assert.rejects(runAutomationBrowserAgent({browser:state.session,startUrl:state.base+'/home',execution:state.execution,actorMode:true,prompt:'Reach the required login form.',maxTurns:5,maxCalls:8,parse:JSON.parse,
  onPartialBuild:async()=>{saves++;return {generation_complete:true};},complete:async(prompt,_timeout,trace)=>{
   if(trace?.generationScope==='section_prerequisite_review'){reviews++;return JSON.stringify({...allowed,decision:'block',reason:'The current manual goal is inconsistent with the supported application flow.',necessary_for_current_step:false});}
   actors++;const page=current(prompt).current_snapshot,link=page.targets.find(target=>target.role==='link');return JSON.stringify({prerequisite_request:{reason:'Investigate the required route.',evidence_refs:[page.observation_id],tool_call:{name:'browser_click',arguments:{locator:link.ref}}}});
  }}),error=>error.code==='AUTOMATION_PREREQUISITE_REJECTED'&&error.message.includes('inconsistent'));
 assert.equal(actors,1);assert.equal(reviews,1);assert.equal(saves,0);assert.equal(state.calls.filter(call=>call.name==='browser_click').length,0);
 assert.deepEqual(state.counters(),{submissions:0,homeVisits:1,loginVisits:0});
});
