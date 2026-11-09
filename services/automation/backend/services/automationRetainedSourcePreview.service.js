const {createHash}=require('node:crypto');
const {createGenerationManifest,generationApplicability}=require('../lib/automationGenerationManifest');
const {groundedManualCoverage}=require('../lib/automationBuildCompletion');
const {createUpstreamPrivateBindingScope}=require('../lib/automationUpstreamPrivateBindings');
const {selectUpstreamSourceParameterValues}=require('../lib/automationUpstreamSourceBindings');
const {generateUpstreamSectionSource}=require('../lib/automationUpstreamSectionSource');
const permissions=['automation.build','automation.ai','automation.view','automation.code.view','testcase.view','data.view','ops.view'];
const fail=(message,code='AUTOMATION_SOURCE_PROPOSAL_UNAVAILABLE',statusCode=409)=>Object.assign(new Error(message),{code,statusCode,nonRetryable:true});
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text=value=>String(value||'').replace(/\s+/g,' ').trim();
const sameIntent=(left,right)=>text(left?.action)===text(right?.action)&&text(left?.expected_result)===text(right?.expected_result);
const identifiers=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(value);
const includesCase=(transaction,id)=>[transaction.metadata?.test_case_id,...(transaction.metadata?.input_test_case_ids||[]),...(transaction.metadata?.output_test_case_ids||[]),...(transaction.metadata?.step_progress||[]).map(row=>row.test_case_id)].includes(id);
function sourcePacket(trace,{transactionId,testCaseId,stepId}){
 if(!trace||trace.session_id!==transactionId||trace.capture?.test_case_id!==testCaseId||trace.status!=='succeeded'||trace.capture?.request_truncated||trace.capture?.response_truncated)throw fail('A complete successful source-model request from this exact case and activity is required. Truncated or expired captures cannot establish native action authority.');
 const messages=trace.request_payload?.messages;
 const user=Array.isArray(messages)?messages.filter(message=>message.role==='user').at(-1)?.content:null;
 let packet;try{packet=JSON.parse(user);}catch{throw fail('The retained source request is not a complete structured native-source packet.');}
 if(!packet?.task?.startsWith('Save this section as executable Playwright JavaScript.')||packet.step?.id!==stepId||typeof packet.native_emitted_code!=='string'||packet.interactive!==true||!Array.isArray(packet.observations)||!packet.final_observation||packet.final_observation.result?.isError===true)throw fail('This call does not contain the completed native work and final observation for the selected section.');
 if(packet.observation_delivery?.historical_page_text_omitted!==true||packet.final_observation.result?.text_truncated||JSON.stringify(packet).includes('[CAPTURE_LIMIT]'))throw fail('The retained native source evidence is incomplete.');
 return packet;
}
function defaultPorts(){
 const db=require('@hellotest/platform/backend/src/db');
 const activity=require('./automationAgentActivity.service');
 const transactions=require('@hellotest/platform/backend/services/workspaceTransaction.service');
 return {
  access:async(user,projectId)=>{await require('@hellotest/platform/backend/public/projectAccess').getProject(projectId,user.id);return require('@hellotest/platform/backend/services/optionalEvidenceAccess.service').getOptionalEvidenceAccess(user,projectId,permissions);},
  transaction:id=>transactions.getTransaction(id),
  current:async(caseId,user,projectId)=>{const testCase=await db.prepare('SELECT tc.*,app.project_id,app.type AS app_type_kind FROM test_cases tc JOIN app_types app ON app.id=tc.app_type_id WHERE tc.id=? AND app.project_id=?').get(caseId,projectId);if(!testCase)throw fail('The automation case is unavailable in this project.');const context=require('../lib/automationBuildContext');return {testCase,steps:await db.prepare('SELECT * FROM test_steps WHERE test_case_id=? ORDER BY step_order,id').all(caseId),manualCases:await context.loadAutomationManualContext({caseId,projectId,userId:user.id}),parameter_source_key:(await context.loadAutomationParameterContext({testCase,projectId,userId:user.id})).source_key};},
  data:(transaction,id)=>activity.buildData(transaction,id),
  preview:(transaction,id)=>activity.preview(transaction,id),
  trace:(projectId,id)=>require('@hellotest/trace/backend/services/llmTraceQuery.service').detail(projectId,id,{includeContent:true}),
  complete:input=>require('./aiAutomationBuilder.service').completeRetainedSourceProposal(input),
  validate:steps=>require('./automationReadiness.service').inspectExecutablePlan(steps)
 };
}
/** A proposal uses recorded SDK authority. It never reconnects a browser or saves source. */
async function previewRetainedSource({transactionId,input={},user,signal},ports=defaultPorts()){
 if(!user?.id||user.role!=='admin')throw fail('Workspace administrator access is required to reuse protected model-request content.', 'AUTOMATION_SOURCE_PROPOSAL_FORBIDDEN',403);
 for(const key of ['test_case_id','step_id','source_call_id'])if(!identifiers(input[key]))throw fail(`Provide a valid ${key}.`,'AUTOMATION_SOURCE_PROPOSAL_INVALID',400);
 if(input.evidence_transaction_id!==undefined&&!identifiers(input.evidence_transaction_id))throw fail('Provide a valid evidence activity.','AUTOMATION_SOURCE_PROPOSAL_INVALID',400);
 const target=await ports.transaction(transactionId),evidence= input.evidence_transaction_id&&input.evidence_transaction_id!==transactionId?await ports.transaction(input.evidence_transaction_id):target;
 for(const transaction of [target,evidence])if(transaction.category!=='automation_build'||!transaction.project_id||transaction.project_id!==target.project_id||transaction.app_type_id!==target.app_type_id||!includesCase(transaction,input.test_case_id)||['queued','running'].includes(transaction.status))throw fail('Choose terminal build activities for this exact project, application and case.');
 const guard=async()=>{signal?.throwIfAborted();const access=await ports.access(user,target.project_id);if(permissions.some(code=>!access[code]))throw fail('Case, source, AI, data and model-call access are required and rechecked before each request.','AUTOMATION_SOURCE_PROPOSAL_FORBIDDEN',403);};
 await guard();
 const current=await ports.current(input.test_case_id,user,target.project_id);
 if(current.testCase.app_type_id!==target.app_type_id||current.testCase.automated!=='yes')throw fail('The current automation case does not match the retained activity.');
 const baseline=hash(current),step=current.steps.find(row=>row.id===input.step_id);
 if(!step||step.step_type!=='web'||step.reusable_group_id||['shared','reusable'].includes(step.group_kind))throw fail('Select one current case-owned web section.');
 const dataId=evidence.metadata?.build_data_artifacts?.[input.test_case_id];
 if(!identifiers(dataId))throw fail('The old build public-value snapshot is required before its native sample values can be rebound.');
 const data=await ports.data(evidence,dataId);
 const historicalResolver=require('../lib/automationBrowserParameters').createBrowserParameterResolver({testCase:{parameter_values:data.parameter_values},caseValues:data.parameter_values,privateParameterNames:data.private_parameter_references||[],steps:current.steps,materialize:false});
 const sameHistoricalIntent=(now,old)=>sameIntent(now,old)||sameIntent(historicalResolver.projectSteps([now])[0],old);
 const oldStep=data.steps.find(row=>row.step_id===step.id),progress=(evidence.metadata?.step_progress||[]).find(row=>row.test_case_id===input.test_case_id&&row.step_id===step.id);
 if(!oldStep||!sameHistoricalIntent(step,oldStep)||!progress||Number(progress.step_order)!==Number(step.step_order)||!sameIntent(step,progress))throw fail('The authored section changed since its native work was observed.');
 const lineage=groundedManualCoverage(current.steps,current.manualCases),coverage=lineage.manualCoverage.filter(row=>row.section_step_id===step.id);
 if(current.manualCases.length&&!coverage.length)throw fail('The section has no exact linked manual-step ownership.');
 for(const mapping of coverage){
  const now=lineage.manualSteps.find(row=>row.id===mapping.manual_step_id&&row.test_case_id===mapping.manual_test_case_id),old=data.manual_steps.find(row=>row.manual_step_id===mapping.manual_step_id&&row.manual_test_case_id===mapping.manual_test_case_id),recorded=(evidence.metadata?.manual_step_progress||[]).find(row=>row.manual_step_id===mapping.manual_step_id&&row.section_step_id===step.id);
  if(!old||!sameHistoricalIntent(now,old)||!recorded||Number(recorded.step_order)!==Number(now.step_order)||!sameIntent(now,recorded))throw fail('The linked manual specification or section ownership changed since this evidence.');
 }
 let priorManifest;
 if(progress.preview_artifact_id){
  const preview=await ports.preview(evidence,progress.preview_artifact_id);priorManifest=preview.generation_manifest;
  const applicability=generationApplicability({manifest:priorManifest,testCaseId:input.test_case_id,currentStep:step,currentManualSteps:lineage.manualSteps});
  if(applicability.status==='unknown'||applicability.reasons.some(reason=>reason!=='source_changed'))throw fail('The prior section or linked manual specification fingerprint no longer matches this case.');
 }else if(evidence.id!==target.id)throw fail('Cross-build native authority requires a validated section preview with exact manual-specification hashes.');
 const trace=await ports.trace(target.project_id,input.source_call_id);
 const packet=sourcePacket(trace,{transactionId:evidence.id,testCaseId:input.test_case_id,stepId:step.id});
 if(!sameIntent(step,packet.step)||Number(packet.step.step_order)!==Number(step.step_order))throw fail('The source-model request describes a different authored section.');
 const privateKeys=new Set(data.private_parameter_references||[]),known=new Set(data.parameter_references||[]);
 for(const [key,value]of Object.entries(packet.parameters||{}))if(!known.has(key)||!privateKeys.has(key)&&data.parameter_values[key]!==value)throw fail('The source request public samples do not match the old build-data snapshot.');
 const references=packet.private_parameter_tokens||{},secretBindings=Object.fromEntries(Object.entries(references).map(([reference,name])=>[name,reference.replace(/^@/,'')]));
 const bindings={parameterValues:{...data.parameter_values,...Object.fromEntries([...privateKeys].map(key=>[key,`@${key}`]))},references,secretBindings,secrets:{},parameterExpressions:true};
 const authored={...step,parameter_references:known.size?[...known].filter(key=>new RegExp(`@${key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?![A-Za-z0-9_-])`).test(`${step.action||''}\n${step.expected_result||''}`)):[]};
 const privateScope=createUpstreamPrivateBindingScope({step:authored,bindings});
 const sourceBindings={...bindings,references:privateScope.references,secretBindings:privateScope.secretBindings,parameterValues:selectUpstreamSourceParameterValues({parameterValues:privateScope.parameterValues,parameterReferences:authored.parameter_references,privateNames:[...privateKeys]})};
 const deadline=Date.now()+180000,allowance=AbortSignal.timeout(180000),proposalSignal=signal?AbortSignal.any([signal,allowance]):allowance;
 // Recheck complete current source, data and manual context before every dispatch.
 const assertCurrent=async()=>{proposalSignal.throwIfAborted();await guard();if(hash(await ports.current(input.test_case_id,user,target.project_id))!==baseline)throw fail('The current case, source, parameters or manual specification changed. Request a fresh proposal.','AUTOMATION_SOURCE_PROPOSAL_STALE');proposalSignal.throwIfAborted();};
 const completed=current.steps.filter(row=>Number(row.step_order)<Number(step.step_order)).map(row=>({step:row,automation_code:row.automation_code}));
 const update=await generateUpstreamSectionSource({step:authored,emitted:packet.native_emitted_code,sourceContext:{latest_observation:packet.final_observation,observations:packet.observations,delivery:packet.observation_delivery},sourceBindings,privateScope,completed,interactive:true,guard:assertCurrent,signal:proposalSignal,validate:ports.validate,
  complete:async({prompt,phase})=>{await assertCurrent();if(Date.now()>=deadline)throw fail('The source-only proposal model allowance ended.');return ports.complete({projectId:target.project_id,userId:user.id,integrationId:input.integration_id,prompt,phase,caseId:input.test_case_id,sectionId:step.id,signal:proposalSignal,timeoutMs:Math.min(90000,deadline-Date.now()),beforeDispatch:assertCurrent,sessionId:target.id});}});
 await assertCurrent();
 const manifest=createGenerationManifest({testCaseId:input.test_case_id,step,update,manualCoverage:lineage.manualCoverage,manualSpecification:lineage.manualSpecification});
 const {automationSourceSha256}=await import('../../shared/automationInstructionMapping.mjs');
 return {schema_version:1,kind:'automation_source_proposal',test_case_id:input.test_case_id,step_id:step.id,step_order:step.step_order,automation_code:update.automation_code,proposed_source_sha256:automationSourceSha256(update.automation_code),...(update.automation_instructions?{automation_instructions:update.automation_instructions}:{}),generation_manifest:manifest,baseline_sha256:baseline,baseline_source_sha256:automationSourceSha256(step.automation_code||''),source_call_id:trace.id,evidence_transaction_id:evidence.id,target_transaction_id:target.id,...(priorManifest?{evidence_source_sha256:priorManifest.source_sha256}:{}),validation_status:'validated',save_status:'not_saved',verification_status:'unverified',side_effects:{browser_actions:0,cases_saved:0},warnings:['Historical native evidence establishes the recorded action authority. This new source has not been executed. Review it and use Save section, then a new Run.'],...(update.instruction_mapping_warning?{instruction_mapping_warning:update.instruction_mapping_warning}:{})};
}
module.exports={previewRetainedSource,sourcePacket,permissions};
