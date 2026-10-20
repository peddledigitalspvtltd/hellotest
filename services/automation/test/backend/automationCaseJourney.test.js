const test=require('node:test'),assert=require('node:assert/strict');
const {createAutomationCaseJourney,automationJourneyRequirements}=require('../../backend/lib/automationCaseJourney');
const {createAutomationActorContext}=require('../../backend/lib/automationActorContext');
const makeSteps=n=>Array.from({length:n},(_,index)=>({id:'step-'+index,step_type:'web',action:'Perform action '+index,expected_result:'Preserve outcome '+index}));

test('a host journey keeps whole intent and actual build progress separate from saved code and future work',()=>{
 const steps=makeSteps(30);steps[12].action='Enter @r.password';steps[12].expected_result='The full supplied value is retained';
 const journey=createAutomationCaseJourney({testCase:{title:'Negative sign in',description:'The authenticated workspace must remain inaccessible',preconditions:'Use PRIVATE_FIXTURE'},steps,activeStepId:'step-12',completedStepIds:['step-11'],projectText:text=>text.replaceAll('PRIVATE_FIXTURE','[private parameter value]')});
 const context=journey.context();
 assert.equal(context.total_steps,30);assert.equal(context.active_position,13);assert.ok(context.omitted_step_count>0);
 assert.equal(context.steps.find(row=>row.step_id==='step-11').state,'browser_confirmed_and_saved_this_build');
 assert.equal(context.steps.find(row=>row.step_id==='step-10').state,'earlier_unconfirmed_this_build');
 assert.equal(context.steps.find(row=>row.step_id==='step-13').state,'future');
 assert.doesNotMatch(JSON.stringify(context),/PRIVATE_FIXTURE/);assert.match(JSON.stringify(context),/@r\.password/);
 assert.deepEqual(journey.select(['step-12'])[0],{step_id:'step-12',position:13,step_type:'web',action:steps[12].action,expected_result:steps[12].expected_result});
 context.steps[0].action.text='Changed';assert.notEqual(journey.context().steps[0].action.text,'Changed');
 for(const forged of [{},structuredClone(context)])assert.throws(()=>automationJourneyRequirements(forged,'step-12'),{code:'AUTOMATION_CASE_JOURNEY_INVALID'});
 assert.throws(()=>automationJourneyRequirements(journey,'step-11'),{code:'AUTOMATION_CASE_JOURNEY_INVALID'});
});

test('journey excerpts are labelled and exact full requirements remain available without substituting data',()=>{
 const steps=makeSteps(2);steps[1].action='Use @r.email '+ 'action '.repeat(400);steps[1].expected_result='Check every outcome '+ 'outcome '.repeat(400);
 const journey=createAutomationCaseJourney({testCase:{title:'Intent'},steps,activeStepId:'step-1',projectText:text=>text});
 assert.equal(journey.context().steps[1].action.truncated,true);
 assert.equal(journey.select(['step-1'])[0].action,steps[1].action);
 for(const ids of [[],['unknown'],['step-0','step-0'],Array(9).fill('step-0')])assert.throws(()=>journey.select(ids),{code:'AUTOMATION_CASE_JOURNEY_INVALID'});
 assert.throws(()=>createAutomationCaseJourney({testCase:{},steps,activeStepId:'step-0',completedStepIds:['step-1'],projectText:text=>text}),{code:'AUTOMATION_CASE_JOURNEY_INVALID'});
});

test('actor context exposes exact journey-step selection within its existing disclosure budget',()=>{
 const steps=makeSteps(2),current={...steps[0],step_order:1};
 const journey=createAutomationCaseJourney({testCase:{id:'case',title:'Intent'},steps,activeStepId:current.id,projectText:text=>text});
 const manager=createAutomationActorContext({task:{case:{id:'case',title:'Intent'},current_section:current,build_context:{linked_manual_cases:[],generation_scope:{active_manual_step_ids:[]}}},caseJourney:journey});
 assert.equal(JSON.parse(manager.prompt).case_journey.total_steps,2);
 const result=manager.request({journey_steps:['step-1']});assert.equal(result.data.journey_steps[0].action,steps[1].action);
 assert.equal(manager.request({journey_steps:['foreign']}).code,'AUTOMATION_ACTOR_CONTEXT_REQUEST_INVALID');
 assert.equal(manager.request({journey_steps:['step-1'],extra:'invented'}).code,'AUTOMATION_ACTOR_CONTEXT_REQUEST_INVALID');
});

test('saved API and mobile setup source never claims prior browser execution in mixed cases',()=>{
 const steps=makeSteps(3);steps[0].step_type='api';steps[1].step_type='android';
 const journey=createAutomationCaseJourney({testCase:{title:'Mixed setup'},steps,activeStepId:'step-2',completedStepIds:['step-0','step-1'],projectText:text=>text});
 assert.deepEqual(journey.context().steps.slice(0,2).map(row=>row.state),['saved_source_unverified_this_build','saved_source_unverified_this_build']);
 assert.ok(automationJourneyRequirements(journey,'step-2').previous.every(row=>row.state==='saved_source_unverified_this_build'));
});
