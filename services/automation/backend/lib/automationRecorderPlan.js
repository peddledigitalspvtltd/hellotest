const { createHash } = require('node:crypto');

// Plan ownership is independent of case parameter edits made during capture.
// No action text, code or private data is included in the transaction receipt.
function recorderPlanFingerprint(steps) {
  const plan = steps.map(step => [step.id, step.step_order, step.step_type, step.action, step.expected_result,
    step.automation_code, step.api_request, step.group_id, step.group_name, step.group_kind, step.reusable_group_id]);
  return createHash('sha256').update(JSON.stringify(plan)).digest('hex');
}

module.exports = { recorderPlanFingerprint };
