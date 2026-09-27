import type { TestStep } from "@hellotest/platform/frontend/src/types";

export function isAutomationStepMapped(step: Pick<TestStep, "automation_code" | "api_request" | "step_type">) {
  if (step.step_type === "api") return Boolean(step.api_request?.url?.trim());
  const executable = String(step.automation_code || "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/[^\n]*$/gm, "").trim();
  return Boolean(executable);
}

export function automationMappingFieldsEqual(left: Record<string, unknown>, right: Record<string, unknown>) {
  return ["step_type", "keyword", "objectRef", "value", "apiMethod", "apiHeaders", "apiBodyMode", "apiExpectedStatus"]
    .every((key) => left[key] === right[key]);
}

export function automationCaseMappingStatus(steps: Array<Pick<TestStep, "automation_code" | "api_request" | "step_type">>) {
  return steps.length > 0 && steps.every(isAutomationStepMapped) ? "ready" as const : "incomplete" as const;
}

/** Cache the durable insertion while the authoritative list is being reloaded. */
export function cacheCreatedAutomationStep(steps: TestStep[], created: TestStep) {
  if (steps.some((step) => step.id === created.id)) return steps;
  const insertionOrder = Math.max(1, Math.min(created.step_order, steps.length + 1));
  return [
    ...steps.map((step) => step.step_order >= insertionOrder ? { ...step, step_order: step.step_order + 1 } : step),
    { ...created, step_order: insertionOrder }
  ].sort((left, right) => left.step_order - right.step_order);
}

/** A reload/status failure must never turn a successful insertion into a retry. */
export async function refreshCreatedAutomationStep(created: TestStep, refresh: (step: TestStep) => Promise<TestStep>): Promise<{ step: TestStep; refreshError: unknown }> {
  try {
    return { step: await refresh(created), refreshError: null };
  } catch (refreshError) {
    return { step: created, refreshError };
  }
}

/** A scalar editor can only replace the complete program it originally generated. */
export function resolveAutomationMappingSave(input: {
  currentCode: string;
  previousMappingCode: string;
  nextMappingCode: string;
  mappingUnchanged: boolean;
}) {
  if (input.mappingUnchanged) return { code: input.currentCode, requiresProgramEditor: false };

  // Only the leading options comment belongs to the outer section editor.
  // Preserve all other comments, expressions, helpers and recorded instructions.
  const comparable = (value: string) => value.replace(/\r\n/g, "\n")
    .replace(/^\s*\/\/\s*@hellotest-options\s+[^\n]*\n?/i, "").trim();
  const current = comparable(input.currentCode);
  const safelyReplaceable = !current || current === comparable(input.previousMappingCode);
  return {
    code: safelyReplaceable ? input.nextMappingCode : input.currentCode,
    requiresProgramEditor: !safelyReplaceable
  };
}

/** Carry the current inline draft into the full editor without replacing custom source. */
export function buildAutomationEditorStep(input: {
  step: TestStep;
  draft: { name: string; expected_result: string; step_type: TestStep["step_type"] };
  currentCode: string;
  previousMappingCode: string;
  nextMappingCode: string;
  mappingUnchanged: boolean;
  apiRequest: TestStep["api_request"];
}): TestStep {
  const mapping = resolveAutomationMappingSave(input);
  return {
    ...input.step,
    action: input.draft.name,
    expected_result: input.draft.expected_result,
    step_type: input.draft.step_type,
    automation_code: mapping.code,
    api_request: input.draft.step_type === "api" ? input.apiRequest : null
  };
}

/** Move within a group, or move the complete group past its adjacent group. */
export function getAutomationStepReorder(steps: TestStep[], stepId: string, direction: "up" | "down") {
  const ordered = [...steps].sort((left, right) => left.step_order - right.step_order || left.id.localeCompare(right.id));
  const index = ordered.findIndex((step) => step.id === stepId);
  const offset = direction === "up" ? -1 : 1;
  const targetIndex = index + offset;
  if (index < 0 || targetIndex < 0 || targetIndex >= ordered.length) return null;
  if (new Set(ordered.map((step) => step.id)).size !== ordered.length) return null;

  const precondition = (step: TestStep) => (step.group_name || "").trim().toLowerCase() === "preconditions";
  const groups: TestStep[][] = [];
  const seenGroupIds = new Set<string>();
  let reachedMainSteps = false;
  for (const step of ordered) {
    const isPrecondition = precondition(step);
    if (isPrecondition && reachedMainSteps) return null;
    if (!isPrecondition) reachedMainSteps = true;
    const previous = groups[groups.length - 1];
    if (step.group_id && previous?.[0].group_id === step.group_id) {
      if (precondition(previous[0]) !== isPrecondition) return null;
      previous.push(step);
    } else {
      // A split legacy group needs explicit repair, not an order change that
      // lets shared-group synchronization overwrite an intervening step.
      if (step.group_id && seenGroupIds.has(step.group_id)) return null;
      if (step.group_id) seenGroupIds.add(step.group_id);
      groups.push([step]);
    }
  }

  const step = ordered[index];
  const target = ordered[targetIndex];
  if (precondition(step) !== precondition(target)) return null;
  if (step.group_id && step.group_id === target.group_id) {
    const stepIds = ordered.map((item) => item.id);
    [stepIds[index], stepIds[targetIndex]] = [stepIds[targetIndex], stepIds[index]];
    return { stepIds, movedStepIds: [stepId] };
  }

  const groupIndex = groups.findIndex((group) => group.some((item) => item.id === stepId));
  const targetGroupIndex = groupIndex + offset;
  if (targetGroupIndex < 0 || targetGroupIndex >= groups.length) return null;
  const movedStepIds = groups[groupIndex].map((item) => item.id);
  [groups[groupIndex], groups[targetGroupIndex]] = [groups[targetGroupIndex], groups[groupIndex]];
  return { stepIds: groups.flatMap((group) => group.map((item) => item.id)), movedStepIds };
}

export function getAutomationStepInsertion(steps: TestStep[], placement: { mode: "end" | "before" | "after"; stepId: string }, isPrecondition: boolean) {
  const precondition = (step: TestStep) => (step.group_name || "").trim().toLowerCase() === "preconditions";
  const preconditionCount = steps.filter(precondition).length;
  const targetIndex = placement.mode === "end" ? -1 : steps.findIndex((step) => step.id === placement.stepId);
  const requestedIndex = targetIndex < 0 ? steps.length : targetIndex + (placement.mode === "after" ? 1 : 0);
  const insertionIndex = isPrecondition ? Math.min(preconditionCount, requestedIndex) : Math.max(preconditionCount, requestedIndex);
  const groupSource = isPrecondition
    ? steps.find((step) => precondition(step) && Boolean(step.group_id))
    : targetIndex >= 0 && !precondition(steps[targetIndex]) ? steps[targetIndex] : undefined;
  return { insertionIndex, groupSource };
}
