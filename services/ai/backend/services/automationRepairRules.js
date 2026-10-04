const {createHash}=require('node:crypto');
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'&&!(value instanceof Date)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const hash=value=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode,code:'AI_INVALID_RESPONSE'});
const literal='"(?:[^"\\\\]|\\\\.)*"';
const supported=new RegExp(`^\\s*await\\s+web\\.(click|fill|hover|check|uncheck)\\(\\s*(${literal})(?:\\s*,\\s*(${literal}))?\\s*\\);?\\s*$`);
const specification=steps=>steps.map(row=>[row.step_order,row.action||'',row.expected_result||'',row.step_type||'',row.automation_code||'',row.api_request||null]);
function patch(base,input) {
  if(input==null)return null;
  if(typeof input!=='object'||Object.keys(input).some(key=>!['kind','step_id','new_locator','rationale'].includes(key))||input.kind!=='replace_locator')throw fail('Return only a typed replace_locator proposal or null.');
  const step=base.steps.find(row=>row.id===input.step_id),match=step?.automation_code?.match(supported);
  if(!step||!match||step.reusable_group_id||['shared','reusable'].includes(step.group_kind)||!base.failed_step_ids.includes(step.id))throw fail('The repair must target a failed standalone supported locator action.');
  if((match[1]==='fill')!==Boolean(match[3]))throw fail('Unsupported locator argument contract.');
  const target=input.new_locator;
  if(typeof target!=='string'||!target.trim()||target.length>1024||/[\x00-\x1f]|\{\{|\$\{|@[trs]\./.test(target)||target===JSON.parse(match[2]))throw fail('Provide a different literal locator without dynamic interpolation.');
  if(typeof input.rationale!=='string'||input.rationale.trim().length<20||input.rationale.length>2000)throw fail('Explain the proposed locator and supporting evidence.');
  const after=`await web.${match[1]}(${JSON.stringify(target)}${match[3]?`, ${match[3]}`:''});`;
  return {kind:'replace_locator',step_id:step.id,step_order:step.step_order,before:step.automation_code,after,rationale:input.rationale.trim(),hash:hash([base.source_hash,step.id,after]),assertions_preserved:true};
}
function evaluate(manifest,receipts,patchStep,oracleStep) {
  const checks=[];
  const originalJob=receipts.original?.jobs?.find(job=>job.test_case_id===manifest.original?.case_ids[0]);
  const contextHash=job=>hash(['environment','configuration','browser','timeouts','run_timeout_seconds','execution_policy','web_engine','hooks','object_repository','run_parameters','case_parameters','suite_parameters'].map(key=>job?.payload?.[key]));
  for(const phase of ['original','patched','negative']) {
    const receipt=receipts[phase],entry=manifest[phase];
    if(!entry||!receipt||receipt.hash!==entry.hash){checks.push({phase,status:'unknown',detail:'Pinned validation snapshots are missing or changed.'});continue;}
    const caseIds=entry.case_ids,jobs=receipt.jobs||[];
    if(jobs.length!==caseIds.length||new Set(jobs.map(job=>job.test_case_id)).size!==caseIds.length){checks.push({phase,status:'unknown',detail:'Exactly one trusted runner receipt per selected Test Case is required.'});continue;}
    let status='passed',detail='Pinned runner evidence satisfies this check.';
    for(const caseId of caseIds) {
      const job=jobs.find(item=>item.test_case_id===caseId),steps=receipt.steps.filter(step=>step.test_case_id===caseId);
      if(!job||!job.completed_at||!['completed','failed'].includes(job.status)){status='pending';detail='Waiting for the Test Engine to finish.';break;}
      if(job.runtime_state?.healing_attempted||job.payload?.max_repair_attempts!==0||job.payload?.session_policy?.web?.mode!=='new'||job.payload?.session_policy?.web?.connect_over_cdp_endpoint){status='unknown';detail='Validation must use a fresh browser session with healing disabled.';break;}
      if(phase!=='original'&&caseId===manifest.original.case_ids[0]&&contextHash(job)!==contextHash(originalJob)){status='unknown';detail='Execution settings or repository evidence changed between validation phases.';break;}
      const executed=job.payload?.steps||[],logs=job.runtime_state?.logs;
      const parsed=typeof logs==='string'?(()=>{try{return JSON.parse(logs);}catch{return {};}})():logs;
      if(executed.length!==steps.length||steps.some(step=>!executed.some(item=>item.id===step.snapshot_step_id&&item.automation_code===step.automation_code))){status='unknown';detail='Runner payload does not match the pinned step specification.';break;}
      const statuses=parsed?.stepStatuses||{};
      const expectedFailure=phase==='original'?patchStep:phase==='negative'?oracleStep:null;
      if(expectedFailure!=null) {
        const target=steps.find(step=>step.step_order===expectedFailure);
        if(!target||job.status!=='failed'||statuses[target.snapshot_step_id]!=='failed'||steps.filter(step=>step.step_order<expectedFailure).some(step=>statuses[step.snapshot_step_id]!=='passed')){status='failed';detail=phase==='original'?'The original failure was not reproduced at the patched step.':'The known-negative fixture did not fail at the protected assertion.';break;}
      } else if(job.status!=='completed'||steps.some(step=>statuses[step.snapshot_step_id]!=='passed')){status='failed';detail='The repaired Test Case or a neighboring Test Case did not pass every step.';break;}
    }
    checks.push({phase,status,detail,receipt_hash:hash(jobs),job_ids:jobs.map(job=>job.id)});
  }
  return {status:checks.every(item=>item.status==='passed')?'verified':checks.some(item=>item.status==='failed')?'failed':'unverified',checks,verifier_version:'automation-repair/1'};
}
module.exports={hash,patch,specification,evaluate,fail};
