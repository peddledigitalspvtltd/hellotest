const test=require('node:test'),assert=require('node:assert/strict');
const {completeAutomationBuild}=require('../../backend/lib/automationBuildCompletion');
const steps=[{id:'one',step_order:1,action:'Open page',expected_result:'Page loaded',step_type:'web'},{id:'two',step_order:2,action:'Submit',expected_result:'Saved',step_type:'web'}];
const candidate=(id,code='await web.click("#submit");')=>({step_id:id,automation_code:code});
function validate(payload,required){
 assert.equal(payload.steps.length,required.length);
 for(const step of required){const item=payload.steps.find(item=>item.step_id===step.id);if(!item||!item.automation_code||item.automation_code.includes('TODO'))throw new Error(`Section ${step.id} needs executable instructions.`);}
 return {updates:payload.steps,summary:payload.summary};
}
test('partial responses retain validated sections and retry only missing instructions before complete validation',async()=>{
 const requests=[],events=[];
 const result=await completeAutomationBuild({steps,validate,feedbackInstruction:'Governed completion guidance',onProgress:async event=>events.push(event),generate:async request=>{requests.push(request);return request.attempt===1?{steps:[candidate('one'),candidate('two','TODO')]}:{steps:[candidate('two')]};}});
 assert.equal(result.updates.length,2);assert.equal(result.completion_attempts,2);assert.equal(result.verification_status,'unverified');assert.equal(requests[1].feedbackInstruction,'Governed completion guidance');
 assert.deepEqual(requests[1].feedback.completed_step_ids,['one']);assert.deepEqual(requests[1].feedback.required_sections.map(step=>step.step_id),['two']);assert.equal(requests[1].feedback.required_sections[0].expected_result,'Saved');assert.match(requests[1].feedback.validation_errors[0].message,/two/);
 assert.deepEqual(events.filter(event=>event.phase==='automation.agent.section.ready').map(event=>event.details.step_id),['one','two']);
});
test('completion attempts are bounded and never return a partially validated case',async()=>{
 let attempts=0;
 await assert.rejects(completeAutomationBuild({steps,validate,maxAttempts:100,generate:async()=>{attempts++;return {steps:[candidate('one')]};}}),error=>{assert.equal(error.code,'AUTOMATION_BUILD_INCOMPLETE');assert.equal(error.completed_sections,1);assert.deepEqual(error.pending_step_ids,['two']);return true;});
 assert.equal(attempts,3);
});
test('malformed JSON output can recover but authorization and cancellation are never generation retries',async()=>{
 let calls=0;
 const result=await completeAutomationBuild({steps,validate,parse:JSON.parse,generate:async()=>++calls===1?'invalid':JSON.stringify({steps:steps.map(step=>candidate(step.id))})});assert.equal(result.completion_attempts,2);
 for(const error of [Object.assign(new Error('Forbidden'),{statusCode:403}),Object.assign(new Error('Cancelled'),{name:'AbortError'}),Object.assign(new Error('Missing required MCP context'),{statusCode:503,code:'AI_MCP_CONTEXT_REQUIRED'})]){
  calls=0;await assert.rejects(completeAutomationBuild({steps,validate,generate:async()=>{calls++;throw error;}}),error);assert.equal(calls,1);
 }
});

test('linked manual steps and expected results are accounted for, including coverage-only bounded retries',async()=>{
 const manual=[{id:'m-one',test_case_id:'manual',step_order:1,step_type:'web',action:'Open page',expected_result:'Page loaded'},{id:'m-new',test_case_id:'manual',step_order:2,step_type:'web',action:'Confirm new behavior',expected_result:'New behavior is visible'}];
 const requests=[],events=[];
 const result=await completeAutomationBuild({steps,manualSteps:manual,validate,onProgress:async event=>events.push(event),generate:async input=>{requests.push(input);return input.attempt===1?{steps:steps.map(step=>candidate(step.id))}:{steps:[],manual_coverage:[{manual_step_id:'m-new',manual_test_case_id:'manual',section_step_id:'two'}]};}});
 assert.equal(result.completion_attempts,2);assert.equal(result.manual_coverage.length,2);assert.equal(requests[1].feedback.required_sections.length,0);assert.equal(requests[1].feedback.required_manual_steps[0].expected_result,'New behavior is visible');
 assert.equal(result.manual_coverage.find(row=>row.manual_step_id==='m-one').section_step_id,'one');assert.equal(events[0].phase,'automation.agent.plan');assert.equal(events[0].details.manual_steps.length,2);
});
test('unmapped or foreign manual coverage never becomes a silently complete generated case',async()=>{
 for(const manual_coverage of [[],[{manual_step_id:'foreign',section_step_id:'one'}],[{manual_step_id:'m',manual_test_case_id:'foreign',section_step_id:'one'}],[{manual_step_id:'m',section_step_id:'foreign'}]]){
  let calls=0;await assert.rejects(completeAutomationBuild({steps,manualSteps:[{id:'m',test_case_id:'manual',action:'Extra behavior',expected_result:'New assertion'}],validate,generate:async()=>{calls++;return {steps:steps.map(step=>candidate(step.id)),manual_coverage};}}),error=>error.code==='AUTOMATION_BUILD_INCOMPLETE'&&error.missing_manual_step_ids.includes('m'));assert.equal(calls,3);
 }
});
test('identical repeated source steps map to distinct saved occurrences rather than silently collapsing a flow',()=>{
 const {matchManualCoverage}=require('../../backend/lib/automationBuildCompletion');
 const repeated=[{id:'a',action:'Click next',expected_result:'Next page'},{id:'b',action:'Click next',expected_result:'Next page'}];
 const mapped=matchManualCoverage(repeated,[{id:'m1',test_case_id:'case',action:'Click next',expected_result:'Next page'},{id:'m2',test_case_id:'case',action:'Click next',expected_result:'Next page'},{id:'m3',test_case_id:'case',action:'Click next',expected_result:'Different page'}]);
 assert.deepEqual([...mapped],[['m1','a'],['m2','b']]);
});

test('an unavailable email dependency ends bounded generation with an actionable truthful outcome and retains good work privately',async()=>{
 let calls=0;const events=[];
 await assert.rejects(completeAutomationBuild({steps,validate,onProgress:async event=>events.push(event),generate:async()=>{calls++;return {steps:[candidate('one')],blocked_steps:[{step_id:'two',dependency_type:'mailbox',reason:'No mailbox connection or inbox source was supplied.',required_context:['Configured test mailbox URL or API and access reference'],required_parameters:[]}]};}}),error=>{
  assert.equal(error.code,'AUTOMATION_DEPENDENCY_MISSING');assert.equal(error.nonRetryable,true);assert.equal(error.completed_sections,1);assert.deepEqual(error.pending_step_ids,['two']);assert.equal(error.blocked_steps[0].step_id,'two');assert.match(error.message,/mailbox connection/);return true;
 });assert.equal(calls,1);assert.ok(events.some(event=>event.phase==='automation.agent.dependencies'));
});
test('invalid dependency reports are corrected within the normal budget and contradictory executable code is never saved as a blocked step',async()=>{
 let calls=0;const build=await completeAutomationBuild({steps,validate,generate:async()=>++calls===1?{steps:[candidate('one')],blocked_steps:[{step_id:'foreign',dependency_type:'mailbox',reason:'Missing',required_context:['Mailbox']}]}:{steps:[candidate('two')]}});assert.equal(build.completion_attempts,2);
 await assert.rejects(completeAutomationBuild({steps,validate,generate:async()=>({steps:steps.map(step=>candidate(step.id)),blocked_steps:[{step_id:'two',dependency_type:'external_context',reason:'This behavior was not actually implemented.',required_context:['Real inbox evidence']} ]})}),error=>error.code==='AUTOMATION_DEPENDENCY_MISSING'&&error.completed_sections===1);
});

test('incremental sections publish validated previews before later browser actions and correct invalid drafts in the same attempt',async()=>{
 const {runAutomationBrowserAgent}=require('../../backend/lib/automationBrowserAgent');
 const previews=[],events=[],receipts=[];let turns=0,requests=0;
 const browser={tools:[{name:'browser_snapshot'}],call:async()=>{
  assert.deepEqual(previews,['one'],'the first section is inspectable before the next browser observation');
  return {content:[{type:'text',text:'Observed saved state'}]};
 }};
 const result=await completeAutomationBuild({steps,validate,onProgress:async event=>events.push(event),
  onValidatedSection:async({step,normalized})=>{assert.equal(normalized.updates.length,1);previews.push(step.id);return {preview_artifact_id:`preview-${step.id}`};},
  generate:async({onPartial})=>{
   requests++;
   return runAutomationBrowserAgent({browser,prompt:'Develop the complete case',parse:JSON.parse,onPartialBuild:async payload=>{const receipt=await onPartial(payload);receipts.push(receipt);return receipt;},
    complete:async prompt=>++turns===1?JSON.stringify({steps:[candidate('one'),candidate('two','await web.click("TODO");')],tool_calls:[{name:'browser_snapshot',arguments:{}}]}):(assert.match(prompt,/automation_generation_feedback/),assert.match(prompt,/two needs executable instructions/),JSON.stringify({steps:[candidate('two')]}))});
  }
 });
 assert.equal(requests,1);assert.equal(result.completion_attempts,1);assert.deepEqual(previews,['one','two']);
 assert.deepEqual(receipts[0].completed_step_ids,['one']);assert.deepEqual(receipts[0].pending_step_ids,['two']);
 assert.doesNotMatch(JSON.stringify(receipts),/await web|automation_code/,'model receipts contain status and diagnostics, never retained source');
 assert.deepEqual(events.filter(event=>event.phase==='automation.agent.section.ready').map(event=>event.details.preview_artifact_id),['preview-one','preview-two']);
 assert.equal(result.updates.length,2);assert.equal(result.verification_status,'unverified');
});

test('incremental manual coverage remains scoped and the final response can acknowledge already validated sections',async()=>{
 const manualSteps=[{id:'m',test_case_id:'manual',action:'Different manual wording',expected_result:'Saved'}];
 const result=await completeAutomationBuild({steps,manualSteps,validate,generate:async({onPartial})=>{
  const rejected=await onPartial({steps:[candidate('foreign')],manual_coverage:[{manual_step_id:'m',manual_test_case_id:'foreign',section_step_id:'two'}]});
  assert.equal(rejected.completed_step_ids.length,0);assert.equal(rejected.validation_errors.length,2);
  await onPartial({steps:steps.map(step=>candidate(step.id)),manual_coverage:[{manual_step_id:'m',manual_test_case_id:'manual',section_step_id:'two'}]});
  return {steps:[]};
 }});
 assert.equal(result.completion_attempts,1);assert.deepEqual(result.manual_coverage,[{manual_step_id:'m',manual_test_case_id:'manual',section_step_id:'two'}]);
});

test('incremental dependencies stop further browser work, retain only safe drafts and never publish a blocked section preview',async()=>{
 const previews=[];let continued=false;
 await assert.rejects(completeAutomationBuild({steps,validate,onValidatedSection:async({step})=>{previews.push(step.id);},generate:async({onPartial})=>{
  await onPartial({steps:[candidate('one')]});
  await onPartial({steps:[candidate('two')],blocked_steps:[{step_id:'two',dependency_type:'mailbox',reason:'No mailbox source was supplied.',required_context:['Test mailbox API']}]});
  continued=true;return {steps:[]};
 }}),error=>error.code==='AUTOMATION_DEPENDENCY_MISSING'&&error.completed_sections===1);
 assert.equal(continued,false);assert.deepEqual(previews,['one']);
});

test('incremental callbacks drain before final validation and close after their owning request',async()=>{
 const previews=[];let late;
 const result=await completeAutomationBuild({steps,validate,onValidatedSection:async({step})=>{await new Promise(setImmediate);previews.push(step.id);},generate:async({onPartial})=>{
  late=onPartial;void onPartial({steps:[candidate('one')]});return {steps:[candidate('two')]};
 }});
 assert.equal(result.updates.length,2);assert.deepEqual(previews,['one','two']);
 await assert.rejects(late({steps:[candidate('foreign')]}),error=>error.code==='AUTOMATION_BUILD_REQUEST_CLOSED');
});
test('progressive persistence is critical and a later dependency reports the Plan sections already saved',async()=>{
 const saved=[],previews=[];
 await assert.rejects(completeAutomationBuild({steps,sequential:true,validate,onSaveSection:async({step})=>{saved.push(step.id);return {instruction_status:'saved'};},onValidatedSection:async({step})=>{assert.ok(saved.includes(step.id));previews.push(step.id);},generate:async request=>request.activeStepId==='one'?{steps:[candidate('one')]}:{blocked_steps:[{step_id:'two',dependency_type:'mailbox',reason:'A mailbox connection is required.',required_context:['Test mailbox']}]} }),error=>error.code==='AUTOMATION_DEPENDENCY_MISSING'&&error.saved_sections===1&&error.saved_step_ids[0]==='one');
 assert.deepEqual(saved,['one']);assert.deepEqual(previews,['one']);
 let requests=0;
 await assert.rejects(completeAutomationBuild({steps,sequential:true,validate,onSaveSection:async()=>{throw new Error('Storage rejected this save');},generate:async()=>{requests++;return {steps:[candidate('one')]};}}),error=>error.code==='AUTOMATION_SECTION_SAVE_FAILED'&&error.nonRetryable&&error.saved_sections===0);
 assert.equal(requests,1);
});
test('final schema correction retains saved sections without replaying generation or adding synthetic schema fields',async()=>{
 const saved=[],requests=[],outcomes=[];
 const result=await completeAutomationBuild({steps,sequential:true,validate,onSaveSection:async({step})=>{saved.push(step.id);},validateOutcome:outcome=>{
  outcomes.push(outcome);
  assert.equal(Object.hasOwn(outcome,'manual_coverage'),false);
  assert.equal(Object.hasOwn(outcome,'learned_locators'),false);
  if(!outcome.summary)throw Object.assign(new Error('A final summary is required.'),{code:'AI_MANAGED_SCHEMA_INVALID',validation_errors:[{required_property:'summary'}]});
 },generate:async request=>{
  requests.push(request);
  if(request.feedback.required_sections.length)return {steps:[candidate(request.activeStepId)]};
  assert.equal(request.feedback.validation_errors[0].code,'AI_MANAGED_SCHEMA_INVALID');
  return {steps:[],summary:'Complete controlled flow'};
 }});
 assert.deepEqual(saved,['one','two']);assert.equal(requests.length,3);assert.equal(outcomes.length,2);assert.equal(result.updates.length,2);
});

test('supplied exact runtime parameters correct false parameter blockers within the existing completion budget',async()=>{
 const requests=[],events=[],previews=[];
 const result=await completeAutomationBuild({steps,validate,availableParameters:['t.password'],onProgress:async event=>events.push(event),onValidatedSection:async({step})=>{previews.push(step.id);},generate:async request=>{
  requests.push(request);
  return request.attempt===1?{steps:[candidate('one'),candidate('two','TODO')],blocked_steps:[{step_id:'two',dependency_type:'parameter',reason:'Password value is private.',required_parameters:['@T.Password']}]}
   :{steps:[candidate('two')]};
 }});
 assert.equal(result.completion_attempts,2);assert.deepEqual(previews,['one','two']);
 assert.deepEqual(requests[1].feedback.available_parameters,['t.password']);
 assert.equal(requests[1].feedback.validation_errors[0].code,'AUTOMATION_PARAMETER_ALREADY_SUPPLIED');
 assert.match(requests[1].feedback.validation_errors[1].message,/executable instructions/,'contradictory candidate still passes the normal validator');
 assert.deepEqual(requests[1].feedback.required_sections.map(row=>row.step_id),['two']);
 assert.equal(events.some(event=>event.phase==='automation.agent.dependencies'),false);
 assert.doesNotMatch(JSON.stringify(requests),/private-secret-value/);
});

test('missing and other-namespace parameters remain unavailable rather than guessed',async()=>{
 const {createBrowserParameterResolver}=require('../../backend/lib/automationBrowserParameters');
 for(const caseValues of [{},{'r.password':'configured-for-another-scope'}]){
  const resolver=createBrowserParameterResolver({caseValues});
  let calls=0;
  await assert.rejects(completeAutomationBuild({steps,validate,availableParameters:resolver.availableParameterNames,generate:async()=>{calls++;return {steps:[candidate('one')],blocked_steps:[{step_id:'two',dependency_type:'parameter',reason:'A password parameter is missing.',required_parameters:['password']}]};}}),error=>error.code==='AUTOMATION_DEPENDENCY_MISSING'&&error.blocked_steps[0].required_parameters[0]==='password');
  assert.equal(calls,1);
 }
});

test('bound blank inputs correct a false parameter blocker without changing data or adding a case',async()=>{
 const {createBrowserParameterResolver}=require('../../backend/lib/automationBrowserParameters');
 for(const value of ['','   ']){
  const resolver=createBrowserParameterResolver({caseValues:{'t.password':value}});
  let calls=0;
  const result=await completeAutomationBuild({steps,validate,availableParameters:resolver.availableParameterNames,generate:async()=>{
   calls++;
   return calls===1?{steps:[candidate('one')],blocked_steps:[{step_id:'two',dependency_type:'parameter',reason:'A password parameter is missing.',required_parameters:['password']}]}:{steps:[candidate('two')]};
  }});
  assert.equal(calls,2);assert.equal(result.updates.length,2);
  assert.equal(resolver.resolve('browser_fill',{value:'@t.password'}).value,value);
 }
});

test('supplied parameters do not hide missing mailbox/context sources or remaining missing references',async()=>{
 for(const blocker of [
  {dependency_type:'mailbox',required_context:['Configured mailbox source'],required_parameters:['@t.verification_code']},
  {dependency_type:'external_context',required_context:['Real email delivery evidence'],required_parameters:['verification_code']},
  {dependency_type:'parameter',required_context:['Configured mailbox source'],required_parameters:['verification_code']},
  {dependency_type:'parameter',required_parameters:['verification_code','mailbox_password']},
  {dependency_type:'mailbox',required_parameters:['verification_code']}
 ]){
  await assert.rejects(completeAutomationBuild({steps,validate,availableParameters:['t.verification_code'],generate:async()=>({steps:[candidate('one')],blocked_steps:[{step_id:'two',reason:'A genuine dependency remains unavailable.',...blocker}]})}),error=>{
   assert.equal(error.code,'AUTOMATION_DEPENDENCY_MISSING');assert.equal(error.completed_sections,1);
   assert.deepEqual(error.blocked_steps[0].required_parameters,blocker.required_parameters.includes('mailbox_password')?['mailbox_password']:[]);
   assert.deepEqual(error.blocked_steps[0].required_context,blocker.required_context||[]);return true;
  });
 }
});

test('incremental false parameter blockers preserve previously validated immutable drafts',async()=>{
 const previews=[];
 const result=await completeAutomationBuild({steps,validate,availableParameters:['t.password'],onValidatedSection:async({step})=>{previews.push(step.id);},generate:async({onPartial})=>{
  await onPartial({steps:[candidate('one')]});
  const receipt=await onPartial({steps:[candidate('one','TODO')],blocked_steps:[{step_id:'one',dependency_type:'parameter',reason:'The private value is not visible.',required_parameters:['t.password']}]});
  assert.deepEqual(receipt.completed_step_ids,['one']);assert.equal(receipt.validation_errors[0].code,'AUTOMATION_PARAMETER_ALREADY_SUPPLIED');
  return {steps:[candidate('two')]};
 }});
 assert.equal(result.completion_attempts,1);assert.deepEqual(previews,['one','two']);assert.equal(result.updates[0].automation_code,candidate('one').automation_code);
});

test('sequential generation requests one authoritative manual section at a time and keeps resolved data out of progress',async()=>{
 const source=steps.map((step,index)=>({...step,id:`m-${step.id}`,test_case_id:'manual',action:`Use @t.value ${index}`}));
 const specification=steps.map((step,index)=>({...step,action:`Use @t.value ${index}`}));
 const requests=[],events=[],validated=[];
 const result=await completeAutomationBuild({steps:specification,manualSteps:source,sequential:true,
  displaySteps:specification.map(step=>({...step,action:step.action.replace('@t.value','Alice 42')})),
  displayManualSteps:source.map(step=>({...step,action:step.action.replace('@t.value','Alice 42')})),
  validate:(payload,required)=>{validated.push(required);return validate(payload,required);},onProgress:async event=>events.push(event),
  generate:async request=>{requests.push(request);assert.equal(request.feedback.required_sections.length,1);return {steps:[candidate(request.activeStepId)]};}
 });
 assert.deepEqual(requests.map(request=>request.activeStepId),['one','two']);
 assert.deepEqual(requests.map(request=>request.activeManualStepIds),[['m-one'],['m-two']]);
 assert.deepEqual(requests.map(request=>request.sectionAttempt),[1,1]);
 assert.match(requests[0].feedback.required_sections[0].action,/Alice 42/);
 assert.doesNotMatch(JSON.stringify(events),/Alice 42/,'resolved parameters belong in protected data, never public activity metadata');
 assert.ok(validated.flat().every(step=>step.action.includes('@t.value')),'validator receives the unchanged saved source');
 assert.deepEqual(events.filter(event=>event.phase==='automation.agent.section.started').map(event=>event.details.step_id),['one','two']);
 assert.equal(events.some(event=>event.phase==='automation.agent.incomplete'),false);
 assert.equal(result.completion_attempts,2);assert.equal(result.updates.length,2);assert.equal(result.manual_coverage.length,2);
});

test('sequential retries cannot start the next manual action before the current draft validates',async()=>{
 const requests=[],events=[];
 await assert.rejects(completeAutomationBuild({steps,sequential:true,manualSteps:steps.map(step=>({...step,id:`m-${step.id}`,test_case_id:'manual'})),validate,
  onProgress:async event=>events.push(event),generate:async request=>{requests.push(request);return {steps:[candidate(request.activeStepId,'TODO')]};}
 }),error=>error.code==='AUTOMATION_BUILD_INCOMPLETE'&&error.completed_sections===0);
 assert.equal(requests.length,3);assert.deepEqual(requests.map(request=>request.activeStepId),['one','one','one']);
 assert.deepEqual(requests.map(request=>request.sectionAttempt),[1,2,3]);
 assert.ok(events.filter(event=>event.phase==='automation.agent.incomplete').every(event=>event.details.active_step_id==='one'));
});

test('sequential generation rejects later drafts and requests a correction without overwriting the validated current section',async()=>{
 const requests=[],previews=[];
 const result=await completeAutomationBuild({steps,sequential:true,validate,onValidatedSection:async({step})=>{previews.push(step.id);},generate:async request=>{
  requests.push(request);
  if(request.attempt===1)return {steps:[candidate('one'),candidate('two')]};
  if(request.attempt===2){assert.equal(request.activeStepId,'one');assert.deepEqual(request.feedback.required_sections,[]);assert.equal(request.feedback.validation_errors[0].code,'AUTOMATION_SECTION_OUT_OF_ORDER');return {steps:[]};}
  assert.equal(request.activeStepId,'two');return {steps:[candidate('two')]};
 }});
 assert.equal(requests.length,3);assert.deepEqual(previews,['one','two']);assert.equal(result.updates.length,2);
});

test('sequential sections advance beyond the old whole-case three-request bound without resetting per-section retries',async()=>{
 const many=Array.from({length:8},(_,index)=>({id:`s${index}`,step_order:index+1,action:`Action ${index}`,expected_result:`Result ${index}`}));
 const requests=[];
 const result=await completeAutomationBuild({steps:many,sequential:true,validate,generate:async request=>{requests.push(request);return {steps:[candidate(request.activeStepId)]};}});
 assert.equal(result.completion_attempts,8);assert.deepEqual(requests.map(request=>request.activeStepId),many.map(step=>step.id));
 assert.ok(requests.every(request=>request.sectionAttempt===1));assert.equal(result.updates.length,8);
});

test('sequential current browser actions and resulting evidence precede validation and the next section request',async()=>{
 const {runAutomationBrowserAgent}=require('../../backend/lib/automationBrowserAgent');
 const browserCalls=[],requests=[],order=[];let browserState='initial',current;
 const browser={tools:[{name:'browser_click'},{name:'browser_snapshot'}],call:async(name,args)=>{
  browserCalls.push(name);
  if(name==='browser_click'){browserState=args.locator;order.push(`action:${current}`);}
  if(name==='browser_snapshot')order.push(`evidence:${current}:${browserState}`);
  return {content:[{type:'text',text:JSON.stringify({browserState})}]};
 }};
 const result=await completeAutomationBuild({steps,sequential:true,validate,onValidatedSection:async({step})=>{order.push(`validated:${step.id}`);},
  generate:async request=>{current=request.activeStepId;requests.push(request);order.push(`request:${current}`);return runAutomationBrowserAgent({browser,generationMode:'sequential',prompt:JSON.stringify(request.feedback),parse:JSON.parse,onPartialBuild:request.onPartial,
   complete:async()=>JSON.stringify({steps:[candidate(request.activeStepId)],tool_calls:[{name:'browser_click',arguments:{locator:`#${request.activeStepId}`}}]})});}
 });
 assert.deepEqual(order,['request:one','action:one','evidence:one:#one','validated:one','request:two','action:two','evidence:two:#two','validated:two']);
 assert.deepEqual(browserCalls,['browser_click','browser_snapshot','browser_click','browser_snapshot']);assert.equal(requests.length,2);assert.equal(result.updates.length,2);
});

test('sequential unknown source coverage stays current until mapped to validated behavior',async()=>{
 const requests=[];
 const result=await completeAutomationBuild({steps,sequential:true,manualSteps:[{id:'unknown',test_case_id:'manual',step_order:1,action:'Other wording',expected_result:'Visible'}],validate,
  generate:async request=>{
   requests.push(request);
   if(request.attempt===1)return {steps:[candidate('one')]};
   if(request.attempt===2){assert.equal(request.activeStepId,'one');assert.deepEqual(request.feedback.required_sections,[]);return {steps:[],manual_coverage:[{manual_step_id:'unknown',manual_test_case_id:'manual',section_step_id:'one'}]};}
   assert.equal(request.activeStepId,'two');return {steps:[candidate('two')]};
  }
 });
 assert.equal(requests.length,3);assert.deepEqual(result.manual_coverage,[{manual_step_id:'unknown',manual_test_case_id:'manual',section_step_id:'one'}]);
});

test('sequential generation follows saved section positions rather than incidental input array order',async()=>{
 const manualSteps=[{...steps[1],id:'m-two',test_case_id:'manual'},{...steps[0],id:'m-one',test_case_id:'manual'}];
 const requests=[];
 const result=await completeAutomationBuild({steps:[steps[1],steps[0]],manualSteps,sequential:true,validate,generate:async request=>{requests.push(request.activeStepId);return {steps:[candidate(request.activeStepId)]};}});
 assert.deepEqual(requests,['one','two']);assert.deepEqual(result.updates.map(step=>step.step_id),['two','one'],'the final whole-case validator retains the authoritative supplied section ordering');
});

test('sequential generation completes automation-only prerequisites before the linked manual action',async()=>{
 const setup={id:'setup',step_order:0,step_type:'web',action:'Open the application and authenticate',expected_result:'Dashboard visible'};
 const manualSteps=steps.map(step=>({...step,id:'manual-'+step.id,test_case_id:'manual'}));
 const requests=[];
 const result=await completeAutomationBuild({steps:[setup,...steps],manualSteps,sequential:true,validate,generate:async request=>{requests.push({section:request.activeStepId,manual:request.activeManualStepIds});return {steps:[candidate(request.activeStepId)]};}});
 assert.deepEqual(requests,[{section:'setup',manual:[]},{section:'one',manual:['manual-one']},{section:'two',manual:['manual-two']}]);
 assert.equal(result.updates.length,3);assert.equal(result.manual_coverage.length,2);
});

test('late dependency reports cannot revoke or resave previously completed sections',async()=>{
 const saved=[],previews=[];
 const result=await completeAutomationBuild({steps,validate,onSaveSection:async({step})=>{saved.push(step.id);},onValidatedSection:async({step})=>{previews.push(step.id);},generate:async({onPartial})=>{
  await onPartial({steps:[candidate('one')]});
  const receipt=await onPartial({steps:[candidate('two')],blocked_steps:[{step_id:'one',dependency_type:'external_context',reason:'A later response claims the completed section needs different context.',required_context:['An unrelated source']}]});
  assert.deepEqual(receipt.completed_step_ids,['one','two']);
  assert.equal(receipt.validation_errors[0].code,'AUTOMATION_SECTION_ALREADY_COMPLETED');
  return {steps:[]};
 }});
 assert.deepEqual(saved,['one','two']);assert.deepEqual(previews,['one','two']);assert.equal(result.updates.length,2);
});

test('manual coverage of invalid drafts is rejected before any section is saved and can be corrected',async()=>{
 const saved=[],previews=[],manualSteps=[{id:'m',test_case_id:'manual',action:'Different manual wording',expected_result:'Saved'}];
 const result=await completeAutomationBuild({steps,manualSteps,validate,
  onSaveSection:async({step,manualCoverage})=>{saved.push({id:step.id,coverage:manualCoverage});},
  onValidatedSection:async({step})=>{previews.push(step.id);},generate:async({onPartial})=>{
   const receipt=await onPartial({steps:[candidate('one'),candidate('two','TODO')],manual_coverage:[{manual_step_id:'m',section_step_id:'two'}]});
   assert.deepEqual(receipt.completed_step_ids,[]);assert.ok(receipt.validation_errors.some(error=>error.code==='AUTOMATION_MANUAL_COVERAGE_UNVALIDATED'));
   assert.deepEqual(saved,[]);assert.deepEqual(previews,[]);
   await onPartial({steps:steps.map(step=>candidate(step.id)),manual_coverage:[{manual_step_id:'m',section_step_id:'two'}]});
   return {steps:[]};
  }
 });
 assert.deepEqual(saved.map(row=>row.id),['one','two']);assert.deepEqual(saved[0].coverage,[],'a future draft is absent from the earlier saved preview');
 assert.deepEqual(saved[1].coverage,result.manual_coverage);assert.deepEqual(previews,['one','two']);
});

test('new manual behavior cannot be assigned to an earlier completed section during development of the current section',async()=>{
 const saved=[],requests=[];
 const manualSteps=[{...steps[0],id:'m-one',test_case_id:'manual'},{id:'m-new',test_case_id:'manual',step_order:2,action:'Different behavior',expected_result:'Additional result'}];
 const result=await completeAutomationBuild({steps,manualSteps,sequential:true,validate,onSaveSection:async({step,attempt})=>{saved.push({id:step.id,attempt});},generate:async request=>{
  requests.push(request);
  if(request.attempt===1)return {steps:[candidate('one')]};
  if(request.attempt===2)return {steps:[candidate('two')],manual_coverage:[{manual_step_id:'m-new',section_step_id:'one'}]};
  assert.equal(request.activeStepId,'two');assert.equal(request.feedback.validation_errors[0].code,'AUTOMATION_MANUAL_COVERAGE_OUT_OF_SCOPE');
  assert.deepEqual(saved,[{id:'one',attempt:1}]);
  return {steps:[candidate('two')],manual_coverage:[{manual_step_id:'m-new',section_step_id:'two'}]};
 }});
 assert.equal(requests.length,3);assert.deepEqual(saved,[{id:'one',attempt:1},{id:'two',attempt:3}]);
 assert.equal(result.manual_coverage.find(row=>row.manual_step_id==='m-new').section_step_id,'two');
});

test('conflicting manual mappings cannot partially commit source or choose an arbitrary first mapping',async()=>{
 const saved=[],manualSteps=[{id:'m',test_case_id:'manual',action:'Different manual wording',expected_result:'Saved'}];
 const result=await completeAutomationBuild({steps,manualSteps,validate,onSaveSection:async({step})=>{saved.push(step.id);},generate:async request=>{
  if(request.attempt===1)return {steps:steps.map(step=>candidate(step.id)),manual_coverage:[{manual_step_id:'m',section_step_id:'one'},{manual_step_id:'m',section_step_id:'two'}]};
  assert.deepEqual(saved,[]);assert.deepEqual(request.feedback.required_sections.map(step=>step.step_id),['one','two']);
  assert.match(request.feedback.validation_errors[0].message,/Conflicting mappings/);
  return {steps:steps.map(step=>candidate(step.id)),manual_coverage:[{manual_step_id:'m',section_step_id:'two'}]};
 }});
 assert.deepEqual(saved,['one','two']);assert.equal(result.manual_coverage[0].section_step_id,'two');
});

test('conflicting linked manual and saved Plan orders stop before browser development or persistence',async()=>{
 let generations=0,saves=0;
 const manualSteps=[{...steps[1],id:'m-two',test_case_id:'manual',step_order:1},{...steps[0],id:'m-one',test_case_id:'manual',step_order:2}];
 await assert.rejects(completeAutomationBuild({steps,manualSteps,sequential:true,validate,onSaveSection:async()=>{saves++;},generate:async()=>{generations++;return {steps:steps.map(step=>candidate(step.id))};}}),error=>{
  assert.equal(error.code,'AUTOMATION_MANUAL_ORDER_CONFLICT');assert.equal(error.nonRetryable,true);assert.deepEqual(error.manual_step_ids,['m-two','m-one']);return true;
 });
 assert.equal(generations,0);assert.equal(saves,0);
});

test('streamed drafts are detached at submission so later mutations cannot replace validated and saved source',async()=>{
 const original=candidate('one'),saved=[];
 const result=await completeAutomationBuild({steps,validate,onSaveSection:async({step,normalized})=>{saved.push({id:step.id,code:normalized.updates[0].automation_code});},generate:async({onPartial})=>{
  const pending=onPartial({steps:[original]});
  original.automation_code='await web.click("#changed-before-consume");';
  await pending;
  original.automation_code='await web.click("#changed-after-save");';
  return {steps:[candidate('two')]};
 }});
 assert.equal(saved[0].code,candidate('one').automation_code);assert.equal(result.updates[0].automation_code,saved[0].code);
 assert.deepEqual(saved.map(row=>row.id),['one','two']);
});

test('normalization preserves only the safe assertion-boundary code in correction feedback',async()=>{
 for(const code of ['AUTOMATION_GENERATED_ASSERTION_NOT_PRESERVED','PRIVATE_PROVIDER_FAILURE']){
  const requests=[],saved=[];
  await completeAutomationBuild({steps:[steps[0]],validate:(payload,required)=>{
   if(payload.steps[0].automation_code==='rejected')throw Object.assign(new Error('The saved assertion must be retained.'),{code,private_context:'DO_NOT_COPY_PRIVATE_CONTEXT'});
   return validate(payload,required);
  },onSaveSection:async({step})=>saved.push(step.id),generate:async request=>{
   requests.push(request);
   if(request.attempt===1)return {steps:[candidate('one','rejected')]};
   const error=request.feedback.validation_errors[0];
   assert.equal(error.code,code==='AUTOMATION_GENERATED_ASSERTION_NOT_PRESERVED'?code:undefined);
   assert.equal(error.step_id,'one');assert.equal(error.message,'The saved assertion must be retained.');
   assert.doesNotMatch(JSON.stringify(request.feedback),/DO_NOT_COPY_PRIVATE_CONTEXT|PRIVATE_PROVIDER_FAILURE/);
   return {steps:[candidate('one')]};
  }});
  assert.equal(requests.length,2);assert.deepEqual(saved,['one']);
 }
});

test('metadata correction has its own bounded allowance after the last section succeeds on its final retry',async()=>{
 const saved=[],requests=[];
 const result=await completeAutomationBuild({steps:[steps[0]],sequential:true,validate,onSaveSection:async({step})=>{saved.push(step.id);},validateOutcome:outcome=>{
  if(!outcome.summary)throw Object.assign(new Error('A final summary is required.'),{code:'AI_MANAGED_SCHEMA_INVALID'});
 },generate:async request=>{
  requests.push(request);
  if(!request.completionOnly)return {steps:[candidate('one',request.sectionAttempt===3?candidate('one').automation_code:'TODO')]};
  assert.equal(request.feedback.completion_only,true);assert.equal(request.activeStepId,undefined);
  assert.deepEqual(request.feedback.required_sections,[]);assert.deepEqual(request.feedback.required_manual_steps,[]);
  assert.equal(request.sectionAttempt,1);return {steps:[],summary:'Completed flow'};
 }});
 assert.deepEqual(requests.map(request=>request.completionOnly),[false,false,false,true]);
 assert.deepEqual(saved,['one']);assert.equal(result.completion_attempts,4);
});

test('metadata-only retries remain bounded and incomplete outcomes report every durable section',async()=>{
 const saved=[],requests=[];
 await assert.rejects(completeAutomationBuild({steps:[steps[0]],sequential:true,validate,onSaveSection:async({step})=>{saved.push(step.id);},validateOutcome:()=>{throw Object.assign(new Error('Missing summary'),{code:'AI_MANAGED_SCHEMA_INVALID'});},generate:async request=>{
  requests.push(request);return request.completionOnly?{steps:[]}:{steps:[candidate('one')]};
 }}),error=>{
  assert.equal(error.code,'AUTOMATION_BUILD_INCOMPLETE');assert.equal(error.completed_sections,1);assert.equal(error.saved_sections,1);assert.deepEqual(error.saved_step_ids,['one']);return true;
 });
 assert.deepEqual(saved,['one']);assert.equal(requests.length,4);assert.deepEqual(requests.slice(1).map(request=>request.sectionAttempt),[1,2,3]);
 assert.ok(requests.slice(1).every(request=>request.completionOnly&&request.activeStepId===undefined));
});

test('every linked manual obligation for a shared section reaches the pinned review contract without truncating active references',async()=>{
 const {buildAutomationGoalObligations}=require('../../backend/lib/automationGoalObligations');
 const manualCases=['manual-a','manual-b','manual-c'].map((id,index)=>({id,steps:[{...steps[0],id:`m-${index}`}]}));
 const events=[];
 const result=await completeAutomationBuild({steps:[steps[0]],manualSteps:manualCases.flatMap(item=>item.steps.map(step=>({...step,test_case_id:item.id}))),sequential:true,validate,
  onProgress:async event=>events.push(event),generate:async request=>{
   assert.deepEqual(request.activeManualStepIds,['m-0','m-1','m-2']);
   assert.deepEqual(request.feedback.active_manual_step_ids,request.activeManualStepIds);
   const obligations=buildAutomationGoalObligations({section:steps[0],manualCases,activeManualStepIds:request.activeManualStepIds,requiredManualSteps:request.feedback.required_manual_steps});
   assert.deepEqual(obligations.map(goal=>goal.id),['one','manual:manual-a:m-0','manual:manual-b:m-1','manual:manual-c:m-2']);
   return {steps:[candidate('one')]};
  }
 });
 assert.equal(result.manual_coverage.length,3);
 assert.deepEqual(events.find(event=>event.phase==='automation.agent.section.started').details.active_manual_step_ids,['m-0','m-1','m-2']);
});
