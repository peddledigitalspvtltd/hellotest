const db=require('@hellotest/platform/backend/src/db');
const planner=require('../workflows/resumePlan');
const execution=require('./agenticWorkflowExecution.service');
const store=execution._internals.store;
const fail=(message,statusCode=409)=>Object.assign(new Error(message),{statusCode,publicMessage:message});
async function inspect(id,nodeId,user){
 const source=await store.get(id);if(!source)throw fail('Source execution not found.',404);
 await execution._internals.requireRunAccess(user,source.project_id);
 const records=await db.prepare('SELECT * FROM workflow_node_receipts WHERE run_id=? AND project_id=? ORDER BY node_id FOR SHARE').all(id,source.project_id);
 const operations=await db.prepare('SELECT id,node_id,state,request_hash FROM workflow_operation_receipts WHERE run_id=? AND project_id=? ORDER BY id FOR SHARE').all(id,source.project_id);
 const plan=planner.plan(source,nodeId,records,operations);
 return {source,plan};
}
async function preview(id,nodeId,user){const {plan}=await inspect(id,nodeId,user);const {seeds,...safe}=plan;return safe;}
async function resume(id,input,user){
 if(!require('../workflows/temporal/control').enabled())throw fail('A durable worker is required to resume.',503);
 if(typeof input.node_id!=='string'||!input.node_id||input.node_id.length>160||! /^[a-f0-9]{64}$/.test(input.source_hash||'')||input.reconciliations!==undefined&&(!Array.isArray(input.reconciliations)||input.reconciliations.length>100||input.reconciliations.some(item=>!item||typeof item!=='object'||Array.isArray(item))))throw fail('Supply a bounded source step, receipt hash and reconciliation list.',400);
 if(!/^[A-Za-z0-9_-]{8,128}$/.test(input.request_id||''))throw fail('Supply a new 8–128 character resume request ID.',400);
 return db.transaction(async()=>{
  await db.prepare('SELECT id FROM agentic_workflow_runs WHERE id=? FOR UPDATE').get(id);
  const {source,plan}=await inspect(id,input.node_id,user);
  if(input.source_hash!==plan.source_hash)throw fail('The source receipts changed. Inspect the resume plan again.');
  const current=await require('./agenticWorkflow.service').getWorkflow(source.workflow_id);
  if(['paused','archived'].includes(current.status)||current.project_id!==source.project_id)throw fail('The workflow is paused, archived or moved. Review its definition first.');
  const reconciliations=plan.reconciliation_required.map(item=>{
   const evidence=(input.reconciliations||[]).find(value=>value.node_id===item.node_id&&(value.operation_id||'')===(item.operation_id||''));
   if(evidence?.disposition!=='not_applied_or_reverted'||typeof evidence.note!=='string'||evidence.note.trim().length<20||evidence.note.length>2000)throw fail('Confirm each uncertain or repeated effect was not applied or was reverted, with a reconciliation note of 20–2,000 characters.');
   return {...item,disposition:evidence.disposition,note:evidence.note.trim(),actor_id:user.id};
  });
  const graph=structuredClone(source.workflow_snapshot);delete graph.runtime_contract;delete graph.execution_order;delete graph.snapped_at;delete graph.execution_mode;
  // Frozen source definition and input are reused; current credentials/access
  // are still checked by normal start/readiness and every dispatched activity.
  return execution.startResumed(graph,{request_id:input.request_id,input_payload:source.input_payload},user,{source_run_id:id,node_id:input.node_id,source_hash:plan.source_hash,seeds:plan.seeds,reconciliations});
 })();
}
module.exports={preview,resume};
