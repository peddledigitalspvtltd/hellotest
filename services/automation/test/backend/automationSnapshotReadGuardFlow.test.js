const test=require('node:test'),assert=require('node:assert/strict');
const {runAutomationBrowserAgent}=require('../../backend/lib/automationBrowserAgent');
const {browserPromptContext}=require('../../backend/lib/automationBrowserContext');
const receipt=value=>({content:[{type:'text',text:JSON.stringify({source:'playwright',...value})}]});
const state=prompt=>JSON.parse(prompt.match(/^Current browser state and confirmed section progress .*?: (.+)$/m)[1]);
function fixture(){
 let reads=0;
 const snapshot=()=>receipt({url:'https://app.test/login',observation_id:`epoch-${reads}`,captured_at:String(reads),accessibility:'- status "Ready"',scope:'body',elements:[{tag:'p',accessible_role:'status',text:'Ready',displayed:true,locators_validated:true,locator_candidates:['#status']}]});
 const observations=[{tool:'browser_snapshot',execution_step_id:'step',arguments:{},result:snapshot()}],calls=[];
 return {observations,calls,browser:{tools:['browser_snapshot','browser_assert'].map(name=>({name,inputSchema:{type:'object'}})),call:async(name,args)=>{
  calls.push({name,args});if(name==='browser_snapshot'){reads++;return snapshot();}return receipt({assertion_outcome:'satisfied'});
 }}};
}
const options={prompt:'Verify the current status',actorMode:true,parse:JSON.parse,maxTurns:5,execution:{required:true,step_id:'step',action:'Verify the current status',expected_result:'The status is visible'}};

test('actor uses existing targets after unchanged-snapshot feedback and saves its actual native check',async()=>{
 const f=fixture();let actors=0,saves=0;
 await runAutomationBrowserAgent({...options,...f,initialObservations:f.observations,onObservation:item=>f.observations.push(item),onPartialBuild:async()=>{saves++;return {generation_complete:true};},complete:async prompt=>{
  actors++;const current=state(prompt);
  if(actors<3)return JSON.stringify({stage:'act',step_id:'step',section_complete:false,tool_calls:[{name:'browser_snapshot',arguments:{}}]});
  assert.equal(current.latest_failure.kind,'snapshot_redundant');assert.equal(current.latest_failure.expected_result_verified,false);
  assert.equal(current.pending_contract.next_required,'use_current_targets_for_remaining_action_or_native_check');
  return JSON.stringify({stage:'act',step_id:'step',section_complete:true,tool_calls:[{name:'browser_assert',arguments:{assertion:'visible',locator:current.current_snapshot.targets[0].ref}}]});
 }});
 assert.equal(actors,3);assert.equal(saves,1);assert.deepEqual(f.calls.map(c=>c.name),['browser_snapshot','browser_assert']);
 assert.equal(browserPromptContext(f.observations,'step',{compactModel:true}).current.latest_failure,undefined);
});

test('actor cannot spend more MCP or model calls repeating the blocked full-page read',async()=>{
 const f=fixture();let actors=0;
 await assert.rejects(runAutomationBrowserAgent({...options,...f,initialObservations:f.observations,onObservation:item=>f.observations.push(item),complete:async()=>{
  actors++;return JSON.stringify({stage:'act',step_id:'step',section_complete:false,tool_calls:[{name:'browser_snapshot',arguments:{}}]});
 }}),{code:'AUTOMATION_BROWSER_SNAPSHOT_READ_STALLED',nonRetryable:true});
 assert.equal(actors,3);assert.equal(f.calls.length,1);assert.equal(f.observations.filter(o=>o.tool==='automation_snapshot_feedback').length,1);
});
