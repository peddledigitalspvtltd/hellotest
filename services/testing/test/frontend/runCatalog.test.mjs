import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { isRunFinished, normalizeRunCatalogView, runCatalogBucket, runStoryCounts } from "../../frontend/lib/runCatalog.ts";
import { assessRunEvidenceReadiness } from "../../../ai/frontend/lib/aiAssurance.ts";

function selectedRunReadiness(selectedExecution, totalRequirements) {
  const page = ts.createSourceFile("ExecutionsPage.tsx", readFileSync(new URL("../../frontend/pages/ExecutionsPage.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let binding;
  const find = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(page) === "selectedRunEvidenceReadiness") binding = node.initializer;
    ts.forEachChild(node, find);
  };
  find(page);
  assert.ok(binding, "use the actual run detail readiness binding");
  const dependencies = {
    useMemo: factory => factory(), assessRunEvidenceReadiness, runStoryCounts, selectedExecution,
    selectedExecutionImpactSummary: { failedRequirementCount: 0, totalRequirements },
    executionProgress: { totalCases: 1, completedCases: 1 },
    executionStatusCounts: { failed: 0, blocked: 0 },
    runReferenceStats: { referenceCount: 0, defectCount: 0 }
  };
  const javascript = ts.transpileModule(`return (${binding.getText(page)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function(...Object.keys(dependencies), javascript)(...Object.values(dependencies));
}

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

test("passed run readiness uses saved Story counts when the case picker cache has no trace links", () => {
  const run = { metrics: { failed_story_count: 0, story_count: 1 } };
  const before = structuredClone(run);
  const readiness = selectedRunReadiness(run, 0);
  assert.equal(readiness.score, 85, "retain the existing results, trace and references weights");
  assert.deepEqual(readiness.signals.find(signal => signal.label === "Story trace"), { label: "Story trace", value: "1 linked", tone: "positive" });
  assert.ok(!readiness.gaps.some(gap => gap.includes("Link scoped cases to stories")));
  assert.deepEqual(run, before);
});

test("readiness preserves an authoritative zero Story count over stale cached links", () => {
  const readiness = selectedRunReadiness({ metrics: { failed_story_count: 0, story_count: 0 } }, 8);
  assert.equal(readiness.score, 65);
  assert.equal(readiness.signals.find(signal => signal.label === "Story trace").value, "0 linked");
  assert.ok(readiness.gaps.includes("Link scoped cases to stories to explain release impact."));
});

test("readiness retains computed trace fallback when saved Story metrics are unavailable", () => {
  assert.equal(selectedRunReadiness({}, 1).score, 85);
  assert.equal(selectedRunReadiness(null, 0).score, 65);
});
