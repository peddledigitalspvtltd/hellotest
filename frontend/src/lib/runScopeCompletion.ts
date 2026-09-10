/** Completion counts finalized data-set instances, using the same basis as run suites. */
export function summarizeRunScopeCompletion(statuses: readonly string[]) {
  const total = statuses.length;
  const finalized = statuses.filter(status => ["passed", "failed", "blocked", "skipped", "aborted", "cancelled"].includes(status)).length;
  const percent = total ? Math.round(finalized / total * 100) : 0;
  const description = total
    ? `${finalized} of ${total} case instances finalized (${percent}%). Passed, failed, blocked, N/A, aborted and cancelled are finalized; running, paused and unexecuted are incomplete.`
    : "No case instances in this scope. Completion is 0%.";
  return { total, finalized, percent, description };
}
