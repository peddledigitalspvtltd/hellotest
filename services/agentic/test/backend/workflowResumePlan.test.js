const test=require('node:test');const assert=require('node:assert/strict');const planner=require('../../backend/workflows/resumePlan');const receipts=require('../../backend/workflows/nodeReceipts');
const source={id:'source',status:'failed',workflow_snapshot:{runtime_contract:{orchestrator:'temporal'},execution_order:['input','work','output'],nodes:[{id:'input',data:{kind:'trigger'}},{id:'work',data:{kind:'transform'}},{id:'output',data:{kind:'output'}}],edges:[{source:'input',target:'work'},{source:'work',target:'output'}]},node_results:[{node_id:'input',status:'completed'},{node_id:'work',status:'failed'},{node_id:'output',status:'queued'}]};
const record=(node_id,status='completed')=>{const result={node_id,node_type:node_id==='input'?'trigger':'transform',status,output:{data:[{value:1}]}};return{node_id,state:'recorded',result,result_hash:receipts.digest(result),request_hash:'original-request'};};
test('resume only reuses verified prior successes and resets selected descendants',()=>{
 const plan=planner.plan(source,'work',[record('input'),record('work','failed')]);
 assert.deepEqual(plan.reuse.map(item=>item.node_id),['input']);assert.deepEqual(plan.rerun,['work','output']);assert.equal(plan.reconciliation_required.length,0);
 assert.throws(()=>planner.plan(source,'work',[{...record('input'),result_hash:'wrong'}]),/integrity/);
 assert.throws(()=>planner.plan(source,'work',[]),/receipt/);
 assert.throws(()=>planner.plan({...source,workflow_snapshot:{...source.workflow_snapshot,runtime_contract:{orchestrator:'local'}}},'work',[]),/development fallback/);
 assert.throws(()=>planner.plan({...source,status:'running'},'work',[]),/stop/);
});
test('uncertain activity and tool effects require explicit manual reconciliation instead of authorizing replay',()=>{
 const plan=planner.plan(source,'work',[record('input'),{node_id:'work',state:'in_flight',request_hash:'dispatch'}],[{id:'op1',node_id:'work',state:'outcome_unknown',request_hash:'effect'}]);
 assert.equal(plan.reconciliation_required.length,2);assert.equal(plan.reuse.length,1);
 assert.ok(plan.reconciliation_required.some(item=>item.operation_id==='op1'));
 const changed=planner.plan(source,'work',[record('input'),{node_id:'work',state:'in_flight',request_hash:'changed'}]);
 assert.notEqual(changed.source_hash,plan.source_hash);
});
test('a connected loop body cannot be independently resumed without its owning composite receipt',()=>{
 const loop={...source,workflow_snapshot:{...source.workflow_snapshot,execution_order:['input','loop','body','output'],nodes:[source.workflow_snapshot.nodes[0],{id:'loop',data:{kind:'loop',loopAction:'workflow'}},{id:'body',data:{kind:'transform'}},source.workflow_snapshot.nodes[2]],edges:[{source:'input',target:'loop'},{source:'loop',target:'body',sourceHandle:'loop'},{source:'body',target:'loop',targetHandle:'continue'},{source:'loop',target:'output',sourceHandle:'done'}]}};
 assert.throws(()=>planner.plan(loop,'body',[]),/owning loop/);
});
