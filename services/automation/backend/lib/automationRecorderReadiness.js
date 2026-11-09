const { prepareExecutablePlan } = require('../services/automationReadiness.service');
const { inferAutomationStepType } = require('@hellotest/platform/backend/src/utils/testStepAutomation');

/** A recording is runnable once its saved instructions are executable. Copied
 * manual expectations do not add assertions or block that recorded plan. */
async function recordedPlanIssues(steps) {
  const prepared = await prepareExecutablePlan(steps.map(step => {
    const type = String(step.step_type || '').trim().toLowerCase();
    return !type || ['manual', 'web', 'api', 'android', 'ios'].includes(type) ? { ...step, step_type: inferAutomationStepType(step) } : step;
  }));
  return prepared.issues;
}

module.exports = { recordedPlanIssues };
