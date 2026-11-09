import test from 'node:test';
import assert from 'node:assert/strict';
import {groundSnapshotLocators} from '../dist/lib/automationSnapshotLocators.js';
import {AutomationObservedSubjects} from '../dist/lib/automationObservedSubjects.js';

test('grounding prioritizes current viewport controls, reuses selector counts and returns only proved candidates under budget',async()=>{
 const calls=[],counts=new Map(),elements=Array.from({length:120},(_,i)=>({tag:'input',displayed:true,in_viewport:false,snapshot_selector:'#off'+i,snapshot_role:'textbox',snapshot_candidates:[],locator_candidates:[],locators_validated:false}));
 elements.push({tag:'input',displayed:true,in_viewport:true,snapshot_selector:'#current',snapshot_role:'textbox',snapshot_candidates:[],locator_candidates:[],locators_validated:false});
 const page={locator:selector=>({count:async()=>{calls.push(selector);counts.set(selector,(counts.get(selector)||0)+1);if(selector!=='#current')await new Promise(resolve=>setTimeout(resolve,50));return 1;},ariaSnapshot:async()=>'- textbox',evaluate:async()=>true})};
 const started=Date.now(),result=await groundSnapshotLocators(page,elements,started+90,async()=>true);
 assert.ok(Date.now()-started<250);assert.equal(result.incomplete,true);assert.equal(calls[0],'#current');
 assert.deepEqual(elements.at(-1).locator_candidates,['#current']);assert.equal(counts.get('#current'),1);
 assert.ok(elements.slice(0,-1).some(element=>element.locator_candidates.length===0));
 assert.ok(elements.every(element=>!('snapshot_selector'in element)&&!('snapshot_candidates'in element)));
});

test('a late native no-role anchor is grounded before navigation links without synthesizing its role or treating a redacted href as absent',async()=>{
 const calls=[],elements=Array.from({length:120},(_,i)=>({tag:'a',attributes:{},displayed:true,in_viewport:true,snapshot_selector:'#nav'+i,snapshot_role:'link',snapshot_candidates:[],locator_candidates:[],locators_validated:false}));
 elements.push({tag:'a',attributes:{id:'icon'},text:'add',displayed:true,in_viewport:true,snapshot_selector:'#icon',snapshot_role:'',snapshot_candidates:['#icon'],locator_candidates:[],locators_validated:false});
 const page={locator:selector=>({count:async()=>{calls.push(selector);if(selector!=='#icon')await new Promise(resolve=>setTimeout(resolve,50));return 1;},ariaSnapshot:async()=>'- generic "add"',evaluate:async()=>true})};
 const result=await groundSnapshotLocators(page,elements,Date.now()+90,async()=>true);
 assert.equal(calls[0],'#icon');assert.equal(result.incomplete,true);assert.deepEqual(elements.at(-1).locator_candidates,['#icon']);
 assert.equal(elements.at(-1).accessible_role,undefined);assert.equal(elements.at(-1).attributes.role,undefined);
 assert.ok(elements.every(element=>!('snapshot_role'in element)));
});

test('late subject reads cannot grant aliases after their deadline or a newer snapshot generation',async()=>{
 for(const replaceSnapshot of [false,true]){
  const subjects=new AutomationObservedSubjects();await subjects.beginSnapshot();let release,started;
  const ready=new Promise(resolve=>{started=resolve;}),identity={attached:true,same_node:true,complete:true,tag:'input',text_excerpt:'',text_truncated:false,attributes:[['id','name']],context_text:'must not arrive late'};
  const target={elementHandle:async()=>({dispose:async()=>{}}),evaluate:async()=>{started();return new Promise(resolve=>{release=()=>resolve(identity);});}};
  const element={tag:'input',text:'',attributes:{id:'name'},locator_candidates:['#name']},page={url:()=> 'https://app.test/form',locator:()=>({count:async()=>0})};
  const pending=subjects.observe(target,element,page,Date.now()+(replaceSnapshot?1000:20));await ready;
  if(replaceSnapshot)await subjects.beginSnapshot();else await new Promise(resolve=>setTimeout(resolve,25));
  release();assert.equal(await pending,false);assert.equal(element.context_text,undefined);
  await assert.rejects(subjects.resolve(page,'#name',Date.now()+100),{code:'BROWSER_OBSERVED_SUBJECT_REQUIRED'});
 }
});
