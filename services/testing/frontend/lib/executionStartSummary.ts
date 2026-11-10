export type ExecutionStartResponse = {
  started: boolean;
  automated_case_count?: number;
  queued_for_engine_count?: number;
  local_run_count?: number;
  execution_mode?: "local" | "remote";
  acknowledgement?: "unknown" | "accepted";
  manual_case_count?: number;
  unsupported_automated_case_count?: number;
  warnings?: string[];
};

const formatCount = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

export function summarizeExecutionStart(
  response: ExecutionStartResponse,
  fallback = "Run started."
) {
  if (!response?.started) {
    return fallback;
  }

  const queuedForEngineCount = Number(response.queued_for_engine_count) || 0;
  const localRunCount = Number(response.local_run_count) || 0;
  const manualCaseCount = Number(response.manual_case_count) || 0;
  const unsupportedAutomatedCaseCount = Number(response.unsupported_automated_case_count) || 0;
  const parts: string[] = [];

  if (queuedForEngineCount > 0) {
    parts.push(`${formatCount(queuedForEngineCount, "automated case")} queued to Test Engine`);
  }

  if (localRunCount > 0) {
    parts.push(`${formatCount(localRunCount, "automated case")} started locally`);
  }

  if (manualCaseCount > 0) {
    parts.push(`${formatCount(manualCaseCount, "manual case")} ready in HelloTest`);
  }

  if (unsupportedAutomatedCaseCount > 0) {
    parts.push(`${formatCount(unsupportedAutomatedCaseCount, "automated case")} could not be dispatched`);
  }

  const firstWarning = Array.isArray(response.warnings) ? response.warnings.find(Boolean) : "";

  if (firstWarning) {
    parts.push(firstWarning);
  }

  return parts.length ? `${fallback} ${parts.map(part => part.replace(/\.+$/, "")).join(". ")}.` : fallback;
}
