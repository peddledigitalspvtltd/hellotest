const test=require('node:test'),assert=require('node:assert/strict');
const {runAutomationBrowserAgent}=require('../../backend/lib/automationBrowserAgent');
const {createRetainedAssertionContract}=require('../../backend/lib/automationRetainedAssertions');
const {compileRecordedProgram}=require('../../backend/lib/automationRecordedProgram');
const {recordBrowserOperation}=require('../../backend/lib/automationBrowserRecording');
const {stampObservation}=require('../../backend/lib/automationActionReconciliation');

const url='https://app.test/auth';
const receipt=(value,isError=false)=>({isError,content:[{type:'text',text:JSON.stringify({source:'playwright',url,...value})}]});
const page=()=>receipt({observation_id:'auth-page',scope:'body',title:'Sign in',accessibility:'- alert: Invalid credentials',elements:[{
 tag:'div',role:'alert',text:'Invalid credentials',attributes:{id:'alert'},displayed:true,locators_validated:true,locator_candidates:['#alert']
}]});
const visible={name:'browser_assert',arguments:{assertion:'visible',locator:'#alert'}};
const urlCheck={name:'browser_assert',arguments:{assertion:'url',value:url}};
const original=compileRecordedProgram([visible,urlCheck]).source;
const goal={id:'current',source:'section',action:'Inspect the sign-in result',expected_result:'The invalid-credentials alert is visible and the URL remains '+url};
const reviewPacket=prompt=>prompt.includes('"kind":"automation_section_semantic_review"')?JSON.parse(prompt.split('\n').at(-1)):null;
const complete=tools=>JSON.stringify({stage:'act',step_id:'current',section_complete:true,tool_calls:tools});
function fixture({source=original,call,maxCalls=12,maxTurns=8,model}={}){
 const calls=[],observations=[],saves=[],events=[];let reviews=0,actors=0;
 const step={id:'current',step_id:'current',step_type:'web',automation_code:source};
 const contract=createRetainedAssertionContract({step});
 return {calls,observations,saves,events,step,contract,get reviews(){return reviews;},get actors(){return actors;},options:{
  browser:{tools:[{name:'browser_assert',inputSchema:{type:'object',properties:{assertion:{enum:['visible','url']},locator:{type:'string'},value:{type:'string'}},required:['assertion'],additionalProperties:false}},
   {name:'browser_snapshot',inputSchema:{type:'object'}}],projectPromptText:value=>value,call:async(name,args)=>{
    calls.push({name,args});return call?call(name,args):name==='browser_snapshot'?page():receipt({assertion_outcome:'satisfied'});
   }},prompt:'Inspect only the current result and retain the original saved assertions.',actorMode:true,parse:JSON.parse,maxCalls,maxTurns,
  initialObservations:[{tool:'browser_snapshot',result:page()}],execution:{required:true,step_id:'current',action:goal.action,expected_result:goal.expected_result,
   obligations:[goal],semantic_review_required:true,retained_assertion_contract:contract},
  complete:async prompt=>{const packet=reviewPacket(prompt);if(packet){reviews++;assert.equal(saves.length,0);return JSON.stringify({decision:'accept',obligations:[{
   id:'current',action_operations:packet.confirmed_operations.map((operation,index)=>operation.name!=='browser_assert'?index+1:null).filter(Boolean),assertion_operations:packet.confirmed_operations.map((operation,index)=>operation.name==='browser_assert'?index+1:null).filter(Boolean)
  }],issues:[]});}actors++;return model?model(prompt,actors):complete([visible]);},
  onObservation:row=>observations.push(row),onProgress:event=>events.push(event),onPartialBuild:async payload=>{saves.push(payload);return {generation_complete:true};}
 }};
}

test('host executes a missing original terminal URL check exactly once before review and save without a mutation',async()=>{
 const state=fixture();const result=await runAutomationBrowserAgent(state.options);
 assert.equal(state.contract.status,'available');assert.equal(state.actors,1);assert.equal(state.reviews,1);assert.equal(state.saves.length,1);
 assert.deepEqual(state.calls,[{name:'browser_assert',args:visible.arguments},{name:'browser_assert',args:urlCheck.arguments}]);
 assert.match(result.steps[0].automation_code,/page\.url\(\)\)\.toBe\("https:\/\/app.test\/auth"\)/);
 assert.match(result.steps[0].automation_code,/toBeVisible/);
 assert.equal(state.step.automation_code,original);
 const hostCheck=state.observations.filter(row=>row.tool==='browser_assert').at(-1);
 assert.equal(hostCheck.execution_step_id,'current');assert.equal(hostCheck.arguments.value,'[redacted]');assert.ok(hostCheck.action_id);
 assert.ok(state.events.some(event=>event.phase==='automation.agent.action.completed'&&event.details?.assertion==='url'));
});

test('an already confirmed original terminal check is not executed again on a completion-only proposal',async()=>{
 const state=fixture({source:compileRecordedProgram([urlCheck]).source,model:(_prompt,actor)=>actor===1?JSON.stringify({tool_calls:[urlCheck],section_complete:false}):complete([])});
 await runAutomationBrowserAgent(state.options);
 assert.equal(state.actors,2);assert.equal(state.reviews,1);assert.equal(state.saves.length,1);
 assert.deepEqual(state.calls,[{name:'browser_assert',args:urlCheck.arguments}]);
});

test('a failed retained original assertion stops without another model request, mutation, review or save',async()=>{
 const state=fixture({call:async(_name,args)=>args.assertion==='url'?receipt({code:'BROWSER_ASSERTION_NOT_SATISFIED',assertion_outcome:'not_satisfied',action_outcome:'not_attempted',retry_safe:true},true):receipt({assertion_outcome:'satisfied'})});
 await assert.rejects(runAutomationBrowserAgent(state.options),error=>error.code==='AUTOMATION_BROWSER_RETAINED_ASSERTION_FAILED'&&error.nonRetryable===true&&error.browser_code==='BROWSER_ASSERTION_NOT_SATISFIED');
 assert.equal(state.calls.length,2);assert.equal(state.actors,1);assert.equal(state.reviews,0);assert.equal(state.saves.length,0);assert.equal(state.step.automation_code,original);
});

test('a retained assertion transport failure is typed and never retries completed browser work',async()=>{
 const state=fixture({call:async(_name,args)=>{if(args.assertion==='url')throw new Error('private transport payload');return receipt({assertion_outcome:'satisfied'});}});
 await assert.rejects(runAutomationBrowserAgent(state.options),error=>error.code==='AUTOMATION_BROWSER_RETAINED_ASSERTION_FAILED'&&error.nonRetryable===true&&!/private/.test(error.message));
 assert.equal(state.calls.length,2);assert.equal(state.actors,1);assert.equal(state.reviews,0);assert.equal(state.saves.length,0);
});

test('retained checks reserve the remaining tool budget and cannot dispatch beyond its cap',async()=>{
 const state=fixture({maxCalls:1});
 await assert.rejects(runAutomationBrowserAgent(state.options),error=>error.code==='AUTOMATION_BROWSER_TOOL_BUDGET_EXHAUSTED'&&error.nonRetryable===true);
 assert.deepEqual(state.calls,[{name:'browser_assert',args:visible.arguments}]);assert.equal(state.reviews,0);assert.equal(state.saves.length,0);
});

test('a missing earlier terminal predicate rechecks the original ordered suffix before review and save',async()=>{
 const source=compileRecordedProgram([urlCheck,visible]).source;
 const state=fixture({source});
 const result=await runAutomationBrowserAgent(state.options);
 assert.deepEqual(state.calls,[
  {name:'browser_assert',args:visible.arguments},
  {name:'browser_assert',args:urlCheck.arguments},
  {name:'browser_assert',args:visible.arguments}
 ]);
 assert.equal(state.reviews,1);assert.equal(state.saves.length,1);
 const recorded=state.observations.filter(row=>row.tool==='browser_assert');
 assert.deepEqual(recorded.slice(-2).map(row=>row.arguments.assertion),['url','visible']);
 assert.ok(recorded.every(row=>row.result.isError===false&&JSON.parse(row.result.content[0].text).assertion_outcome==='satisfied'));
 assert.equal((result.steps[0].automation_code.match(/toBeVisible/g)||[]).length,2);
 assert.ok(result.steps[0].automation_code.indexOf('page.url()')<result.steps[0].automation_code.lastIndexOf('toBeVisible'));
 assert.equal(state.step.automation_code,source);
});

test('ordered saved-check hints let a compact actor preserve source without redundant terminal checks',async()=>{
 const source=compileRecordedProgram([urlCheck,visible]).source;
 let nextSource=source;
 for(let rebuild=0;rebuild<2;rebuild++){
  const state=fixture({source:nextSource,model:prompt=>{
   const current=JSON.parse(prompt.match(/^Current browser state and confirmed section progress .*?: (.+)$/m)[1]);
   const hints=current.retained_assertions.ordered_final_checks;
   assert.deepEqual(hints.checks.map(check=>check.assertion),['url','visible']);
   assert.equal(hints.checks[0].expected_value_omitted,true);
   assert.equal(hints.checks[1].locator,'#alert');
   assert.equal(hints.omitted_count,0);
   assert.doesNotMatch(JSON.stringify(hints),/https:\/\/app\.test\/auth/,'saved literals do not enter the order hints');
   return complete([urlCheck,visible]);
  }});
  const result=await runAutomationBrowserAgent(state.options);
  assert.equal(state.actors,1);assert.equal(state.reviews,1);assert.equal(state.saves.length,1);
  assert.deepEqual(state.calls,[{name:'browser_assert',args:urlCheck.arguments},{name:'browser_assert',args:visible.arguments}]);
  nextSource=result.steps[0].automation_code;
  assert.equal(nextSource,source,'following the retained order does not accumulate duplicate checks across rebuilds');
 }
});

test('the complete original ordered suffix must fit the shared budget before any host check is attempted',async()=>{
 const state=fixture({source:compileRecordedProgram([urlCheck,visible]).source,maxCalls:2});
 await assert.rejects(runAutomationBrowserAgent(state.options),error=>error.code==='AUTOMATION_BROWSER_TOOL_BUDGET_EXHAUSTED'&&error.nonRetryable===true);
 assert.deepEqual(state.calls,[{name:'browser_assert',args:visible.arguments}]);
 assert.equal(state.reviews,0);assert.equal(state.saves.length,0);
});

test('earlier saved checkpoints are never appended after their action by the final preflight',async()=>{
 const click={name:'browser_click',arguments:{locator:'#continue'}};
 const source=compileRecordedProgram([visible,click,urlCheck]).source;
 const state=fixture({source,model:(prompt,actor)=>{const current=JSON.parse(prompt.match(/^Current browser state and confirmed section progress .*?: (.+)$/m)[1]);
  assert.equal(current.retained_assertions.diagnostic.code,'AUTOMATION_RETAINED_ASSERTION_ORDER_GAP');return complete(actor===1?[urlCheck]:[]);}});
 const priorClick={tool:'browser_click',arguments:click.arguments,execution_step_id:'current',action_id:'confirmed-prior-click',result:receipt({action_outcome:'completed'})};
 stampObservation(priorClick,click);recordBrowserOperation(priorClick,click);state.options.initialObservations.push(priorClick);
 state.options.onPartialBuild=async()=>({generation_complete:false,validation_errors:[{code:'AUTOMATION_GENERATED_ASSERTION_NOT_PRESERVED'}]});
 await assert.rejects(runAutomationBrowserAgent(state.options),error=>error.code==='AUTOMATION_RECORDED_SECTION_VALIDATION_STALLED');
 assert.ok(state.calls.every(call=>call.name==='browser_assert'&&call.args.assertion==='url'));
 assert.equal(state.calls.some(call=>call.args.locator==='#alert'),false);
 assert.equal(state.saves.length,0);assert.equal(state.step.automation_code,source);
});

test('a retained contract from another section is diagnosed without executing any saved check',async()=>{
 const state=fixture({maxTurns:1,model:prompt=>{const current=JSON.parse(prompt.match(/^Current browser state and confirmed section progress .*?: (.+)$/m)[1]);
  assert.equal(current.retained_assertions.diagnostic.code,'AUTOMATION_RETAINED_ASSERTIONS_INVALID');return complete([]);}});
 state.options.execution.retained_assertion_contract=createRetainedAssertionContract({step:{id:'other',step_type:'web',automation_code:original}});
 await assert.rejects(runAutomationBrowserAgent(state.options),error=>error.code==='AUTOMATION_BROWSER_EXECUTION_INCOMPLETE');
 assert.equal(state.calls.length,0);assert.equal(state.reviews,0);assert.equal(state.saves.length,0);
});

test('a later failed check invalidates old terminal success even when a different check then passes',async()=>{
 let urls=0;
 const state=fixture({model:(_prompt,actor)=>actor===1?JSON.stringify({tool_calls:[visible,urlCheck],section_complete:false}):actor===2?JSON.stringify({tool_calls:[urlCheck],section_complete:false}):complete([visible]),
  call:async(name,args)=>name==='browser_snapshot'?page():args.assertion==='url'&&++urls>1?receipt({code:'BROWSER_ASSERTION_NOT_SATISFIED',assertion_outcome:'not_satisfied',action_outcome:'not_attempted',retry_safe:true},true):receipt({assertion_outcome:'satisfied'})});
 await assert.rejects(runAutomationBrowserAgent(state.options),error=>error.code==='AUTOMATION_BROWSER_RETAINED_ASSERTION_FAILED'&&error.nonRetryable===true);
 assert.equal(urls,3,'the old passed URL cannot discharge its original oracle after a failed check');
 assert.equal(state.actors,3);assert.equal(state.reviews,0);assert.equal(state.saves.length,0);
 assert.ok(state.calls.every(call=>['browser_assert','browser_snapshot'].includes(call.name)));
});

test('a contradictory error receipt with a satisfied field cannot pass original assertion preflight',async()=>{
 const state=fixture({call:async(_name,args)=>args.assertion==='url'?receipt({code:'BROWSER_ASSERTION_NOT_SATISFIED',assertion_outcome:'satisfied'},true):receipt({assertion_outcome:'satisfied'})});
 await assert.rejects(runAutomationBrowserAgent(state.options),error=>error.code==='AUTOMATION_BROWSER_RETAINED_ASSERTION_FAILED');
 assert.equal(state.reviews,0);assert.equal(state.saves.length,0);
});

test('an expired original deadline prevents any retained check from being dispatched',async t=>{
 const now=Date.now();let expired=false;
 t.mock.method(Date,'now',()=>expired?now+2000:now);
 const state=fixture({call:async()=>{expired=true;return receipt({assertion_outcome:'satisfied'});}});
 state.options.deadlineMs=now+1000;
 await assert.rejects(runAutomationBrowserAgent(state.options),error=>error.code==='AUTOMATION_BUILD_DEADLINE'&&error.nonRetryable===true);
 assert.deepEqual(state.calls,[{name:'browser_assert',args:visible.arguments}]);assert.equal(state.reviews,0);assert.equal(state.saves.length,0);
});
