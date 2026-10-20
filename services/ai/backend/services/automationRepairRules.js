const {createHash}=require('node:crypto');
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'&&!(value instanceof Date)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const hash=value=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode,code:'AI_INVALID_RESPONSE'});
const literal='"(?:[^"\\\\]|\\\\.)*"';
const supported=new RegExp(`^\\s*await\\s+web\\.(click|fill|hover|check|uncheck)\\(\\s*(${literal})(?:\\s*,\\s*(${literal}))?\\s*\\);?\\s*$`);
const specification=steps=>steps.map(row=>[row.step_order,row.action||'',row.expected_result||'',row.step_type||'',row.automation_code||'',row.api_request||null]);
const sharedBindings=steps=>steps.map(row=>[row.step_order,row.shared_parameter_values||{},row.shared_parameter_template_values||{},row.shared_parameter_sensitive_names||[]]);
const {parse}=require('acorn');
const actions=new Set(['click','dblclick','rightClick','hover','fill','check','uncheck','press','selectOption','waitForUrl','expectVisible','expectHidden','expectEnabled','expectText']);
function instructionStatements(code) {
  if(typeof code!=='string'||!code.trim()||code.length>30000)throw fail('Provide a bounded nonempty section program.');
  let ast;try{ast=parse(code,{ecmaVersion:'latest',allowAwaitOutsideFunction:true});}catch{throw fail('Section instructions must be valid JavaScript.');}
  const argument=node=>node?.type==='Literal' && typeof node.value==='string' || node?.type==='MemberExpression' && node.object?.name==='params' && node.computed && node.property?.type==='Literal' && typeof node.property.value==='string';
  return ast.body.map(statement=>{
    const call=statement.type==='ExpressionStatement'&&statement.expression?.type==='AwaitExpression'&&statement.expression.argument;
    const method=call?.type==='CallExpression'&&call.callee?.type==='MemberExpression'&&!call.callee.computed&&call.callee.object?.name==='web'&&call.callee.property?.name;
    if(!method||!actions.has(method)||!call.arguments.length||call.arguments.some(node=>!argument(node)))throw fail('Instruction repair accepts awaited supported web helpers with literal strings or params references. Keep scripts, branching, captures, timeouts and external calls outside a typed repair.');
    const count=['fill','press','selectOption','expectText'].includes(method)?2:1;
    if(call.arguments.length!==count)throw fail('Preserve supported web helper argument counts.');
    return {method,text:code.slice(statement.start,statement.end),line:code.slice(0,statement.start).split('\n').length,arguments:call.arguments.map(node=>code.slice(node.start,node.end)),operands:call.arguments.map(node=>node.type==='Literal'?{kind:'literal',value:node.value}:{kind:'parameter',value:node.property.value})};
  });
}
function protectedAssertionContract(step) {
  if(!step?.expected_result?.trim())return false;
  try {
    if(/\b(?:page|playwrightPage)\s*\.|\bexpect\s*[.(]/.test(step.automation_code||'')) {
      return require('@hellotest/automation/backend/lib/automationRepairProgramContract').nativeRepairProgramSummary(step);
    }
    const statements=instructionStatements(step.automation_code);
    return {operation_count:statements.length,assertion_count:statements.filter(statement=>statement.method.startsWith('expect')).length,
      operation_lines:statements.map(statement=>({line:statement.line,assertion:statement.method.startsWith('expect')}))};
  } catch { return null; }
}
const hasProtectedAssertion=step=>protectedAssertionContract(step)?.assertion_count>0;
function negativeOracleReached(step,logs) {
  const contract=protectedAssertionContract(step);
  if(!contract?.assertion_count)return false;
  const lines=contract.operation_lines;
  if(!Array.isArray(lines)||new Set(lines.map(row=>row.line)).size!==lines.length)return false;
  const trace=logs?.stepAutomationDetails?.[step.snapshot_step_id]?.line_results;
  if(!Array.isArray(trace)||!trace.length||trace.length>1000||trace.some(row=>!row||!Number.isSafeInteger(row.line)||row.line<1||row.attempt!==1||!['passed','failed'].includes(row.status)))return false;
  const failedIndex=trace.findIndex(row=>row.status==='failed');
  if(failedIndex<0||failedIndex!==trace.length-1||failedIndex>=lines.length||!lines[failedIndex].assertion)return false;
  const detail=logs?.stepAutomationDetails?.[step.snapshot_step_id];
  const unavailable=/BROWSER_READ_UNAVAILABLE|BROWSER_CONTEXT_LOST|Execution context was destroyed|Cannot find context|target (?:page|browser|context).*closed|(?:page|browser|context) has been closed|browser (?:has been )?disconnected/i;
  if([detail?.error_code,detail?.error_message,trace[failedIndex].error].some(value=>typeof value==='string'&&unavailable.test(value)))return false;
  return trace.every((row,index)=>row.line===lines[index].line&&row.status===(index===failedIndex?'failed':'passed'));
}
function completedHookEvidence(payload,statuses) {
  if(payload?.hooks===undefined)return true;
  if(!Array.isArray(payload.hooks)||payload.hooks.length>100)return false;
  const seen=new Set();
  for(const hook of payload.hooks){
    if(!hook||hook.scope!=='test'||!['pre','post'].includes(hook.phase)||typeof hook.id!=='string'||!hook.id
      ||!Array.isArray(hook.steps)||!hook.steps.length||hook.steps.length>200)return false;
    for(const step of hook.steps){
      if(!step||typeof step.id!=='string'||!step.id)return false;
      const id=`${hook.scope}:${hook.phase}:${hook.id}:${step.id}`;
      if(seen.has(id)||statuses[id]!=='passed')return false;
      seen.add(id);
    }
  }
  return true;
}
function instructionPatch(base,input) {
  if(Object.keys(input).some(key=>!['kind','step_id','automation_code','rationale'].includes(key)))throw fail('Unsupported instruction repair fields.');
  const step=base.steps.find(row=>row.id===input.step_id);
  if(!step||step.reusable_group_id||['shared','reusable'].includes(step.group_kind)||!base.failed_step_ids.includes(step.id))throw fail('Target a failed case-owned section; shared definitions require a separate reviewed group change.');
  if(typeof input.rationale!=='string'||input.rationale.trim().length<20||input.rationale.length>2000)throw fail('Explain the instruction changes and their observed evidence.');
  if(/\b(?:page|playwrightPage)\s*\.|\bexpect\s*[.(]/.test(step.automation_code||'')) {
    let native;
    try{native=require('@hellotest/automation/backend/lib/automationRepairProgramContract').nativeProgramPatch({step,automationCode:input.automation_code});}
    catch(error){throw fail(error.message);}
    return {kind:'replace_instructions',step_id:step.id,step_order:step.step_order,before:step.automation_code,after:native.automation_code,rationale:input.rationale.trim(),hash:hash([base.source_hash,step.id,native.automation_code]),assertions_preserved:true,program_contract:'engineer-native/1',operation_count:native.operation_count,assertion_count:native.assertion_count};
  }
  const before=instructionStatements(step.automation_code),after=instructionStatements(input.automation_code);
  if(!after.length||after.length>80||step.automation_code.trim()===input.automation_code.trim())throw fail('Provide changed, complete section instructions.');
  if(JSON.stringify(before.map(row=>row.method))!==JSON.stringify(after.map(row=>row.method)))throw fail('Preserve every action, assertion checkpoint and wait in order. A focused repair cannot add synchronization or other instructions.');
  const waits=rows=>rows.filter(row=>row.method==='waitForUrl').map(row=>row.text);
  if(JSON.stringify(waits(before))!==JSON.stringify(waits(after)))throw fail('Preserve existing synchronization targets and timing policy.');
  const data=rows=>rows.filter(row=>['fill','press','selectOption','expectText'].includes(row.method)).map(row=>[row.method,...row.operands.slice(1)]);
  if(JSON.stringify(data(before))!==JSON.stringify(data(after)))throw fail('Preserve entered values, key presses and parameter references; change test data explicitly outside repair.');
  const forward=new Map(),reverse=new Map();let changes=0;
  for(let index=0;index<before.length;index++){
    if(before[index].method==='waitForUrl')continue;
    const original=before[index].operands[0],candidate=after[index].operands[0];
    const oldKey=JSON.stringify(original),newKey=JSON.stringify(candidate);
    if(oldKey!==newKey){
      if(original.kind!=='literal'||candidate.kind!=='literal'||!candidate.value.trim()||candidate.value.length>1024||/[\x00-\x1f]|\{\{|\$\{|@[trs]\./.test(candidate.value))throw fail('Repair observed literal locators only. Preserve dynamic locator parameter bindings.');
      changes++;
    }
    if(forward.has(oldKey)&&forward.get(oldKey)!==newKey||reverse.has(newKey)&&reverse.get(newKey)!==oldKey)throw fail('Rebind each saved subject consistently across its actions and assertions; distinct subjects must remain distinct.');
    forward.set(oldKey,newKey);reverse.set(newKey,oldKey);
  }
  if(!changes)throw fail('A locator repair must correct an observed subject; formatting-only changes are unnecessary.');
  return {kind:'replace_instructions',step_id:step.id,step_order:step.step_order,before:step.automation_code,after:input.automation_code,rationale:input.rationale.trim(),hash:hash([base.source_hash,step.id,input.automation_code]),assertions_preserved:true};
}
function patch(base,input) {
  if(input==null)return null;
  if(input?.kind==='replace_instructions')return instructionPatch(base,input);
  if(typeof input!=='object'||Object.keys(input).some(key=>!['kind','step_id','new_locator','rationale'].includes(key))||input.kind!=='replace_locator')throw fail('Return only a typed replace_locator proposal or null.');
  const step=base.steps.find(row=>row.id===input.step_id),match=step?.automation_code?.match(supported);
  if(!step||step.reusable_group_id||['shared','reusable'].includes(step.group_kind)||!base.failed_step_ids.includes(step.id))throw fail('The repair must target a failed case-owned section.');
  const target=input.new_locator;
  if(typeof target!=='string'||!target.trim()||target.length>1024||/[\x00-\x1f]|\{\{|\$\{|@[trs]\./.test(target)||match&&target===JSON.parse(match[2]))throw fail('Provide a different literal locator without dynamic interpolation.');
  if(typeof input.rationale!=='string'||input.rationale.trim().length<20||input.rationale.length>2000)throw fail('Explain the proposed locator and supporting evidence.');
  if(!match) {
    if(!/\b(?:page|playwrightPage)\s*\.|\bexpect\s*[.(]/.test(step.automation_code||''))throw fail('The repair must target a supported saved locator action.');
    let native;
    try{native=require('@hellotest/automation/backend/lib/automationRepairProgramContract').nativeLocatorPatch({step,newLocator:target});}
    catch(error){throw fail(error.message);}
    return {kind:'replace_locator',step_id:step.id,step_order:step.step_order,before:step.automation_code,after:native.automation_code,rationale:input.rationale.trim(),hash:hash([base.source_hash,step.id,native.automation_code]),assertions_preserved:true,program_contract:'engineer-native/1',operation_count:native.operation_count,assertion_count:native.assertion_count};
  }
  if((match[1]==='fill')!==Boolean(match[3]))throw fail('Unsupported locator argument contract.');
  const after=`await web.${match[1]}(${JSON.stringify(target)}${match[3]?`, ${match[3]}`:''});`;
  return {kind:'replace_locator',step_id:step.id,step_order:step.step_order,before:step.automation_code,after,rationale:input.rationale.trim(),hash:hash([base.source_hash,step.id,after]),assertions_preserved:true};
}
function validateStoredPatch(base,saved) {
  if(!saved||typeof saved!=='object')throw fail('A typed repair proposal is required.');
  const step=base.steps.find(item=>item.id===saved.step_id);
  let checked;
  if(saved.kind==='replace_instructions'||saved.kind==='replace_locator'&&/\b(?:page|playwrightPage)\s*\.|\bexpect\s*[.(]/.test(step?.automation_code||'')) {
    checked=instructionPatch(base,{kind:'replace_instructions',step_id:saved.step_id,automation_code:saved.after,rationale:saved.rationale});
  } else if(saved.kind==='replace_locator') {
    const match=saved.after?.match(supported);
    if(!match)throw fail('The saved locator repair no longer matches its typed contract.');
    checked=patch(base,{kind:'replace_locator',step_id:saved.step_id,new_locator:JSON.parse(match[2]),rationale:saved.rationale});
  } else throw fail('The saved repair kind is unsupported.');
  if(saved.before!==checked.before||saved.after!==checked.after||saved.step_order!==checked.step_order||saved.hash!==checked.hash||saved.assertions_preserved!==true)throw fail('The saved repair differs from its pinned action, data or assertion contract.');
  return true;
}
function evaluate(manifest,receipts,patchStep,oracleStep) {
  const checks=[];
  const originalJob=Array.isArray(receipts.original?.jobs)?receipts.original.jobs.find(job=>job.test_case_id===manifest.original?.case_ids[0]):null;
  const originalSteps=Array.isArray(receipts.original?.steps)?receipts.original.steps.filter(step=>step.test_case_id===manifest.original?.case_ids[0]):null;
  const contextHash=job=>hash(['environment','configuration','browser','timeouts','run_timeout_seconds','execution_policy','web_engine','hooks','object_repository','run_parameters','case_parameters','suite_parameters','data_policy','parameter_scope_default','parameters_frozen'].map(key=>job?.payload?.[key]));
  for(const phase of ['original','patched','negative']) {
    const receipt=receipts[phase],entry=manifest[phase];
    if(!entry||!receipt||receipt.hash!==entry.hash){checks.push({phase,status:'unknown',detail:'Pinned validation snapshots are missing or changed.'});continue;}
    const caseIds=entry.case_ids,jobs=receipt.jobs||[];
    if(!Array.isArray(jobs)||!Array.isArray(receipt.steps)){checks.push({phase,status:'unknown',detail:'Trusted runner receipts or pinned step evidence are unavailable.'});continue;}
    if(jobs.length!==caseIds.length||new Set(jobs.map(job=>job.test_case_id)).size!==caseIds.length){checks.push({phase,status:'unknown',detail:'Exactly one trusted runner receipt per selected Test Case is required.'});continue;}
    let status='passed',detail='Pinned runner evidence satisfies this check.';
    for(const caseId of caseIds) {
      const job=jobs.find(item=>item.test_case_id===caseId),steps=receipt.steps.filter(step=>step.test_case_id===caseId);
      if(!job||!job.completed_at||!['completed','failed'].includes(job.status)){status='pending';detail='Waiting for the Test Engine to finish.';break;}
      if(job.runtime_state?.healing_attempted||job.payload?.max_repair_attempts!==0||job.payload?.session_policy?.web?.mode!=='new'||job.payload?.session_policy?.web?.connect_over_cdp_endpoint){status='unknown';detail='Validation must use a fresh browser session with healing disabled.';break;}
      if(phase!=='original'&&caseId===manifest.original.case_ids[0]&&contextHash(job)!==contextHash(originalJob)){status='unknown';detail='Execution settings or repository evidence changed between validation phases.';break;}
      if(phase!=='original'&&caseId===manifest.original.case_ids[0]&&(!originalSteps||hash(sharedBindings(steps))!==hash(sharedBindings(originalSteps)))){status='unknown';detail='Frozen per-section shared values, templates or private bindings changed between validation phases.';break;}
      const executed=job.payload?.steps||[],logs=job.runtime_state?.logs;
      const parsed=typeof logs==='string'?(()=>{try{return JSON.parse(logs);}catch{return {};}})():logs;
      if(!Array.isArray(executed)||!steps.length||executed.length!==steps.length||steps.some((step,index)=>{
        const item=executed[index];
        return !item||item.id!==step.snapshot_step_id||item.automation_code!==step.automation_code
          ||item.order!==undefined&&item.order!==step.step_order
          ||hash(item.shared_parameter_values||{})!==hash(step.shared_parameter_values||{})
          ||Object.keys(item.source_case_context||{}).length||Object.keys(item.source_case_parameters||{}).length;
      })){status='unknown';detail='Runner payload does not match the exact pinned step order, source or shared parameter bindings.';break;}
      const statuses=parsed?.stepStatuses||{};
      if(!completedHookEvidence(job.payload,statuses)){status='unknown';detail='Every pinned Before / After hook step must have a passed runner receipt. Failed, skipped, missing or unexecuted setup and cleanup cannot verify a repair, including hooks configured to continue.';break;}
      const expectedFailure=phase==='original'?patchStep:phase==='negative'?oracleStep:null;
      if(expectedFailure!=null) {
        const target=steps.find(step=>step.step_order===expectedFailure);
        if(!target||job.status!=='failed'||statuses[target.snapshot_step_id]!=='failed'||steps.filter(step=>step.step_order<expectedFailure).some(step=>statuses[step.snapshot_step_id]!=='passed')){status='failed';detail=phase==='original'?'The original failure was not reproduced at the patched step.':'The known-negative fixture did not fail at the protected assertion.';break;}
        if(phase==='negative'&&!negativeOracleReached(target,parsed)){status='unknown';detail='The failed section does not prove that its protected assertion was reached. Trusted assertion-line evidence is required after every preceding action; action or setup failures cannot verify a negative fixture.';break;}
      } else if(job.status!=='completed'||steps.some(step=>statuses[step.snapshot_step_id]!=='passed')){status='failed';detail='The repaired Test Case or a neighboring Test Case did not pass every step.';break;}
    }
    const repairedSteps=receipt.steps.filter(step=>step.test_case_id===manifest.original?.case_ids[0]);
    const coverage=phase==='patched'&&status==='passed'?{focused_step_order:patchStep,verified_case_sections:repairedSteps.length,verified_successor_sections:repairedSteps.filter(step=>step.step_order>patchStep).length}:undefined;
    if(coverage)detail=`The repaired section and every saved section passed, including ${coverage.verified_successor_sections} following sections${caseIds.length>1?' and the selected neighboring Test Cases':''}.`;
    checks.push({phase,status,detail,receipt_hash:hash(jobs),job_ids:jobs.map(job=>job.id),...(coverage?{coverage}:{})});
  }
  return {status:checks.every(item=>item.status==='passed')?'verified':checks.some(item=>item.status==='failed')?'failed':'unverified',checks,verifier_version:'automation-repair/1'};
}
module.exports={hash,patch,specification,sharedBindings,evaluate,fail,hasProtectedAssertion,validateStoredPatch};
