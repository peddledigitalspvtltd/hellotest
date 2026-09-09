/** Completion counts finalized data-set instances, using the same basis as run suites. */
export function summarizeRunScopeCompletion(statuses: readonly string[]) {
  const total = statuses.length;
  const finalized = statuses.filter(status => status === "passed" || status === "failed" || status === "blocked").length;
  const percent = total ? Math.round(finalized / total * 100) : 0;
  const description = total
    ? `${finalized} of ${total} case instances finalized (${percent}%). Passed, failed, and blocked are finalized; running and not started are incomplete.`
    : "No case instances in this scope. Completion is 0%.";
  return { total, finalized, percent, description };
}
