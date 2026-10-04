// This module runs in Temporal's deterministic sandbox. Never import a service,
// database, wall-clock IO, credentials or model client into workflow history.
const { proxyActivities, CancellationScope, isCancellation } = require('@temporalio/workflow');
const { executeReviewNode } = proxyActivities({ startToCloseTimeout: '185 seconds', scheduleToCloseTimeout: '5 minutes',
  heartbeatTimeout: '15 seconds', retry: { maximumAttempts: 3, initialInterval: '1 second', maximumInterval: '5 seconds' } });
const { publishReview } = proxyActivities({ startToCloseTimeout: '15 seconds', retry: { maximumAttempts: 10, maximumInterval: '30 seconds' } });
async function reviewWorkflow(plan) {
  const receipts = [];
  let status = 'completed', reason = null;
  try {
    await CancellationScope.withTimeout(Math.max(1, Date.parse(plan.deadline) - Date.now()), async () => {
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
