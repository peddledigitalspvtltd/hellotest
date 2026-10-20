const test=require('node:test'),assert=require('node:assert/strict');
const {repairProjection,MAX_PROJECTION_BYTES}=require('../../backend/services/automationRepairContext');
const {minimalContext}=require('../../../agentic/backend/services/agentMinimalContext');

function fixture(){
 const steps=Array.from({length:8},(_,index)=>({id:`step-${index+1}`,step_order:index+1,action:`Action ${index+1}`,expected_result:`Expected ${index+1}`,automation_code:`await web.click("#${index+1}");\n${'// existing code\n'.repeat(100)}`}));
 return {steps,focus:steps[3],test:{id:'case',title:'Complete checkout intent',description:'Cart through completed order'},base:{test_case_id:'case',source_hash:'revision',execution_id:'run',build:'build',environment_id:'qa'},failureEvidence:{error:'Current locator missing',stepStatuses:{snapshot:'failed'}},sourceChanged:false};
}
test('repair projection keeps the exact failed section once and every preceding and subsequent requirement',()=>{
 const f=fixture(),projection=repairProjection(f);
 assert.equal(projection.focus.code,f.focus.automation_code);assert.equal(projection.steps.length,8);
 assert.ok(projection.steps.every(step=>!Object.hasOwn(step,'code')&&/^[a-f0-9]{64}$/.test(step.source_hash)));
 assert.deepEqual(projection.verification_scope.preceding_step_ids,['step-1','step-2','step-3']);
 assert.deepEqual(projection.verification_scope.successor_step_ids,['step-5','step-6','step-7','step-8']);
 assert.ok(Buffer.byteLength(JSON.stringify(projection))<MAX_PROJECTION_BYTES);
});
test('oversized exact failed source and case intent are rejected rather than partially disclosed',()=>{
 const f=fixture();f.focus.automation_code='x'.repeat(MAX_PROJECTION_BYTES);assert.equal(repairProjection(f),null);
 const g=fixture();g.steps[7].expected_result='x'.repeat(MAX_PROJECTION_BYTES);assert.equal(repairProjection(g),null);
});
test('provider size correction retains the complete repair contract ahead of unrelated excerpts',()=>{
 const projection=repairProjection(fixture()),content=JSON.stringify(projection);
 const reduced=minimalContext({bounded_workspace_context:{live_project:Array.from({length:4},(_,index)=>({id:`live-${index}`,source_kind:'live_project',content:'x'.repeat(3000)})),automation_repair:[{id:'repair',content,citation:{id:'repair'}}]},citation_contract:[{id:'repair'}]});
 assert.equal(reduced.payload.bounded_workspace_context.automation_repair[0].content,content);
 assert.equal(reduced.payload.bounded_workspace_context.automation_repair[0].excerpt_truncated,undefined);
 assert.ok(reduced.ids.has('repair'));
 assert.deepEqual(JSON.parse(reduced.payload.bounded_workspace_context.automation_repair[0].content).focus,projection.focus);
});
