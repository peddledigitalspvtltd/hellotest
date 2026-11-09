const test=require('node:test'),assert=require('node:assert/strict');
const {runAutomationBrowserAgent}=require('../../backend/lib/automationBrowserAgent');
const {recordedSectionRequests}=require('../../backend/lib/automationBrowserRecording');
const {browserObservationDeadline,progressEvent}=require('../../backend/lib/automationProgressDiagnostics');
const receipt=(value,isError=false)=>({isError,content:[{type:'text',text:JSON.stringify({source:'playwright',...value})}]});

test('a completed click followed by a native snapshot deadline retains its phase and stops before screenshot,404or replay',async()=>{
  for(const phase of ['page_readiness','frame_inventory','snapshot']){
    const calls=[],events=[],observations=[{tool:'browser_snapshot',arguments:{},result:receipt({url:'https://app.test/before',title:'Fixture',scope:'body',observation_id:'initial',accessibility:'- button "Next"',elements:[
      {tag:'button',accessible_role:'button',accessible_name:'Next',attributes:{id:'next'},locators_validated:true,locator_candidates:['#next'],displayed:true}
    ]})}];let models=0;
    const browser={tools:['browser_click','browser_snapshot','browser_screenshot','browser_assert'].map(name=>({name,inputSchema:{type:'object'}})),call:async(name,args)=>{
      calls.push({name,args});
      if(name==='browser_click')return receipt({url:'https://app.test/after',action_outcome:'completed'});
      if(name==='browser_snapshot')return receipt({code:'BROWSER_TOOL_DEADLINE',tool_phase:phase,action_outcome:'not_attempted',retry_safe:true,url:'https://PRIVATE.test/?token=PRIVATE',message:'PRIVATE native details',
        readiness_diagnostics:{loaded:true,usable:true,actionable:true,busy:true,document_busy:false,document_root_busy:false,busy_regions:1,indeterminate_progress:0,signature_changes:3,quiet_ms:0,pending_requests:1,probe_count:20,load_state:'complete',text:'PRIVATE',signature:12345}},true);
      throw Error('A screenshot or follow-up read must not mask the original deadline with404');
    }};
    await assert.rejects(runAutomationBrowserAgent({browser,prompt:'Click Next and verify the next page',actorMode:true,parse:JSON.parse,initialObservations:observations,
      execution:{required:true,step_id:'current',action:'Click Next',expected_result:'The next page is visible',source_obligations:[{id:'current',action:'Click Next'}]},
      onObservation:row=>observations.push(row),onProgress:async event=>events.push(progressEvent(event)),onPartialBuild:async()=>assert.fail('A failed observation cannot save an unfinished section'),
      complete:async prompt=>{
        models++;const state=JSON.parse(prompt.match(/^Current browser state and confirmed section progress .*?: (.+)$/m)[1]);
        return JSON.stringify({stage:'act',step_id:'current',section_complete:true,tool_calls:[{name:'browser_click',arguments:{locator:state.current_snapshot.targets[0].ref}}]});
      }}),error=>error.code==='AUTOMATION_BROWSER_OBSERVATION_DEADLINE'&&error.browser_code==='BROWSER_TOOL_DEADLINE'&&error.tool_phase===phase&&error.action_outcome==='not_attempted'&&error.retry_safe===false&&error.nonRetryable);
    assert.deepEqual(calls.map(call=>call.name),['browser_click','browser_snapshot']);assert.equal(models,1);
    const completed=events.find(event=>event.phase==='automation.agent.action.completed');assert.ok(completed);assert.equal(completed.details.action_outcome,'completed');
    const failed=events.find(event=>event.phase==='automation.agent.observation.failed');assert.ok(failed);
    assert.equal(failed.details.tool_phase,phase);assert.equal(failed.details.browser_code,'BROWSER_TOOL_DEADLINE');assert.equal(failed.details.error_code,'AUTOMATION_BROWSER_OBSERVATION_DEADLINE');
    assert.equal(failed.details.last_completed_action_id,completed.details.action_id);assert.equal(failed.details.known_action_outcome,'completed');
    assert.equal(failed.details.readiness_diagnostics.busy,true);assert.equal(failed.details.readiness_diagnostics.busy_regions,1);assert.equal(failed.details.readiness_diagnostics.probe_count,20);
    assert.equal(failed.details.readiness_diagnostics.text,undefined);assert.equal(failed.details.readiness_diagnostics.signature,undefined);
    assert.deepEqual(recordedSectionRequests(observations,'current').map(operation=>operation.name),['browser_click'],'the native completed action remains in the protected ledger');
    assert.ok(!events.some(event=>event.phase==='automation.agent.evidence.unavailable'||event.phase==='automation.agent.action.unknown'));
    assert.doesNotMatch(JSON.stringify(events),/PRIVATE|https?:|token=|native details/);
  }
});

test('only a native terminal read deadline supplies observation classifications; unsafe fields and unknown actions retain their own handling',()=>{
  const native={code:'BROWSER_TOOL_DEADLINE',tool_phase:'snapshot',action_outcome:'not_attempted'};
  assert.equal(browserObservationDeadline(receipt(native,true),{tool:'browser_click'}),null);
  for(const value of [{...native,source:'model'},{...native,code:'BROWSER_READ_UNAVAILABLE'},{...native,action_outcome:'unknown'}])
    assert.equal(browserObservationDeadline(receipt(value,true),{tool:'browser_snapshot'}),null);
  assert.equal(browserObservationDeadline(receipt(native),{tool:'browser_snapshot'}),null);
  const result=browserObservationDeadline(receipt({...native,tool_phase:'https://PRIVATE',value:'PRIVATE',message:'PRIVATE'},true),{tool:'browser_snapshot'});
  assert.equal(result.error_code,'AUTOMATION_BROWSER_OBSERVATION_DEADLINE');assert.equal(result.tool_phase,undefined);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|message|value/);
});

test('a hard screenshot deadline stays terminal with its original phase rather than optional feedback followed by404',async()=>{
  const calls=[],events=[],observations=[{tool:'browser_snapshot',arguments:{},result:receipt({url:'https://app.test/before',scope:'body',observation_id:'initial',accessibility:'- button "Next"',elements:[
    {tag:'button',accessible_role:'button',accessible_name:'Next',attributes:{id:'next'},locators_validated:true,locator_candidates:['#next'],displayed:true}
  ]})}];let models=0;
  const browser={tools:['browser_click','browser_snapshot','browser_screenshot'].map(name=>({name,inputSchema:{type:'object'}})),call:async name=>{
    calls.push(name);
    if(name==='browser_click')return receipt({url:'https://app.test/after',action_outcome:'completed'});
    if(name==='browser_snapshot')return receipt({url:'https://app.test/after',scope:'body',observation_id:'after',accessibility:'- heading "Ready"',elements:[
      {tag:'h1',accessible_role:'heading',accessible_name:'Ready',text:'Ready',attributes:{id:'ready'},locators_validated:true,locator_candidates:['#ready'],displayed:true}
    ]});
    if(name==='browser_screenshot')return receipt({code:'BROWSER_TOOL_DEADLINE',tool_phase:'screenshot',session_disposition:'quarantined',action_outcome:'not_attempted',retry_safe:false,optional:true},true);
    throw Error('No following tool is permitted');
  }};
  await assert.rejects(runAutomationBrowserAgent({browser,prompt:'Click Next',actorMode:true,parse:JSON.parse,initialObservations:observations,
    execution:{required:true,step_id:'current',action:'Click Next',expected_result:'Ready is visible',source_obligations:[{id:'current',action:'Click Next'}]},
    onProgress:async event=>events.push(event),onObservation:row=>observations.push(row),complete:async prompt=>{
      models++;const state=JSON.parse(prompt.match(/^Current browser state and confirmed section progress .*?: (.+)$/m)[1]);
      return JSON.stringify({stage:'act',step_id:'current',section_complete:true,tool_calls:[{name:'browser_click',arguments:{locator:state.current_snapshot.targets[0].ref}}]});
    }}),error=>error.code==='AUTOMATION_BROWSER_OBSERVATION_DEADLINE'&&error.browser_code==='BROWSER_TOOL_DEADLINE'&&error.tool_phase==='screenshot'&&error.session_disposition==='quarantined');
  assert.deepEqual(calls,['browser_click','browser_snapshot','browser_screenshot']);assert.equal(models,1);
  const failed=events.find(event=>event.phase==='automation.agent.observation.failed');assert.equal(failed.details.session_disposition,'quarantined');assert.equal(failed.details.tool_phase,'screenshot');
  assert.ok(!events.some(event=>event.phase==='automation.agent.evidence.unavailable'||event.phase==='automation.agent.action.unknown'));
  assert.deepEqual(recordedSectionRequests(observations,'current').map(operation=>operation.name),['browser_click']);
});
