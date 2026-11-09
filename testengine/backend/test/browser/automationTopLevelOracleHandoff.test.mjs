import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import Fastify from 'fastify';
import {registerAutomationMcp} from '../../dist/lib/automationMcp.js';
const require=createRequire(import.meta.url);
const {connectAutomationBrowser,runAutomationBrowserAgent}=require('../../../../services/automation/backend/lib/automationBrowserAgent.js');
const {createRetainedAssertionContract}=require('../../../../services/automation/backend/lib/automationRetainedAssertions.js');
const {compileRecordedProgram}=require('../../../../services/automation/backend/lib/automationRecordedProgram.js');
const {deriveProgramTools}=require('../../../../services/automation/backend/lib/automationProgramTools.js');
const {inspectExecutablePlan}=require('../../../../services/automation/backend/services/automationReadiness.service.js');
const receipt=result=>JSON.parse(result.content.find(block=>block.type==='text').text);

test('top-page saved outcome waits precede broad context discovery and still require fresh evidence and review/source save',{timeout:60000},async t=>{
 const previous=process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;process.env.RECORDER_ALLOWED_PRIVATE_HOSTS='127.0.0.1';
 t.after(()=>{if(previous===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=previous;});
 const app=Fastify();let effects=0;
 app.get('/start',async(_request,reply)=>reply.type('text/html').send('<!doctype html><title>Slow employee workspace</title><main id="shell"><button id="go" onclick="history.pushState({},\'\',\'/result\');document.body.setAttribute(\'aria-busy\',\'true\');document.querySelector(\'#shell\').innerHTML=\'<p>Loading...</p>\';fetch(\'/effect\',{method:\'POST\'});setTimeout(()=>{document.querySelector(\'#shell\').innerHTML=\'<button id=&quot;ready&quot;>Ready</button>\';document.body.removeAttribute(\'aria-busy\')},1400)">Go</button></main>'));
 app.post('/effect',async()=>{effects++;return {ok:true};});
 await registerAutomationMcp(app,async()=>{});const base=await app.listen({host:'127.0.0.1',port:0});t.after(()=>app.close());
 for(const scenario of ['accepted','budget-insufficient'])await t.test(scenario,async()=>{
  const before=effects,browser=await connectAutomationBrowser({integration:{base_url:base},startUrl:base+'/start',allowBrowserActions:true});
  try{
   browser.tools=browser.tools.filter(tool=>tool.name!=='browser_screenshot');browser.projectPromptText=value=>value;
   await browser.call('browser_navigate',{url:base+'/start'});const initial=await browser.call('browser_snapshot',{});
   const stepId='top-result',saved=[{name:'browser_click',arguments:{locator:'getByRole("button", {name:"Go",exact:true})'}},
    {name:'browser_assert',arguments:{assertion:'url',value:base+'/result'}},{name:'browser_assert',arguments:{assertion:'visible',locator:'#ready'}}];
   const source=compileRecordedProgram(saved).source,contract=createRetainedAssertionContract({step:{id:stepId,step_type:'web',automation_code:source}});assert.equal(contract.status,'available');
   const goal={id:stepId,source:'section',action:'Click Go once',expected_result:`The URL is ${base}/result and the Ready control is visible`};
   const calls=[],observations=[],original=browser.call;
   browser.call=async(name,args,...rest)=>{const row={name,args:structuredClone(args),started:Date.now()};calls.push(row);try{return await original(name,args,...rest);}finally{row.finished=Date.now();}};
   let actors=0,reviews=0,sourceAttempts=0,seals=0;
   const run=()=>runAutomationBrowserAgent({browser,prompt:'Perform the saved Go action once and check its exact URL and Ready outcome before contextual discovery.',actorMode:true,generationMode:'sequential',parse:JSON.parse,maxTurns:1,maxCalls:scenario==='accepted'?12:3,
    execution:{required:true,step_id:stepId,action:goal.action,expected_result:goal.expected_result,obligations:[goal],source_obligations:[goal],semantic_review_required:true,retained_assertion_contract:contract},
    initialObservations:[{tool:'browser_snapshot',arguments:{},result:initial,execution_step_id:stepId}],onObservation:row=>observations.push(row),onRecordedContract:()=>{seals++;},
    complete:async prompt=>{
     if(prompt.includes('"kind":"automation_section_semantic_review"')){
      reviews++;const packet=JSON.parse(prompt.split('\n').at(-1));
      assert.equal(packet.current_page.scope,'body');assert.ok(packet.current_page.targets.some(target=>target.name==='Ready'),'Review receives the fresh post-outcome page');
      const fresh=observations.filter(row=>row.tool==='browser_snapshot');assert.equal(fresh.length,1);assert.equal(fresh[0].result.isError,undefined);assert.equal(receipt(fresh[0].result).url,base+'/result');
      assert.equal(sourceAttempts,0);return JSON.stringify({decision:'accept',obligations:packet.obligations.map(row=>({id:row.id,action_operations:[1],assertion_operations:[2,3]})),issues:[]});
     }
     actors++;assert.equal(actors,1,'The saved native outcome needs no redundant completion acknowledgement');
     const current=JSON.parse(prompt.match(/^Current browser state and confirmed section progress .*?: (.+)$/m)[1]);
     const locator=current.current_snapshot.targets.find(target=>target.name==='Go')?.ref;assert.ok(locator);
     return JSON.stringify({stage:'act',step_id:stepId,section_complete:false,tool_calls:[{name:'browser_click',arguments:{locator}}]});
    },onPartialBuild:async payload=>{sourceAttempts++;assert.equal(reviews,1);assert.equal(seals,1);assert.equal(inspectExecutablePlan(payload.steps).length,0);return {generation_complete:true};}});
   if(scenario==='accepted'){
    const result=await run(),replay=deriveProgramTools({payload:result,execution:{required:true,step_id:stepId}});assert.ok(replay);
    assert.deepEqual(replay.map(operation=>operation.name),['browser_click','browser_assert','browser_assert']);assert.deepEqual(replay.slice(1).map(operation=>operation.arguments.assertion),['url','visible']);
    assert.deepEqual(calls.map(row=>row.name),['browser_click','browser_assert','browser_assert','browser_snapshot']);
    assert.equal(calls[1].args.assertion,'url');assert.equal(calls[2].args.locator,'#ready');
    assert.ok(calls[1].finished-calls[1].started>=750,'The first native outcome check must wait for the real delayed SPA state');
    assert.ok(calls[3].started>=calls[2].finished,'A broad snapshot cannot precede the saved native oracles');
    assert.equal(reviews,1);assert.equal(sourceAttempts,1);assert.equal(seals,1);assert.ok(calls.length<=12);
   }else{
    await assert.rejects(run(),error=>error.code==='AUTOMATION_BROWSER_TOOL_BUDGET_EXHAUSTED');
    assert.deepEqual(calls.map(row=>row.name),['browser_click'],'The complete original oracle suffix plus required fresh context must fit before starting a read');
    assert.equal(reviews,0);assert.equal(sourceAttempts,0);assert.equal(seals,0);
   }
   assert.equal(actors,1);assert.equal(calls.filter(row=>row.name==='browser_click').length,1);
   if(scenario==='accepted')assert.equal(effects-before,1,'The accepted Go effect cannot be replayed for evidence');
   else assert.ok(effects-before<=1,'A budget stop can close the browser before its asynchronous request completes, and cannot repeat it');
  }finally{await browser.close();}
 });
});
