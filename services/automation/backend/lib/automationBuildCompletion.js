const MAX_COMPLETION_ATTEMPTS = 3;
const {normalizeParameterKey}=require('@hellotest/platform/backend/src/utils/stepParameterResolution');
const {sanitizeAiText}=require('@hellotest/platform/backend/src/security/aiTextPolicy');
const specification=value=>String(value||'').replace(/\s+/g,' ').trim();
function matchManualCoverage(steps,manualSteps) {
  const coverage=new Map(),used=new Map();
  for(const manual of manualSteps){const key=manual.test_case_id||'';if(!used.has(key))used.set(key,new Set());const section=steps.find(step=>!used.get(key).has(step.id)&&specification(step.action)===specification(manual.action)&&specification(step.expected_result)===specification(manual.expected_result)&&(step.step_type||'web')===(manual.step_type||'web'));if(section){coverage.set(manual.id,section.id);used.get(key).add(section.id);}}
  return coverage;
}
/** Validate and finalize each mapping before an optional save commits it to Plan. */
async function completeAutomationBuild({steps,manualSteps=[],displaySteps=steps,displayManualSteps=manualSteps,sequential=false,progressionPolicy='generated_saved',availableParameters=[],generate,parse=value=>value,validate,validateOutcome,feedbackInstruction,onProgress=async()=>{},onBeforeSaveSection=async()=>{},onSaveSection,onValidatedSection=async()=>({}),maxAttempts=MAX_COMPLETION_ATTEMPTS}) {
  const limit=Math.max(1,Math.min(MAX_COMPLETION_ATTEMPTS,Number(maxAttempts)||MAX_COMPLETION_ATTEMPTS));
  const byId=new Map(steps.map(step=>[step.id,step]));
  const byOrder=new Map(steps.map(step=>[Number(step.step_order),step]));
  const manualById=new Map(manualSteps.map(step=>[step.id,step]));
  // Resolved display data never changes the authoritative saved specification
  // used by the validator, exact coverage matcher or concurrent-edit guard.
  const displayedSections=new Map(displaySteps.map(step=>[step.id,step]));
  const displayedManual=new Map(displayManualSteps.map(step=>[step.id,step]));
  const sectionText=step=>({...step,action:displayedSections.get(step.id)?.action??step.action,expected_result:displayedSections.get(step.id)?.expected_result??step.expected_result});
  const manualText=step=>({...step,action:displayedManual.get(step.id)?.action??step.action,expected_result:displayedManual.get(step.id)?.expected_result??step.expected_result});
  const availableParameterNames=[...new Set(availableParameters.map(key=>normalizeParameterKey(key,'t')).filter(Boolean))].sort();
  const suppliedParameters=new Set(availableParameterNames);
  const coverage=matchManualCoverage(steps,manualSteps);
  const accepted=new Map(),learned=[];
  const saved=new Set();
  const sectionOrder=[...steps].sort((left,right)=>(Number(left.step_order)||0)-(Number(right.step_order)||0));
  const manualCaseOrder=[...new Set(manualSteps.map(step=>step.test_case_id||''))];
  const manualOrder=[...manualSteps].sort((left,right)=>manualCaseOrder.indexOf(left.test_case_id||'')-manualCaseOrder.indexOf(right.test_case_id||'')||(Number(left.step_order)||0)-(Number(right.step_order)||0));
  if(sequential){
    const positions=new Map(sectionOrder.map((step,index)=>[step.id,index])),previousByCase=new Map();
    for(const manual of manualOrder){
      if(!coverage.has(manual.id))continue;
      const key=manual.test_case_id||'',position=positions.get(coverage.get(manual.id)),previous=previousByCase.get(key);
      if(previous&&position<previous.position)throw Object.assign(new Error('The linked manual steps and saved Plan specify conflicting action orders. Align their section order before building so browser development and execution follow the same flow.'),{code:'AUTOMATION_MANUAL_ORDER_CONFLICT',statusCode:409,nonRetryable:true,manual_step_ids:[previous.manualId,manual.id],section_step_ids:[coverage.get(previous.manualId),coverage.get(manual.id)]});
      previousByCase.set(key,{position,manualId:manual.id});
    }
  }
  let activeWork;
  const completedManual=id=>coverage.has(id)&&accepted.has(coverage.get(id));
  const workComplete=()=>activeWork&&(!activeWork.stepId||accepted.has(activeWork.stepId))&&activeWork.manualIds.every(completedManual);
  const nextWork=()=>{
    const manual=manualOrder.find(step=>!completedManual(step.id));
    // Development must follow the same order as the saved executable Plan.
    // A linked manual case's order cannot move a later action ahead of setup
    // or another mapped section in that Plan.
    const section=sectionOrder.find(step=>!accepted.has(step.id));
    const manualIds=manualOrder.filter(step=>section&&coverage.get(step.id)===section.id).map(step=>step.id);
    if(manual&&!coverage.has(manual.id)&&!manualIds.includes(manual.id))manualIds.push(manual.id);
    return {stepId:section?.id||null,manualIds};
  };
  const workAttempts=new Map();
  // Correcting final response metadata must not consume the last section's
  // retry allowance, or cause that section's browser actions to be replayed.
  const requestLimit=(sequential?limit*Math.max(1,steps.length+manualSteps.length):limit)+limit;
  const coverageRows=()=>[...coverage].map(([manual_step_id,section_step_id])=>({manual_step_id,manual_test_case_id:manualById.get(manual_step_id)?.test_case_id,section_step_id}));
  await onProgress({phase:'automation.agent.plan',message:`Queued ${steps.length} saved sections and ${manualSteps.length} linked manual steps for instruction coverage.`,details:{generation_mode:sequential?'sequential':'case',progression_policy:progressionPolicy,steps:steps.map(step=>({step_id:step.id,step_order:step.step_order,step_type:step.step_type,action:step.action,expected_result:step.expected_result})),manual_steps:manualSteps.map(step=>({manual_step_id:step.id,manual_test_case_id:step.test_case_id,step_order:step.step_order,action:step.action,expected_result:step.expected_result})),manual_coverage:coverageRows(),verification_status:'unverified'}});
  let summary, outcomeFields={},outcomeHasCoverage=false,outcomeHasLearning=false;
  const consume = async (payload, attempt, partial = false) => {
    const failures = [];
    const candidates=Array.isArray(payload?.steps)?payload.steps:[];
    if(!partial&&!candidates.length&&(sequential?activeWork.stepId&&!accepted.has(activeWork.stepId):steps.some(step=>!accepted.has(step.id)))&&!failures.length)failures.push({message:'The model returned no section mappings.'});
    const blockers=[];
    if(payload?.blocked_steps!==undefined&&!Array.isArray(payload.blocked_steps))failures.push({message:'blocked_steps must be an array describing unavailable dependencies for existing section IDs.'});
    for(const item of Array.isArray(payload?.blocked_steps)?payload.blocked_steps:[]){
      const list=value=>Array.isArray(value)&&value.length<=20&&value.every(item=>typeof item==='string'&&item.trim()&&item.length<=300)?value.map(item=>item.trim()):null;
      const requiredContext=list(item?.required_context||[]),requiredParameters=list(item?.required_parameters||[]);
      if(!item||!byId.has(item.step_id)||!['mailbox','external_context','parameter'].includes(item.dependency_type)||typeof item.reason!=='string'||!item.reason.trim()||item.reason.length>1000||!requiredContext||!requiredParameters||requiredParameters.some(key=>!/^@?[a-z][a-z0-9_.-]{0,149}$/i.test(key))||!requiredContext.length&&!requiredParameters.length){failures.push({message:'An invalid dependency report was rejected. Identify an existing step, its missing source/parameter and the reason.'});continue;}
      if(sequential&&item.step_id!==activeWork.stepId){failures.push({step_id:item.step_id,message:'Only the current section can report a new dependency during sequential generation.'});continue;}
      const missingParameters=requiredParameters.filter(key=>!suppliedParameters.has(normalizeParameterKey(key,'t')));
      if(item.dependency_type==='parameter'&&!requiredContext.length&&requiredParameters.length&&!missingParameters.length){
        // A model report cannot turn an existing authorized runtime value into
        // missing context. Correct the report within the normal bounded budget;
        // new executable candidates still pass the ordinary section validator.
        failures.push({step_id:item.step_id,code:'AUTOMATION_PARAMETER_ALREADY_SUPPLIED',available_parameters:requiredParameters.map(key=>normalizeParameterKey(key,'t')),message:'The requested parameter references already have configured runtime values.'});
        continue;
      }
      if(accepted.has(item.step_id)){
        failures.push({step_id:item.step_id,code:'AUTOMATION_SECTION_ALREADY_COMPLETED',message:'This section already has validated instructions. A later dependency report cannot revoke or replace its saved result; report dependencies for unfinished sections only.'});
        continue;
      }
      blockers.push({step_id:item.step_id,step_order:byId.get(item.step_id).step_order,dependency_type:item.dependency_type,reason:item.reason.trim(),required_context:requiredContext,required_parameters:missingParameters});
    }
    const seen=new Set(),prepared=[];
    for(const candidate of candidates) {
      const id=candidate?.step_id||candidate?.id;
      const step=id?byId.get(id):byOrder.get(Number(candidate?.step_order??candidate?.order));
      if(!step||seen.has(step.id)){failures.push({step_id:id||null,message:'Unknown or duplicate section mapping was rejected.'});continue;}
      seen.add(step.id);
      if(sequential&&step.id!==activeWork.stepId&&!accepted.has(step.id)){failures.push({step_id:step.id,code:'AUTOMATION_SECTION_OUT_OF_ORDER',message:'Generate only the current requested section. Later sections remain queued until its instructions and manual coverage validate.'});continue;}
      if(accepted.has(step.id)||blockers.some(item=>item.step_id===step.id))continue;
      let normalized,retained;
      try {
        // Keep the validated source detached from streaming/model-owned objects.
        // Mutating an earlier partial response must never change the final save.
        retained=structuredClone(candidate);
        normalized=validate({steps:[structuredClone(retained)]},[step]);
      }
      catch(error){failures.push({step_id:step.id,...(error.code==='AUTOMATION_GENERATED_ASSERTION_NOT_PRESERVED'?{code:error.code}:{}),message:String(error.message||'Invalid section instructions').slice(0,500)});continue;}
      prepared.push({step,normalized,retained});
    }
    // Validate supplied coverage before any durable write. Invalid drafts and
    // arbitrary earlier sections cannot establish new manual-step coverage.
    const coverageFailures=[],proposedCoverage=new Map(),preparedIds=new Set(prepared.map(item=>item.step.id));
    if(payload?.manual_coverage!==undefined&&!Array.isArray(payload.manual_coverage))coverageFailures.push({message:'manual_coverage must be an array of manual_step_id and section_step_id mappings.'});
    for(const mapping of Array.isArray(payload?.manual_coverage)?payload.manual_coverage:[]){
      if(!mapping||!manualById.has(mapping.manual_step_id)||!byId.has(mapping.section_step_id)||mapping.manual_test_case_id&&mapping.manual_test_case_id!==manualById.get(mapping.manual_step_id).test_case_id){coverageFailures.push({message:'An unknown linked manual step or section coverage mapping was rejected.'});continue;}
      if(coverage.has(mapping.manual_step_id)&&coverage.get(mapping.manual_step_id)!==mapping.section_step_id){coverageFailures.push({manual_step_id:mapping.manual_step_id,message:'An established manual step mapping cannot be silently moved to another section.'});continue;}
      if(proposedCoverage.has(mapping.manual_step_id)&&proposedCoverage.get(mapping.manual_step_id)!==mapping.section_step_id){coverageFailures.push({manual_step_id:mapping.manual_step_id,message:'Conflicting mappings for the same manual step were rejected.'});continue;}
      if(!accepted.has(mapping.section_step_id)&&!preparedIds.has(mapping.section_step_id)){coverageFailures.push({manual_step_id:mapping.manual_step_id,code:'AUTOMATION_MANUAL_COVERAGE_UNVALIDATED',message:'Manual coverage must refer to a section with validated executable instructions.'});continue;}
      if(sequential&&!coverage.has(mapping.manual_step_id)&&(!activeWork.manualIds.includes(mapping.manual_step_id)||mapping.section_step_id!==activeWork.stepId)){coverageFailures.push({manual_step_id:mapping.manual_step_id,code:'AUTOMATION_MANUAL_COVERAGE_OUT_OF_SCOPE',message:'New manual coverage must refer to the current section. Previously completed sections cannot establish new behavior without developing its instructions.'});continue;}
      proposedCoverage.set(mapping.manual_step_id,mapping.section_step_id);
    }
    failures.push(...coverageFailures);
    for(const {step,normalized,retained} of coverageFailures.length?[]:prepared){
      const previewCoverage=new Map(coverageRows().filter(row=>accepted.has(row.section_step_id)||row.section_step_id===step.id).map(row=>[row.manual_step_id,row]));
      for(const [manual_step_id,section_step_id] of proposedCoverage)if(accepted.has(section_step_id)||section_step_id===step.id)previewCoverage.set(manual_step_id,{manual_step_id,section_step_id,manual_test_case_id:manualById.get(manual_step_id).test_case_id});
      // Finalization is part of acceptance, including builds without a Plan
      // save callback. Provenance/source binding must fail before persistence;
      // the optional workspace preview below cannot enforce this boundary.
      try{await onBeforeSaveSection({step,normalized,attempt,manualCoverage:[...previewCoverage.values()]});}
      catch(error){
        const failure=error instanceof Error?error:new Error('The section could not be finalized before saving.');
        throw Object.assign(failure,{code:failure.code||'AUTOMATION_SECTION_FINALIZATION_FAILED',nonRetryable:true,
          active_step_id:step.id,completed_sections:accepted.size,saved_step_ids:[...saved],saved_sections:saved.size,
          total_sections:steps.length,pending_step_ids:steps.filter(item=>!accepted.has(item.id)).map(item=>item.id)});
      }
      let saveReceipt={};
      if(onSaveSection){
        try{saveReceipt=await onSaveSection({step,normalized,attempt,manualCoverage:[...previewCoverage.values()]})||{};saved.add(step.id);}
        catch(error){throw Object.assign(error,{code:error.code||'AUTOMATION_SECTION_SAVE_FAILED',nonRetryable:true,saved_step_ids:[...saved],saved_sections:saved.size});}
      }
      accepted.set(step.id,retained);
      let preview={};
      try {preview=await onValidatedSection({step,normalized,attempt,manualCoverage:[...previewCoverage.values()]})||{};}
      catch(error){
        if([401,403].includes(error.statusCode)||error.name==='AbortError'||['BATCH_LEASE_LOST','BATCH_JOB_LEASE_LOST'].includes(error.code))throw error;
        await onProgress({phase:'automation.agent.preview.unavailable',level:'warning',message:'Validated instructions are retained in this build, but their optional workspace preview could not be stored.',details:{attempt,step_id:step.id,verification_status:'unverified'}});
      }
      // Publishing a preview or its activity event must never turn a valid section
      // into a model retry (which could repeat browser side effects).
      await onProgress({phase:'automation.agent.section.ready',message:`Validated instructions for section ${step.step_order}: ${String(step.action||'Untitled section').slice(0,160)}.`,details:{attempt,step_id:step.id,step_order:step.step_order,active_manual_step_ids:sequential?activeWork.manualIds:undefined,completed_sections:accepted.size,total_sections:steps.length,verification_status:'unverified',...preview,...saveReceipt,...(saved.has(step.id)?{development_status:'completed'}:{})}});
    }
    if(blockers.length){
      const message=blockers.map(item=>`Section ${item.step_order}: ${item.reason} Required: ${[...item.required_context,...item.required_parameters].join('; ')}.`).join(' ');
      const savedMessage=onSaveSection?`${saved.size} completed sections remain saved in Plan; the case is incomplete.`:'Existing instructions were retained; no partial changes were saved.';
      await onProgress({phase:'automation.agent.dependencies',level:'warning',message:`Generation needs additional context. ${message} ${savedMessage}`,details:{blocked_steps:blockers,completed_sections:accepted.size,saved_sections:saved.size,saved_step_ids:[...saved],total_sections:steps.length,pending_step_ids:steps.filter(step=>!accepted.has(step.id)).map(step=>step.id),verification_status:'unverified'}});
      throw Object.assign(new Error(`Automation generation needs additional context. ${message} ${accepted.size} of ${steps.length} sections validated. ${savedMessage}`),{code:'AUTOMATION_DEPENDENCY_MISSING',statusCode:422,nonRetryable:true,blocked_steps:blockers,completed_sections:accepted.size,saved_sections:saved.size,saved_step_ids:[...saved],total_sections:steps.length,pending_step_ids:steps.filter(step=>!accepted.has(step.id)).map(step=>step.id)});
    }
    if(!coverageFailures.length)for(const [manualId,sectionId] of proposedCoverage)if(accepted.has(sectionId))coverage.set(manualId,sectionId);
    await onProgress({phase:'automation.agent.coverage',message:`Accounted for ${coverage.size} of ${manualSteps.length} linked manual steps; execution remains unverified.`,details:{manual_coverage:coverageRows(),total_manual_steps:manualSteps.length,verification_status:'unverified'}});
    if(typeof payload?.summary==='string')summary=payload.summary;
    if(payload&&typeof payload==='object')for(const [key,value]of Object.entries(payload))if(!['steps','tool_calls','manual_coverage','blocked_steps','learned_locators'].includes(key))outcomeFields[key]=value;
    if(Array.isArray(payload?.manual_coverage))outcomeHasCoverage=true;
    if(Array.isArray(payload?.learned_locators)){outcomeHasLearning=true;learned.push(...payload.learned_locators.slice(0,100));}
    return {completed_step_ids:[...accepted.keys()],pending_step_ids:steps.filter(step=>!accepted.has(step.id)).map(step=>step.id),validation_errors:failures,...(sequential?{generation_mode:'sequential',active_step_id:activeWork.stepId,active_manual_step_ids:activeWork.manualIds,generation_complete:Boolean(workComplete()&&!failures.length)}:{})};
  };
  let failures=[];
  let attemptsMade=0;
  for(let attempt=1;attempt<=requestLimit;attempt++) {
    const completionOnly=accepted.size===steps.length&&coverage.size===manualSteps.length;
    if(sequential&&(!activeWork||workComplete()&&!failures.length))activeWork=nextWork();
    const workKey=completionOnly?'completion':sequential?activeWork.stepId||`manual:${activeWork.manualIds.join(',')}`:'case';
    const sectionAttempt=(workAttempts.get(workKey)||0)+1;
    if(sectionAttempt>limit)break;
    workAttempts.set(workKey,sectionAttempt);
    attemptsMade=attempt;
    const pending=steps.filter(step=>!accepted.has(step.id));
    const missingManual=manualSteps.filter(step=>!coverage.has(step.id));
    const currentSections=completionOnly?[]:sequential?pending.filter(step=>step.id===activeWork.stepId):pending;
    const currentManual=completionOnly?[]:sequential?missingManual.filter(step=>activeWork.manualIds.includes(step.id)):missingManual;
    const activeDetails={...(sequential?{generation_mode:'sequential',active_step_id:completionOnly?null:activeWork.stepId,active_manual_step_ids:completionOnly?[]:[...activeWork.manualIds],section_attempt:sectionAttempt}:{}),...(completionOnly?{completion_only:true}:{})};
    await onProgress({phase:'automation.agent.attempt',message:completionOnly?`Completing final response metadata: attempt ${sectionAttempt} of ${limit}.`:sequential?`Generating the current section: attempt ${sectionAttempt} of ${limit}.`:`Generating instructions: attempt ${sectionAttempt} of ${limit}, ${pending.length} sections and ${missingManual.length} manual coverage mappings remaining.`,details:{attempt,max_attempts:requestLimit,completed_sections:accepted.size,total_sections:steps.length,pending_step_ids:pending.map(step=>step.id),pending_manual_step_ids:missingManual.map(step=>step.id),...activeDetails}});
    if(sequential&&!completionOnly)await onProgress({phase:'automation.agent.section.started',message:activeWork.stepId?`Developing section ${byId.get(activeWork.stepId).step_order}.`:'Mapping the current manual step to validated instructions.',details:{attempt,step_id:activeWork.stepId,...activeDetails,verification_status:'unverified'}});
    const feedback={attempt,max_attempts:requestLimit,completed_step_ids:[...accepted.keys()],required_sections:currentSections.map(sectionText).map(step=>({step_id:step.id,order:step.step_order,type:step.step_type,action:step.action,expected_result:step.expected_result})),required_manual_steps:currentManual.map(manualText).map(step=>({manual_step_id:step.id,manual_test_case_id:step.test_case_id,action:step.action,expected_result:step.expected_result})),available_section_ids:sequential?[...new Set([...accepted.keys(),...(activeWork.stepId?[activeWork.stepId]:[])])]:[...byId.keys()],available_parameters:availableParameterNames,validation_errors:failures,...activeDetails};
    failures=[];
    let raw,payload;
    let partialOpen = true, partialFailure;
    let partialQueue = Promise.resolve();
    const onPartial = (value) => {
      if (!partialOpen) return Promise.reject(Object.assign(new Error('This incremental build request has ended.'), {code:'AUTOMATION_BUILD_REQUEST_CLOSED'}));
      let snapshot;
      try{snapshot=structuredClone(value);}catch(error){return Promise.reject(error);}
      const task = partialQueue.then(() => {
        if (partialFailure) throw partialFailure;
        return consume(snapshot, attempt, true);
      });
      partialQueue = task.then(() => undefined, error => { partialFailure = error; });
      return task;
    };
    try {raw=await generate({attempt,sectionAttempt,completionOnly,activeStepId:sequential&&!completionOnly?activeWork.stepId:undefined,activeManualStepIds:sequential&&!completionOnly?[...activeWork.manualIds]:undefined,feedback,feedbackInstruction,onPartial});}
    catch(error) {if(error.code!=='AI_INVALID_JSON')throw error;failures.push({code:'AI_INVALID_JSON',message:'The provider response was not valid JSON.'});}
    finally {partialOpen=false;await partialQueue;}
    if(partialFailure)throw partialFailure;
    if(!failures.length)try {payload=parse(raw);} catch(error) {failures.push({code:'AI_INVALID_JSON',message:'The provider response was not valid JSON.'});}
    const receipt = await consume(payload, attempt);
    failures.push(...receipt.validation_errors);
    if(accepted.size===steps.length&&coverage.size===manualSteps.length&&!failures.length) {
      const outcome={...outcomeFields,steps:steps.map(step=>accepted.get(step.id)),...(outcomeHasLearning?{learned_locators:learned.slice(0,200)}:{}),...(outcomeHasCoverage?{manual_coverage:coverageRows()}:{})};
      if(validateOutcome)try{await validateOutcome(outcome);}catch(error){
        if(error.code!=='AI_MANAGED_SCHEMA_INVALID')throw error;
        failures.push({code:error.code,message:error.message,validation_errors:error.validation_errors});
        continue;
      }
      const build=validate({...outcome,summary,learned_locators:learned.slice(0,200)},steps);
      return {...build,manual_coverage:coverageRows(),completion_attempts:attempt,verification_status:'unverified'};
    }
    // A normal sequential advance is not an incomplete generation warning.
    // It must not mark every future row as needing attention.
    if(!sequential||!workComplete()||failures.length)await onProgress({phase:'automation.agent.incomplete',level:'warning',message:`${accepted.size} of ${steps.length} sections have validated instructions; ${coverage.size} of ${manualSteps.length} linked manual steps are mapped. ${sectionAttempt<limit?'Continuing with the current work.':'The bounded completion attempts are exhausted; existing instructions are retained.'}`,details:{attempt,max_attempts:requestLimit,completed_sections:accepted.size,total_sections:steps.length,pending_step_ids:steps.filter(step=>!accepted.has(step.id)).map(step=>step.id),missing_manual_step_ids:manualSteps.filter(step=>!coverage.has(step.id)).map(step=>step.id),validation_errors:failures,...activeDetails}});
  }
  const validationFeedback=failures.slice(0,5).map(failure=>({
    ...(byId.has(failure.step_id)?{step_id:failure.step_id}:{}),
    ...(typeof failure.code==='string'&&/^[A-Z][A-Z_]{1,79}$/.test(failure.code)?{code:failure.code}:{}),
    message:sanitizeAiText(String(failure.message||'The generated instructions did not satisfy the native contract.')).text.slice(0,500)
  }));
  const publicMessage=`Automation generation is incomplete: ${accepted.size} of ${steps.length} sections validated.${validationFeedback.length?' '+validationFeedback.map(item=>item.message).join(' '):' Check the unfinished section mappings and linked manual coverage.'}`.slice(0,2000);
  throw Object.assign(new Error(`Automation generation is incomplete: ${accepted.size} of ${steps.length} sections validated and ${coverage.size} of ${manualSteps.length} linked manual steps mapped after ${attemptsMade} requests. Existing instructions were retained.`),{code:'AUTOMATION_BUILD_INCOMPLETE',statusCode:422,publicMessage,validation_feedback:validationFeedback,completed_sections:accepted.size,saved_sections:saved.size,saved_step_ids:[...saved],total_sections:steps.length,pending_step_ids:steps.filter(step=>!accepted.has(step.id)).map(step=>step.id),missing_manual_step_ids:manualSteps.filter(step=>!coverage.has(step.id)).map(step=>step.id)});
}
module.exports={completeAutomationBuild,MAX_COMPLETION_ATTEMPTS,matchManualCoverage};
