import type { ExecutionResult, TestStep } from "@hellotest/platform/frontend/src/types";
import { parseExecutionLogs, type ExecutionStepEvidence } from "./executionLogs";
import { selectLatestExecutionResultInstances } from "./executionResultMetrics";

const failurePriority = (status?: string) => status === "failed" ? 2 : status === "blocked" ? 1 : 0;
const resultTimestamp = (result: ExecutionResult) => {
  const timestamp = Date.parse(result.created_at || result.updated_at || "");
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

/** Keep the inspector message and media in one current case/iteration result. */
export function selectExecutionInspectorEvidence<TStep extends Pick<TestStep, "id" | "test_case_id" | "step_order">>({
  executionId,
  testCaseId,
  results,
  steps
}: {
  executionId: string;
  testCaseId: string;
  results: ExecutionResult[];
  steps: TStep[];
}): { result: ExecutionResult | null; step: TStep | null; evidence: ExecutionStepEvidence | null } {
  const result = selectLatestExecutionResultInstances(results.filter((candidate) =>
    candidate.execution_id === executionId && candidate.test_case_id === testCaseId
  )).sort((left, right) =>
    failurePriority(right.status) - failurePriority(left.status)
    || resultTimestamp(right) - resultTimestamp(left)
    || right.id.localeCompare(left.id)
  )[0] || null;
  const logs = parseExecutionLogs(result?.logs || null);
  const step = steps.filter((candidate) => {
    const evidence = logs.stepEvidence?.[candidate.id];
    return candidate.test_case_id === testCaseId && Boolean(evidence?.attachmentId || evidence?.dataUrl);
  }).sort((left, right) =>
    failurePriority(logs.stepStatuses?.[right.id] || logs.stepAutomationDetails?.[right.id]?.status)
      - failurePriority(logs.stepStatuses?.[left.id] || logs.stepAutomationDetails?.[left.id]?.status)
    || right.step_order - left.step_order
    || left.id.localeCompare(right.id)
  )[0] || null;

  return { result, step, evidence: step ? logs.stepEvidence?.[step.id] || null : null };
}
