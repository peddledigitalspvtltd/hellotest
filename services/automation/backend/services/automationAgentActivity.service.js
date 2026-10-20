const obsDb=require('@hellotest/platform/backend/src/obsDb');
const transactions=require('@hellotest/platform/backend/services/workspaceTransaction.service');
const diagnostics=require('../lib/automationProgressDiagnostics');
const traceContext=require('@hellotest/platform/backend/src/utils/llmTraceContext');
function page(input={}){
 const offset=Number(input.events_offset??0),limit=Number(input.events_limit??200);
 if(!Number.isSafeInteger(offset)||offset<0||offset>1000000||!Number.isSafeInteger(limit)||limit<1||limit>500)throw Object.assign(new Error('Choose a valid activity log page.'),{statusCode:400});
 return {offset,limit};
}
async function activity(value,input){
 const transaction=typeof value==='string'?await transactions.getTransaction(value):value;
 const {offset,limit}=page(input);
 const rows=await obsDb.prepare('SELECT * FROM workspace_transaction_events WHERE transaction_id=? ORDER BY created_at ASC,id ASC LIMIT ? OFFSET ?').all(transaction.id,limit+1,offset);
 return {...transaction,events:rows.slice(0,limit),events_has_more:rows.length>limit,events_next_offset:offset+Math.min(rows.length,limit),events_total:Number(transaction.event_count)||rows.length};
}
async function latest({projectId,appTypeId,caseId}){
 const row=await obsDb.prepare(`SELECT id FROM workspace_transactions
 WHERE project_id=? AND app_type_id=? AND category='automation_build' AND metadata->>'agent_activity'='true'
 AND (?='' OR metadata->'input_test_case_ids' @> jsonb_build_array(?::text) OR metadata->'output_test_case_ids' @> jsonb_build_array(?::text))
 ORDER BY created_at DESC,id DESC LIMIT 1`).get(projectId,appTypeId,caseId||'',caseId||'',caseId||'');
 return row?activity(row.id):null;
}
module.exports={activity,latest,page};

function historyPage(input={}){
 const limit=Number(input.limit??20);if(!Number.isSafeInteger(limit)||limit<1||limit>50)throw Object.assign(new Error('Choose a valid activity history page.'),{statusCode:400});
 let cursor=null;
 if(input.cursor){try{if(typeof input.cursor!=='string'||input.cursor.length>2000)throw new Error();cursor=JSON.parse(Buffer.from(input.cursor,'base64url').toString('utf8'));if(!Array.isArray(cursor)||cursor.length!==2||typeof cursor[0]!=='string'||!Number.isFinite(Date.parse(cursor[0]))||typeof cursor[1]!=='string'||!cursor[1]||cursor[1].length>200)throw new Error();}catch{throw Object.assign(new Error('The activity history cursor is invalid.'),{statusCode:400});}}
 return {limit,cursor};
}
async function history({projectId,appTypeId,caseId},input={}){
 const {limit,cursor}=historyPage(input);
 const params=[projectId,appTypeId,caseId||'',caseId||'',caseId||''];
 let sql=`SELECT id,project_id,app_type_id,status,description,created_at,created_at::text AS cursor_created_at FROM workspace_transactions WHERE project_id=? AND app_type_id=? AND category='automation_build' AND metadata->>'agent_activity'='true'
 AND (?='' OR metadata->'input_test_case_ids' @> jsonb_build_array(?::text) OR metadata->'output_test_case_ids' @> jsonb_build_array(?::text))`;
 if(cursor){sql+=' AND (created_at,id) < (?::timestamptz,?)';params.push(...cursor);}
 sql+=' ORDER BY created_at DESC,id DESC LIMIT ?';params.push(limit+1);
 const rows=await obsDb.prepare(sql).all(...params),selected=rows.slice(0,limit),last=selected.at(-1);
 const items=selected.map(({cursor_created_at,...row})=>row);
 return {items,next_cursor:rows.length>limit?Buffer.from(JSON.stringify([last.cursor_created_at||new Date(last.created_at).toISOString(),last.id])).toString('base64url'):null};
}
async function recordProgress(transactionId,event){
 if(!transactionId)return;
 event=diagnostics.progressEvent(event,{activityId:transactionId,context:traceContext.current()});
 return obsDb.transaction(async()=>{
  await obsDb.prepare('SELECT id FROM workspace_transactions WHERE id=? FOR UPDATE').get(transactionId);
  const transaction=await transactions.getTransaction(transactionId);
  const progress=require('../lib/automationActivityProgress').reduceActivityProgress(transaction.metadata,event);
  return transactions.appendTransactionEvent(transactionId,{...event,metadata:{...event.metadata,...progress}});
 })();
}
module.exports.history=history;module.exports.historyPage=historyPage;module.exports.recordProgress=recordProgress;
async function screenshot(transaction,artifactId){
 const artifact=await getArtifact(artifactId);
 const invalid=()=>Object.assign(new Error('Browser screenshot is unavailable for this activity.'),{statusCode:404});
 if(!artifact||artifact.transaction_id!==transaction.id||!['image/jpeg','image/png'].includes(artifact.mime_type)||typeof artifact.content!=='string'||artifact.content.length>196608||!/^[A-Za-z0-9+/]+={0,2}$/.test(artifact.content))throw invalid();
 const bytes=Buffer.from(artifact.content,'base64');
 if(!bytes.length||bytes.length>128*1024||(artifact.mime_type==='image/jpeg'?!bytes.subarray(0,3).equals(Buffer.from([255,216,255])):!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))))throw invalid();
 return {id:artifact.id,mime_type:artifact.mime_type,data_url:`data:${artifact.mime_type};base64,${artifact.content}`};
}
module.exports.screenshot=screenshot;

async function createSectionPreview(transactionId,input){
 if(!transactionId)return {};
 const workspace=require('../lib/automationWorkspacePreview');
 const value=workspace.sectionPreview(input);
 const artifact=await transactions.createTransactionArtifact(transactionId,{file_name:`section-${value.step_id}-attempt-${value.attempt}.json`,mime_type:workspace.PREVIEW_MIME,content:workspace.artifactJson(value)});
 return {preview_artifact_id:artifact.id,preview_created_at:value.created_at,validated_at:value.created_at};
}
async function createBrowserEvidence(transactionId,input){
 if(!transactionId)return null;
 const workspace=require('../lib/automationWorkspacePreview'),observed=workspace.browserEvidence(input);
 if(!observed)return null;
 const {evidence,hasSnapshot,image}=observed;
 let snapshotArtifact,screenshotArtifact,screenshotUnavailable=false;
 if(hasSnapshot)snapshotArtifact=await transactions.createTransactionArtifact(transactionId,{file_name:`browser-observation-${input.testCaseId}-${Date.now()}.json`,mime_type:workspace.EVIDENCE_MIME,content:workspace.artifactJson(evidence)});
 if(image)try{
  const candidate={transaction_id:transactionId,id:'pending',mime_type:image.mimeType,content:image.data};
  // The same validation as the protected image reader prevents retaining non-image payloads.
  const bytes=Buffer.from(candidate.content,'base64');
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(candidate.content)||!bytes.length||bytes.length>128*1024||(image.mimeType==='image/jpeg'?!bytes.subarray(0,3).equals(Buffer.from([255,216,255])):!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))))throw new Error('Optional browser screenshot is invalid.');
  screenshotArtifact=await transactions.createTransactionArtifact(transactionId,{file_name:`browser-${input.testCaseId}-${Date.now()}.${image.mimeType==='image/png'?'png':'jpg'}`,mime_type:image.mimeType,content:image.data});
 }catch(error){if(!snapshotArtifact||diagnostics.isCriticalAutomationError(error))throw error;diagnostics.reportDiagnosticFailure({activityId:transactionId,operation:'browser_screenshot_storage',error});screenshotUnavailable=true;}
 return {test_case_id:input.testCaseId,...(snapshotArtifact?{snapshot_artifact_id:snapshotArtifact.id,screenshot_artifact_id:null}:{}),...(screenshotArtifact?{screenshot_artifact_id:screenshotArtifact.id}:{}),...(screenshotUnavailable?{screenshot_unavailable:true}:{}),observed_at:evidence.observed_at,...(evidence.url?{url:evidence.url}:{}),...(evidence.title?{title:evidence.title}:{}),...(evidence.active_step_id?{active_step_id:evidence.active_step_id,active_manual_step_ids:evidence.active_manual_step_ids||[]}:{}),attempt:input.attempt,interaction_mode:input.interactionMode,verification_status:'unverified'};
}
async function getArtifact(artifactId){try{return await transactions.getTransactionArtifact(artifactId);}catch(error){if(error.message==='Workspace transaction artifact not found')throw Object.assign(new Error('Automation workspace evidence is unavailable for this activity.'),{statusCode:404});throw error;}}
async function workspaceArtifact(transaction,artifactId,mime,kind){
 const workspace=require('../lib/automationWorkspacePreview');
 return workspace.readArtifact(await getArtifact(artifactId),transaction,mime,kind);
}
module.exports.createSectionPreview=createSectionPreview;
module.exports.createBrowserEvidence=createBrowserEvidence;
module.exports.preview=async(transaction,artifactId)=>{
 const preview=await workspaceArtifact(transaction,artifactId,require('../lib/automationWorkspacePreview').PREVIEW_MIME,'section_preview');
 const unknown={status:'unknown',reasons:['current_plan_unavailable']};
 if(!transaction.project_id)return {...preview,applicability:unknown};
 try{
  const db=require('@hellotest/platform/backend/src/db');
  const step=await db.prepare(`SELECT s.* FROM test_steps s JOIN test_cases tc ON tc.id=s.test_case_id JOIN app_types app ON app.id=tc.app_type_id
   WHERE s.id=? AND tc.id=? AND tc.automated='yes' AND app.project_id=? AND (?::text IS NULL OR tc.app_type_id=?)`).get(preview.step_id,preview.test_case_id,transaction.project_id,transaction.app_type_id||null,transaction.app_type_id||null);
  const references=preview.generation_manifest?.manual_specification;
  const ids=Array.isArray(references)?[...new Set(references.filter(row=>typeof row?.manual_step_id==='string').map(row=>row.manual_step_id))].slice(0,200):[];
  const manualSteps=ids.length?await db.prepare(`SELECT s.*,tc.id AS manual_test_case_id,s.id AS manual_step_id FROM automation_case_links link
   JOIN test_cases target ON target.id=link.automation_test_case_id AND target.automated='yes'
   JOIN test_cases tc ON tc.id=link.manual_test_case_id AND tc.app_type_id=target.app_type_id AND COALESCE(tc.automated,'no')='no'
   JOIN app_types app ON app.id=target.app_type_id JOIN test_steps s ON s.test_case_id=tc.id
   WHERE target.id=? AND app.project_id=? AND s.id IN (${ids.map(()=>'?').join(',')})`).all(preview.test_case_id,transaction.project_id,...ids):[];
  return {...preview,applicability:require('../lib/automationGenerationManifest').generationApplicability({manifest:preview.generation_manifest,testCaseId:preview.test_case_id,currentStep:step,currentManualSteps:manualSteps})};
 }catch(error){
  if(diagnostics.isCriticalAutomationError(error))throw error;
  // Version comparison is optional. Protected historical content remains
  // readable when the live Plan database is temporarily unavailable.
  diagnostics.reportDiagnosticFailure({activityId:transaction.id,operation:'browser_preview_applicability',error});
  return {...preview,applicability:unknown};
 }
};
module.exports.createBuildData=(transactionId,input)=>require('./automationBuildData.service').create(transactionId,input);
module.exports.buildData=(transaction,artifactId)=>require('./automationBuildData.service').read(transaction,artifactId);
module.exports.evidence=(transaction,artifactId)=>workspaceArtifact(transaction,artifactId,require('../lib/automationWorkspacePreview').EVIDENCE_MIME,'browser_evidence');
