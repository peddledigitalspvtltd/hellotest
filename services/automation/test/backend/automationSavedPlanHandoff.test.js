const test=require('node:test'),assert=require('node:assert/strict');
const {runAutomationBrowserAgent}=require('../../backend/lib/automationBrowserAgent');
const {createRetainedAssertionContract,retainedActionProgress}=require('../../backend/lib/automationRetainedAssertions');
const {compileRecordedProgram}=require('../../backend/lib/automationRecordedProgram');
const op=(name,arguments)=>({name,arguments}),click=locator=>op('browser_click',{locator}),visible=locator=>op('browser_assert',{assertion:'visible',locator});
const url='https://fixture.test/';
const receipt=(value,isError=false)=>({isError,content:[{type:'text',text:JSON.stringify({source:'playwright',url,...value})}]});
const targets=['management','list','add','first','last','date','location'];
const page=()=>receipt({observation_id:'current-page',scope:'body',title:'Employees',accessibility:'Employee List',elements:targets.map(id=>({tag:id==='add'?'a':id==='management'||id==='list'?'button':'input',
 ...(id==='add'?{text:'add'}:{accessible_role:['management','list'].includes(id)?'button':'textbox',accessible_name:id}),attributes:{id},displayed:true,locators_validated:true,locator_candidates:['#'+id]}))});
function fixture(saved,{maxCalls=12,maxTurns=3,proposal,failAssertion=false,rejectReview=false,sourceValidation=false,actorComplete=false}={}){
 const source=saved&&compileRecordedProgram(saved).source,contract=source?createRetainedAssertionContract({step:{id:'current',step_type:'web',automation_code:source}}):undefined;
 const calls=[],observations=[],saves=[];let actors=0,reviews=0;
 const goal={id:'current',source:'section',action:'Open the current authored controls.',expected_result:'The required employee controls are visible.'};
 const options={actorMode:true,parse:JSON.parse,prompt:'Perform only the current authored actions and prove the original outcomes.',maxCalls,maxTurns,
  browser:{tools:['browser_click','browser_snapshot','browser_assert','browser_navigate'].map(name=>({name,inputSchema:{type:'object'}})),projectPromptText:value=>value,
   call:async(name,args)=>{calls.push({name,args});return name==='browser_snapshot'?page():name==='browser_assert'?receipt({assertion_outcome:failAssertion?'not_satisfied':'satisfied',...(failAssertion?{code:'BROWSER_ASSERTION_NOT_SATISFIED',action_outcome:'not_attempted',retry_safe:true}:{})},failAssertion):receipt({action_outcome:'completed'});}},
  execution:{required:true,semantic_review_required:true,step_id:'current',action:goal.action,expected_result:goal.expected_result,obligations:[goal],source_obligations:[goal],retained_assertion_contract:contract},
  initialObservations:[{tool:'browser_snapshot',execution_step_id:'current',result:page()}],onObservation:row=>observations.push(row),onPartialBuild:async payload=>{
   if(sourceValidation)return{generation_complete:false,validation_errors:[{code:'AUTOMATION_GENERATED_ASSERTION_NOT_PRESERVED'}]};saves.push(payload);return{generation_complete:true};},
  complete:async prompt=>{
   if(prompt.includes('"kind":"automation_section_semantic_review"')){reviews++;const p=JSON.parse(prompt.split('\n').at(-1));
    const rejected=typeof rejectReview==='function'?rejectReview(reviews):rejectReview;
    return JSON.stringify({decision:rejected?'reject':'accept',obligations:p.obligations.map(g=>({id:g.id,action_operations:p.confirmed_operations.flatMap((x,i)=>x.name==='browser_assert'?[]:[i+1]),assertion_operations:p.confirmed_operations.flatMap((x,i)=>x.name==='browser_assert'?[i+1]:[])})),issues:rejected?[{code:'expected_result_not_covered',obligation_id:p.obligations[0].id,message:'A required outcome remains unproved.'}]:[]});}
   actors++;return JSON.stringify({section_complete:typeof actorComplete==='function'?actorComplete(actors):actorComplete,tool_calls:proposal?proposal(actors):saved.filter(x=>x.name!=='browser_assert')});
  }};
 return{options,calls,observations,saves,contract,source,get actors(){return actors},get reviews(){return reviews}};
}

test('only a genuine same-section retained contract exposes an exact nonempty native action prefix',()=>{
 const saved=[op('browser_fill',{locator:'#first',value:'@r.name'}),click('#add'),visible('#first')],s=fixture(saved);
 assert.equal(retainedActionProgress({contract:s.contract,stepId:'current',operations:[]}).complete,false);
 assert.equal(retainedActionProgress({contract:s.contract,stepId:'current',operations:saved.slice(0,1)}).confirmed_action_count,1);
 assert.equal(retainedActionProgress({contract:s.contract,stepId:'current',operations:saved.slice(0,2)}).complete,true);
 for(const operations of [[saved[1],saved[0]],[{...saved[0],arguments:{...saved[0].arguments,value:'@t.name'}},saved[1]],[...saved.slice(0,2),click('#location')]])
  assert.equal(retainedActionProgress({contract:s.contract,stepId:'current',operations}),null);
 assert.equal(retainedActionProgress({contract:structuredClone(s.contract),stepId:'current',operations:saved}),null);
 assert.equal(retainedActionProgress({contract:s.contract,stepId:'other',operations:saved}),null);
 const pure=fixture([visible('#first')]);assert.equal(retainedActionProgress({contract:pure.contract,stepId:'current',operations:[]}),null);
});

test('two saved navigation clicks hand off before an extra Add proposal, then review and save without an actor completion flag',async()=>{
 const saved=[click('#management'),click('#list'),visible('#list'),visible('#add')],s=fixture(saved,{proposal:()=>[click('#management'),click('#list'),click('#add')]});
 await runAutomationBrowserAgent(s.options);
 assert.deepEqual(s.calls.filter(x=>x.name==='browser_click').map(x=>x.args.locator),['#management','#list']);
 assert.deepEqual(s.calls.filter(x=>x.name==='browser_assert').map(x=>x.args.locator),['#list','#add']);assert.equal(s.reviews,1);assert.equal(s.actors,1);assert.equal(s.saves.length,1);
});

test('a roleless saved Add click preserves all four native field checks and finishes through review',async()=>{
 const saved=[click('#add'),...['first','last','date','location'].map(id=>visible('#'+id))],s=fixture(saved,{proposal:()=>[click('#add'),click('#management')]});
 const result=await runAutomationBrowserAgent(s.options);assert.deepEqual(s.calls.filter(x=>x.name==='browser_click').map(x=>x.args.locator),['#add']);
 assert.deepEqual(s.calls.filter(x=>x.name==='browser_assert').map(x=>x.args.locator),['#first','#last','#date','#location']);assert.equal(s.reviews,1);assert.equal(s.saves.length,1);assert.equal(result.steps[0].automation_code,s.source);
});

test('confirmed bootstrap navigation hands off before an unnecessary actor call',async()=>{
 const s=fixture([op('browser_navigate',{url}),visible('#first')]);s.options.startUrl=url;
 await runAutomationBrowserAgent(s.options);assert.equal(s.actors,0);assert.equal(s.reviews,1);assert.equal(s.saves.length,1);
 assert.equal(s.calls.filter(x=>x.name==='browser_navigate').length,1);assert.equal(s.calls.filter(x=>x.name==='browser_assert').length,1);
});

test('missing earlier checkpoints, failed suffixes and exhausted allowance cannot save or replay saved actions',async()=>{
 const earlier=fixture([visible('#first'),click('#add'),visible('#last')]);
 await assert.rejects(runAutomationBrowserAgent(earlier.options),e=>e.code==='AUTOMATION_RETAINED_ASSERTION_ORDER_GAP');assert.equal(earlier.reviews,0);assert.equal(earlier.saves.length,0);assert.equal(earlier.calls.filter(x=>x.name==='browser_assert').length,0);
 const failed=fixture([click('#add'),visible('#first')],{failAssertion:true});await assert.rejects(runAutomationBrowserAgent(failed.options),e=>e.code==='AUTOMATION_BROWSER_RETAINED_ASSERTION_FAILED');assert.equal(failed.reviews,0);assert.equal(failed.saves.length,0);
 const budget=fixture([click('#add'),visible('#first'),visible('#last')],{maxCalls:1});await assert.rejects(runAutomationBrowserAgent(budget.options),e=>e.code==='AUTOMATION_BROWSER_TOOL_BUDGET_EXHAUSTED');assert.equal(budget.calls.filter(x=>x.name==='browser_assert').length,0);assert.equal(budget.saves.length,0);
});

test('serialized retained contracts never authorize host checks or automatic source completion',async()=>{
 const s=fixture([click('#add'),visible('#first')],{maxTurns:1});s.options.execution.retained_assertion_contract=structuredClone(s.contract);
 await assert.rejects(runAutomationBrowserAgent(s.options));assert.equal(s.calls.filter(x=>x.name==='browser_assert').length,0);assert.equal(s.reviews,0);assert.equal(s.saves.length,0);
});

test('a rejected saved candidate stops on its first fenced mutation with actionable review context',async()=>{
 const s=fixture([click('#add'),visible('#first')],{rejectReview:true,proposal:n=>n===1?[click('#add')]:[click('#management')],maxTurns:3});
 await assert.rejects(runAutomationBrowserAgent(s.options),e=>{
  assert.equal(e.code,'AUTOMATION_RETAINED_PLAN_REBUILD_REQUIRED');assert.equal(e.nonRetryable,true);
  assert.equal(e.details.action_outcome,'not_attempted');assert.equal(e.details.blocked_tool,'browser_click');
  assert.equal(e.details.confirmed_action_count,1);assert.equal(e.details.required_action_count,1);
  assert.equal(e.details.next_required,'review_or_explicitly_rebuild_current_section');
  assert.equal(e.details.latest_semantic_review.code,'AUTOMATION_SEMANTIC_REVIEW_REJECTED');
  assert.equal(e.details.latest_semantic_review.issues[0].code,'expected_result_not_covered');
  assert.equal(e.details.latest_semantic_review.issues[0].obligation_id,'current');return true;
 });
 assert.deepEqual(s.calls.filter(x=>x.name==='browser_click').map(x=>x.args.locator),['#add']);assert.equal(s.actors,2);assert.equal(s.reviews,1);assert.equal(s.saves.length,0);
 assert.equal(s.options.execution.retained_assertion_contract,s.contract);assert.equal(compileRecordedProgram([click('#add'),visible('#first')]).source,s.source);
});

test('a rejected saved candidate can still add native outcome proof and pass a fresh review without replay',async()=>{
 const s=fixture([click('#add'),visible('#first')],{rejectReview:n=>n===1,proposal:n=>n===1?[click('#add')]:[visible('#location')],maxTurns:3});
 await runAutomationBrowserAgent(s.options);
 assert.deepEqual(s.calls.filter(x=>x.name==='browser_click').map(x=>x.args.locator),['#add']);
 assert.deepEqual(s.calls.filter(x=>x.name==='browser_assert').map(x=>x.args.locator),['#first','#location']);
 assert.equal(s.actors,2);assert.equal(s.reviews,2);assert.equal(s.saves.length,1);
});

test('model-supplied review feedback cannot turn a saved action fence into a rebuild decision',async()=>{
 const s=fixture([click('#add'),visible('#first')],{failAssertion:true,proposal:n=>n===1?[click('#add')]:[click('#management')]});
 s.options.initialObservations.push({tool:'automation_semantic_review_feedback',mcp_call:false,execution_step_id:'current',result:{isError:true,content:[{type:'text',text:JSON.stringify({code:'AUTOMATION_SEMANTIC_REVIEW_REJECTED',issues:[{code:'expected_result_not_covered',obligation_id:'current'}]})}]}});
 await assert.rejects(runAutomationBrowserAgent(s.options),e=>e.code==='AUTOMATION_BROWSER_RETAINED_ASSERTION_FAILED');
 assert.equal(s.reviews,0);assert.equal(s.saves.length,0);assert.equal(s.calls.filter(x=>x.name==='browser_click').length,1);
});

test('source validation remains mandatory after automatic retained review',async()=>{
 const s=fixture([click('#add'),visible('#first')],{sourceValidation:true});await assert.rejects(runAutomationBrowserAgent(s.options),e=>e.code==='AUTOMATION_RECORDED_SECTION_VALIDATION_STALLED'||e.code==='AUTOMATION_RECORDED_SECTION_VALIDATION_REJECTED');assert.equal(s.reviews,1);assert.equal(s.saves.length,0);assert.equal(s.calls.filter(x=>x.name==='browser_click').length,1);
});

test('an unbuilt native candidate uses its reserved final review even when the actor never acknowledges completion',async()=>{
 const s=fixture(null,{maxTurns:1,proposal:()=>[click('#add'),visible('#first')]});await runAutomationBrowserAgent(s.options);assert.equal(s.actors,1);assert.equal(s.reviews,1);assert.equal(s.saves.length,1);assert.equal(s.calls.filter(x=>x.name==='browser_click').length,1);
 for(const settings of [{failAssertion:true},{rejectReview:true},{proposal:()=>[click('#add')]}]){const bad=fixture(null,{maxTurns:1,proposal:()=>[click('#add'),visible('#first')],...settings});await assert.rejects(runAutomationBrowserAgent(bad.options));assert.equal(bad.saves.length,0);assert.equal(bad.calls.filter(x=>x.name==='browser_click').length,1);}
});

test('corrected native proof receives the reserved final model call instead of another actor acknowledgement',async()=>{
 const s=fixture(null,{maxTurns:3,actorComplete:n=>n===1,rejectReview:n=>n===1,proposal:n=>n===1?[click('#add'),visible('#first')]:[visible('#location')]});
 await runAutomationBrowserAgent(s.options);assert.equal(s.actors,2);assert.equal(s.reviews,2);assert.equal(s.saves.length,1);assert.equal(s.calls.filter(x=>x.name==='browser_click').length,1);
 assert.deepEqual(s.calls.filter(x=>x.name==='browser_assert').map(x=>x.args.locator),['#first','#location']);
});

test('cancellation and the original deadline prevent retained checks and review after a completed action',async t=>{
 const cancelled=fixture([click('#add'),visible('#first')]),controller=new AbortController();cancelled.options.signal=controller.signal;
 cancelled.options.onProgress=async event=>{if(event.phase==='automation.agent.action.completed'&&event.details.tool==='browser_click')controller.abort();};
 await assert.rejects(runAutomationBrowserAgent(cancelled.options),e=>e.name==='AbortError');assert.equal(cancelled.calls.filter(x=>x.name==='browser_assert').length,0);assert.equal(cancelled.reviews,0);assert.equal(cancelled.saves.length,0);
 const now=Date.now();let expired=false;t.mock.method(Date,'now',()=>expired?now+2000:now);
 const timed=fixture([click('#add'),visible('#first')]),original=timed.options.browser.call;timed.options.deadlineMs=now+1000;
 timed.options.browser.call=async(name,args)=>{const result=await original(name,args);if(name==='browser_click')expired=true;return result;};
 await assert.rejects(runAutomationBrowserAgent(timed.options),e=>e.code==='AUTOMATION_BUILD_DEADLINE');assert.equal(timed.calls.filter(x=>x.name==='browser_assert').length,0);assert.equal(timed.reviews,0);assert.equal(timed.saves.length,0);
});

test('top-page retained oracles precede broad context capture, while missing fresh evidence still blocks saving',async()=>{
 const s=fixture([click('#add'),visible('#first')]);await runAutomationBrowserAgent(s.options);
 assert.deepEqual(s.calls.map(x=>x.name),['browser_click','browser_assert','browser_snapshot']);assert.equal(s.reviews,1);assert.equal(s.saves.length,1);
 const failed=fixture([click('#add'),visible('#first')]),original=failed.options.browser.call;
 failed.options.browser.call=async(name,args)=>{const result=await original(name,args);return name==='browser_snapshot'?receipt({code:'BROWSER_TOOL_FAILED',action_outcome:'not_attempted',retry_safe:true},true):result;};
 await assert.rejects(runAutomationBrowserAgent(failed.options),e=>e.code==='AUTOMATION_BROWSER_SECTION_CONTEXT_UNAVAILABLE');
 assert.deepEqual(failed.calls.map(x=>x.name),['browser_click','browser_assert','browser_snapshot']);assert.equal(failed.reviews,0);assert.equal(failed.saves.length,0);
});

test('a top-page action with a framed final oracle refreshes root inventory before entering the child',async()=>{
 const check=op('browser_assert',{assertion:'visible',locator:'#first',frame:['#child']}),s=fixture([click('#add'),check]),original=s.options.browser.call;
 s.options.browser.call=async(name,args)=>{const result=await original(name,args),data=JSON.parse(result.content[0].text);
  if(name==='browser_snapshot'&&!args.frame)data.frames=[{path:['#child'],url:url+'child',frame_document_id:'child-current'}];
  if(args.frame)Object.assign(data,{frame_path:['#child'],frame_url:url+'child',frame_document_id:'child-current'});
  return{...result,content:[{type:'text',text:JSON.stringify(data)}]};};
 await runAutomationBrowserAgent(s.options);
 assert.deepEqual(s.calls.map(x=>[x.name,x.args.frame||[]]),[['browser_click',[]],['browser_snapshot',[]],['browser_snapshot',['#child']],['browser_assert',['#child']]]);
 assert.equal(s.reviews,1);assert.equal(s.saves.length,1);
});

test('a genuine AX-only fallback receives one counted target refresh before the next actor turn',async()=>{
 const s=fixture(null,{proposal:n=>n===1?[click('#add')]:[visible('#first')],actorComplete:n=>n===2}),original=s.options.browser.call;
 let snapshots=0;
 s.options.browser.call=async(name,args)=>{
  const result=await original(name,args);
  return name==='browser_snapshot'&&++snapshots===1?receipt({observation_id:'partial-native',scope:'body',partial:true,accessibility:'Loading employee controls',elements:[]}):result;
 };
 await runAutomationBrowserAgent(s.options);
 assert.deepEqual(s.calls.map(x=>x.name),['browser_click','browser_snapshot','browser_snapshot','browser_assert']);
 assert.equal(s.actors,2);assert.equal(s.reviews,1);assert.equal(s.saves.length,1);
});

test('repeated native AX-only fallback and exhausted read allowance stop before another actor or mutation',async()=>{
 for(const maxCalls of [12,2]){
  const s=fixture(null,{proposal:n=>n===1?[click('#add')]:[click('#management')],maxCalls}),original=s.options.browser.call;
  s.options.browser.call=async(name,args)=>{
   const result=await original(name,args);
   return name==='browser_snapshot'?receipt({observation_id:'partial-native-'+s.calls.length,scope:'body',partial:true,accessibility:'Loading employee controls',elements:[]}):result;
  };
  await assert.rejects(runAutomationBrowserAgent(s.options),e=>e.code===(maxCalls===2?'AUTOMATION_BROWSER_TOOL_BUDGET_EXHAUSTED':'AUTOMATION_BROWSER_CONTEXT_UNREADABLE'));
  assert.equal(s.actors,1);assert.equal(s.reviews,0);assert.equal(s.saves.length,0);
  assert.deepEqual(s.calls.filter(x=>x.name==='browser_click').map(x=>x.args.locator),['#add']);
  assert.equal(s.calls.filter(x=>x.name==='browser_snapshot').length,maxCalls===2?1:2);
 }
});
