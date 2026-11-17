const receipts=require('./nodeReceipts');
const registry=require('./nodeRegistry');
const fail=message=>Object.assign(new Error(message),{statusCode:409,publicMessage:message});
function plan(source,nodeId,records,operations=[]){
 if(!source||source.workflow_snapshot?.runtime_contract?.orchestrator!=='temporal')throw fail('Resume requires a durable run with verified node receipts. The local development fallback cannot certify prior dispatches.');
 if(!['failed','interrupted','cancelled','needs_review'].includes(source.status))throw fail('Wait for the source run to stop before resuming.');
 const graph=source.workflow_snapshot;
 if(graph.runtime_contract.target_node_id)throw fail('A selected-step execution cannot seed a complete workflow.');
 const bodies=require('@hellotest/platform/backend/src/utils/agenticWorkflowGraph').loopBodies(graph.nodes,graph.edges);
 if(Object.values(bodies).some(ids=>ids.includes(nodeId)))throw fail('Resume from the owning loop node so its batch receipts remain atomic.');
 if(!graph.execution_order.includes(nodeId))throw fail('Choose a step from this saved execution.');
 const reset=new Set([nodeId]), pending=[nodeId];
 while(pending.length){const id=pending.shift();for(const edge of graph.edges.filter(edge=>edge.source===id&&!require('./workflowScheduling').isReturn(edge)))if(!reset.has(edge.target)){reset.add(edge.target);pending.push(edge.target);}}
 for(const owner of Object.keys(bodies))if(reset.has(owner))for(const id of bodies[owner])reset.add(id);
 const byId=new Map(records.map(row=>[row.node_id,row])), seeds=[], checks=[];
 for(const row of records){
  if(row.state==='recorded'&&(!row.result||receipts.digest(row.result)!==row.result_hash||row.result.node_id!==row.node_id))throw fail('A source node receipt failed integrity verification. Restore its original receipt before resuming.');
  if(row.state!=='recorded')checks.push({node_id:row.node_id,reason:'A dispatched activity has no final acknowledgement.'});
 }
 for(const id of graph.execution_order){
  if(Object.values(bodies).some(ids=>ids.includes(id)))continue;
  const row=byId.get(id), projected=source.node_results.find(item=>item.node_id===id);
  if(!reset.has(id)&&row?.state==='recorded'&&['completed','skipped'].includes(row.result.status)){if(receipts.summary(row.result,row.result_hash).needs_review||receipts.summary(row.result,row.result_hash).needs_attention||row.result.fatal)throw fail('A prior step still needs review. Resume from that step first.');seeds.push(row);}
  else if(!reset.has(id)&&!['queued','skipped'].includes(projected?.status||'queued'))throw fail('An earlier or independent step has no reusable successful receipt. Resume from that step instead.');
  if(reset.has(id)&&row?.state==='recorded'&&row.result.status==='completed'){
   const node=graph.nodes.find(item=>item.id===id);
   if(registry.get(node.data.kind)?.isExclusive(node.data))checks.push({node_id:id,reason:'A completed effect-capable step would run again.'});
  }
 }
 for(const operation of operations)if(reset.has(operation.node_id))checks.push({node_id:operation.node_id,operation_id:operation.id,reason:operation.state==='response_received'?'A tool response was recorded; repeating it may repeat an effect.':'A tool effect may already have happened.'});
 // Every reused dependency must be certified. Never substitute the mutable UI
 // node_results projection for an activity receipt.
 for(const edge of graph.edges.filter(edge=>reset.has(edge.target)&&!reset.has(edge.source)&&!require('./workflowScheduling').isReturn(edge)))if(!seeds.some(seed=>seed.node_id===edge.source))throw fail('A required prior dependency has no verified reusable receipt. Resume from that dependency instead.');
 for(const result of source.node_results.filter(item=>reset.has(item.node_id))){
  const pending=[result];let published=false;while(pending.length){const item=pending.pop();if(!item||typeof item!=='object')continue;if(item.saved===true&&typeof item.id==='string'&&item.id.trim()){published=true;break;}pending.push(...Object.values(item).filter(value=>value&&typeof value==='object'));}
  if(published)checks.push({node_id:result.node_id,reason:'This step saved native artifacts. Reconcile or remove those artifacts before generating them again.'});
 }
 const unique=[...new Map(checks.map(check=>[`${check.node_id}:${check.operation_id||''}`,check])).values()];
 return {node_id:nodeId,reuse:seeds.map(row=>({node_id:row.node_id,status:row.result.status,result_hash:row.result_hash})),rerun:[...reset],reconciliation_required:unique,seeds,
 source_hash:receipts.digest({run_id:source.id,snapshot:graph,records:records.map(row=>({node_id:row.node_id,state:row.state,result_hash:row.result_hash,request_hash:row.request_hash})),operations:operations.map(row=>({id:row.id,state:row.state,request_hash:row.request_hash}))})};
}
module.exports={plan};
