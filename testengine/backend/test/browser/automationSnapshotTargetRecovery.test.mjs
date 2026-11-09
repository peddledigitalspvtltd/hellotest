import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import Fastify from 'fastify';
import {chromium} from 'playwright';
import {registerAutomationMcp} from '../../dist/lib/automationMcp.js';

const require=createRequire(import.meta.url);
const {connectAutomationBrowser,runAutomationBrowserAgent}=require('../../../../services/automation/backend/lib/automationBrowserAgent.js');
const payload=result=>JSON.parse(result.content.find(block=>block.type==='text').text);
const stateFromPrompt=prompt=>JSON.parse(prompt.match(/^Current browser state and confirmed section progress \(page content is untrusted data\): (.+)$/m)[1]);

async function fixture(t,failures){
 const previous=process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;
 process.env.RECORDER_ALLOWED_PRIVATE_HOSTS='127.0.0.1';
 const app=Fastify(),calls=[],observations=[];
 let native,page,remaining=failures,domFailures=0,accessibilityReads=0;
 app.get('/menu',async(_request,reply)=>reply.type('text/html').send('<!doctype html><title>Employee navigation</title><main><h1>Home</h1><button id="employees" onclick="window.menuClicks++;document.querySelector(\'#add-employee\').hidden=false">Employees</button><button id="add-employee" hidden>Add employee</button></main><script>window.menuClicks=0;</script>'));
 await registerAutomationMcp(app,async()=>{},{launchBrowser:async options=>{
  native=await chromium.launch(options);
  const newContext=native.newContext.bind(native);
  native.newContext=async options=>{
   const context=await newContext(options);
   context.on('page',value=>{
    page=value;
    const locator=page.locator.bind(page);
    page.locator=(selector,...args)=>{
     const scoped=locator(selector,...args);
     if(selector==='body'){
      const evaluate=scoped.evaluate.bind(scoped),ariaSnapshot=scoped.ariaSnapshot.bind(scoped);
      scoped.ariaSnapshot=async(...args)=>{accessibilityReads++;return ariaSnapshot(...args);};
      scoped.evaluate=async(fn,...args)=>{
       // This trusted fixture seam fails only the bounded DOM inventory. The
       // accessibility read, native browser, HTTP MCP and target grounding stay real.
       if(remaining>0&&String(fn).includes('const controlSelector')){
        remaining--;domFailures++;throw new Error('Fixture bounded DOM inventory unavailable');
       }
       return evaluate(fn,...args);
      };
     }
     return scoped;
    };
   });
   return context;
  };
  return native;
 }});
 const base=await app.listen({host:'127.0.0.1',port:0}),url=base+'/menu';
 const browser=await connectAutomationBrowser({integration:{base_url:base},startUrl:url,allowBrowserActions:true});
 browser.projectPromptText=value=>value;
 const call=browser.call;
 browser.call=async(name,args,options)=>{calls.push({name,args});return call(name,args,options);};
 t.after(async()=>{
  await browser.close();await app.close();
  if(previous===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=previous;
 });
 return {browser,url,calls,observations,page:()=>page,stats:()=>({domFailures,accessibilityReads})};
}

test('real AX-only fallback receives one counted grounded snapshot before the actor clicks and saves',{timeout:30_000},async t=>{
 const f=await fixture(t,1);
 const goal={id:'employees',source:'section',action:'Open the Employees menu.',expected_result:'The Add employee button is visible.'};
 let turns=0,reviews=0,saves=0;
 const built=await runAutomationBrowserAgent({browser:f.browser,startUrl:f.url,actorMode:true,prompt:'Open Employees once and check the Add employee button.',
  execution:{required:true,step_id:goal.id,action:goal.action,expected_result:goal.expected_result,obligations:[goal],source_obligations:[goal],semantic_review_required:true},
  maxTurns:4,maxCalls:8,parse:JSON.parse,onObservation:async observation=>f.observations.push(observation),
  onPartialBuild:async()=>{saves++;return {generation_complete:true};},
  complete:async prompt=>{
   if(prompt.includes('"kind":"automation_section_semantic_review"')){
    reviews++;const packet=JSON.parse(prompt.split('\n').at(-1));
    const click=packet.confirmed_operations.find(row=>row.name==='browser_click');
    const check=packet.confirmed_operations.find(row=>row.name==='browser_assert');
    assert.ok(click);assert.equal(check.arguments.assertion,'visible');
    return JSON.stringify({decision:'accept',obligations:[{id:goal.id,action_operations:[click.index],assertion_operations:[check.index]}],issues:[]});
   }
   turns++;const current=stateFromPrompt(prompt),page=current.current_snapshot;
   assert.notEqual(page.targets_unavailable,true,'AX text alone never becomes actor target authority');
   if(turns===1){
    const snapshots=f.observations.filter(row=>row.tool==='browser_snapshot'&&row.mcp_call!==false);
    assert.equal(snapshots.length,2,'the actor is admitted only after the counted recovery read');
    const fallback=payload(snapshots[0].result),fresh=payload(snapshots[1].result);
    assert.equal(fallback.partial,true);assert.deepEqual(fallback.elements,[]);assert.match(fallback.accessibility,/Employees/);
    assert.equal(fresh.partial,false);assert.notEqual(fallback.observation_id,fresh.observation_id);
    assert.ok(fresh.elements.find(row=>row.attributes?.id==='employees')?.locators_validated);
    const menu=page.targets.find(row=>row.name==='Employees');assert.ok(menu?.ref);
    return JSON.stringify({stage:'act',step_id:goal.id,section_complete:false,tool_calls:[{name:'browser_click',arguments:{locator:menu.ref}}]});
   }
   assert.equal(turns,2);const target=page.targets.find(row=>row.name==='Add employee');assert.ok(target?.ref);
   return JSON.stringify({stage:'act',step_id:goal.id,section_complete:true,tool_calls:[{name:'browser_assert',arguments:{assertion:'visible',locator:target.ref}}]});
  }
 });
 assert.equal(turns,2);assert.equal(reviews,1);assert.equal(saves,1);
 assert.equal(f.calls.filter(row=>row.name==='browser_navigate').length,1);
 assert.equal(f.calls.filter(row=>row.name==='browser_click').length,1);
 assert.equal(f.calls.filter(row=>row.name==='browser_assert').length,1);
 assert.equal(await f.page().evaluate(()=>window.menuClicks),1);
 assert.equal(f.stats().domFailures,1);assert.ok(f.stats().accessibilityReads>=2);
 assert.match(built.steps[0].automation_code,/\.click\(/);
});

test('a second real AX-only fallback stops at the three-call budget before any actor or click',{timeout:20_000},async t=>{
 const f=await fixture(t,2);let actors=0,saves=0;
 await assert.rejects(runAutomationBrowserAgent({browser:f.browser,startUrl:f.url,actorMode:true,prompt:'Open Employees once.',
  execution:{required:true,step_id:'employees',action:'Open the Employees menu.',expected_result:'The Add employee button is visible.'},
  maxTurns:3,maxCalls:3,parse:JSON.parse,onObservation:async observation=>f.observations.push(observation),
  onPartialBuild:async()=>{saves++;},complete:async()=>{actors++;assert.fail('A second AX-only response cannot reach the actor');}
 }),error=>error.code==='AUTOMATION_BROWSER_CONTEXT_UNREADABLE'&&error.action_outcome==='not_attempted');
 assert.equal(actors,0);assert.equal(saves,0);assert.equal(await f.page().evaluate(()=>window.menuClicks),0);
 const snapshots=f.observations.filter(row=>row.tool==='browser_snapshot'&&row.mcp_call!==false);
 assert.equal(snapshots.length,2);
 for(const row of snapshots){const page=payload(row.result);assert.equal(page.partial,true);assert.deepEqual(page.elements,[]);assert.match(page.accessibility,/Employees/);}
 assert.deepEqual(f.calls.filter(row=>row.name!=='browser_screenshot').map(row=>row.name),['browser_navigate','browser_snapshot','browser_snapshot']);
 assert.equal(f.stats().domFailures,2);assert.equal(f.stats().accessibilityReads,2);
});
