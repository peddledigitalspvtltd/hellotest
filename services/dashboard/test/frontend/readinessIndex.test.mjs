import assert from "node:assert/strict";
import test from "node:test";
import { deriveReleaseReadiness } from "../../frontend/lib/releaseReadiness.ts";
import { deriveReadinessIndex } from "../../frontend/lib/readinessIndex.ts";

const at = "2026-09-10T10:00:00Z";
const complete = { sourcesAvailable: true, evidenceComplete: true, scoped: true };
const model = (patch = {}) => deriveReleaseReadiness({
  release: "R1", sprint: "", now: Date.parse(at), evidenceComplete: true,
  requirements: [{ id: "s1", title: "Story", fix_version: "R1", test_case_ids: ["c1"] }],
  testCases: [{ id: "c1", title: "Case" }],
  executions: [{ id: "run", release: "R1", test_case_ids: ["c1"] }],
  executionResults: [{ id: "r1", execution_id: "run", test_case_id: "c1", status: "passed", created_at: at }],
  issues: [],
  ...patch,
});

test("readiness index exposes the four weighted components without inventing confidence", () => {
  const result = deriveReadinessIndex(model(), complete);
  assert.equal(result.score, 100);
  assert.equal(result.rawScore, 100);
  assert.deepEqual(result.components, [
    { id: "coverage", weight: 25, value: 100, contribution: 25 },
    { id: "completion", weight: 20, value: 100, contribution: 20 },
    { id: "pass-rate", weight: 35, value: 100, contribution: 35 },
    { id: "defect-containment", weight: 20, value: 100, contribution: 20 },
  ]);
  assert.deepEqual(result.caps, []);
  assert.equal(result.provisional, false);
  assert.equal("confidence" in result, false);
});

test("readiness index uses observed component denominators and resolved scoped Bug proportion", () => {
  const result = deriveReadinessIndex(model({
    requirements: [{ id: "s1", fix_version: "R1", test_case_ids: ["c1", "c2", "c3", "c4"] }, { id: "s2", fix_version: "R1" }],
    testCases: ["c1", "c2", "c3", "c4"].map(id => ({ id })),
    executions: [{ id: "run", release: "R1", test_case_ids: ["c1", "c2", "c3", "c4"] }],
    executionResults: [
      { id: "r1", execution_id: "run", test_case_id: "c1", status: "passed", created_at: at },
      { id: "r2", execution_id: "run", test_case_id: "c2", status: "failed", created_at: at },
      { id: "r3", execution_id: "run", test_case_id: "c3", status: "pending", created_at: at },
    ],
    issues: [{ id: "open", fix_version: "R1", status: "Open" }, { id: "done", fix_version: "R1", status_category: "done" }, { id: "outside", fix_version: "R2", status: "Open" }],
  }), complete);
  assert.deepEqual(result.components.map(component => component.value), [50, 50, 50, 50]);
  assert.equal(result.rawScore, 50);
  assert.equal(result.score, 50);
});

test("unavailable sources or unknown required rates withhold the index rather than substitute zero", () => {
  const denied = deriveReadinessIndex(model(), { ...complete, sourcesAvailable: false });
  assert.equal(denied.score, null);
  assert.equal(denied.rawScore, null);
  assert.ok(denied.components.every(component => component.value === null && component.contribution === null));
  assert.equal(denied.provisional, true);
  for (const patch of [{ requirements: [] }, { executionResults: [] }]) {
    const missing = deriveReadinessIndex(model(patch), complete);
    assert.equal(missing.score, null);
    assert.equal(missing.rawScore, null);
    assert.equal(missing.provisional, true);
  }
});

test("critical, blocked and priority caps remain explicit and lowest applicable cap wins", () => {
  const critical = deriveReadinessIndex(model({ issues: [{ id: "critical", fix_version: "R1", status: "Open", severity: "Critical" }] }), complete);
  assert.equal(critical.rawScore, 80);
  assert.equal(critical.score, 39);
  assert.deepEqual(critical.caps, [{ id: "critical-defects", maximum: 39 }]);
  const blockedModel = model({
    executions: [{ id: "run", release: "R1", test_case_ids: ["c1"] }],
    executionResults: [
      { id: "pass", execution_id: "run", test_case_id: "c1", status: "passed", data_set_iteration_key: "a", created_at: at },
      { id: "block", execution_id: "run", test_case_id: "c1", status: "blocked", data_set_iteration_key: "b", created_at: at },
    ],
  });
  const blocked = deriveReadinessIndex(blockedModel, complete);
  assert.equal(blockedModel.metrics.passRate, 100, "the established pass denominator excludes blocked rows");
  assert.equal(blocked.score, 59, "a blocked row still caps the advisory index");
  assert.deepEqual(blocked.caps, [{ id: "blocked-evidence", maximum: 59 }]);
  const priority = deriveReadinessIndex(model({ requirements: [{ id: "s1", fix_version: "R1", test_case_ids: ["c1"] }, { id: "gap", fix_version: "R1", priority: 1 }] }), complete);
  assert.equal(priority.rawScore, 88);
  assert.equal(priority.score, 69);
  assert.deepEqual(priority.caps, [{ id: "priority-coverage", maximum: 69 }]);
  const combined = deriveReadinessIndex(model({
    evidenceComplete: false,
    requirements: [{ id: "s1", fix_version: "R1", test_case_ids: ["c1"] }, { id: "gap", fix_version: "R1", priority: 1 }],
    issues: [{ id: "critical", fix_version: "R1", status: "Open", severity: "Critical" }],
  }), { ...complete, scoped: false });
  assert.equal(combined.score, 39);
  assert.deepEqual(combined.caps.map(cap => cap.id), ["critical-defects", "priority-coverage", "incomplete-evidence", "unscoped"]);
});

test("partial, unscoped and stale evidence remain provisional with disclosed ceilings", () => {
  for (const [evidence, context, cap] of [
    [model(), { ...complete, evidenceComplete: false }, "incomplete-evidence"],
    [model({ testCases: [] }), complete, "incomplete-evidence"],
    [model(), { ...complete, scoped: false }, "unscoped"],
    [model({ now: Date.parse("2026-09-25T10:00:00Z") }), complete, "stale-evidence"],
    [model({ executionResults: [{ id: "r1", execution_id: "run", test_case_id: "c1", status: "passed", created_at: "invalid" }] }), complete, "unknown-freshness"],
  ]) {
    const result = deriveReadinessIndex(evidence, context);
    assert.equal(result.rawScore, 100);
    assert.equal(result.score, 49, cap);
    assert.equal(result.provisional, true, cap);
    assert.deepEqual(result.caps, [{ id: cap, maximum: 49 }]);
  }
  assert.equal(deriveReadinessIndex(model({ now: Date.parse("2026-09-24T10:00:00Z") }), complete).score, 100, "the existing 14-day boundary remains inclusive");
});

test("index calculation never mutates the evidence model or raises a low observed score to a ceiling", () => {
  const evidence = model({
    requirements: [{ id: "gap", fix_version: "R1", priority: 1 }],
    executionResults: [{ id: "failed", execution_id: "run", test_case_id: "c1", status: "failed", created_at: at }],
    issues: [{ id: "critical", fix_version: "R1", status: "Open", severity: "Critical" }],
  });
  const before = structuredClone(evidence);
  const result = deriveReadinessIndex(evidence, complete);
  assert.equal(result.rawScore, 20);
  assert.equal(result.score, 20);
  assert.deepEqual(evidence, before);
  assert.equal("readinessScore" in evidence.metrics, false);
});
