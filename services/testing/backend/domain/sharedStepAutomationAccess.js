const { isDeepStrictEqual } = require("node:util");
const { createHash } = require("node:crypto");
const { normalizeSharedSteps } = require("./sharedStepDefinition");

const publicSharedStepImplementation = (group) => ({
  ...group,
  automation_source_hidden: true,
  steps: (group.steps || []).map(step => ({ ...step, automation_code: "", api_request: null, automation_source_hidden: true }))
});

const preserveHiddenSharedStepImplementation = (steps, existingSteps = []) => {
  if (!Array.isArray(steps)) return steps;
  const byId = new Map(existingSteps.map(step => [step.id, step]));
  return steps.map((step, index) => {
    if (!step || typeof step !== "object") return step;
    const previous = step.id ? byId.get(step.id) : existingSteps[index];
    if (!previous) return step;
    return { ...step,
      ...(!step.automation_code && !step.automationCode ? { automation_code: previous.automation_code } : {}),
      ...(!step.api_request && !step.apiRequest ? { api_request: previous.api_request } : {})
    };
  });
};

const sharedStepImplementationChanged = (steps, existingSteps = []) => {
  const signature = values => normalizeSharedSteps(values).filter(step => step.automation_code || step.api_request).map(step => ({
    id: step.id || null, step_type: step.step_type, automation_code: step.automation_code, api_request: step.api_request
  }));
  return !isDeepStrictEqual(signature(steps), signature(existingSteps));
};

const sharedStepImplementationFingerprint = (steps) => createHash("sha256").update(JSON.stringify(normalizeSharedSteps(steps).map(step => ({
  id: step.id || null, step_type: step.step_type, automation_code: step.automation_code, api_request: step.api_request
})))).digest("hex");

module.exports = { publicSharedStepImplementation, preserveHiddenSharedStepImplementation, sharedStepImplementationChanged, sharedStepImplementationFingerprint };
