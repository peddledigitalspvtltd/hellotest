const test=require('node:test');
const assert=require('node:assert/strict');
const {buildWithUpstreamPlaywright}=require('../../backend/lib/automationUpstreamEngineer');
const {failureInfo,withArtifact,withNode}=require('../../../agentic/backend/workflows/runtimeEvents');

const step={id:'open-product',step_order:6,step_type:'web',action:'Open the observed product',expected_result:'The product details are visible'};
const native=text=>({content:[{type:'text',text}]});
const timeout={isError:true,content:[{type:'text',text:'### Error\nTimeoutError: locator.click: Timeout 15000ms exceeded.\nCall log: navigating https://private-user:private-pass@shop.test/item?token=PRIVATE_TOKEN\npassword=PRIVATE_PASSWORD contact buyer@example.com\n'+'x'.repeat(12000)}]};
function fixture({onObservation,failedResult=timeout,actor}={}){
 const calls=[],phases=[],observations=[];let closed=false;
 const browser={tools:[
  {name:'browser_navigate',inputSchema:{type:'object',properties:{url:{type:'string'}},required:['url']}},
  {name:'browser_click',inputSchema:{type:'object',properties:{ref:{type:'string'}},required:['ref']}},
  {name:'browser_find',inputSchema:{type:'object',properties:{query:{type:'string'}},required:['query']}}
 ],call:async(name,args)=>{calls.push({name,args});if(name==='browser_navigate')return native('### Snapshot\n- link "Product" [ref=e15]');if(failedResult instanceof Error)throw failedResult;return failedResult;},close:async()=>{closed=true;}};
 const options={steps:[step],startUrl:'https://shop.test/',interactive:true,browser,
  validate:require('../../backend/services/automationReadiness.service').inspectExecutablePlan,
  complete:async request=>{phases.push(request.phase);return actor?actor(request):{tool:{name:'browser_click',arguments:{ref:'e15'}}};}};
 if(onObservation)options.onObservation=async observation=>{observations.push(observation);await onObservation(observation);};
 return {run:()=>buildWithUpstreamPlaywright(options),calls,phases,observations,get closed(){return closed;}};
}

test('failed native actions deliver bounded redacted evidence before stopping, without another model turn or action',async()=>{
 let delivered=false;
 const state=fixture({onObservation:async observation=>{if(observation.result.isError){delivered=true;
  assert.deepEqual(observation.result.failure,{tool:'browser_click',kind:'native_action_timeout',status:'unconfirmed'});
  assert.ok(observation.result.content[0].text.length<=4000);
  assert.match(observation.result.content[0].text,/Timeout 15000ms exceeded/);
  assert.doesNotMatch(JSON.stringify(observation),/private-user|private-pass|PRIVATE_TOKEN|PRIVATE_PASSWORD|buyer@example.com|https:\/\//);
 }}});
 await assert.rejects(state.run(),error=>{
  assert.equal(delivered,true);assert.equal(error.code,'AUTOMATION_UPSTREAM_ACTION_OUTCOME_UNCONFIRMED');
  assert.equal(error.nonRetryable,true);assert.equal(error.section_order,6);
  assert.equal(error.validation_errors[0].keyword,'native_action_timeout');
  assert.match(error.validation_errors[0].message,/TimeoutError: locator.click/);return true;
 });
 assert.deepEqual(state.calls.map(row=>row.name),['browser_navigate','browser_click']);
 assert.deepEqual(state.phases,['upstream_browser_actor']);assert.equal(state.closed,true);
});

test('workflow preview with its default no-op observation callback still persists native reason and reconciliation provenance',async()=>{
 const state=fixture();let error;
 try{await state.run();}catch(caught){error=caught;}
 assert.ok(error);Object.assign(error,{outcome_unknown:true,operation_id:'op-native-click'});
 const attributed=withNode(withArtifact(error,{artifact_task:'automation-engineer',story_id:'story-1',case_index:0,case_client_id:'case-1'}),
  {loop_owner:'each-story',iteration_index:0,iteration_path:['each-story',0]},{id:'automation',data:{label:'Automation Engineer'}});
 // This is the same bounded DTO serialized into the durable workflow node error.
 const saved=JSON.parse(JSON.stringify(failureInfo(attributed)));
 assert.equal(saved.category,'outcome_unknown');assert.equal(saved.reconciliation_required,true);assert.equal(saved.retryable,false);
 assert.equal(saved.section_order,6);assert.equal(saved.origin.node_id,'automation');assert.equal(saved.artifact.case_client_id,'case-1');
 assert.match(saved.message,/not automatically retried/);
 assert.equal(saved.validation_errors[0].keyword,'native_action_timeout');assert.match(saved.validation_errors[0].message,/Timeout 15000ms exceeded/);
 assert.ok(saved.validation_errors.length<=3&&saved.validation_errors.every(row=>row.message.length<=500));
 assert.doesNotMatch(JSON.stringify(saved),/private-user|private-pass|PRIVATE_TOKEN|PRIVATE_PASSWORD|buyer@example.com|https:\/\//);
 assert.deepEqual(state.calls.map(row=>row.name),['browser_navigate','browser_click']);assert.equal(state.closed,true);
});

test('an optional failed-evidence write cannot replace the native fault; revoked access and cancellation remain terminal',async()=>{
 for(const kind of ['optional','access','cancel']){
  const storageError=Object.assign(new Error('Evidence write unavailable'),kind==='access'?{statusCode:403,code:'MCP_ACCESS_DENIED'}:kind==='cancel'?{name:'AbortError'}:{code:'EVIDENCE_WRITE_FAILED'});
  const state=fixture({onObservation:async observation=>{if(observation.result.isError)throw storageError;}});
  await assert.rejects(state.run(),error=>{
   assert.equal(kind==='optional'?error.code==='AUTOMATION_UPSTREAM_ACTION_OUTCOME_UNCONFIRMED':error===storageError,true);
   assert.equal(error.nonRetryable,true);assert.equal(error.validation_errors[0].keyword,'native_action_timeout');return true;
  });
  assert.deepEqual(state.calls.map(row=>row.name),['browser_navigate','browser_click']);assert.equal(state.phases.length,1);assert.equal(state.closed,true);
 }
});

test('a thrown HTTP transport failure keeps its active section and native tool attribution without replay',async()=>{
 const {browserTransportError}=require('../../backend/lib/automationBrowserTransportError');
 const failure=browserTransportError(503,{method:'tools/call',tool:'browser_click'}),state=fixture({failedResult:failure});
 await assert.rejects(state.run(),error=>{
  assert.equal(error,failure);assert.equal(error.section_order,6);assert.equal(error.nonRetryable,true);
  const view=failureInfo(Object.assign(error,{outcome_unknown:true}));
  assert.equal(view.section_order,6);assert.equal(view.upstream_status_code,503);
  assert.equal(view.validation_errors[0].path,'/browser_tools/browser_click');assert.match(view.validation_errors[0].message,/HTTP 503/);return true;
 });
 assert.deepEqual(state.calls.map(row=>row.name),['browser_navigate','browser_click']);assert.equal(state.phases.length,1);assert.equal(state.closed,true);
});

test('a known blocker produces an explicitly unverified draft with a bounded private-safe reason',async()=>{
 const reason='The search shows 503 - Service Unavailable.';
 const state=fixture({actor:request=>request.phase==='upstream_browser_actor'
  ?{blocked_reason:reason+' https://private-user:private-pass@private-host.test/?token=PRIVATE_TOKEN password=PRIVATE_PASSWORD buyer@example.com '+ 'x'.repeat(9000)}
  :{automation_code:'await page.getByRole("link",{name:"Product",exact:true}).click();\nawait expect(page.getByRole("heading",{name:"Product details",exact:true})).toBeVisible();'}});
 const result=await state.run(),validation=result.browser_evidence.live_validation;
 assert.equal(validation.status,'blocked');assert.equal(validation.stopped_at_step_order,6);
 assert.ok(validation.reason.startsWith(reason));assert.ok(validation.reason.length<=500);
 assert.doesNotMatch(JSON.stringify(validation),/private-user|private-pass|PRIVATE_TOKEN|PRIVATE_PASSWORD|buyer@example.com|https:\/\//);
 assert.equal(result.updates.length,1);assert.equal(result.updates[0].live_validation.status,'blocked');
 assert.deepEqual(state.calls.map(row=>row.name),['browser_navigate']);
 assert.deepEqual(state.phases,['upstream_browser_actor','upstream_source']);assert.equal(state.closed,true);
});
