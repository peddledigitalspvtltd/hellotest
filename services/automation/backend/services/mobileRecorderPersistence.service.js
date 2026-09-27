const { buildMobileRecorderPlan } = require("../domain/mobileRecorderPlan");

/** The caller supplies its transaction and storage ports; this service owns the
 * atomic save boundary, and never starts a browser or contacts an LLM. */
async function persistMobileRecorderPlan(input, { transaction, lockCase, readSteps, updateStep, createStep, updateCaseReadiness }) {
  return transaction(async () => {
    if (!await lockCase(input.caseId)) throw Object.assign(new Error("The recorder case no longer exists."), { code: "AUTOMATION_RECORDER_CASE_MISSING", statusCode: 404 });
    const existingSteps = await readSteps(input.caseId);
    const changes = buildMobileRecorderPlan({ ...input, existingSteps });
    const results = [];
    for (const change of changes) {
      let stepId = change.stepId;
      if (change.operation === "updated") await updateStep(stepId, change.input, { syncSharedGroup: false });
      else {
        const created = await createStep(change.input, { syncSharedGroup: false });
        if (!created?.id) throw new Error("The recorder step was not saved. Retry the recording save.");
        stepId = created.id;
      }
      results.push({ step_id: stepId, ...change.result, operation: change.operation });
    }
    if (results.length) await updateCaseReadiness(input.caseId);
    return results;
  });
}

module.exports = { persistMobileRecorderPlan };
