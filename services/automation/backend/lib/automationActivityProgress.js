const {appendStepBuildError}=require('./automationStepBuildErrors');
const {reduceBrowserActions}=require('./automationActivityReceipts');
/** Generation state is separate from execution; validation is not a passing run. */
function reduceActivityProgress(metadata={},event={}) {
 const details=event.details||{},caseId=details.test_case_id;
 if(!caseId)return {};
 const verification=event.phase==='automation.agent.verification'&&details.verification&&typeof details.verification==='object'?{verification_by_case:{...(metadata.verification_by_case||{}),[caseId]:details.verification}}:{};
 const timestamp=details.occurred_at||details.updated_at||details.observed_at||new Date().toISOString();
 const previousSectionRows=Array.isArray(metadata.step_progress)?metadata.step_progress:[];
 const previousManualRows=Array.isArray(metadata.manual_step_progress)?metadata.manual_step_progress:[];
 let sections=previousSectionRows.map(row=>({...row}));
 let manual=previousManualRows.map(row=>({...row}));
 const previousSections=new Map(previousSectionRows.filter(row=>row.test_case_id===caseId).map(row=>[row.step_id,row]));
 const previousManual=new Map(previousManualRows.filter(row=>row.test_case_id===caseId).map(row=>[row.manual_step_id,row]));
 const forCase=row=>row.test_case_id===caseId;
 const terminalFailure=['automation.llm.failed','automation.agent.save.failed','automation.agent.blocked','automation.agent.browser.failed','automation.agent.browser.startup.failed'].includes(event.phase);
 if(event.phase==='automation.agent.plan'){
  sections=[...sections.filter(row=>!forCase(row)),...(details.steps||[]).map(row=>({...row,test_case_id:caseId,status:'queued',instruction_status:'pending',development_status:'queued',...(details.progression_policy?{progression_policy:details.progression_policy}:{}),verification_status:'unverified',updated_at:timestamp}))];
  manual=[...manual.filter(row=>!forCase(row)),...(details.manual_steps||[]).map(row=>({...row,test_case_id:caseId,status:'queued',development_status:'queued',...(details.progression_policy?{progression_policy:details.progression_policy}:{}),verification_status:'unverified',updated_at:timestamp}))];
 }
 // Only the sequential orchestrator can identify current work. Legacy whole-
 // case attempts remain queued because they do not identify an active action.
 if(event.phase==='automation.agent.attempt')for(const row of sections)if(forCase(row)&&(details.pending_step_ids||[]).includes(row.step_id)&&(!details.generation_mode||details.generation_mode!=='sequential'||row.step_id===details.active_step_id))Object.assign(row,{status:'queued',instruction_status:'requested',attempt:details.attempt});
 if(event.phase==='automation.agent.section.started')for(const row of sections)if(forCase(row)){
  if(row.step_id===details.step_id&&!['validated','saved','validated_not_saved'].includes(row.instruction_status))Object.assign(row,{status:'in_progress',instruction_status:'requested',attempt:details.attempt,section_attempt:details.section_attempt,active_manual_step_ids:details.active_manual_step_ids||[]});
  else if(row.status==='in_progress')Object.assign(row,{status:'queued',instruction_status:'pending'});
 }
 if(event.phase==='automation.agent.section.ready')for(const row of sections)if(forCase(row)&&row.step_id===details.step_id){Object.assign(row,{status:'completed',instruction_status:row.instruction_status==='saved'?'saved':'validated',attempt:details.attempt,validated_at:details.validated_at||timestamp});if(row.instruction_status==='saved'&&details.development_status==='completed')row.development_status='completed';for(const key of ['preview_artifact_id','preview_created_at'])if(typeof details[key]==='string')row[key]=details[key];}
 if(event.phase==='automation.agent.section.saved')for(const row of sections)if(forCase(row)&&(row.step_id===details.step_id||(details.step_ids||[]).includes(row.step_id)))Object.assign(row,{status:'completed',instruction_status:'saved',saved_at:details.saved_at||timestamp,verification_status:'unverified'});
 if(event.phase==='automation.agent.section.saved'&&details.development_status==='completed')for(const row of sections)if(forCase(row)&&(row.step_id===details.step_id||(details.step_ids||[]).includes(row.step_id)))row.development_status='completed';
 if(event.phase==='automation.agent.incomplete')for(const row of sections)if(forCase(row)&&row.instruction_status!=='saved'&&(details.pending_step_ids||[]).includes(row.step_id)&&(details.generation_mode!=='sequential'||row.step_id===details.active_step_id))Object.assign(row,{status:'needs_attention',instruction_status:'pending'});
 if(event.phase==='automation.agent.dependencies')for(const blocker of details.blocked_steps||[])for(const row of sections)if(forCase(row)&&row.instruction_status!=='saved'&&row.step_id===blocker.step_id)Object.assign(row,{status:'needs_attention',instruction_status:'dependency_missing',dependency: blocker,preview_artifact_id:null,preview_created_at:null,validated_at:null});
 if(event.phase==='automation.agent.plan'||event.phase==='automation.agent.coverage')for(const mapping of details.manual_coverage||[])for(const row of manual)if(forCase(row)&&row.manual_step_id===mapping.manual_step_id)row.section_step_id=mapping.section_step_id;
 if(event.phase==='automation.case.updated')for(const row of sections)if(forCase(row)&&(details.step_ids||[]).includes(row.step_id))Object.assign(row,{status:'completed',instruction_status:'saved'});
 const runningSections=sections.filter(row=>forCase(row)&&row.status==='in_progress');
 const failedStepId=details.active_step_id||details.failed_step_id||details.step_id||(terminalFailure&&runningSections.length===1?runningSections[0].step_id:undefined);
 if(terminalFailure)for(const row of sections)if(forCase(row)&&row.instruction_status!=='saved'&&(row.instruction_status==='validated'||(failedStepId?row.step_id===failedStepId:row.status==='in_progress')))Object.assign(row,{status:row.instruction_status==='validated'?'completed':'needs_attention',instruction_status:row.instruction_status==='validated'?'validated_not_saved':row.dependency?'dependency_missing':'not_saved'});
 for(const row of sections)if(forCase(row)&&failedStepId&&row.step_id===failedStepId)appendStepBuildError(row,event,timestamp);
 if(event.phase==='automation.agent.dependencies')for(const blocker of details.blocked_steps||[])for(const row of sections)if(forCase(row)&&row.step_id===blocker.step_id)appendStepBuildError(row,event,timestamp);
 if(['automation.agent.section.saved','automation.agent.section.ready'].includes(event.phase))for(const row of sections)if(forCase(row)&&row.instruction_status==='saved'&&(row.step_id===details.step_id||(details.step_ids||[]).includes(row.step_id))&&Array.isArray(row.build_errors))row.build_errors=row.build_errors.map(error=>({...error,resolved_at:error.resolved_at||timestamp}));
 for(const row of sections)if(forCase(row)&&row.step_id===details.active_step_id){const actions=reduceBrowserActions(row.browser_actions,event,timestamp);if(actions!==undefined)row.browser_actions=actions;}
 const sectionsById=new Map(sections.filter(forCase).map(row=>[row.step_id,row]));
 for(const row of sections)if(forCase(row)){const previous=previousSections.get(row.step_id);if(JSON.stringify(previous)!==JSON.stringify(row))row.updated_at=timestamp;}
 for(const row of manual)if(forCase(row)){
  const section=sectionsById.get(row.section_step_id);
  const isActiveManual=(details.active_manual_step_ids||[]).includes(row.manual_step_id);
  const failedCurrent=terminalFailure&&(isActiveManual||!failedStepId&&row.status==='in_progress');
  const incompleteCurrent=event.phase==='automation.agent.incomplete'&&(details.missing_manual_step_ids||[]).includes(row.manual_step_id)&&(details.generation_mode!=='sequential'||isActiveManual);
  const unmappedStatus=failedCurrent||incompleteCurrent?'needs_attention':event.phase==='automation.agent.attempt'&&(details.pending_manual_step_ids||[]).includes(row.manual_step_id)?'queued':row.status||'queued';
  Object.assign(row,{status:section?.status||unmappedStatus,instruction_status:section?.instruction_status||'unmapped'});
  if(Array.isArray(section?.browser_actions))row.browser_actions=section.browser_actions.filter(action=>action.active_manual_step_ids?.includes(row.manual_step_id));
  const errorSection=section||(isActiveManual&&sectionsById.get(failedStepId));
  if(Array.isArray(errorSection?.build_errors))row.build_errors=errorSection.build_errors;
  if(section?.status==='in_progress'&&Array.isArray(section.active_manual_step_ids)&&!section.active_manual_step_ids.includes(row.manual_step_id))Object.assign(row,{status:'queued',instruction_status:'pending'});
  if(event.phase==='automation.agent.section.started'&&isActiveManual&&!['validated','saved','validated_not_saved'].includes(row.instruction_status))Object.assign(row,{status:'in_progress',instruction_status:'requested',attempt:details.attempt,section_attempt:details.section_attempt});
  const previous=previousManual.get(row.manual_step_id);
  if(JSON.stringify(previous)!==JSON.stringify(row))row.updated_at=timestamp;
 }

 let application;
 if(event.phase==='automation.agent.observation'){
  // Metadata contains references only; accessibility/source remain protected artifacts.
  application=metadata.workspace_application?.test_case_id===caseId?{...metadata.workspace_application}:{test_case_id:caseId};
  for(const key of ['snapshot_artifact_id','screenshot_artifact_id','observed_at','url','title','interaction_mode','attempt','active_step_id','active_manual_step_ids'])if(details[key]!==undefined)application[key]=details[key];
  application.verification_status='unverified';
 }
 const buildData=event.phase==='automation.agent.data'&&typeof details.build_data_artifact_id==='string'?{build_data_artifacts:{...(metadata.build_data_artifacts||{}),[caseId]:details.build_data_artifact_id}}:{};
 for(const row of manual)if(forCase(row)){const section=sectionsById.get(row.section_step_id);if(section?.development_status==='completed'&&section.instruction_status==='saved')row.development_status='completed';}
 return {...verification,step_progress:sections,manual_step_progress:manual,...(details.generation_mode?{generation_mode:details.generation_mode}:{}),...(details.progression_policy?{progression_policy:details.progression_policy}:{}),...buildData,...(application?{workspace_application:application}:{})};
}
module.exports={reduceActivityProgress};
