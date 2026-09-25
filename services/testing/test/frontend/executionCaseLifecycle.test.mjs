import test from "node:test";
import assert from "node:assert/strict";
import { getExecutionResultDurationMs } from "../../frontend/lib/executionCaseLifecycle.ts";
import { selectLatestExecutionResultInstances } from "../../frontend/lib/executionResultMetrics.ts";

test("persisted case timers advance only for an active running segment", () => {
  const start = Date.parse("2026-09-10T10:00:00Z");
  const result = { duration_ms: 4000, timer_started_at: new Date(start).toISOString(), status: "running" };
  assert.equal(getExecutionResultDurationMs(result, start + 1500), 5500);
  for (const status of ["pending", "paused", "passed", "failed", "blocked", "aborted", "skipped"]) assert.equal(getExecutionResultDurationMs({ ...result, status }, start + 60000), 4000);
  assert.equal(getExecutionResultDurationMs({ ...result, timer_started_at: null }, start + 60000), 4000);
  assert.equal(getExecutionResultDurationMs(result, start - 1000), 4000, "Clock skew cannot subtract already recorded work");
  assert.equal(getExecutionResultDurationMs(null, start), 0);
});

test("editing an older attempt cannot replace the latest reset or another data row", () => {
  const base = { execution_id: "run", test_case_id: "case", data_set_iteration_key: "data:1" };
  const old = { ...base, id: "old", status: "failed", created_at: "2026-09-10T10:00:00Z", updated_at: "2026-09-10T12:00:00Z" };
  const reset = { ...base, id: "reset", status: "pending", created_at: "2026-09-10T11:00:00Z" };
  const otherRow = { ...base, id: "other", data_set_iteration_key: "data:2", status: "passed", created_at: "2026-09-10T10:00:00Z" };
  assert.deepEqual(selectLatestExecutionResultInstances([old, reset, otherRow]).map(result => result.id).sort(), ["other", "reset"]);
});

test("legacy and canonical data keys with the same iteration index resolve to one current attempt", () => {
  const base = { execution_id: "run", test_case_id: "case", data_set_iteration_index: 0 };
  const old = { ...base, id: "old", data_set_iteration_key: "data:0", status: "passed", created_at: "2026-09-10T10:00:00Z" };
  const reset = { ...base, id: "reset", data_set_iteration_key: "data:1", status: "pending", created_at: "2026-09-10T11:00:00Z" };
  assert.deepEqual(selectLatestExecutionResultInstances([reset, old]).map(result => result.id), ["reset"]);
});
