
const graphContract=require('@hellotest/platform/backend/src/utils/agenticWorkflowGraph');
const scheduling=require('../workflowScheduling');
const {contextFor}=require('./shared/values');
const {collectReviews,reviewSource}=require('./shared/reviewContext');
const {verificationId,needsExecutionReview}=require('../automationResult');
async function execute({run,node,sources}){
    const ancestors = new Set();
    const bodies = graphContract.loopBodies(run.workflow_snapshot.nodes, run.workflow_snapshot.edges);
    const visit = id => {
      for (const edge of run.workflow_snapshot.edges.filter(item => item.target === id && !scheduling.isReturn(item))) {
        if (!ancestors.has(edge.source)) { ancestors.add(edge.source); visit(edge.source); }
      }
      for (const child of bodies[id] || []) if (!ancestors.has(child)) { ancestors.add(child); visit(child); }
    };
    visit(node.id);
    const results = run.node_results.filter(item=>ancestors.has(item.node_id));
    const snapshots = results.flatMap(item=>item.iterations?.length ? item.iterations : [item]);
    const batchFailures = snapshots.flatMap(item=>item.output?.iteration_failures || []);
    const counts = {verified:0,unverified:0,failed:0,needs_input:0};
    let executionReviewCount = 0;
    let hasAutomation = false;
    for (const item of snapshots) {
      const output = item.output;
      if (output?.artifact_task !== 'automation-engineer') continue;
      hasAutomation = true;
      const rows = Array.isArray(output.data) ? output.data : output.data ? [output.data] : [];
      for (const row of rows) {
        const generated = Array.isArray(row.automation) ? row.automation : [row.automation];
        for (const draft of generated.filter(Boolean)) {
          counts[verificationId(draft) ? 'verified' : 'unverified']++;
          if (needsExecutionReview(draft)) executionReviewCount++;
        }
        counts.failed += Array.isArray(row.automation_failures) ? row.automation_failures.filter(Boolean).length : Number(Boolean(row.automation_failure));
        counts.needs_input += Array.isArray(row.automation_input_required) ? row.automation_input_required.filter(Boolean).length : Number(Boolean(row.automation_input_required));
      }
    }
    return {reviews:collectReviews(results.filter(reviewSource)),data:contextFor(run,sources).input,
      sources:sources.map(source=>({node_id:source.node_id,node_name:source.node_name,output_key:source.output_key,status:source.status})),
      ...(hasAutomation ? {automation_counts:counts} : {}),
      ...(executionReviewCount ? {automation_execution_review_count:executionReviewCount} : {}),
      ...(batchFailures.length ? {iteration_failures:batchFailures} : {}),requires_human_review:true};
}
module.exports=require("./definition")("output",{connectionPolicy:{incoming:'required',outgoing:'forbidden'},validate:()=>[],execute});
