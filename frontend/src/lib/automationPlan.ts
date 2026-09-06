import type { TestStep, TestCase, StepApiRequest } from "../types";
import { getAutomationKeywordInputSpec } from "./automationKeywordInputs";

export const isAutomationPrecondition = (step: Pick<TestStep, "group_name">) => (step.group_name || "").trim().toLowerCase() === "preconditions";

export function seedAutomationPlan(sources: Array<{ testCase: Pick<TestCase, "id">; steps: TestStep[] }>, createId: () => string) {
  const groupIds = new Map<string, string>();
  const steps = sources.flatMap((source) => source.steps.map((step) => {
    const key = step.group_id ? `${source.testCase.id}:${step.group_id}` : "";
    if (key && !groupIds.has(key)) groupIds.set(key, createId());
    return {
      action: step.action || "", expected_result: step.expected_result || "", step_type: step.step_type || "web",
      automation_code: step.automation_code || undefined, api_request: step.api_request || undefined,
      group_id: key ? groupIds.get(key) : undefined, group_name: step.group_name || undefined,
      group_kind: step.group_kind || undefined, reusable_group_id: step.reusable_group_id || undefined
    };
  }));
  return steps.sort((left, right) => Number(isAutomationPrecondition(right)) - Number(isAutomationPrecondition(left)))
    .map((step, index) => ({ ...step, step_order: index + 1 }));
}

export function automationMappingIsComplete(draft: { keyword: string; objectRef: string; value: string; apiMethod?: StepApiRequest["method"] }) {
  if (draft.keyword === "api.request") return Boolean(draft.objectRef.trim());
  if (draft.keyword === "api.expectStatus") return /^[1-5]\d\d$/.test(draft.objectRef.trim());
  const spec = getAutomationKeywordInputSpec(draft.keyword);
  return (!spec.targetRequired || Boolean(draft.objectRef.trim())) && (!spec.valueRequired || Boolean(draft.value.trim()));
}

export function getAutomationSchedule(value: string, now = Date.now()) {
  if (!value.trim()) return undefined;
  const scheduled = new Date(value);
  if (!Number.isFinite(scheduled.getTime()) || scheduled.getTime() <= now) throw new Error("Choose a future date and time for the build.");
  return scheduled.toISOString();
}
