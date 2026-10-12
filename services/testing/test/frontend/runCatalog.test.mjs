import assert from "node:assert/strict";
import test from "node:test";
import { isRunFinished, normalizeRunCatalogView, runCatalogBucket, runStoryCounts } from "../../frontend/lib/runCatalog.ts";

test("suite and independent case runs share one catalog without changing run scope", () => {
  for (const trigger of ["manual", "ci", "schedule", undefined]) {
    for (const suite_ids of [[], ["suite-a"]]) {
      const run = { trigger, suite_ids, test_case_ids: ["case-a"] };
      const before = structuredClone(run);
      assert.equal(runCatalogBucket(run), "suite-runs");
      assert.deepEqual(run, before);
    }
  }
  assert.equal(runCatalogBucket({ trigger: "local" }), "local-runs");
});

test("legacy catalog links resolve to Suite Runs while other routes stay intact", () => {
  assert.equal(normalizeRunCatalogView("test-case-runs"), "suite-runs");
  assert.equal(normalizeRunCatalogView(null), "suite-runs");
  assert.equal(normalizeRunCatalogView(""), "suite-runs");
  for (const view of ["suite-runs", "local-runs", "scheduled-runs"]) {
    assert.equal(normalizeRunCatalogView(view), view);
  }
});

test("terminal status or recorded completion disables editing", () => {
  for (const status of ["completed", "passed", "failed", "blocked", "skipped", "cancelled", "aborted", "partially_completed"]) assert.equal(isRunFinished({ status }), true);
  for (const status of ["queued", "running", "retrying"]) {
    assert.equal(isRunFinished({ status }), false);
    assert.equal(isRunFinished({ status, ended_at: "2026-09-09T12:00:00Z" }), true);
  }
});

test("story ratios prefer complete backend counts including zero failed stories", () => {
  const fallback = { failedRequirementCount: 7, totalRequirements: 8 };
  assert.deepEqual(runStoryCounts({ metrics: { failed_story_count: 0, story_count: 3 } }, fallback), { failed: 0, total: 3 });
  assert.deepEqual(runStoryCounts({ metrics: { failed_story_count: 2, story_count: 3 } }, fallback), { failed: 2, total: 3 });
  assert.deepEqual(runStoryCounts({}, fallback), { failed: 7, total: 8 });
});
