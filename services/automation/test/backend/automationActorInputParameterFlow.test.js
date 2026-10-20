const test=require('node:test'),assert=require('node:assert/strict');
const {runAutomationBrowserAgent}=require('../../backend/lib/automationBrowserAgent');
const {createAutomationInputParameterBinding}=require('../../backend/lib/automationInputParameterBinding');
const result=value=>({content:[{type:'text',text:JSON.stringify({source:'playwright',...value})}]});

test('actor wiring records active public inputs and explicit expected bindings as reusable references',async()=>{
 const value='reviewed@example.test',goal={id:'email',source:'section',action:'Enter @r.email in Email',expected_result:'Email retains @r.email without errors'};
 const snapshot=()=>result({observation_id:'email-page',url:'https://app.test/login',scope:'body',elements:[{tag:'input',attributes:{type:'email'},locators_validated:true,locator_candidates:['#email'],displayed:true}]});
 const policy=createAutomationInputParameterBinding({stepId:'email',obligations:[goal],bindings:[{obligation_id:'email',action_parameters:['r.email'],expected_result_parameters:['r.email']}],parameterValues:{'r.email':value}});
 const calls=[];let actorCalls=0,reviewCalls=0,saved;
 await runAutomationBrowserAgent({prompt:'Enter the reviewed email',actorMode:true,parse:JSON.parse,inputParameterBinding:policy,
  execution:{required:true,step_id:'email',action:goal.action,expected_result:goal.expected_result,obligations:[goal],source_obligations:[goal],semantic_review_required:true},
  initialObservations:[{tool:'browser_snapshot',result:snapshot()}],
  browser:{tools:['browser_fill','browser_assert','browser_snapshot'].map(name=>({name,inputSchema:{type:'object'}})),call:async(name,args)=>{calls.push({name,args});return name==='browser_snapshot'?snapshot():result(name==='browser_assert'?{assertion_outcome:'satisfied'}:{action_outcome:'completed'});}},
  complete:async(prompt,_remaining,trace)=>{
   if(trace?.generationScope==='section_semantic_review'){reviewCalls++;return JSON.stringify({decision:'accept',obligations:[{id:'email',action_operations:[1],assertion_operations:[2,3]}],issues:[]});}
   actorCalls++;return JSON.stringify({stage:'act',step_id:'email',section_complete:true,tool_calls:[{name:'browser_fill',arguments:{locator:'#email',value}},{name:'browser_assert',arguments:{assertion:'value',locator:'#email',value}},{name:'browser_assert',arguments:{assertion:'field_valid',locator:'#email'}}]});
  },onPartialBuild:async payload=>{saved=payload.steps[0].automation_code;return {generation_complete:true};}
 });
 assert.equal(actorCalls,1);assert.equal(reviewCalls,1);
 assert.equal(calls.find(call=>call.name==='browser_fill').args.value,'@r.email');
 assert.equal(calls.find(call=>call.name==='browser_assert'&&call.args.assertion==='value').args.value,'@r.email');
 assert.match(saved,/@r\.email/);assert.ok(!saved.includes(value));
});
