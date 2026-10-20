const test=require('node:test'),assert=require('node:assert/strict');
const {recordBrowserOperation,adoptPlanningNavigation,recordedSectionRequests,recordedSectionCandidate,actorOperationState}=require('../../backend/lib/automationBrowserRecording');
const {compileRecordedProgram}=require('../../backend/lib/automationRecordedProgram');
const {deriveProgramTools}=require('../../backend/lib/automationProgramTools');
const {runAutomationBrowserAgent}=require('../../backend/lib/automationBrowserAgent');
const receipt=(value,isError=false)=>({isError,content:[{type:'text',text:JSON.stringify({source:'playwright',...value})}]});
const tools=['browser_navigate','browser_snapshot','browser_fill','browser_click','browser_assert'].map(name=>({name,inputSchema:{type:'object'}}));
const execution={required:true,step_id:'current',expected_result:'Configured value is entered'};

test('only real host records retain scoped inputs; cloned or model-authored observations cannot compile a section',()=>{
 const request={name:'browser_fill',arguments:{locator:'#password',value:'@t.password'}};
 const observation={tool:request.name,execution_step_id:'current',arguments:{locator:'#password',value:'[redacted]'},result:receipt({action_outcome:'completed'})};
 recordBrowserOperation(observation,request);request.arguments.value='changed-after-dispatch';
 assert.equal(recordedSectionRequests([observation],'current')[0].arguments.value,'@t.password');
 assert.deepEqual(recordedSectionRequests([JSON.parse(JSON.stringify(observation))],'current'),[]);
 assert.deepEqual(recordedSectionRequests([observation],'future'),[]);
 const failed={...observation,result:receipt({action_outcome:'unknown'},true)};recordBrowserOperation(failed,request);
 assert.deepEqual(recordedSectionRequests([failed],'current'),[]);
});

test('only original unassigned completed planning navigations acquire first-section scope',()=>{
 const request={name:'browser_navigate',arguments:{url:'https://app.test/auth'}};
 const host=(extra={})=>({tool:'browser_navigate',action_id:'host-navigation',result:receipt({action_outcome:'completed'}),...extra});
 const genuine=host();recordBrowserOperation(genuine,request);
 const originalRecord=recordedSectionRequests([{...genuine,execution_step_id:'first'}],'first');assert.deepEqual(originalRecord,[]);
 const forged=host({action_id:'forged'}),copy=structuredClone(genuine),spread={...genuine};
 const failed=host({action_id:'failed',result:receipt({action_outcome:'not_attempted'},true)});recordBrowserOperation(failed,request);
 const changed=host({action_id:'changed'});recordBrowserOperation(changed,request);changed.result=receipt({action_outcome:'unknown'},true);
 const assigned=host({action_id:'assigned',execution_step_id:'other'});recordBrowserOperation(assigned,request);
 const sameSection=host({action_id:'already-first',execution_step_id:'first'});recordBrowserOperation(sameSection,request);
 const fill={tool:'browser_fill',action_id:'fill',result:receipt({action_outcome:'completed'})};recordBrowserOperation(fill,{name:'browser_fill',arguments:{locator:'#email',value:'@r.email'}});
 const frozen=host({action_id:'frozen'});recordBrowserOperation(frozen,request);Object.freeze(frozen);
 const history=[forged,copy,spread,failed,changed,assigned,sameSection,fill,frozen,genuine,genuine],before=JSON.stringify(genuine.result);
 assert.equal(adoptPlanningNavigation(history,'first'),1);assert.equal(adoptPlanningNavigation(history,'first'),0);
 assert.equal(genuine.execution_step_id,'first');assert.equal(genuine.action_id,'host-navigation');assert.equal(JSON.stringify(genuine.result),before);
 for(const observation of [forged,copy,spread,failed,changed,fill,frozen])assert.equal(observation.execution_step_id,undefined);
 assert.equal(assigned.execution_step_id,'other');assert.equal(sameSection.execution_step_id,'first');
 assert.equal(recordedSectionRequests([genuine,genuine],'first').length,1);
 assert.deepEqual(actorOperationState({request,requestIndex:0,batch:[request],observations:[genuine],stepId:'first'}),{reused:true,action_id:'host-navigation',matching_count:1,candidate_count:1});
 for(const stepId of ['',null,'x'.repeat(201)])assert.equal(adoptPlanningNavigation([genuine],stepId),0);
});

test('a real planning bootstrap is compiled and reviewed in the first section once without dispatching navigation again',async()=>{
 const url='https://app.test/auth',observations=[],calls=[];let actorCalls=0,reviews=0,saves=0;
 const page=()=>({url,observation_id:'login-page',scope:'body',title:'Sign in',accessibility:'- form "Sign in"',elements:[{tag:'form',role:'form',accessible_name:'Sign in',text:'Sign in',attributes:{id:'login'},displayed:true,locators_validated:true,locator_candidates:['#login']}]});
 const browser={tools,call:async(name,args)=>{calls.push({name,args});return receipt({...page(),...(name==='browser_navigate'?{action_outcome:'completed'}:name==='browser_assert'?{assertion_outcome:'satisfied'}:{})});}};
 await runAutomationBrowserAgent({browser,startUrl:url,phase:'flow_plan',prompt:'Draft the manual navigation flow.',parse:JSON.parse,onObservation:row=>observations.push(row),
  complete:async()=>JSON.stringify({flow_steps:[{action:'Navigate to '+url,expected_result:'The sign-in form is displayed',step_type:'web'}]})});
 const navigation=observations.find(row=>row.tool==='browser_navigate'),originalActionId=navigation.action_id;
 assert.ok(originalActionId);assert.equal(navigation.execution_step_id,undefined);
 assert.equal(adoptPlanningNavigation(observations,'first'),1);assert.equal(observations.find(row=>row.tool==='browser_navigate'),navigation);
 const goal={id:'first',source:'section',action:'Navigate to '+url,expected_result:'The sign-in form is displayed'};
 const result=await runAutomationBrowserAgent({browser,prompt:'Complete only the first saved manual section.',initialObservations:observations,actorMode:true,parse:JSON.parse,
  execution:{required:true,step_id:'first',action:goal.action,expected_result:goal.expected_result,semantic_review_required:true,obligations:[goal],source_obligations:[goal]},
  complete:async prompt=>{
   if(prompt.includes('"kind":"automation_section_semantic_review"')){
    reviews++;const packet=JSON.parse(prompt.split('\n').at(-1));
    assert.deepEqual(packet.confirmed_operations.map(operation=>operation.name),['browser_navigate','browser_assert']);
    return JSON.stringify({decision:'accept',obligations:[{id:'first',action_operations:[1],assertion_operations:[2]}],issues:[]});
   }
   actorCalls++;return JSON.stringify({stage:'act',step_id:'first',section_complete:true,tool_calls:[{name:'browser_navigate',arguments:{url}},{name:'browser_assert',arguments:{assertion:'visible',locator:'#login'}}]});
  },onPartialBuild:async()=>{saves++;return {generation_complete:true};}});
 assert.equal(actorCalls,1);assert.equal(reviews,1);assert.equal(saves,1);
 assert.equal(calls.filter(call=>call.name==='browser_navigate').length,1,'generation reuses the protected planning navigation instead of replaying it');
 assert.equal((result.steps[0].automation_code.match(/page\.goto\(/g)||[]).length,1);assert.match(result.steps[0].automation_code,/toBeVisible/);
 assert.equal(navigation.action_id,originalActionId);
});

test('a completion flag cannot replace a real expected-result check or clear its later failure',()=>{
 const fill={tool:'browser_fill',execution_step_id:'current',result:receipt({action_outcome:'completed'})};
 recordBrowserOperation(fill,{name:'browser_fill',arguments:{locator:'#email',value:'@t.email'}});
 const response={stage:'act',step_id:'current',section_complete:true};
 const candidate=observations=>recordedSectionCandidate({response,execution,observations,compile:compileRecordedProgram});
 assert.equal(candidate([fill]),null);
 const check={tool:'browser_assert',execution_step_id:'current',result:receipt({assertion_outcome:'satisfied'})};
 recordBrowserOperation(check,{name:'browser_assert',arguments:{assertion:'value',locator:'#email',value:'@t.email'}});
 assert.match(candidate([fill,check]).payload.steps[0].automation_code,/@t.email/);
 assert.equal(candidate([fill,check,{tool:'browser_assert',execution_step_id:'current',result:receipt({assertion_outcome:'not_satisfied'},true)}]),null);
});

test('actor browser execution and saving succeeds independently of malformed accompanying model source',async()=>{
 let turns=0,saves=0;const calls=[];
 const browser={tools,call:async(name,args)=>{calls.push({name,args});return receipt({url:'https://app.test/signup',...(name==='browser_assert'?{assertion_outcome:'satisfied'}:name==='browser_snapshot'?{accessibility:'Email input',elements:[]}:{action_outcome:'completed'})});}};
 const result=await runAutomationBrowserAgent({browser,prompt:'Enter configured email',execution,generationMode:'sequential',parse:JSON.parse,
  complete:async()=>{turns++;return JSON.stringify({stage:'act',step_id:'current',section_complete:true,steps:[{step_id:'current',automation_code:'this is malformed JavaScript'}],tool_calls:[{name:'browser_fill',arguments:{locator:'#email',value:'@t.email'}},{name:'browser_assert',arguments:{assertion:'value',locator:'#email',value:'@t.email'}}]});},
  onPartialBuild:async payload=>{saves++;assert.deepEqual(deriveProgramTools({payload,execution}),[{name:'browser_fill',arguments:{locator:'#email',value:'@t.email'}},{name:'browser_assert',arguments:{assertion:'value',locator:'#email',value:'@t.email'}}]);assert.doesNotMatch(payload.steps[0].automation_code,/malformed|redacted/);assert.equal(payload.stage,undefined);return {generation_complete:true};}
 });
 assert.equal(turns,1);assert.equal(saves,1);assert.equal(calls.filter(row=>row.name==='browser_fill').length,1);assert.match(result.steps[0].automation_code,/toHaveValue/);
});

test('production actor mode translates supported legacy code into real operations and saves host-compiled source',async()=>{
 let saves=0,fills=0;
 const page={observation_id:'email-page',url:'https://app.test/signup',elements:[{tag:'input',attributes:{id:'email'},locators_validated:true,locator_candidates:['getByLabel("Email", {"exact":false})']}]};
 const browser={tools,call:async name=>{if(name==='browser_fill')fills++;return receipt({url:'https://app.test/signup',...(name==='browser_assert'?{assertion_outcome:'satisfied'}:name==='browser_snapshot'?page:{action_outcome:'completed'})});}};
 const original="await page.getByLabel('Email').fill('@t.email'); await expect(page.getByLabel('Email')).toHaveValue('@t.email');";
 const events=[];
 const result=await runAutomationBrowserAgent({browser,prompt:'Enter configured email',execution,actorMode:true,initialObservations:[{tool:'browser_snapshot',result:receipt(page)}],generationMode:'sequential',parse:JSON.parse,
  complete:async prompt=>{assert.doesNotMatch(prompt,/automationBrowserAgent\.toolResponse/);return JSON.stringify({steps:[{step_id:'current',automation_code:original}]});},
  onProgress:event=>events.push(event),onPartialBuild:async()=>{saves++;return {generation_complete:true};}
 });
 assert.equal(saves,1);assert.equal(fills,1);assert.notEqual(result.steps[0].automation_code,original);assert.match(result.steps[0].automation_code,/"exact":false/);assert.equal(events.some(row=>row.phase==='automation.agent.source.compiled'),true);
});

test('an actor corrects a failed check without filling or submitting the confirmed input again',async()=>{
 const calls=[],events=[];let turns=0,checks=0,saves=0;
 const browser={tools,call:async(name,args)=>{calls.push({name,args});if(name==='browser_assert'&&++checks===1)return receipt({assertion_outcome:'not_satisfied',action_outcome:'not_attempted',retry_safe:true},true);return receipt({url:'https://app.test/signup',...(name==='browser_assert'?{assertion_outcome:'satisfied'}:name==='browser_snapshot'?{elements:[]}:{action_outcome:'completed'})});}};
 await runAutomationBrowserAgent({browser,prompt:'Enter configured email',execution,generationMode:'sequential',parse:JSON.parse,
  onProgress:event=>events.push(event),
  complete:async()=>{turns++;return JSON.stringify({stage:'act',step_id:'current',section_complete:true,tool_calls:[{name:'browser_fill',arguments:{locator:'#email',value:'@t.email'}},{name:'browser_assert',arguments:{assertion:'value',locator:'#email',value:'@t.email'}}]});},
  onPartialBuild:async payload=>{saves++;assert.equal((payload.steps[0].automation_code.match(/\.fill\(/g)||[]).length,1);return {generation_complete:true};}
 });
 assert.equal(turns,2);assert.equal(saves,1);assert.equal(calls.filter(row=>row.name==='browser_fill').length,1);assert.equal(checks,2);
 const original=events.find(row=>row.phase==='automation.agent.action.completed'&&row.details?.tool==='browser_fill');
 const reused=events.find(row=>row.phase==='automation.agent.browser.reconciled');
 assert.ok(original?.details?.action_id);assert.equal(reused?.details?.source_action_id,original.details.action_id);
});

test('actor check corrections reconcile a repeated submission even with an irrelevant reload tag',async()=>{
 let turns=0,checks=0,clicks=0,saves=0;const calls=[];
 const browser={tools,call:async name=>{calls.push(name);if(name==='browser_click')clicks++;if(name==='browser_assert'&&++checks===1)return receipt({assertion_outcome:'not_satisfied',action_outcome:'not_attempted',retry_safe:true},true);return receipt({url:'https://app.test/result',...(name==='browser_assert'?{assertion_outcome:'satisfied'}:name==='browser_snapshot'?{elements:[]}:{action_outcome:'completed'})});}};
 const result=await runAutomationBrowserAgent({browser,prompt:'Create once',execution,generationMode:'sequential',parse:JSON.parse,
  complete:async prompt=>{turns++;if(turns===2){assert.match(prompt,/page_state_unavailable/);assert.equal(checks,0);assert.equal(saves,0);}if(turns===3){assert.match(prompt,/BROWSER_ASSERTION_NOT_SATISFIED/);assert.equal(checks,1);assert.equal(saves,0);}return JSON.stringify({stage:'act',step_id:'current',section_complete:true,tool_calls:[{name:'browser_click',...(turns>1?{navigation_intent:'reload'}:{}),arguments:{locator:'#create'}},{name:'browser_assert',arguments:{assertion:'text_content',locator:'#result',value:'Created'}}]});},onPartialBuild:async()=>{saves++;return {generation_complete:true};}});
 assert.equal(turns,3);assert.equal(clicks,1);assert.equal(checks,2);assert.equal(saves,1);assert.deepEqual(calls,['browser_click','browser_snapshot','browser_assert','browser_snapshot','browser_assert']);assert.equal((result.steps[0].automation_code.match(/\.click\(/g)||[]).length,1);
});

test('intentional repeated actions use cumulative occurrence instead of disabling retry reconciliation',async()=>{
 let turns=0,clicks=0;
 const browser={tools,call:async name=>{if(name==='browser_click')clicks++;return receipt({url:'https://app.test/list',...(name==='browser_assert'?{assertion_outcome:'satisfied'}:name==='browser_snapshot'?{elements:[]}:{action_outcome:'completed'})});}};
 const result=await runAutomationBrowserAgent({browser,prompt:'Add two rows',execution,generationMode:'sequential',parse:JSON.parse,
  complete:async()=>{turns++;return JSON.stringify({stage:'act',step_id:'current',section_complete:turns===2,tool_calls:[{name:'browser_click',occurrence:turns,arguments:{locator:'#add'}},{name:'browser_assert',arguments:{assertion:'count',locator:'.row',value:String(turns)}}]});},onPartialBuild:async()=>({generation_complete:true})});
 assert.equal(turns,2);assert.equal(clicks,2);assert.equal((result.steps[0].automation_code.match(/\.click\(/g)||[]).length,2);
});

test('an invalid later actor request cannot erase a confirmed submit or turn its retry into another mutation',async()=>{
 let turns=0,clicks=0,checks=0,saves=0;const calls=[];
 const browser={tools,call:async name=>{calls.push(name);if(name==='browser_click')clicks++;if(name==='browser_assert'&&++checks===1)return receipt({assertion_outcome:'not_satisfied',action_outcome:'not_attempted',retry_safe:true},true);return receipt({url:'https://app.test/result',...(name==='browser_assert'?{assertion_outcome:'satisfied'}:name==='browser_snapshot'?{elements:[]}:{action_outcome:'completed'})});}};
 const submit={name:'browser_click',occurrence:1,arguments:{locator:'#create'}};
 await runAutomationBrowserAgent({browser,prompt:'Create once',execution,generationMode:'sequential',parse:JSON.parse,
  complete:async prompt=>{turns++;if(turns===2){assert.match(prompt,/page_state_unavailable/);assert.equal(checks,0);}if(turns===3){assert.equal(checks,0);assert.equal(saves,0);}if(turns===4){assert.equal(checks,1);assert.equal(saves,0);}return JSON.stringify({stage:'act',step_id:'current',section_complete:true,tool_calls:turns===2?[submit,{name:'browser_fill',arguments:{locator:'#invalid',value:123}}]:[...(turns===1?[submit]:[]),{name:'browser_assert',arguments:{assertion:'visible',locator:'#result'}}]});},onPartialBuild:async()=>{saves++;return {generation_complete:true};}});
 assert.equal(turns,4);assert.equal(clicks,1);assert.equal(checks,2);assert.equal(saves,1);assert.equal(calls.includes('browser_fill'),false);
});

test('intervening different operations do not erase a confirmed actor occurrence',async()=>{
 let turns=0,clicks=0,fills=0,checks=0,saves=0;const events=[];
 const browser={tools,call:async name=>{if(name==='browser_click')clicks++;if(name==='browser_fill')fills++;if(name==='browser_assert'&&++checks===2)return receipt({assertion_outcome:'not_satisfied',action_outcome:'not_attempted',retry_safe:true},true);return receipt({url:'https://app.test/list',...(name==='browser_assert'?{assertion_outcome:'satisfied'}:name==='browser_snapshot'?{elements:[]}:{action_outcome:'completed'})});}};
 const result=await runAutomationBrowserAgent({browser,prompt:'Add one row then edit it',execution,generationMode:'sequential',parse:JSON.parse,onProgress:event=>events.push(event),
  complete:async prompt=>{turns++;if(turns===2){assert.match(prompt,/page_state_unavailable/);assert.equal(checks,0);}if(turns===3){assert.equal(fills,1);assert.equal(checks,1);assert.equal(saves,0);}if(turns===4){assert.match(prompt,/BROWSER_ASSERTION_NOT_SATISFIED/);assert.equal(saves,0);}return JSON.stringify({stage:'act',step_id:'current',section_complete:turns>2,tool_calls:[turns===2?{name:'browser_fill',arguments:{locator:'#row',value:'edited'}}:{name:'browser_click',occurrence:1,arguments:{locator:'#add'}},{name:'browser_assert',arguments:{assertion:'visible',locator:'#row'}}]});},onPartialBuild:async()=>{saves++;return {generation_complete:true};}});
 assert.equal(turns,4);assert.equal(clicks,1);assert.equal(fills,1);assert.equal(checks,3);assert.equal(saves,1);
 assert.equal((result.steps[0].automation_code.match(/\.click\(/g)||[]).length,1);assert.equal((result.steps[0].automation_code.match(/\.fill\(/g)||[]).length,1);assert.match(result.steps[0].automation_code,/edited/);
 const created=events.find(event=>event.phase==='automation.agent.action.completed'&&event.details?.tool==='browser_click');
 const reconciled=events.filter(event=>event.phase==='automation.agent.browser.reconciled');
 assert.ok(created?.details?.action_id);assert.equal(reconciled.length,2);assert.ok(reconciled.every(event=>event.details?.source_action_id===created.details.action_id));
});

test('null requests and skipped occurrence ordinals receive correction feedback without dispatch',async()=>{
 for(const invalid of [null,{name:'browser_click',occurrence:3,arguments:{locator:'#create'}}]){
  let turns=0,clicks=0,checks=0,saves=0;
  const browser={tools,call:async name=>{if(name==='browser_click')clicks++;if(name==='browser_assert')checks++;return receipt({url:'https://app.test/result',...(name==='browser_assert'?{assertion_outcome:'satisfied'}:name==='browser_snapshot'?{elements:[]}:{action_outcome:'completed'})});}};
  await runAutomationBrowserAgent({browser,prompt:'Create once',execution,generationMode:'sequential',parse:JSON.parse,
   complete:async prompt=>{turns++;if(turns===2){assert.equal(clicks,0);assert.equal(checks,0);}if(turns===3){assert.match(prompt,/page_state_unavailable/);assert.equal(clicks,1);assert.equal(checks,0);assert.equal(saves,0);}return JSON.stringify({stage:'act',step_id:'current',section_complete:true,tool_calls:turns===1?[invalid]:[{name:'browser_click',occurrence:1,arguments:{locator:'#create'}},{name:'browser_assert',arguments:{assertion:'visible',locator:'#result'}}]});},onPartialBuild:async()=>{saves++;return {generation_complete:true};}});
  assert.equal(turns,3);assert.equal(clicks,1);assert.equal(checks,1);assert.equal(saves,1);
 }
});

test('same-URL signup transitions pause stale actor fields before another mutation and preserve the prerequisite click',async()=>{
 let page='entry',turns=0;const calls=[];
 const snapshot=()=>({url:'https://app.test/auth',elements:[{tag:page==='entry'?'button':'input',label:page==='entry'?'Sign up':'Email',attributes:{id:page==='entry'?'signup':'email'},locator_candidates:[page==='entry'?'#signup':'#email']}]});
 const browser={tools,call:async(name,args)=>{calls.push({name,args});if(name==='browser_click')page='signup';return receipt({...snapshot(),...(name==='browser_assert'?{assertion_outcome:'satisfied'}:name==='browser_snapshot'?{}:{action_outcome:'completed'})});}};
 const result=await runAutomationBrowserAgent({browser,prompt:'Enter email on signup',execution,generationMode:'sequential',parse:JSON.parse,initialObservations:[{tool:'browser_snapshot',result:receipt(snapshot())}],
  complete:async prompt=>{if(++turns===1)return JSON.stringify({stage:'act',step_id:'current',tool_calls:[{name:'browser_click',arguments:{locator:'#signup'}},{name:'browser_fill',arguments:{locator:'#stale',value:'wrong'}}]});assert.match(prompt,/controls_changed/);return JSON.stringify({stage:'act',step_id:'current',section_complete:true,tool_calls:[{name:'browser_fill',arguments:{locator:'#email',value:'@t.email'}},{name:'browser_assert',arguments:{assertion:'value',locator:'#email',value:'@t.email'}}]});},
  onPartialBuild:async()=>({generation_complete:true})
 });
 assert.equal(calls.some(row=>row.args.locator==='#stale'),false);assert.equal(calls.filter(row=>row.name==='browser_click').length,1);assert.match(result.steps[0].automation_code,/#signup.*click/);
});

test('a ready current SPA URL is not reopened merely to complete navigation wording',async()=>{
 let turns=0,navigates=0;
 const snapshot={url:'https://app.test/signup',elements:[{tag:'input',attributes:{id:'email'},locator_candidates:['#email']}]};
 const browser={tools,call:async name=>{if(name==='browser_navigate'){navigates++;throw new Error('Direct SPA route is unavailable');}return receipt({...snapshot,...(name==='browser_assert'?{assertion_outcome:'satisfied'}:{})});}};
 const result=await runAutomationBrowserAgent({browser,prompt:'Navigate to signup',execution,generationMode:'sequential',parse:JSON.parse,initialObservations:[{tool:'browser_snapshot',result:receipt(snapshot)}],
  complete:async prompt=>{turns++;if(turns===1)return JSON.stringify({stage:'act',step_id:'current',section_complete:false,tool_calls:[{name:'browser_assert',arguments:{assertion:'visible',locator:'#email'}}]});assert.match(prompt,/"completion_available":true/);return JSON.stringify({stage:'act',step_id:'current',section_complete:true,tool_calls:[{name:'browser_navigate',arguments:{url:snapshot.url}}]});},
  onPartialBuild:async()=>({generation_complete:true})
 });
 assert.equal(turns,2);assert.equal(navigates,0);assert.doesNotMatch(result.steps[0].automation_code,/goto/);
});

test('an explicit requested reload is performed and retained separately from an already-reached URL',async()=>{
 let navigates=0;
 const snapshot={url:'https://app.test/settings',elements:[]};
 const browser={tools,call:async name=>{if(name==='browser_navigate')navigates++;return receipt({...snapshot,...(name==='browser_navigate'?{action_outcome:'completed'}:name==='browser_assert'?{assertion_outcome:'satisfied'}:{})});}};
 const result=await runAutomationBrowserAgent({browser,prompt:'Refresh settings',execution,generationMode:'sequential',parse:JSON.parse,initialObservations:[{tool:'browser_snapshot',result:receipt(snapshot)}],
  complete:async()=>JSON.stringify({stage:'act',step_id:'current',section_complete:true,tool_calls:[{name:'browser_navigate',navigation_intent:'reload',arguments:{url:snapshot.url}},{name:'browser_assert',arguments:{assertion:'title',value:'Settings'}}]}),onPartialBuild:async()=>({generation_complete:true})});
 assert.equal(navigates,1);assert.match(result.steps[0].automation_code,/goto/);
});

test('a redaction placeholder is rejected before browser dispatch and corrected to a private reference in the same session',async()=>{
 const {createBrowserParameterResolver}=require('../../backend/lib/automationBrowserParameters');
 const secret='owned-secret-not-for-model',parameters=createBrowserParameterResolver({caseValues:{'t.password':secret}});
 let turns=0,actualFills=0;
 const browser={tools,call:async(name,args)=>{
  const resolved=parameters.resolve(name,args);
  if(name==='browser_fill'){actualFills++;assert.equal(resolved.value,secret);}
  return receipt({url:'https://app.test/signup',...(name==='browser_assert'?{assertion_outcome:'satisfied'}:name==='browser_snapshot'?{elements:[]}:{action_outcome:'completed'})});
 }};
 const result=await runAutomationBrowserAgent({browser,prompt:'Use the configured private password',execution,generationMode:'sequential',parse:JSON.parse,
  complete:async prompt=>{if(++turns>1){assert.match(prompt,/AUTOMATION_PARAMETER_REFERENCE_REQUIRED/);assert.doesNotMatch(prompt,new RegExp(secret));}return JSON.stringify({stage:'act',step_id:'current',section_complete:true,tool_calls:[{name:'browser_fill',arguments:{locator:'#password',value:turns===1?'[private parameter reference]':'@t.password'}},{name:'browser_assert',arguments:{assertion:'value',locator:'#password',value:'@t.password'}}]});},
  onPartialBuild:async()=>({generation_complete:true})
 });
 assert.equal(turns,2);assert.equal(actualFills,1);assert.match(result.steps[0].automation_code,/@t.password/);assert.doesNotMatch(result.steps[0].automation_code,new RegExp(secret));
});
