import type { ExecutionResult } from "@hellotest/platform/frontend/src/types";

export type ExecutionCaseLifecycleAction = "start" | "resume" | "pause" | "abort" | "block" | "skip" | "reset" | "pass" | "fail";
export type ExecutionCaseIdentity = { execution_id: string; test_case_id: string; data_set_iteration_index?: number | null; data_set_iteration_key?: string | null };
export const EXECUTION_CASE_FINAL_STATUSES = ["passed", "failed", "blocked", "aborted", "skipped"] as const;
export const EXECUTION_CASE_STATUS_LABELS: Record<ExecutionResult["status"], string> = {
  pending: "Unexecuted", running: "Running", paused: "Paused", passed: "Passed", failed: "Failed", blocked: "Blocked", aborted: "Aborted", skipped: "N/A"
};

/** Active time belongs to the persisted result, independently of opened screens. */
export function getExecutionResultDurationMs(result?: Partial<ExecutionResult> | null, now = Date.now()) {
  const accumulated = Math.max(0, Number(result?.duration_ms) || 0);
  const startedAt = result?.timer_started_at ? new Date(result.timer_started_at).getTime() : NaN;
  return Math.round(accumulated + (result?.status === "running" && Number.isFinite(startedAt) ? Math.max(0, now - startedAt) : 0));
}
