const STATUS_PRIORITY = Object.freeze({ passed: 1, not_applicable: 2, skipped: 3, pending: 4, unknown: 5, paused: 6, running: 7, aborted: 8, blocked: 9, failed: 10 });

function normalizeCaseStatus(value) {
  const status = String(value || "").trim().toLowerCase().replace(/[ -]+/g, "_");
  if (["n/a", "na", "not_applicable"].includes(status)) return "not_applicable";
  if (["not_run", "not_started", "queued", "pending"].includes(status)) return "pending";
  if (["in_progress", "running", "retrying"].includes(status)) return "running";
  if (["cancelled", "canceled", "aborted"].includes(status)) return "aborted";
  return Object.hasOwn(STATUS_PRIORITY, status) ? status : "unknown";
}

// A Test Case contributes once. Retried rows replace the same iteration, and
// unfinished data rows prevent a partial pass from becoming a whole-case pass.
function summarizeLatestRunCases(caseRows = [], resultRows = []) {
  const cases = new Map(caseRows.map(row => [row.test_case_id, { expected: Math.max(1, Number(row.expected_iterations) || 1), iterations: new Map() }]));
  for (const row of resultRows) {
    if (!row.test_case_id) continue;
    if (!cases.has(row.test_case_id)) cases.set(row.test_case_id, { expected: 1, iterations: new Map() });
    const iterations = cases.get(row.test_case_id).iterations;
    const key = String(row.data_set_iteration_index ?? row.data_set_iteration_key ?? "default");
    const previous = iterations.get(key);
    const currentAt = Number(new Date(row.created_at || 0)) || 0;
    const previousAt = Number(new Date(previous?.created_at || 0)) || 0;
    if (!previous || currentAt > previousAt || currentAt === previousAt && String(row.id) > String(previous.id)) iterations.set(key, row);
  }
  const counts = Object.fromEntries(Object.keys(STATUS_PRIORITY).map(status => [status, 0]));
  for (const { expected, iterations } of cases.values()) {
    let status = iterations.size < expected ? "pending" : "passed";
    for (const row of iterations.values()) {
      const candidate = normalizeCaseStatus(row.status);
      if (STATUS_PRIORITY[candidate] > STATUS_PRIORITY[status]) status = candidate;
    }
    counts[status]++;
  }
  const total = cases.size;
  return { total, passed: counts.passed, percent: total && resultRows.length ? Math.round(counts.passed / total * 100) : null, counts };
}

module.exports = { normalizeCaseStatus, summarizeLatestRunCases };
