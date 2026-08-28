import type { ExecutionResult } from "../types";

export function executionResultInstanceKey(result: ExecutionResult) {
  const iterationKey = String(result.data_set_iteration_key || "").trim()
    || (result.data_set_iteration_index === null || result.data_set_iteration_index === undefined
      ? "default"
      : String(result.data_set_iteration_index));
  return `${result.execution_id}:${result.test_case_id}:${iterationKey}`;
}

const resultTimestamp = (result: ExecutionResult) => {
  const parsed = new Date(result.updated_at || result.created_at || "").getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

export function selectLatestExecutionResultInstances(results: ExecutionResult[]) {
  const latestResultByInstance = new Map<string, ExecutionResult>();

  results.forEach((result) => {
    const instanceKey = executionResultInstanceKey(result);
    const current = latestResultByInstance.get(instanceKey);
    const candidateTimestamp = resultTimestamp(result);
    const currentTimestamp = current ? resultTimestamp(current) : 0;

    if (
      !current
      || candidateTimestamp > currentTimestamp
      || (candidateTimestamp === currentTimestamp && result.id.localeCompare(current.id) > 0)
    ) {
      latestResultByInstance.set(instanceKey, result);
    }
  });

  return Array.from(latestResultByInstance.values());
}
