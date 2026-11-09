const {createHash}=require('node:crypto');
const {validSavedInstructionMapping}=require('../lib/automationInstructionMapping');
const {PREVIEW_MIME,MAX_ARTIFACT_BYTES}=require('../lib/automationWorkspacePreview');

/** Optional projection of the already-authorized current source. The mapping
 * stays in protected, retained build artifacts, never in test-data options. */
function createInstructionMappingService({obsDb:providedDb}={}) {
async function attachInstructionMappings({steps,projectId,appTypeId,testCaseId}) {
  if (!projectId || !testCaseId || !Array.isArray(steps) || !steps.length) return steps;
  const hashes=[...new Set(steps.filter(step=>typeof step.automation_code==='string'&&step.automation_code.trim()).map(step=>createHash('sha256').update(step.automation_code,'utf8').digest('hex')))];
  if (!hashes.length) return steps;
  const obsDb=providedDb||require('@hellotest/platform/backend/src/obsDb');
  // Artifact JSON is created and bounded by sectionPreview/artifactJson. The
  // query is scoped to the currently authorized case, project and application.
  const rows=await obsDb.prepare(`SELECT artifact.id,artifact.content,activity.metadata AS transaction_metadata
    FROM workspace_transaction_artifacts artifact
    JOIN workspace_transactions activity ON activity.id=artifact.transaction_id
    WHERE activity.project_id=? AND (?::text IS NULL OR activity.app_type_id=?)
      AND activity.category='automation_build' AND artifact.mime_type=?
      AND artifact.content::jsonb->>'test_case_id'=?
      AND artifact.content::jsonb->'automation_instructions'->>'source_sha256' IN (${hashes.map(()=>'?').join(',')})
    ORDER BY artifact.created_at DESC,artifact.id DESC LIMIT ?`).all(projectId,appTypeId||null,appTypeId||null,PREVIEW_MIME,testCaseId,...hashes,Math.min(1000,steps.length*5));
  const mappings=new Map();
  for (const row of rows) {
    if (row.transaction_metadata?.artifact_quarantine?.[row.id]?.quarantined===true || typeof row.content!=='string' || Buffer.byteLength(row.content)>MAX_ARTIFACT_BYTES) continue;
    let preview;try{preview=JSON.parse(row.content);}catch{continue;}
    const step=steps.find(step=>step.id===preview.step_id);
    if (!step || mappings.has(step.id) || preview.schema_version!==1 || preview.kind!=='section_preview' || preview.test_case_id!==testCaseId || preview.automation_code!==step.automation_code) continue;
    const mapping=validSavedInstructionMapping(preview.automation_instructions,{source:step.automation_code,stepId:step.id});
    if (mapping) mappings.set(step.id,mapping);
  }
  return steps.map(step=>mappings.has(step.id)?{...step,automation_instructions:mappings.get(step.id)}:step);
}
return {attachInstructionMappings};
}

module.exports={...createInstructionMappingService(),createInstructionMappingService};
