import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import Fastify from 'fastify';
import {registerAutomationMcp} from '../../dist/lib/automationMcp.js';
const require=createRequire(import.meta.url);
const {connectAutomationBrowser,runAutomationBrowserAgent}=require('../../../../services/automation/backend/lib/automationBrowserAgent.js');
const {createRetainedAssertionContract}=require('../../../../services/automation/backend/lib/automationRetainedAssertions.js');
const {compileRecordedProgram}=require('../../../../services/automation/backend/lib/automationRecordedProgram.js');
const {inspectExecutablePlan}=require('../../../../services/automation/backend/services/automationReadiness.service.js');
const {deriveProgramTools}=require('../../../../services/automation/backend/lib/automationProgramTools.js');
const receipt=result=>JSON.parse(result.content.find(block=>block.type==='text').text);

test('saved iframe Search hands off through bounded document refresh, native checks and mandatory review/source validation without another actor',{timeout:90000},async t=>{
 const previous=process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;process.env.RECORDER_ALLOWED_PRIVATE_HOSTS='127.0.0.1';
 t.after(()=>{if(previous===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=previous;});
 const app=Fastify();let searches=0,extraAdds=0;
 app.get('/shell',async(_request,reply)=>reply.type('text/html').send('<!doctype html><title>Employee workspace</title><iframe id="employee-frame" src="/search" style="width:800px;height:400px"></iframe>'));
 app.get('/search',async(_request,reply)=>reply.type('text/html').send('<!doctype html><title>Search employees</title><button id="search" onclick="location.href=\'/results\'">Search</button><a id="add" onclick="fetch(\'/extra-add\',{method:\'POST\'})">add</a>'));
 app.get('/results',async(_request,reply)=>{searches++;return reply.type('text/html').send('<!doctype html><title>Results</title><h1>Search complete</h1><a id="add" onclick="fetch(\'/extra-add\',{method:\'POST\'})">add</a>');});
 app.post('/extra-add',async()=>{extraAdds++;return {ok:true};});
 await registerAutomationMcp(app,async()=>{});const base=await app.listen({host:'127.0.0.1',port:0});t.after(()=>app.close());
 const frame=['#employee-frame'],stepId='search-current',click={name:'browser_click',arguments:{frame,locator:'getByRole("button", {name:"Search",exact:true})'}};
 const checks=[{name:'browser_assert',arguments:{frame,locator:'getByRole("heading", {name:"Search complete",exact:true})',assertion:'visible'}},
  {name:'browser_assert',arguments:{frame,locator:'getByRole("heading", {name:"Search complete",exact:true})',assertion:'text',value:'Search complete'}}];
 const source=compileRecordedProgram([click,...checks]).source;
 for(const scenario of ['accepted','budget-exhausted','source-rejected'])await t.test(scenario,async()=>{
  const before=searches,browser=await connectAutomationBrowser({integration:{base_url:base},startUrl:base+'/shell',allowBrowserActions:true});
  try{
   browser.tools=browser.tools.filter(tool=>tool.name!=='browser_screenshot');browser.projectPromptText=value=>value;
   await browser.call('browser_navigate',{url:base+'/shell'});await browser.call('browser_snapshot',{});
   const initial=await browser.call('browser_snapshot',{frame}),oldDocument=receipt(initial).frame_document_id;
   const original=browser.call,calls=[],observations=[];browser.call=async(name,args,...rest)=>{calls.push({name,args:structuredClone(args)});return original(name,args,...rest);};
   let actors=0,reviews=0,sourceAttempts=0,commits=0,seals=0;
   const goal={id:stepId,source:'section',action:'Click Search in the embedded employee application',expected_result:'The Search complete heading is visible and contains exactly Search complete'};
   const contract=createRetainedAssertionContract({step:{id:stepId,step_type:'web',automation_code:source}});assert.equal(contract.status,'available');
   const run=()=>runAutomationBrowserAgent({browser,prompt:'Execute the current saved Search and preserve its two exact heading checks.',actorMode:true,generationMode:'sequential',parse:JSON.parse,maxTurns:1,maxCalls:scenario==='budget-exhausted'?3:12,
    execution:{required:true,step_id:stepId,action:goal.action,expected_result:goal.expected_result,obligations:[goal],source_obligations:[goal],semantic_review_required:true,retained_assertion_contract:contract},
    initialObservations:[{tool:'browser_snapshot',arguments:{frame},result:initial,execution_step_id:stepId}],onObservation:row=>observations.push(row),onRecordedContract:()=>{seals++;},
    complete:async prompt=>{
     if(prompt.includes('"kind":"automation_section_semantic_review"')){
      reviews++;const packet=JSON.parse(prompt.split('\n').at(-1));assert.equal(packet.confirmed_operations.filter(operation=>operation.name==='browser_click').length,1);
      return JSON.stringify({decision:'accept',obligations:packet.obligations.map(obligation=>({id:obligation.id,action_operations:[1],assertion_operations:[2,3]})),issues:[]});
     }
     actors++;const current=JSON.parse(prompt.match(/^Current browser state and confirmed section progress .*?: (.+)$/m)[1]);
     const locator=current.current_snapshot.targets.find(target=>target.name==='Search')?.ref;assert.ok(locator);
     return JSON.stringify({stage:'act',step_id:stepId,section_complete:false,tool_calls:[{name:'browser_click',arguments:{locator}}]});
    },onPartialBuild:async payload=>{
     sourceAttempts++;assert.equal(reviews,1);assert.equal(seals,1);assert.equal(inspectExecutablePlan(payload.steps).length,0);
     if(scenario==='source-rejected')return {generation_complete:false,validation_errors:[{code:'AUTOMATION_GENERATED_ASSERTION_NOT_PRESERVED'}]};
     commits++;return {generation_complete:true};
    }});
   if(scenario==='budget-exhausted'){
    await assert.rejects(run(),error=>error.code==='AUTOMATION_BROWSER_TOOL_BUDGET_EXHAUSTED');
    assert.equal(calls.length,3);assert.equal(calls.filter(call=>call.name==='browser_assert').length,0);assert.equal(reviews,0);assert.equal(sourceAttempts,0);
   }else{
    if(scenario==='source-rejected')await assert.rejects(run(),error=>['AUTOMATION_RECORDED_SECTION_VALIDATION_STALLED','AUTOMATION_RECORDED_SECTION_VALIDATION_REJECTED'].includes(error.code));
    else{const result=await run();assert.match(result.steps[0].automation_code,/frameLocator\("#employee-frame"\)/);
     const replay=deriveProgramTools({payload:result,execution:{required:true,step_id:stepId}});assert.ok(replay);
     assert.deepEqual(replay.map(operation=>operation.name),['browser_click','browser_assert','browser_assert']);
     assert.deepEqual(replay.slice(1).map(operation=>operation.arguments.assertion),['visible','text']);assert.equal(replay[2].arguments.value,'Search complete');assert.ok(replay.every(operation=>JSON.stringify(operation.arguments.frame)===JSON.stringify(frame)));
    }
    assert.equal(reviews,1);assert.equal(sourceAttempts,1);
    const snapshots=observations.filter(row=>row.tool==='browser_snapshot');assert.equal(snapshots[0].result.isError,true);assert.equal(receipt(snapshots[0].result).code,'BROWSER_FRAME_STALE');
    assert.equal(receipt(snapshots[0].result).action_outcome,'not_attempted');assert.equal(receipt(snapshots[0].result).retry_safe,true);
    assert.deepEqual(snapshots.map(row=>row.arguments),[{frame},{},{frame}]);
    assert.notEqual(receipt(snapshots.at(-1).result).frame_document_id,oldDocument);
    assert.equal(calls.filter(call=>call.name==='browser_assert').length,2);assert.ok(calls.length<=12);
   }
   assert.equal(actors,1,'No completion acknowledgement or extra Add proposal is requested');
   assert.equal(commits,scenario==='accepted'?1:0);assert.equal(searches-before,1,'Search navigation is never replayed');assert.equal(extraAdds,0);
   assert.equal(calls.filter(call=>call.name==='browser_click').length,1);
  }finally{await browser.close();}
 });
});
