import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {chromium} from 'playwright';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {registerAutomationMcp} from '../../dist/lib/automationMcp.js';
import {createPrivilegedRunGuard,resolveTestEngineSharedSecret} from '../../dist/lib/testEngineSecurity.js';
import {createWebRunSession} from '../../dist/lib/webEngine.js';
const require=createRequire(import.meta.url);
const {connectAutomationBrowser,runAutomationBrowserAgent}=require('../../../../services/automation/backend/lib/automationBrowserAgent');
const {createBrowserParameterResolver}=require('../../../../services/automation/backend/lib/automationBrowserParameters');
const {buildAutomationParameterBindings}=require('../../../../services/automation/backend/lib/automationParameterBindings');
const {createAutomationInputParameterBinding}=require('../../../../services/automation/backend/lib/automationInputParameterBinding');
const {recordedSectionRequests}=require('../../../../services/automation/backend/lib/automationBrowserRecording');

test('real MCP bootstrap saves an original navigation reference and the same source replays against two edited absolute URLs',{timeout:90000},async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'qaira-navigation-binding-'));
  const previous={ARTIFACT_ROOT:process.env.ARTIFACT_ROOT,RECORDER_ALLOWED_PRIVATE_HOSTS:process.env.RECORDER_ALLOWED_PRIVATE_HOSTS};
  Object.assign(process.env,{ARTIFACT_ROOT:root,RECORDER_ALLOWED_PRIVATE_HOSTS:'127.0.0.1'});
  const visits=[];
  const first=Fastify(),second=Fastify();
  first.get('/entry',async(_req,reply)=>{visits.push('first');return reply.type('text/html').send('<!doctype html><title>Destination ready</title><h1>First destination</h1>');});
  second.get('/entry',async(_req,reply)=>{visits.push('second');return reply.type('text/html').send('<!doctype html><title>Destination ready</title><h1>Second destination</h1>');});
  await registerAutomationMcp(first,createPrivilegedRunGuard(resolveTestEngineSharedSecret()),{launchBrowser:options=>chromium.launch(options)});
  const firstUrl=(await first.listen({host:'127.0.0.1',port:0}))+'/entry';
  const secondUrl=(await second.listen({host:'127.0.0.1',port:0}))+'/entry';
  t.after(async()=>{await first.close();await second.close();await rm(root,{recursive:true,force:true});for(const [key,value]of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;});
  const resolver=createBrowserParameterResolver({caseValues:{'t.base_url':firstUrl,'r.unrelated':firstUrl},materialize:false});
  const original={id:'open',source:'section',action:'Open @t.base_url',expected_result:'The page title is Destination ready.'};
  const bindings=buildAutomationParameterBindings({obligations:[original],referencedParameterNames:resolver.referencedParameterNames});
  const inputParameterBinding=createAutomationInputParameterBinding({stepId:'open',obligations:[original],bindings,parameterValues:resolver.promptValues,privateParameterNames:resolver.privateParameterNames});
  const browser=await connectAutomationBrowser({integration:{base_url:new URL(firstUrl).origin},startUrl:firstUrl,allowBrowserActions:true});
  t.after(()=>browser.close());
  const rawCall=browser.call,transport=[],observations=[];
  browser.projectPromptText=resolver.projectText;browser.projectPrivateText=resolver.projectPrivateText;browser.canonicalizeParameterArguments=resolver.canonicalArguments;
  browser.call=async(name,args)=>{const resolved=resolver.resolve(name,args);if(name==='browser_navigate')transport.push({saved:args.url,actual:resolved.url});return rawCall(name,resolved);};
  const execution={required:true,step_id:'open',action:resolver.projectText(original.action),expected_result:original.expected_result,source_obligations:[original],obligations:resolver.projectSteps([original]),navigation_parameter_references:['t.base_url'],semantic_review_required:true};
  let modelCalls=0,saved;
  const built=await runAutomationBrowserAgent({browser,startUrl:firstUrl,prompt:'Build the original navigation action and verify its title.',actorMode:true,execution,inputParameterBinding,parse:JSON.parse,maxTurns:3,maxCalls:5,
    onObservation:observation=>observations.push(observation),complete:async(_prompt,_remaining,trace)=>{
      modelCalls++;
      return trace?.generationScope==='section_semantic_review'?JSON.stringify({decision:'accept',obligations:[{id:'open',action_operations:[1],assertion_operations:[2]}],issues:[]}):JSON.stringify({stage:'act',step_id:'open',section_complete:true,tool_calls:[{name:'browser_assert',arguments:{assertion:'title',value:'Destination ready'}}]});
    },onPartialBuild:async payload=>{saved=payload.steps[0].automation_code;return {generation_complete:true};}});
  assert.equal(modelCalls,2);assert.deepEqual(transport,[{saved:'@t.base_url',actual:firstUrl}]);
  assert.equal(recordedSectionRequests(observations,'open')[0].arguments.url,'@t.base_url');
  assert.match(saved,/page.goto\("@t.base_url"\)/);assert.doesNotMatch(saved,/127\.0\.0\.1/);assert.equal(built.steps[0].automation_code,saved);
  await browser.close();
  for(const [index,url]of [firstUrl,secondUrl].entries()){
    const source=JSON.parse(JSON.stringify(saved));
    const session=createWebRunSession({engine_run_id:'navigation-replay-'+index,browser:'chromium',headless:true,web_engine:{active:'playwright'},run_timeout_seconds:15,max_repair_attempts:0,
      parameters_frozen:true,case_parameters:{'t.base_url':url},artifact_policy:{video_mode:'off',trace_mode:'off',screenshot_on_success:false,screenshot_on_failure:false,capture_console:false,capture_network:false},steps:[]});
    try{await session.start();const result=await session.runStep({id:'open',order:1,step_type:'web',action:original.action,expected_result:original.expected_result,automation_code:source});assert.equal(result.status,'passed',result.note);assert.equal(result.web_detail.url,url);}
    finally{await session.stop();}
    assert.equal(source,saved,'changing data cannot rewrite the saved source');
  }
  assert.ok(visits.includes('first'));assert.ok(visits.includes('second'));
});
