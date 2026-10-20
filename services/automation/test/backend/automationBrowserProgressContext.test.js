const test=require('node:test');
const assert=require('node:assert/strict');
const {runAutomationBrowserAgent}=require('../../backend/lib/automationBrowserAgent');
const {browserPromptContext,browserCurrentSnapshotObservation,browserCurrentSnapshot}=require('../../backend/lib/automationBrowserContext');
const {browserRecoveryState,recordBrowserCheck,confirmedLocatorValidation,browserToolBudgetError}=require('../../backend/lib/automationBrowserRecovery');

const url='https://app.test/auth',stepId='signup-navigation';
const good='getByRole("textbox", { name: "Email", exact: true })';
const bad='getByRole("textbox", { name: "Email *" })';
const result=(value,isError=false)=>({isError,content:[{type:'text',text:JSON.stringify({source:'playwright',url,...value})}]});
const page=()=>({url,title:'Signup',accessibility:'- main:\n  - heading "Sign up"\n  - textbox "Email"\n  - button "Sign up"',elements:[{tag:'input',accessible_role:'textbox',accessible_name:'Email',label:'Email',displayed:true,in_viewport:true,disabled:false,locators_validated:true,locator_candidates:[good,'getByLabel("Email *", { exact: true })','#email-input'],attributes:{id:'email-input',placeholder:'Email*',type:'email'}}]});
const snapshot=(id='actual-initial')=>({tool:'browser_snapshot',execution_step_id:stepId,result:result({...page(),observation_id:id,captured_at:'2026-10-16T22:53:25.359Z'})});
const observation=(tool,args,value,isError=false)=>({tool,execution_step_id:stepId,arguments:args,result:result(value,isError)});
const failedAssertion=()=>observation('browser_assert',{assertion:'visible',locator:bad},{code:'BROWSER_ASSERTION_NOT_SATISFIED',assertion_outcome:'not_satisfied',action_outcome:'not_attempted',retry_safe:true,message:'The browser expected-result assertion did not pass.'},true);
const failedLookup=()=>observation('browser_validate_locator',{locator:bad},{match_count:0,unique:false});
const uniqueLookup=()=>observation('browser_validate_locator',{locator:good},{match_count:1,unique:true});
const actor=(tool_calls,complete=false)=>JSON.stringify({stage:'act',step_id:stepId,section_complete:complete,tool_calls});
const current=prompt=>JSON.parse(prompt.split('\n').find(line=>line.startsWith('Current browser state and confirmed section progress')).split(': ').slice(1).join(': '));
const tools=['browser_assert','browser_validate_locator','browser_snapshot'].map(name=>({name,inputSchema:{type:'object'}}));

test('corrected unique lookup retires a lookup error while the prior failed assertion remains an explicit obligation',()=>{
  const observations=[snapshot(),failedAssertion(),failedLookup(),uniqueLookup()];
  const model=browserPromptContext(observations,stepId,{compactModel:true});
  assert.equal(model.current.latest_failure.tool,'browser_assert');
  assert.equal(model.current.latest_failure.code,'BROWSER_ASSERTION_NOT_SATISFIED');
  assert.equal(model.current.latest_failure.remaining_contract,'browser_assert_required_after_failed_check');
  assert.equal(model.current.latest_failure.locator,undefined);
  assert.equal(model.current.locator_resolution.expected_result_verified,false);
  assert.match(model.current.locator_resolution.locator,/^ref:/);
  assert.doesNotMatch(JSON.stringify(model),/Email \*/);
  const discoveryOnly=browserPromptContext([snapshot(),failedLookup(),uniqueLookup()],stepId);
  assert.equal(discoveryOnly.current.latest_failure,undefined);
  assert.equal(discoveryOnly.current.locator_resolution.unique,true);
});

test('a corrected locator cannot erase an unrelated generated-source validation error',()=>{
  const source={tool:'automation_source_validation',execution_step_id:stepId,mcp_call:false,result:result({code:'AUTOMATION_GENERATED_SOURCE_INVALID',message:'Current section source is invalid.'})};
  const model=browserPromptContext([snapshot(),source,failedLookup(),uniqueLookup()],stepId,{compactModel:true});
  assert.equal(model.current.latest_failure.code,'AUTOMATION_GENERATED_SOURCE_INVALID');
  assert.equal(model.current.locator_resolution.expected_result_verified,false);
});

test('outcome-target reassessment remains pending through discovery and clears after a successful current-section assertion',()=>{
  const feedback={tool:'automation_section_issue_feedback',execution_step_id:stepId,mcp_call:false,
    result:result({code:'AUTOMATION_BROWSER_OUTCOME_TARGET_REVIEW_REQUIRED',reason:'failed_text_target_not_in_current_snapshot',
      message:'Inspect persistent current evidence without repeating the completed action.'},true)};
  const observations=[snapshot(),failedAssertion(),feedback];
  const initial=JSON.stringify(observations);
  const pending=browserPromptContext(observations,stepId,{compactModel:true});
  assert.equal(pending.current.latest_failure.kind,'outcome_target');
  assert.equal(pending.current.latest_failure.allowed_recovery,'read_only_outcome_reassessment');
  assert.equal(browserPromptContext([...observations,uniqueLookup()],stepId,{compactModel:true}).current.latest_failure.kind,'outcome_target',
    'a unique locator establishes discovery, not the required outcome');
  const satisfied=observation('browser_assert',{assertion:'visible',locator:good},{assertion_outcome:'satisfied'});
  const otherSection={...satisfied,execution_step_id:'another-section'};
  assert.equal(browserPromptContext([...observations,otherSection],stepId,{compactModel:true}).current.latest_failure.kind,'outcome_target');
  const corrected=browserPromptContext([...observations,uniqueLookup(),satisfied],stepId,{compactModel:true});
  assert.equal(corrected.current.latest_failure,undefined);
  assert.equal(corrected.current.recent_section_receipts.at(-1).assertion_outcome,'satisfied');
  assert.equal(browserPromptContext([...observations,failedAssertion()],stepId,{compactModel:true}).current.latest_failure.code,'BROWSER_ASSERTION_NOT_SATISFIED');
  assert.equal(JSON.stringify(observations),initial,'context projection does not rewrite retained host evidence');
});

// Privacy-safe replay of the observed AT32 sequence: zero-match Email* role,
// then repeated successful Email role discovery without a real assertion.
test('AT32 corrected-lookup replay caches repeated success, then saves only after the actual expected-result assertion',async()=>{
 const calls=[],events=[],observations=[];let turns=0,saves=0;
 // The previously observed label changes before the first assertion. Its
 // native failure is genuine; recovery then exposes the current Email target.
 const initial=snapshot(),initialPage=JSON.parse(initial.result.content[0].text);
 initialPage.elements[0].accessible_name='Email *';initialPage.elements[0].locator_candidates=[bad];
 initial.result.content[0].text=JSON.stringify(initialPage);
  const browser={tools,call:async(name,args)=>{
    calls.push({name,args});
    if(name==='browser_snapshot')return result({...page(),observation_id:`actual-snapshot-${calls.length}`});
    if(name==='browser_validate_locator')return result({match_count:args.locator===good?1:0,unique:args.locator===good});
    if(args.locator===bad)return failedAssertion().result;
    assert.equal(args.locator,good);return result({assertion_outcome:'satisfied'});
  }};
 const built=await runAutomationBrowserAgent({browser,prompt:'Reach the signup page without submitting it.',execution:{required:true,step_id:stepId,action:'Navigate to signup',expected_result:'Signup email input is visible'},actorMode:true,generationMode:'sequential',parse:JSON.parse,initialObservations:[initial],maxCalls:6,
    onObservation:item=>observations.push(item),onProgress:event=>events.push(event),
    complete:async prompt=>{
      turns++;const state=current(prompt),target=state.current_snapshot.targets.find(item=>item.name==='Email');
      if(turns===1)return actor([{name:'browser_assert',arguments:{assertion:'visible',locator:bad}}]);
      assert.ok(target?.ref);
      if(turns===2)return actor([{name:'browser_validate_locator',arguments:{locator:bad}}]);
      if(turns===3)return actor([{name:'browser_validate_locator',arguments:{locator:target.ref}}]);
      assert.equal(state.pending_contract.expected_result_check,'required');
      assert.equal(state.pending_contract.locator_validation_is_expected_result_check,false);
      assert.equal(state.pending_contract.next_required,'perform_remaining_goal_and_browser_assert');
      assert.equal(state.recorded_section.completion_available,false);
      assert.equal(state.latest_failure.tool,'browser_assert');
      assert.equal(state.locator_resolution.expected_result_verified,false);
      if(turns===4)return actor([{name:'browser_validate_locator',arguments:{locator:target.ref}}],true);
      assert.match(prompt,/AUTOMATION_LOCATOR_ALREADY_VALIDATED/);
      assert.equal(saves,0);
      return actor([{name:'browser_assert',arguments:{assertion:'visible',locator:target.ref}}],true);
    },onPartialBuild:async()=>{saves++;return {generation_complete:true};}});
  assert.equal(turns,5);assert.equal(saves,1);
  assert.deepEqual(calls.map(item=>item.name),['browser_assert','browser_snapshot','browser_validate_locator','browser_snapshot','browser_validate_locator','browser_assert']);
  assert.equal(observations.filter(item=>item.tool==='automation_locator_feedback'&&item.mcp_call===false).length,1);
  assert.match(built.steps[0].automation_code,/getByRole\("textbox",.*"name":"Email"/);
  assert.doesNotMatch(built.steps[0].automation_code,/Email \*|ref:/);
  const packed=events.filter(item=>item.phase==='automation.agent.prompt.packed');
  assert.equal(packed.length,5);
  assert.ok(packed.every(item=>Number.isSafeInteger(item.details.prompt_utf8_bytes)&&Number.isSafeInteger(item.details.current_state_chars)));
  assert.ok(packed.every(item=>!Object.keys(item.details).some(key=>key.includes('estimated_tokens'))));
});

test('only protected actual unique-check receipts may suppress a redundant discovery call',()=>{
  const observations=[snapshot()],request={name:'browser_validate_locator',arguments:{locator:good}};
  const actual=uniqueLookup();recordBrowserCheck(actual,request,browserRecoveryState(observations,request));observations.push(actual);
  assert.equal(confirmedLocatorValidation({request,observations,stepId}).match_count,1);
  assert.equal(confirmedLocatorValidation({request,observations:structuredClone(observations),stepId}),null);
  observations.push({tool:'browser_click',execution_step_id:stepId,action_id:'actual-mutation',result:result({action_outcome:'completed'})});
  assert.equal(confirmedLocatorValidation({request,observations,stepId}),null);
});

test('typed budget diagnostics stop blaming a resolved zero-match lookup without pretending an assertion passed',()=>{
  const error=browserToolBudgetError({observations:[snapshot(),failedAssertion(),failedLookup(),uniqueLookup()],stepId,calls:6,maxCalls:6});
  assert.equal(error.details.latest_browser_failure.tool,'browser_assert');
  assert.equal(error.details.latest_browser_failure.code,'BROWSER_ASSERTION_NOT_SATISFIED');
  const discoveryOnly=browserToolBudgetError({observations:[snapshot(),failedLookup(),uniqueLookup()],stepId,calls:6,maxCalls:6});
  assert.equal(discoveryOnly.details.latest_browser_failure,undefined);
  assert.doesNotMatch(discoveryOnly.message,/matches 0 elements/);
});

test('compact model context retains one live page and bounded typed history while full evidence remains unchanged',()=>{
  const initial=snapshot(),raw=JSON.stringify(initial);
  const old=Array.from({length:18},(_,index)=>({tool:'browser_snapshot',execution_step_id:'previous',result:result({...page(),observation_id:`old-${index}`,accessibility:'Old decorative content '.repeat(900)})}));
  const observations=[...old,initial,...Array.from({length:12},()=>uniqueLookup())];
  const legacy=browserPromptContext(observations,stepId),compact=browserPromptContext(observations,stepId,{compactModel:true});
  assert.equal(browserCurrentSnapshotObservation(observations),initial);
  assert.deepEqual(browserCurrentSnapshot(observations),JSON.parse(initial.result.content[0].text));
  assert.equal(JSON.stringify(initial),raw);
  assert.ok(JSON.stringify(compact).length<JSON.stringify(legacy).length*.45);
  assert.equal(compact.history.some(item=>item.tool==='browser_snapshot'),false);
  assert.equal(compact.history.some(item=>item.tool==='browser_validate_locator'),false);
  assert.ok(compact.current.recent_section_receipts.length<=6);
  assert.doesNotMatch(JSON.stringify(compact.current.current_snapshot),/locator_candidates|attributes|getByLabel/);
});
