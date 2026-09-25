const HISTORY_STATUSES = [
  ["passed", "Passed"],
  ["failed", "Failed"],
  ["blocked", "Blocked"],
  ["running", "Running"],
  ["pending", "Pending"],
  ["paused", "Paused"],
  ["aborted", "Aborted"],
  ["skipped", "Skipped"],
  ["not_applicable", "Not applicable"],
  ["unknown", "Unknown"]
] as const;

/** Keep every outcome in the caller's history window in the denominator. */
export function buildHistoryStatusBreakdown(history: ReadonlyArray<{ status?: string | null }>) {
  const counts = new Map<string, number>(HISTORY_STATUSES.map(([key]) => [key, 0]));
  for (const result of history) {
    const status = String(result.status || "").trim().toLowerCase();
    const key = counts.has(status) ? status : "unknown";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return {
    total: history.length,
    segments: HISTORY_STATUSES.map(([key, label]) => ({ key, label, count: counts.get(key) || 0 }))
  };
}

/** Heuristic readiness is a score, so its segments must not imply case counts. */
export function buildReadinessScoreBreakdown(score: number | null) {
  if (score === null || !Number.isFinite(score)) return undefined;
  const value = Math.max(0, Math.min(100, score));
  return {
    total: 100,
    unit: "percent" as const,
    segments: [
      { key: "covered", label: "Readiness score", count: value },
      { key: "pending", label: "Remaining score", count: 100 - value }
    ]
  };
}
