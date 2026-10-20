const { normalizeApiRequest, normalizeRichText, normalizeTestStepType } = require("@hellotest/platform/backend/src/utils/testStepAutomation");
const { createHash, randomUUID } = require("node:crypto");

const normalizeText = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
};

const normalizeSharedSteps = (steps = []) => {
  if (!Array.isArray(steps)) {
    return [];
  }

  return steps
    .map((step, index) => ({
      ...(normalizeText(step?.id) ? { id: normalizeText(step.id) } : {}),
      step_order: Number.isFinite(Number(step?.step_order)) ? Number(step.step_order) : index + 1,
      action: normalizeText(step?.action),
      expected_result: normalizeText(step?.expected_result || step?.expectedResult),
      step_type: normalizeTestStepType(step?.step_type || step?.stepType, "web"),
      automation_code: normalizeRichText(step?.automation_code || step?.automationCode),
      api_request: normalizeApiRequest(step?.api_request || step?.apiRequest)
    }))
    .filter((step) => step.action || step.expected_result || step.automation_code || step.api_request)
    .sort((left, right) => left.step_order - right.step_order)
    .map((step, index) => ({
      ...step,
      step_order: index + 1
    }));
};

// Legacy definitions did not persist IDs. Derive a stable, group-owned ID on
// read, then persist it on the next save. A name change cannot change identity.
const sharedStepsWithIds = (steps, groupId) => {
  const used = new Set();
  return normalizeSharedSteps(steps).map((step, index) => {
    const candidate = step.id;
    const id = candidate && !used.has(candidate) ? candidate : `shared-section-${createHash("sha256").update(`${groupId}\0${index}`).digest("hex").slice(0, 32)}`;
    used.add(id);
    return { ...step, id };
  });
};

// Draft IDs are local UI handles, not authority to adopt another group's
// section. Only IDs already owned by this definition survive an update.
const reconcileSharedStepIds = (steps, previousSteps, groupId) => {
  const previous = sharedStepsWithIds(previousSteps, groupId);
  const owned = new Set(previous.map(step => step.id));
  const used = new Set();
  return normalizeSharedSteps(steps).map((step, index) => {
    const candidate = step.id || previous[index]?.id;
    if (candidate && owned.has(candidate) && used.has(candidate)) {
      throw Object.assign(new Error("A Shared Section Group cannot contain the same section twice. Duplicate it to create a separate section."), { statusCode: 400, code: "SHARED_SECTION_ID_DUPLICATE" });
    }
    const id = candidate && owned.has(candidate) ? candidate : randomUUID();
    used.add(id);
    return { ...step, id };
  });
};

const definitionKey = ({ action, expected_result, step_type, automation_code, api_request }) =>
  JSON.stringify({ action, expected_result, step_type, automation_code, api_request });

// Case references have their own row IDs. Resolve those against the pre-edit
// instance when supplied; exact definitions provide a legacy-compatible
// fallback for clients that save an entire case in one request.
const sharedStepsFromReference = (steps, previousSteps, groupId, previousReferenceSteps) => {
  const previous = sharedStepsWithIds(previousSteps, groupId);
  const normalized = normalizeSharedSteps(steps);
  const byReferenceId = new Map((previousReferenceSteps || []).map((step, index) => [step.id, previous[index]?.id]));
  const used = new Set();
  const resolved = normalized.map(step => {
    const id = byReferenceId.get(step.id);
    if (!id || used.has(id)) return { ...step, id: undefined };
    used.add(id);
    return { ...step, id };
  });
  for (const step of resolved.filter(step => !step.id)) {
    const match = previous.find(candidate => !used.has(candidate.id) && definitionKey(candidate) === definitionKey(step));
    if (match) { step.id = match.id; used.add(match.id); }
  }
  for (const [index, step] of resolved.entries()) {
    if (step.id) continue;
    const candidate = previous[index];
    if (candidate && !used.has(candidate.id)) { step.id = candidate.id; used.add(candidate.id); }
    else step.id = randomUUID();
  }
  return resolved;
};

module.exports = { normalizeSharedSteps, sharedStepsWithIds, reconcileSharedStepIds, sharedStepsFromReference };
