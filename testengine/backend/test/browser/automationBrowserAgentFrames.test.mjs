import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import {registerAutomationMcp} from '../../dist/lib/automationMcp.js';
import {runAutomationVerification} from '../../dist/lib/automationVerification.js';
const require=createRequire(import.meta.url);
const {connectAutomationBrowser,runAutomationBrowserAgent}=require('../../../../services/automation/backend/lib/automationBrowserAgent.js');
const {deriveProgramTools}=require('../../../../services/automation/backend/lib/automationProgramTools.js');
const {inspectExecutablePlan}=require('../../../../services/automation/backend/services/automationReadiness.service.js');
const state=prompt=>JSON.parse(prompt.match(/^Current browser state and confirmed section progress .*?: (.+)$/m)[1]);
const receipt=observation=>JSON.parse(observation.result.content.find(block=>block.type==='text').text);

test('real Engineer actor injects observed frame scope, refreshes child navigation and compiles confirmed work without action replay',{timeout:120000},async t=>{
  const previous=process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;process.env.RECORDER_ALLOWED_PRIVATE_HOSTS='127.0.0.1';
  t.after(()=>{if(previous===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=previous;});
  const directory=await mkdtemp(path.join(tmpdir(),'qaira-agent-frames-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const app=Fastify();let intended=0,wrong=0;
  app.get('/shell',async(_request,reply)=>reply.type('text/html').send('<!doctype html><title>Top application</title><label>Name<input id="name" value="Parent remains untouched"></label><button onclick="fetch(\'/wrong\',{method:\'POST\'})">Next</button><iframe id="outer" src="/form" style="width:700px;height:350px"></iframe><iframe id="sibling" src="/sibling" style="width:700px;height:350px"></iframe>'));
  app.get('/form',async(_request,reply)=>reply.type('text/html').send('<!doctype html><title>Embedded form</title><h1 id="heading">Enter details</h1><label>Name<input id="name"></label><button id="next" onclick="fetch(\'/advance\',{method:\'POST\'}).then(()=>location.href=\'/details\')">Next</button>'));
  app.get('/details',async(_request,reply)=>reply.type('text/html').send('<!doctype html><title>Embedded details</title><h1 id="heading">Details ready</h1><label>Name<input id="name" value="Different document"></label><button id="next" onclick="fetch(\'/wrong\',{method:\'POST\'})">Next</button>'));
  app.get('/sibling',async(_request,reply)=>reply.type('text/html').send('<!doctype html><title>Sibling form</title><label>Name<input id="name"></label><button id="next" onclick="fetch(\'/wrong\',{method:\'POST\'})">Next</button>'));
  app.post('/advance',async()=>{intended++;return {ok:true};});app.post('/wrong',async()=>{wrong++;return {ok:true};});
  await registerAutomationMcp(app,async()=>{});const base=await app.listen({host:'127.0.0.1',port:0});t.after(()=>app.close());
  const browser=await connectAutomationBrowser({integration:{base_url:base},startUrl:base+'/shell',allowBrowserActions:true});t.after(()=>browser.close());
  const original=browser.call,calls=[],observations=[];
  browser.call=async(name,args,...rest)=>{calls.push({name,arguments:structuredClone(args)});return original(name,args,...rest);};
  let turns=0,saves=0,initialDocument,oldHeadingRef;
  const stepId='embedded-flow';
  const result=await runAutomationBrowserAgent({browser,startUrl:base+'/shell',prompt:'Enter the name in the embedded application and advance once. Verify Details ready in the embedded document.',
    execution:{required:true,step_id:stepId,action:'Enter the name in the embedded form and click Next once',expected_result:'Details ready is visible in the embedded application'},actorMode:true,generationMode:'sequential',parse:JSON.parse,maxTurns:5,maxCalls:24,
    onObservation:observation=>observations.push(observation),onPartialBuild:async payload=>{saves++;assert.equal(intended,1);assert.equal(wrong,0);assert.equal(inspectExecutablePlan(payload.steps).length,0);return {generation_complete:true};},
    complete:async prompt=>{
      const current=state(prompt),snapshot=current.current_snapshot;turns++;
      const actor=(tool_calls,section_complete=false)=>JSON.stringify({stage:'act',step_id:stepId,section_complete,tool_calls});
      if(turns===1){assert.equal(snapshot.frame_path,undefined);const frame=snapshot.frames.find(row=>row.url===base+'/form');assert.deepEqual(frame.path,['#outer']);return actor([{name:'browser_snapshot',arguments:{frame:frame.path}}]);}
      if(turns===2){
        assert.deepEqual(snapshot.frame_path,['#outer']);assert.equal(snapshot.frame_url,base+'/form');initialDocument=snapshot.frame_document_id;
        const input=snapshot.targets.find(target=>target.name==='Name'),next=snapshot.targets.find(target=>target.name==='Next');
        oldHeadingRef=snapshot.targets.find(target=>target.name==='Enter details').ref;
        // The model provides refs only: the host must bind their frame scope.
        return actor([{name:'browser_fill',arguments:{locator:input.ref,value:'Review fixture name'}},{name:'browser_click',arguments:{locator:next.ref}},
          {name:'browser_assert',arguments:{assertion:'text',locator:oldHeadingRef,value:'Details ready'}}]);
      }
      assert.equal(turns,3,'host reads should resolve the child transition without another action/model retry');
      assert.deepEqual(snapshot.frame_path,['#outer']);assert.equal(snapshot.frame_url,base+'/details');assert.notEqual(snapshot.frame_document_id,initialDocument);
      const heading=snapshot.targets.find(target=>target.name==='Details ready');assert.ok(heading);assert.notEqual(heading.ref,oldHeadingRef);
      return actor([{name:'browser_assert',arguments:{assertion:'text',locator:heading.ref,value:'Details ready'}},
        {name:'browser_assert',arguments:{assertion:'url',value:base+'/shell'}},{name:'browser_assert',arguments:{assertion:'title',value:'Top application'}}],true);
    }});
  assert.equal(turns,3);assert.equal(saves,1);assert.equal(intended,1);assert.equal(wrong,0);
  const mutations=calls.filter(call=>['browser_fill','browser_click'].includes(call.name));assert.equal(mutations.length,2);
  assert.ok(mutations.every(call=>JSON.stringify(call.arguments.frame)==='["#outer"]'));
  const clickIndex=calls.findIndex(call=>call.name==='browser_click'),after=calls.slice(clickIndex+1);
  assert.equal(after[0].name,'browser_snapshot');assert.deepEqual(after[0].arguments,{frame:['#outer']},'the prior observed scope is checked first');
  assert.equal(after[1].name,'browser_snapshot');assert.deepEqual(after[1].arguments,{});
  assert.equal(after[2].name,'browser_snapshot');assert.deepEqual(after[2].arguments,{frame:['#outer']},'a safe stale document refreshes inventory once before re-entering the observed path');
  const clickObservation=observations.findIndex(row=>row.tool==='browser_click');
  const staleSnapshot=observations.slice(clickObservation+1).find(row=>row.tool==='browser_snapshot');
  assert.equal(staleSnapshot.result.isError,true);assert.equal(receipt(staleSnapshot).code,'BROWSER_FRAME_STALE');
  assert.equal(receipt(staleSnapshot).action_outcome,'not_attempted');assert.equal(receipt(staleSnapshot).retry_safe,true);
  assert.equal(calls.filter(call=>call.name==='browser_assert').length,3,'the stale pre-navigation assertion was never dispatched');
  const code=result.steps[0].automation_code;assert.match(code,/page\.frameLocator\("#outer"\)/);
  const operations=deriveProgramTools({payload:result,execution:{required:true,step_id:stepId}});assert.ok(operations);
  assert.equal(operations.filter(operation=>operation.name==='browser_click').length,1);
  assert.equal(operations.filter(operation=>operation.name==='browser_assert'&&operation.arguments.frame).length,1);
  const scopedReceipts=observations.filter(observation=>['browser_fill','browser_click'].includes(observation.tool)).map(receipt);
  assert.ok(scopedReceipts.every(value=>value.frame_document_id===initialDocument));
  await browser.close();
  const replay=await runAutomationVerification({schema_version:1,verification_id:randomUUID(),lease_token:randomUUID(),start_url:base+'/shell',parameters:{},sections:[{step_id:stepId,automation_code:code,operations}],replay_policy:{mode:'authorized_run',allow_mutations:true},timeout_ms:15000},{artifactRoot:directory});
  assert.equal(replay.status,'passed',JSON.stringify(replay));assert.equal(replay.completed_interactions,2);assert.equal(replay.assertion_count,3);
  assert.equal(intended,2,'exactly one advance in Engineer, then one independent authorized replay');assert.equal(wrong,0);
});

test('stable framed filter, entry and Search retain row uniqueness plus three checks inside the unchanged twelve-call budget',{timeout:60000},async t=>{
  const previous=process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;process.env.RECORDER_ALLOWED_PRIVATE_HOSTS='127.0.0.1';
  t.after(()=>{if(previous===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=previous;});
  const app=Fastify();let searches=0;
  app.get('/shell',async(_r,reply)=>reply.type('text/html').send('<!doctype html><title>Employee workspace</title><label>Employee<input id="employee" value="Parent untouched"></label><iframe id="employee-frame" src="/employees" style="width:800px;height:500px"></iframe>'));
  app.get('/employees',async(_r,reply)=>reply.type('text/html').send('<!doctype html><title>Employees</title><button id="filters" aria-pressed="false" onclick="this.setAttribute(\'aria-pressed\',\'true\')">Filters</button><label>Employee<input id="employee"></label><button id="search" onclick="document.querySelector(\'#results\').innerHTML=\'<p id=&quot;row&quot;></p>\';document.querySelector(\'#row\').textContent=document.querySelector(\'#employee\').value;fetch(\'/searched\',{method:\'POST\'})">Search</button><section id="results"></section>'));
  app.post('/searched',async()=>{searches++;return {ok:true};});
  await registerAutomationMcp(app,async()=>{});const base=await app.listen({host:'127.0.0.1',port:0});t.after(()=>app.close());
  const browser=await connectAutomationBrowser({integration:{base_url:base},startUrl:base+'/shell',allowBrowserActions:true});t.after(()=>browser.close());
  browser.tools=browser.tools.filter(tool=>tool.name!=='browser_screenshot');
  await browser.call('browser_navigate',{url:base+'/shell'});await browser.call('browser_snapshot',{});
  const initial=await browser.call('browser_snapshot',{frame:['#employee-frame']});
  const original=browser.call,calls=[];browser.call=async(name,args,...rest)=>{calls.push({name,arguments:structuredClone(args)});return original(name,args,...rest);};
  const stepId='filter-employee';let turns=0,saves=0;
  const result=await runAutomationBrowserAgent({browser,prompt:'Filter the employee list and search once; preserve all four authored checks.',actorMode:true,generationMode:'sequential',parse:JSON.parse,maxTurns:4,maxCalls:12,
    execution:{required:true,step_id:stepId,action:'Open filters, enter the employee name and click Search',expected_result:'One matching employee row is visible with the entered name and Search remains enabled'},
    initialObservations:[{tool:'browser_snapshot',arguments:{frame:['#employee-frame']},result:initial,execution_step_id:stepId}],
    onPartialBuild:async payload=>{saves++;assert.equal(inspectExecutablePlan(payload.steps).length,0);return {generation_complete:true};},
    complete:async prompt=>{
      const snapshot=state(prompt).current_snapshot;turns++;assert.deepEqual(snapshot.frame_path,['#employee-frame']);
      const target=name=>snapshot.targets.find(row=>row.name===name)?.ref;
      if(turns===1)return JSON.stringify({stage:'act',step_id:stepId,section_complete:false,tool_calls:[
        {name:'browser_click',arguments:{locator:target('Filters')}},{name:'browser_fill',arguments:{locator:target('Employee'),value:'Fresh employee'}},{name:'browser_click',arguments:{locator:target('Search')}}]});
      assert.equal(turns,2);const row=snapshot.targets.find(target=>target.tag==='p'&&target.text==='Fresh employee')?.ref;assert.ok(row,'Search exposes the matching employee row in the scoped snapshot');
      return JSON.stringify({stage:'act',step_id:stepId,section_complete:true,tool_calls:[
        {name:'browser_assert',arguments:{assertion:'count',locator:row,value:'1'}},
        {name:'browser_assert',arguments:{assertion:'value',locator:target('Employee'),value:'Fresh employee'}},
        {name:'browser_assert',arguments:{assertion:'text',locator:row,value:'Fresh employee'}},
        {name:'browser_assert',arguments:{assertion:'enabled',locator:target('Search')}}]});
    }});
  assert.equal(saves,1);assert.equal(searches,1);assert.equal(turns,2);
  assert.ok(calls.length<=12,JSON.stringify(calls));
  assert.equal(calls.filter(call=>['browser_click','browser_fill'].includes(call.name)).length,3);
  assert.equal(calls.filter(call=>call.name==='browser_assert').length,4,'Row uniqueness and every expected-result check remain');
  const reads=calls.filter(call=>call.name==='browser_snapshot');assert.ok(reads.length<=3);
  assert.ok(reads.every(call=>JSON.stringify(call.arguments.frame)==='["#employee-frame"]'),'Stable frame reads never duplicate root inventory');
  assert.match(result.steps[0].automation_code,/frameLocator\("#employee-frame"\)/);
});
