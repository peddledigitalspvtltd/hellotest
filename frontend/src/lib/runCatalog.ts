import type { Execution } from "../types";

export const isRunFinished = (run: Pick<Execution, "status" | "ended_at">) => Boolean(run.ended_at) || ["completed", "passed", "failed", "blocked", "skipped", "cancelled", "aborted", "partially_completed"].includes(run.status || "");

export const runCatalogBucket = (run: Pick<Execution, "trigger">): "suite-runs" | "local-runs" => run.trigger === "local" ? "local-runs" : "suite-runs";

export const normalizeRunCatalogView = (view: string | null) => view === "test-case-runs" ? "suite-runs" : view;

export function runStoryCounts(run: Execution, fallback: { failedRequirementCount: number; totalRequirements: number }) {
  return { failed: run.metrics?.failed_story_count ?? fallback.failedRequirementCount, total: run.metrics?.story_count ?? fallback.totalRequirements };
}
