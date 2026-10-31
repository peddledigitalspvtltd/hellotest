// This module runs in Temporal's deterministic sandbox. Never import a service,
// database, wall-clock IO, credentials or model client into workflow history.
const { proxyActivities, CancellationScope, isCancellation } = require('@temporalio/workflow');
const scheduling = require('../workflowScheduling');
const { executeReviewNode } = proxyActivities({ startToCloseTimeout: '60 minutes', scheduleToCloseTimeout: '65 minutes',
  heartbeatTimeout: '15 seconds', retry: { maximumAttempts: 3, initialInterval: '1 second', maximumInterval: '5 seconds' } });
const { publishReview } = proxyActivities({ startToCloseTimeout: '15 seconds', retry: { maximumAttempts: 10, maximumInterval: '30 seconds' } });
async function reviewWorkflow(plan) {
  const receipts = [];
  let status = 'completed', reason = null;
  try {
    await CancellationScope.withTimeout(Math.max(1, Date.parse(plan.deadline) - Date.now()), async () => {
      // Old accepted plans retain their original activity command sequence so
      // an upgraded worker can replay and finish their existing histories.
      if (plan.scheduler_version === 2) {
        const bodyIds = new Set(plan.nodes.flatMap(node => node.body_ids || []));
        const pending = new Set(plan.nodes.filter(node => !bodyIds.has(node.id)).map(node => node.id));
        while (pending.size) {
          const batch = scheduling.readyBatch({ nodes: plan.nodes, edges: plan.edges, results: receipts, pending, maxParallel: plan.processing?.max_parallel_nodes || 1 });
          if (!batch.length) throw new Error('Workflow dependency scheduling failed.');
          const outcomes = await Promise.allSettled(batch.map(node => executeReviewNode({ runId: plan.runId, nodeId: node.id,
            shouldRun: node.kind === 'trigger' || plan.edges.filter(edge => edge.target === node.id).some(edge => scheduling.selectedEdge(edge, receipts.find(item => item.node_id === edge.source), node.kind)), receipts: [...receipts] })));
          for (let index = 0; index < batch.length; index++) {
            const outcome = outcomes[index];
            if (outcome.status !== 'fulfilled') continue;
            receipts.push(outcome.value); pending.delete(batch[index].id);
          }
          const rejected = outcomes.find(outcome => outcome.status === 'rejected');
          if (rejected) throw rejected.reason;
          if (receipts.some(receipt => receipt.fatal)) { status = 'failed'; reason = receipts.find(receipt => receipt.fatal).error_code; break; }
          if (receipts.some(receipt => receipt.needs_review)) { status = 'needs_review'; break; }
          if (receipts.some(receipt => receipt.needs_attention)) status = 'needs_review';
        }
        return;
      }
      for (const node of plan.nodes) {
        const active = node.kind === 'trigger' || plan.edges.filter(edge => edge.target === node.id).some(edge => {
          const prior = receipts.find(item => item.node_id === edge.source);
          if (node.kind === 'errorHandler') return prior?.status === 'failed';
          return prior?.status === 'completed' && (prior.kind !== 'condition' || prior.matched === (edge.sourceHandle !== 'false'));
        });
        const receipt = await executeReviewNode({ runId: plan.runId, nodeId: node.id, shouldRun: active, receipts });
        receipts.push(receipt);
        if (receipt.fatal) { status = 'failed'; reason = receipt.error_code; break; }
        if (receipt.needs_review) { status = 'needs_review'; break; }
        if (receipt.needs_attention) status = 'needs_review';
      }
    });
  } catch (error) {
    status = isCancellation(error) ? (Date.now() >= Date.parse(plan.deadline) ? 'interrupted' : 'cancelled') : 'interrupted';
    reason = status === 'cancelled' ? 'WORKFLOW_CANCELLED' : 'WORKFLOW_INTERRUPTED';
  }
  // Cancellation is a Temporal command. Persist the final UI projection even
  // when the workflow's cancellable scope has been stopped.
  await CancellationScope.nonCancellable(() => publishReview({ runId: plan.runId, receipts, status, reason }));
  return { run_id: plan.runId, status };
}
module.exports = { reviewWorkflow };
