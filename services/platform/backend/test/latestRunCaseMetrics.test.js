const test = require("node:test");
const assert = require("node:assert/strict");
const { summarizeLatestRunCases } = require("../src/utils/latestRunCaseMetrics");

test("latest run counts cases once, replaces retried iterations and respects missing data rows", () => {
  const row = (id, test_case_id, status, index = 0, at = "2026-09-20") => ({ id, test_case_id, status, data_set_iteration_index: index, created_at: at });
  const metric = summarizeLatestRunCases([
    { test_case_id: "passes", expected_iterations: 2 }, { test_case_id: "fails", expected_iterations: 2 },
    { test_case_id: "partial", expected_iterations: 2 }, { test_case_id: "unstarted" }
  ], [
    row("old", "passes", "failed", 0, "2026-09-19"), row("new", "passes", "passed", 0), row("row-two", "passes", "passed", 1),
    row("fail", "fails", "failed", 0), row("pass", "fails", "passed", 1), row("partial", "partial", "passed")
  ]);
  assert.equal(metric.total, 4);
  assert.equal(metric.passed, 1);
  assert.equal(metric.percent, 25);
  assert.equal(metric.counts.failed, 1);
  assert.equal(metric.counts.pending, 2);
  assert.equal(Object.values(metric.counts).reduce((a, b) => a + b, 0), 4);
});

test("latest run preserves N/A, skipped and unknown outcomes and deterministic attempt order", () => {
  const metric = summarizeLatestRunCases([], [
    { id: "na", test_case_id: "na", status: "N/A" }, { id: "skipped", test_case_id: "skipped", status: "skipped" },
    { id: "unknown", test_case_id: "unknown", status: "new_vendor_outcome" },
    { id: "a", test_case_id: "retry", status: "passed", data_set_iteration_index: 0, data_set_iteration_key: "old-key" },
    { id: "z", test_case_id: "retry", status: "queued", data_set_iteration_index: 0, data_set_iteration_key: "new-key" },
    { id: "block", test_case_id: "block", status: " BLOCKED " }, { id: "run", test_case_id: "run", status: "In Progress" }
  ]);
  assert.equal(metric.total, 6);
  assert.equal(metric.percent, 0);
  for (const status of ["not_applicable", "skipped", "unknown", "pending", "blocked", "running"]) assert.equal(metric.counts[status], 1);
});

test("empty runs and unstarted scope do not manufacture a zero pass rate", () => {
  assert.equal(summarizeLatestRunCases().percent, null);
  const scoped = summarizeLatestRunCases([{ test_case_id: "planned" }]);
  assert.equal(scoped.percent, null);
  assert.equal(scoped.counts.pending, 1);
});
