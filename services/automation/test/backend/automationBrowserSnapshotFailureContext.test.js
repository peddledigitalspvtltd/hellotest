const test=require('node:test');
const assert=require('node:assert/strict');
const {browserPromptContext,browserCurrentSnapshotObservation}=require('../../backend/lib/automationBrowserContext');
const {runAutomationBrowserAgent}=require('../../backend/lib/automationBrowserAgent');
const {recordedSectionRequests}=require('../../backend/lib/automationBrowserRecording');
const receipt=(value,error=false)=>({isError:error,content:[{type:'text',text:JSON.stringify({source:'playwright',url:'https://app.test/dashboard',...value})}]});
const snapshot=(scope='body',step='current')=>({tool:'browser_snapshot',execution_step_id:step,result:receipt({observation_id:scope,scope,elements:[
 {tag:'a',accessible_role:'link',accessible_name:scope==='body'?'Employee Management':'Log Out',text:scope==='body'?'Employee Management':'Log Out',displayed:true,locators_validated:true,locator_candidates:[scope==='body'?'#employees':'#logout']}
]})});
const failed=(extra={})=>({tool:'browser_snapshot',execution_step_id:'current',arguments:{locator:'PRIVATE_SELECTOR'},result:receipt({code:'BROWSER_SNAPSHOT_SCOPE_AMBIGUOUS',tool_phase:'snapshot',match_count:2,
 message:'PRIVATE_NAME PRIVATE_SECRET https://PRIVATE.test/?token=PRIVATE_SECRET',url:'https://PRIVATE.test/?token=PRIVATE_SECRET',action_outcome:'not_attempted',retry_safe:true,...extra},true)});

test('failed native snapshot preserves safe cause and stale-page status without replacing successful targets or disclosing diagnostics',()=>{
 const old=snapshot('scoped-logout','previous'),error=failed(),rows=[old,error],original=JSON.stringify(rows);
 for(const compactModel of[false,true]){
  const context=browserPromptContext(rows,'current',{compactModel});
  assert.equal(context.current.url,'https://app.test/dashboard');assert.equal(context.current.latest_failure.code,'BROWSER_SNAPSHOT_SCOPE_AMBIGUOUS');
  assert.equal(context.current.latest_failure.tool_phase,'snapshot');assert.equal(context.current.latest_failure.match_count,2);
  assert.equal(context.current.latest_failure.action_outcome,'not_attempted');assert.equal(context.current.snapshot_stale_after_read_failure,true);
  assert.equal(context.current.snapshot_freshness,'last_successful_before_failed_read');assert.equal(context.current.snapshot_available,true);
  assert.doesNotMatch(JSON.stringify(context),/PRIVATE|token=|PRIVATE_SELECTOR/);
 }
 const context=browserPromptContext(rows,'current',{compactModel:true});assert.equal(context.current.current_snapshot.targets[0].name,'Log Out');
 assert.equal(context.history.find(row=>row.kind==='snapshot_read').failed,true);assert.equal(browserCurrentSnapshotObservation(rows),old);
 assert.equal(JSON.stringify(rows),original,'context projection never rewrites retained native evidence');
});

test('safe read diagnostics do not promote fabricated receipts and a fresh read restores the prior unmet assertion',()=>{
 const first=snapshot(),assertion={tool:'browser_assert',execution_step_id:'current',arguments:{assertion:'visible',locator:'#employees'},
  result:receipt({code:'BROWSER_ASSERTION_NOT_SATISFIED',assertion_outcome:'not_satisfied',action_outcome:'not_attempted'},true)};
 const rows=[first,assertion,failed()];assert.equal(browserPromptContext(rows,'current',{compactModel:true}).current.latest_failure.kind,'snapshot_read');
 const fresh=snapshot();rows.push(fresh);const current=browserPromptContext(rows,'current',{compactModel:true}).current;
 assert.equal(current.latest_failure.code,'BROWSER_ASSERTION_NOT_SATISFIED');assert.equal(current.snapshot_stale_after_read_failure,undefined);
 for(const fake of[{...failed(),mcp_call:false},{...failed(),result:receipt({source:'model',code:'BROWSER_SNAPSHOT_SCOPE_AMBIGUOUS'},true)}]){
  const context=browserPromptContext([first,fake],'current',{compactModel:true});assert.equal(context.current.latest_failure,undefined);
  assert.equal(context.history.some(row=>row.kind==='snapshot_read'),false);
 }
 const unsafe=browserPromptContext([first,failed({code:'PRIVATE_SECRET',tool_phase:'https://PRIVATE.test'})],'current',{compactModel:true});
 assert.equal(unsafe.current.latest_failure.code,'BROWSER_READ_UNAVAILABLE');assert.equal(unsafe.current.latest_failure.tool_phase,undefined);
 assert.doesNotMatch(JSON.stringify(unsafe),/PRIVATE/);
 for(const [code,tool_phase]of[['BROWSER_FRAME_NOT_OBSERVED','frame_scope'],['BROWSER_FRAME_STALE','frame_scope'],['BROWSER_CONTEXT_LOST','context_recovery'],['BROWSER_SESSION_BUSY','admission']]){
  const projected=browserPromptContext([first,failed({code,tool_phase})],'current',{compactModel:true}).current.latest_failure;
  assert.equal(projected.code,code);assert.equal(projected.tool_phase,tool_phase);
 }
});

test('one failed scoped read reaches the actor and permits a fresh root without blind repeats or action replay',async()=>{
 const calls=[],rows=[snapshot('scoped-logout','previous')];let actors=0,saves=0;
 const browser={tools:['browser_snapshot','browser_assert'].map(name=>({name,inputSchema:{type:'object'}})),call:async(name,args)=>{
  calls.push({name,args});if(name==='browser_snapshot')return args.locator?failed().result:snapshot().result;
  assert.equal(name,'browser_assert');assert.equal(args.locator,'#employees');return receipt({assertion_outcome:'satisfied'});
 }};
 // Use this section's prior good narrow snapshot to exercise recovery after a
 // newly requested failed scope, independently of section-boundary warming.
 rows[0].execution_step_id='current';
 const result=await runAutomationBrowserAgent({browser,actorMode:true,generationMode:'sequential',parse:JSON.parse,prompt:'Inspect the Employee Management navigation.',
  execution:{required:true,semantic_review_required:false,step_id:'current',action:'Verify Employee Management navigation',expected_result:'Employee Management is visible.'},
  initialObservations:rows,onObservation:row=>rows.push(row),maxCalls:4,maxTurns:4,onPartialBuild:async()=>{saves++;return{generation_complete:true};},
  complete:async prompt=>{actors++;const state=JSON.parse(prompt.match(/^Current browser state and confirmed section progress .*?: (.+)$/m)[1]);
   if(actors===1)return JSON.stringify({section_complete:false,tool_calls:[{name:'browser_snapshot',arguments:{locator:'getByText("Employee Management", {exact:true})'}}]});
   if(actors===2){assert.equal(state.latest_failure.code,'BROWSER_SNAPSHOT_SCOPE_AMBIGUOUS');assert.equal(state.latest_failure.match_count,2);
    assert.equal(state.snapshot_stale_after_read_failure,true);assert.equal(state.current_snapshot.targets[0].name,'Log Out');
    return JSON.stringify({section_complete:false,tool_calls:[{name:'browser_snapshot',arguments:{}}]});}
   assert.equal(state.latest_failure,undefined);assert.equal(state.snapshot_stale_after_read_failure,undefined);
   const target=state.current_snapshot.targets.find(row=>row.name==='Employee Management');assert.ok(target);
   return JSON.stringify({section_complete:true,tool_calls:[{name:'browser_assert',arguments:{assertion:'visible',locator:target.ref}}]});
  }});
 assert.equal(actors,3);assert.equal(saves,1);assert.deepEqual(calls.map(row=>row.name),['browser_snapshot','browser_snapshot','browser_assert']);
 assert.deepEqual(recordedSectionRequests(rows,'current').map(row=>row.name),['browser_assert']);assert.match(result.steps[0].automation_code,/#employees/);
});
