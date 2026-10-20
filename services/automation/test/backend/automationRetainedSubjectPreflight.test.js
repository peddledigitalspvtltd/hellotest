const test = require('node:test');
const assert = require('node:assert/strict');
const { compileRecordedProgram } = require('../../backend/lib/automationRecordedProgram');
const { createRetainedAssertionContract } = require('../../backend/lib/automationRetainedAssertions');
const { assertRetainedInputSubject, canonicalizeRetainedInputRequest } = require('../../backend/lib/automationRetainedSubjectPreflight');
const { preserveGeneratedAssertions } = require('../../backend/lib/automationGeneratedProgram');
const { projectModelSnapshot } = require('../../backend/lib/automationBrowserModelTargets');
const { runAutomationBrowserAgent } = require('../../backend/lib/automationBrowserAgent');
const { buildFailureProgress } = require('../../backend/lib/automationBuildFailureProgress');
const { stepBuildError } = require('../../backend/lib/automationStepBuildErrors');
const oldLocator = 'getByLabel("PRIVATE saved password label", {"exact":true})';
const input = { name:'browser_fill', arguments:{locator:oldLocator,value:'@r.password'} };
const value = { name:'browser_assert', arguments:{assertion:'value',locator:oldLocator,value:'@r.password'} };
const valid = { name:'browser_assert', arguments:{assertion:'field_valid',locator:oldLocator} };
const operation = { name:'browser_fill', arguments:{locator:'#password-input',value:'@r.password'} };
const create = operations => createRetainedAssertionContract({step:{id:'password',step_type:'web',automation_code:compileRecordedProgram(operations).source}});
const receipt = (value,isError=false) => ({isError,content:[{type:'text',text:JSON.stringify({source:'playwright',url:'https://app.test/auth',...value})}]});
function snapshot({aliases=['#password-input'],extra=[]}={}) {
  const observation={tool:'browser_snapshot',result:receipt({observation_id:'current-auth',title:'Create account',scope:'body',elements:[{
    tag:'input',attributes:{id:'password-input',name:'password',type:'password'},accessible_name:'Password',displayed:true,disabled:false,locators_validated:true,locator_candidates:aliases
  },...extra]})};
  projectModelSnapshot(observation);return observation;
}
const call = (contract,options={}) => assertRetainedInputSubject({contract,stepId:'password',request:operation,operations:[],snapshot:snapshot(),...options});

test('a missing, ambiguous or unproven saved input subject stops before changing the proposed current field',async()=>{
  for(const count of [0,2,1]) {
    let reads=0;const contract=create([input,value,valid]);
    await assert.rejects(call(contract,{read:async subject=>{reads++;assert.equal(subject.locator,oldLocator);return {available:true,match_count:count};}}),error=>
      error.code==='AUTOMATION_RETAINED_SUBJECT_REVIEW_REQUIRED'&&error.nonRetryable===true&&error.action_outcome==='not_attempted'&&!/PRIVATE/.test(JSON.stringify(error)));
    assert.equal(reads,1);
  }
});

test('fresh same-control aliases need no extra read; distinct observed fields cannot acquire subject equivalence',async()=>{
  let reads=0;const contract=create([input,value,valid]),read=async()=>{reads++;return {available:true,match_count:1};};
  assert.equal(await call(contract,{snapshot:snapshot({aliases:['#password-input',oldLocator]}),read}),false);assert.equal(reads,0);
  const other={tag:'input',attributes:{id:'other',type:'password'},displayed:true,locators_validated:true,locator_candidates:[oldLocator]};
  await assert.rejects(call(contract,{snapshot:snapshot({extra:[other]}),read}),error=>error.code==='AUTOMATION_RETAINED_SUBJECT_REVIEW_REQUIRED'&&error.details.retained_subject_issue==='different_observed_field');
  assert.equal(reads,0);
});

test('only same-current-target aliases with exact binding and protected action prefix canonicalize to the saved input locator',()=>{
  const contract=create([input,value,valid]),current=snapshot({aliases:['#password-input',oldLocator]});
  const request={...operation,occurrence:1},options={contract,stepId:'password',request,operations:[],snapshot:current};
  const result=canonicalizeRetainedInputRequest(options);
  assert.equal(result.canonicalized,true);assert.equal(result.request.arguments.locator,oldLocator);assert.equal(result.request.arguments.value,request.arguments.value);assert.equal(result.request.occurrence,1);assert.equal(request.arguments.locator,'#password-input');
  assert.equal(canonicalizeRetainedInputRequest({...options,operations:[input]}).canonicalized,true,'a later alias reconciles with the original completed input');
  for(const changed of [
    {contract:structuredClone(contract)}, {stepId:'other'}, {snapshot:snapshot()},
    {request:{...request,arguments:{...request.arguments,value:'@t.password'}}},
    {operations:[{name:'browser_click',arguments:{locator:'#different-action'}}]},
    {operations:[operation]},
    {snapshot:snapshot({extra:[{tag:'input',attributes:{id:'another'},displayed:true,locators_validated:true,locator_candidates:[oldLocator]}]})}
  ])assert.equal(canonicalizeRetainedInputRequest({...options,...changed}).canonicalized,false);
  current.result.content[0].text=current.result.content[0].text.replace('current-auth','changed-auth');assert.equal(canonicalizeRetainedInputRequest(options).canonicalized,false,'changed receipts invalidate their private registry proof');
});

test('assertion alias canonicalization requires the exact next original oracle and complete confirmed operation prefix',()=>{
  const contract=create([input,value,valid]),current=snapshot({aliases:['#password-input',oldLocator]});
  const canonical=(request,operations)=>canonicalizeRetainedInputRequest({contract,stepId:'password',request,operations,snapshot:current});
  const nextValue={name:'browser_assert',arguments:{...value.arguments,locator:'#password-input'}},nextValid={name:'browser_assert',arguments:{assertion:'field_valid',locator:'#password-input'}};
  assert.equal(canonical(nextValue,[input]).request.arguments.locator,oldLocator);assert.equal(canonical(nextValid,[input,value]).request.arguments.locator,oldLocator);
  for(const [request,operations] of [[nextValue,[]],[nextValid,[input]],[nextValue,[input,value]],[{...nextValue,arguments:{...nextValue.arguments,value:'@t.password'}},[input]],
    [{...nextValid,arguments:{...nextValid.arguments,value:''}},[input,value]],[nextValid,[input,{...value,arguments:{...value.arguments,locator:'#other'}}]]])assert.equal(canonical(request,operations).canonicalized,false);
});

test('the narrow guard requires a genuine complete same-binding contract at the saved input action boundary',async()=>{
  const navigate={name:'browser_navigate',arguments:{url:'https://app.test/auth'}};
  const click={name:'browser_click',arguments:{locator:'#open-signup'}};
  let reads=0;const read=async()=>{reads++;return {available:true,match_count:0};};
  const complete=create([input,value,valid]);
  for(const [contract,options] of [
    [structuredClone(complete),{}], [create([input,value]),{}], [create([input,valid]),{}],
    [create([input,value,valid]),{request:{...operation,arguments:{...operation.arguments,value:'@t.password'}}}],
    [create([navigate,click,input,value,valid]),{}],
    [create([navigate,click,input,value,valid]),{operations:[navigate]}],
    [complete,{operations:[input]}], [complete,{request:{name:'browser_click',arguments:{locator:'#password-input'}}}]
  ])assert.equal(await call(contract,{read,...options}),false);
  assert.equal(reads,0,'destinations behind navigation or disclosure are not preflighted early');
  await assert.rejects(call(create([navigate,click,input,value,valid]),{read,operations:[navigate,click]}),{code:'AUTOMATION_RETAINED_SUBJECT_REVIEW_REQUIRED'});
  assert.equal(reads,1);
});

function actorFixture({maxCalls=5,lookup=async()=>receipt({match_count:0,unique:false})}={}) {
  const observations=[],calls=[],saves=[];let actors=0;
  const contract=create([input,value,valid]);
  const tools=[{name:'browser_fill',inputSchema:{type:'object',properties:{locator:{type:'string'},value:{type:'string'}},required:['locator','value'],additionalProperties:false}},
    {name:'browser_assert',inputSchema:{type:'object',properties:{assertion:{enum:['value','field_valid']},locator:{type:'string'},value:{type:'string'}},required:['assertion','locator']}},
    {name:'browser_validate_locator',inputSchema:{type:'object',properties:{locator:{type:'string'}},required:['locator'],additionalProperties:false}},
    {name:'browser_snapshot',inputSchema:{type:'object'}}];
  return {observations,calls,saves,get actors(){return actors;},options:{browser:{tools,projectPromptText:value=>value,call:async(name,args)=>{
      calls.push({name,args});return name==='browser_validate_locator'?lookup():receipt({action_outcome:'completed'});
    }},initialObservations:[snapshot()],execution:{required:true,step_id:'password',action:'Enter the password using @r.password',expected_result:'The password is entered without errors.',retained_assertion_contract:contract},
    actorMode:true,generationMode:'sequential',maxCalls,parse:JSON.parse,prompt:'Enter the configured password and retain the saved field checks.',
    complete:async prompt=>{actors++;const current=JSON.parse(prompt.match(/^Current browser state and confirmed section progress .*?: (.+)$/m)[1]);
      return JSON.stringify({stage:'act',step_id:'password',section_complete:false,tool_calls:[{...operation,arguments:{...operation.arguments,locator:current.current_snapshot.targets[0].ref}}]});},
    onObservation:observation=>observations.push(observation),onPartialBuild:async payload=>{saves.push(payload);return {generation_complete:true};}
  }};
}

test('the actor performs one bounded saved-subject read and stops before fill, another model request or save',async()=>{
  const state=actorFixture();
  await assert.rejects(runAutomationBrowserAgent(state.options),{code:'AUTOMATION_RETAINED_SUBJECT_REVIEW_REQUIRED'});
  assert.equal(state.actors,1);assert.equal(state.saves.length,0);assert.deepEqual(state.calls,[{name:'browser_validate_locator',args:{locator:oldLocator}}]);
  assert.equal(state.observations.length,1);assert.equal(state.observations[0].retained_subject_preflight,true);assert.doesNotMatch(JSON.stringify(state.observations),/PRIVATE|saved password label/);
});

test('the full actor dispatches the saved alias once, reconciles a repeated opaque proposal and retains its original terminal oracles',async()=>{
  const state=actorFixture({maxCalls:6}),current=()=>snapshot({aliases:['#password-input',oldLocator]}),source=compileRecordedProgram([input,value,valid]).source;
  state.options.initialObservations=[current()];let actors=0;
  state.options.complete=async prompt=>{actors++;const context=JSON.parse(prompt.match(/^Current browser state and confirmed section progress .*?: (.+)$/m)[1]);
    return JSON.stringify({stage:'act',step_id:'password',section_complete:actors===2,tool_calls:[{...operation,arguments:{...operation.arguments,locator:context.current_snapshot.targets[0].ref}}]});};
  state.options.browser.call=async(name,args)=>{state.calls.push({name,args});return name==='browser_snapshot'?current().result:name==='browser_assert'?receipt({assertion_outcome:'satisfied'}):receipt({action_outcome:'completed'});};
  state.options.onPartialBuild=async payload=>{preserveGeneratedAssertions(source,payload.steps[0].automation_code);state.saves.push(payload);return {generation_complete:true};};
  const result=await runAutomationBrowserAgent(state.options);
  assert.equal(actors,2);assert.equal(state.saves.length,1);assert.equal(state.calls.filter(row=>row.name==='browser_fill').length,1);
  assert.equal(state.calls.find(row=>row.name==='browser_fill').args.locator,oldLocator);assert.equal(state.calls.some(row=>row.name==='browser_validate_locator'),false);
  assert.deepEqual(state.calls.filter(row=>row.name==='browser_assert').map(row=>row.args),[value.arguments,valid.arguments]);
  assert.equal(result.steps[0].automation_code,source);assert.doesNotThrow(()=>preserveGeneratedAssertions(source,result.steps[0].automation_code));
});

test('the actor canonicalizes the next same-target value and field-valid aliases without appending redundant retained checks',async()=>{
  const state=actorFixture({maxCalls:6}),current=()=>snapshot({aliases:['#password-input',oldLocator]}),source=compileRecordedProgram([input,value,valid]).source;
  state.options.initialObservations=[current()];let actors=0;
  state.options.complete=async prompt=>{actors++;const context=JSON.parse(prompt.match(/^Current browser state and confirmed section progress .*?: (.+)$/m)[1]),locator=context.current_snapshot.targets[0].ref;
    return JSON.stringify({stage:'act',step_id:'password',section_complete:actors===2,tool_calls:actors===1?[{...operation,arguments:{...operation.arguments,locator}}]:[
      {name:'browser_assert',arguments:{assertion:'value',locator,value:'@r.password'}},{name:'browser_assert',arguments:{assertion:'field_valid',locator}}
    ]});};
  state.options.browser.call=async(name,args)=>{state.calls.push({name,args});return name==='browser_snapshot'?current().result:name==='browser_assert'?receipt({assertion_outcome:'satisfied'}):receipt({action_outcome:'completed'});};
  state.options.onPartialBuild=async payload=>{preserveGeneratedAssertions(source,payload.steps[0].automation_code);state.saves.push(payload);return {generation_complete:true};};
  const result=await runAutomationBrowserAgent(state.options);
  assert.equal(actors,2);assert.equal(state.saves.length,1);assert.deepEqual(state.calls.filter(row=>row.name!=='browser_snapshot'),[
    {name:'browser_fill',args:input.arguments},{name:'browser_assert',args:value.arguments},{name:'browser_assert',args:valid.arguments}
  ]);assert.equal(result.steps[0].automation_code,source);
});

test('the preflight shares the original tool budget and propagates revoked access without a mutation',async()=>{
  const budget=actorFixture({maxCalls:1});await assert.rejects(runAutomationBrowserAgent(budget.options),{code:'AUTOMATION_BROWSER_TOOL_BUDGET_EXHAUSTED'});assert.equal(budget.calls.length,0);assert.equal(budget.actors,1);
  const denied=Object.assign(new Error('access changed'),{statusCode:403}),permission=actorFixture({lookup:async()=>{throw denied;}});
  await assert.rejects(runAutomationBrowserAgent(permission.options),error=>error===denied);assert.equal(permission.calls.length,1);assert.equal(permission.saves.length,0);
});

test('an expired original deadline after the read stops before the proposed input',async t=>{
  const now=Date.now();let expired=false;t.mock.method(Date,'now',()=>expired?now+3000:now);
  const state=actorFixture({lookup:async()=>{expired=true;return receipt({match_count:0,unique:false});}});state.options.deadlineMs=now+2000;
  await assert.rejects(runAutomationBrowserAgent(state.options),{code:'AUTOMATION_BUILD_DEADLINE'});
  assert.equal(state.calls.length,1);assert.equal(state.calls[0].name,'browser_validate_locator');assert.equal(state.saves.length,0);assert.equal(state.actors,1);
});

test('public saved-field diagnostics explain the review requirement without copying private source or page details',()=>{
  const progress=buildFailureProgress(Object.assign(new Error('PRIVATE saved password label'),{code:'AUTOMATION_RETAINED_SUBJECT_REVIEW_REQUIRED',active_step_id:'password'}),{modelStarted:true});
  assert.equal(progress.phase,'automation.agent.blocked');assert.equal(progress.details.failure_stage,'context');
  const error=stepBuildError({...progress,details:{...progress.details,locator:oldLocator,value:'PRIVATE password',message:'PRIVATE page text'}},'now');
  assert.match(error.message,/Review or reselect that field in the saved Plan/);assert.match(error.message,/new input was not performed/);assert.doesNotMatch(JSON.stringify(error),/PRIVATE|saved password label/);
});
