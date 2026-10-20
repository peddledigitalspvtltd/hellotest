const test=require('node:test'),assert=require('node:assert/strict');
const rules=require('../../backend/services/automationRepairRules');
const base={source_hash:'revision',failed_step_ids:['action'],steps:[{id:'action',step_order:1,automation_code:'await web.click("#old");'},{id:'oracle',step_order:2,expected_result:'Saved state',automation_code:'await web.expectText("#status", "Saved");'}]};
const candidate={kind:'replace_locator',step_id:'action',new_locator:'#new',rationale:'The captured DOM identifies this replacement button.'};
test('typed repair escapes literal targets and cannot change assertions, values, retries or arbitrary code',()=>{
  const patch=rules.patch(base,candidate);assert.equal(patch.after,'await web.click("#new");');assert.equal(patch.assertions_preserved,true);
  assert.equal(rules.validateStoredPatch(base,patch),true);
  assert.throws(()=>rules.validateStoredPatch(base,{...patch,after:'await web.click("#different");'}));
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
    const steps=manifest[phase].case_ids.flatMap(id=>[1,2].map(order=>({test_case_id:id,step_order:order,snapshot_step_id:`${id}-${order}`,expected_result:order===2?'Saved state':'',automation_code:order===1?'await web.click("#submit");':'await web.expectText("#status", "Saved");'})));
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
test('missing pinned runs and malformed receipt collections remain unverified without throwing',()=>{
 for(const change of ['missing-original','missing-patched','missing-steps','malformed-jobs','malformed-original-jobs','malformed-executed-steps']){
  const f=fixture();
  if(change==='missing-original')f.receipts.original=null;if(change==='missing-patched')f.receipts.patched=null;
  if(change==='missing-steps')delete f.receipts.patched.steps;if(change==='malformed-jobs')f.receipts.patched.jobs={};
  if(change==='malformed-original-jobs')f.receipts.original.jobs={};if(change==='malformed-executed-steps')f.receipts.patched.jobs[0].payload.steps={length:2};
  const result=rules.evaluate(f.manifest,f.receipts,1,2);assert.notEqual(result.status,'verified',change);assert.ok(result.checks.some(check=>check.status==='unknown'),change);
 }
});

test('complete section rewrites preserve action order, assertions and parameter data',()=>{
 const current={...base,steps:[{id:'action',step_order:1,automation_code:'await web.fill("#old", params["t.user"]);\nawait web.click("#submit");\nawait web.expectText("#state", "Saved");'},base.steps[1]]};
 const code='await web.fill("#new", params["t.user"]);\nawait web.click("#submit-new");\nawait web.expectText("#state", "Saved");';
 const proposal={kind:'replace_instructions',step_id:'action',automation_code:code,rationale:'Live Playwright MCP observations show updated controls and navigation.'};
 assert.equal(rules.patch(current,proposal).after,code);
 for(const changed of [code.replace('params["t.user"]','"hardcoded"'),code.replace('"Saved"','"Failed"'),code.replace('await web.click("#submit-new");',''),code+'\nawait fetch("https://outside.test");',code.replace('"#new"','process.env.SECRET'),code.replace('await web.expectText','await web.waitForUrl("/saved");\nawait web.expectText'), 'await web.expectText("#state", "Saved");\nawait web.fill("#new", params["t.user"]);\nawait web.click("#submit-new");'])assert.throws(()=>rules.patch(current,{...proposal,automation_code:changed}));
 assert.throws(()=>rules.patch({...current,steps:[{...current.steps[0],reusable_group_id:'shared'}]},proposal),/shared/i);
});

test('native engineer sections can repair one observed field without dropping its data or validation predicates',()=>{
 const {compileRecordedProgram}=require('../../../automation/backend/lib/automationRecordedProgram');
 const rows=locator=>[{name:'browser_fill',arguments:{locator,value:'@r.password'}},{name:'browser_assert',arguments:{assertion:'value',locator,value:'@r.password'}},{name:'browser_assert',arguments:{assertion:'field_valid',locator}}];
 const step={id:'action',step_order:1,step_type:'web',expected_result:'Password is entered without errors',automation_code:compileRecordedProgram(rows('#old')).source};
 const current={...base,steps:[step]};
 const patch=rules.patch(current,{...candidate,new_locator:'#password-input'});
 assert.equal(patch.program_contract,'engineer-native/1');assert.equal(patch.operation_count,3);assert.equal(patch.assertion_count,2);
 assert.equal(patch.after,compileRecordedProgram(rows('#password-input')).source);
 assert.equal(rules.validateStoredPatch(current,patch),true);
 assert.equal(rules.hasProtectedAssertion(step),true);
 assert.equal(rules.hasProtectedAssertion({...step,automation_code:compileRecordedProgram([rows('#old')[2]]).source}),true,'poll-only validation is a discoverable protected oracle');
 assert.equal(rules.hasProtectedAssertion({...step,automation_code:'await expect.poll(() => arbitrary()).toBe(true);'}),false);
 const changed=rows('#new');changed[1].arguments.value='@t.password';
 assert.throws(()=>rules.patch(current,{kind:'replace_instructions',step_id:'action',automation_code:compileRecordedProgram(changed).source,rationale:candidate.rationale}),/parameter scope|input binding/i);
});

test('repair verification proves every successor rather than stopping at the repaired action or first oracle',()=>{
 const f=fixture();
 for(const phase of Object.keys(f.manifest))for(const id of f.manifest[phase].case_ids){
  const step={test_case_id:id,step_order:3,snapshot_step_id:`${id}-3`,automation_code:'final state assertion'};
  f.receipts[phase].steps.push(step);
  const job=f.receipts[phase].jobs.find(item=>item.test_case_id===id);
  job.payload.steps.push({id:step.snapshot_step_id,automation_code:step.automation_code});
  job.runtime_state.logs.stepStatuses[step.snapshot_step_id]='passed';
 }
 const passed=rules.evaluate(f.manifest,f.receipts,1,2);
 assert.equal(passed.status,'verified');assert.deepEqual(passed.checks[1].coverage,{focused_step_order:1,verified_case_sections:3,verified_successor_sections:2});
 f.receipts.patched.jobs[0].runtime_state.logs.stepStatuses['case-3']='failed';
 const failed=rules.evaluate(f.manifest,f.receipts,1,2);assert.equal(failed.status,'failed');assert.equal(failed.checks[1].coverage,undefined);
});

test('a mixed-section negative fixture needs trusted evidence that its assertion was reached after its action',()=>{
 const code='await web.fill("#input", "@r.value");\nawait web.expectText("#status", "Saved");';
 for(const failure of ['assertion','action','missing','recovery','same-line']){
  const f=fixture(),step=f.receipts.negative.steps.find(item=>item.step_order===2),job=f.receipts.negative.jobs[0];
  step.automation_code=failure==='same-line'?code.replace('\n',' '):code;
  job.payload.steps.find(item=>item.id===step.snapshot_step_id).automation_code=step.automation_code;
  const trace=failure==='action'?[{line:1,status:'failed',attempt:1}]:[{line:1,status:'passed',attempt:1},{line:2,status:'failed',attempt:failure==='recovery'?2:1}];
  if(failure!=='missing')job.runtime_state.logs.stepAutomationDetails={[step.snapshot_step_id]:{line_results:trace}};
  assert.equal(rules.evaluate(f.manifest,f.receipts,1,2).status==='verified',failure==='assertion',failure);
 }
});

test('continued, skipped or missing Before / After hook receipts never establish a verified repair',()=>{
 for(const scenario of ['passed','continued-failure','skipped','missing-post','unexecuted-successor']){
  const f=fixture();
  for(const receipt of Object.values(f.receipts))for(const job of receipt.jobs){
   job.payload.hooks=[{id:'global-setup',scope:'test',phase:'pre',fail_behavior:'continue',steps:[{id:'before-1'},{id:'before-2'}]},
    {id:'case:case:cleanup',scope:'test',phase:'post',steps:[{id:'after'}]}];
   Object.assign(job.runtime_state.logs.stepStatuses,{'test:pre:global-setup:before-1':'passed','test:pre:global-setup:before-2':'passed','test:post:case:case:cleanup:after':'passed'});
  }
  const statuses=f.receipts.patched.jobs[0].runtime_state.logs.stepStatuses;
  if(scenario==='continued-failure')statuses['test:pre:global-setup:before-1']='failed';
  if(scenario==='skipped')statuses['test:post:case:case:cleanup:after']='skipped';
  if(scenario==='missing-post')delete statuses['test:post:case:case:cleanup:after'];
  if(scenario==='unexecuted-successor')delete statuses['test:pre:global-setup:before-2'];
  assert.equal(rules.evaluate(f.manifest,f.receipts,1,2).status==='verified',scenario==='passed',scenario);
 }
});
