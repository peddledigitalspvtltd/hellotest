const test=require('node:test'),assert=require('node:assert/strict');
const rules=require('../../backend/services/automationRepairRules');
const base={source_hash:'revision',failed_step_ids:['action'],steps:[{id:'action',step_order:1,automation_code:'await web.click("#old");'},{id:'oracle',step_order:2,expected_result:'Saved state',automation_code:'await web.expectText("#status", "Saved");'}]};
const candidate={kind:'replace_locator',step_id:'action',new_locator:'#new',rationale:'The captured DOM identifies this replacement button.'};
test('typed repair escapes literal targets and cannot change assertions, values, retries or arbitrary code',()=>{
  const patch=rules.patch(base,candidate);assert.equal(patch.after,'await web.click("#new");');assert.equal(patch.assertions_preserved,true);
  assert.throws(()=>rules.patch(base,{...candidate,step_id:'oracle'}));
  assert.throws(()=>rules.patch(base,{...candidate,code:'skip()'}));
  assert.throws(()=>rules.patch(base,{...candidate,new_locator:'${arbitrary}'}));
  assert.throws(()=>rules.patch({...base,steps:[{...base.steps[0],automation_code:'await web.click("#old"); await arbitrary();'}]},candidate));
  const escaped=rules.patch(base,{...candidate,new_locator:'button[data-label="Save"]'});assert.match(escaped.after,/\\"Save\\"/);
  assert.equal(rules.patch(base,null),null);
});
function fixture(){
  const manifest={original:{hash:'original',case_ids:['case']},patched:{hash:'patched',case_ids:['case','neighbor']},negative:{hash:'negative',case_ids:['case']}};
  const receipts={};
  for(const phase of Object.keys(manifest)){
    const steps=manifest[phase].case_ids.flatMap(id=>[1,2].map(order=>({test_case_id:id,step_order:order,snapshot_step_id:`${id}-${order}`,automation_code:`code-${order}`})));
    const jobs=manifest[phase].case_ids.map(id=>({id:`job-${phase}-${id}`,test_case_id:id,status:phase==='patched'?'completed':'failed',completed_at:'2026-10-04',payload:{max_repair_attempts:0,session_policy:{web:{mode:'new'}},steps:steps.filter(step=>step.test_case_id===id).map(step=>({id:step.snapshot_step_id,automation_code:step.automation_code}))},runtime_state:{logs:{stepStatuses:{[`${id}-1`]:phase==='original'?'failed':'passed',[`${id}-2`]:phase==='negative'?'failed':'passed'}}}}));
    receipts[phase]={hash:phase,steps,jobs};
  }
  return {manifest,receipts};
}
test('verification requires original failure, repaired and neighbor passes, and protected negative assertion failure',()=>{const f=fixture();const result=rules.evaluate(f.manifest,f.receipts,1,2);assert.equal(result.status,'verified');assert.ok(result.checks.every(check=>check.receipt_hash&&check.job_ids.length));});
test('unknown, changed, healed, missing neighbor and broken oracle evidence never verify a repair',()=>{
  for(const change of ['snapshot','neighbor','oracle','healing','payload','settings','duplicate','pending']){
    const f=fixture(),target=f.receipts.patched.jobs[0];
    if(change==='snapshot')f.receipts.patched.hash='changed';if(change==='neighbor')f.receipts.patched.jobs.pop();
    if(change==='oracle')f.receipts.negative.jobs[0].runtime_state.logs.stepStatuses['case-2']='passed';
    if(change==='healing')target.runtime_state.healing_attempted=true;if(change==='payload')target.payload.steps[0].automation_code='ignored()';
    if(change==='settings')target.payload.timeouts={action_timeout_ms:999999};if(change==='duplicate')f.receipts.patched.jobs.push(target);if(change==='pending')target.completed_at=null;
    assert.notEqual(rules.evaluate(f.manifest,f.receipts,1,2).status,'verified',change);
  }
});
