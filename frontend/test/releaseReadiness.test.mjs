import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveReleaseReadiness,
  latestReadinessResults,
} from "../src/lib/releaseReadiness.ts";
const at = "2026-09-10T10:00:00Z";
const source = (patch = {}) => ({
  release: "R1",
  sprint: "",
  evidenceComplete: true,
  now: Date.parse(at),
  requirements: [
    {
      id: "s1",
      project_id: "p1",
      fix_version: "R1",
      priority: 1,
      test_case_ids: ["c1"],
    },
  ],
  testCases: [{ id: "c1", requirement_ids: ["s1"] }],
  executions: [
    {
      id: "run",
      release: "R1",
      test_case_ids: ["c1"],
      case_snapshots: [{ test_case_id: "c1", expected_iterations: 1 }],
    },
  ],
  executionResults: [
    {
      id: "result",
      execution_id: "run",
      test_case_id: "c1",
      status: "passed",
      created_at: at,
    },
  ],
  issues: [],
  ...patch,
});
const row = (id, status, patch = {}) => ({
  id,
  execution_id: "run",
  test_case_id: "c1",
  status,
  created_at: at,
  ...patch,
});

test("a passing data row never hides a different failing data row", () => {
  const model = deriveReleaseReadiness(
    source({
      executionResults: [
        row("a", "failed", { data_set_iteration_key: "card-a" }),
        row("b", "passed", { data_set_iteration_key: "card-b" }),
      ],
    }),
  );
  assert.equal(model.metrics.failedCount, 1);
  assert.equal(model.metrics.passRate, 50);
  assert.equal(model.metrics.outcomeCount, 2);
  assert.equal(model.decisionState, "attention");
});
test("editing an old attempt never revives it over a later reset attempt", () => {
  const results = latestReadinessResults([
    row("old", "passed", {
      created_at: "2026-09-09",
      updated_at: "2026-09-11",
    }),
    row("new", "pending", { created_at: at }),
  ]);
  assert.equal(results.length, 1);
  assert.equal(results[0].id, "new");
});
test("different runs preserve their environment and configuration boundaries", () => {
  assert.equal(
    latestReadinessResults([
      row("a", "failed"),
      row("b", "passed", { execution_id: "other" }),
    ]).length,
    2,
  );
});
test("pending, paused, running, blocked, aborted and N/A are not assessed cases or pass-rate denominator", () => {
  for (const status of [
    "pending",
    "paused",
    "running",
    "blocked",
    "aborted",
    "skipped",
  ]) {
    const model = deriveReleaseReadiness(
      source({ executionResults: [row("a", status)] }),
    );
    assert.equal(model.metrics.executedCaseCount, 0, status);
    assert.equal(model.metrics.unassessedCaseCount, 1, status);
    assert.equal(model.metrics.passRate, null, status);
    assert.notEqual(model.decisionState, "clear", status);
  }
});
test("a planned data row without a result keeps the case unassessed", () => {
  const model = deriveReleaseReadiness(
    source({
      executions: [
        {
          id: "run",
          release: "R1",
          test_case_ids: ["c1"],
          case_snapshots: [{ test_case_id: "c1", expected_iterations: 3 }],
        },
      ],
    }),
  );
  assert.equal(model.metrics.missingIterationCount, 2);
  assert.equal(model.metrics.executedCaseCount, 0);
  assert.equal(model.missingRowsByRun.get("run"), 2);
});
test("missing case metadata cannot shrink the planned scope or pass complete-source checks", () => {
  const model = deriveReleaseReadiness(
    source({
      testCases: [],
      executions: [{ id: "run", release: "R1", test_case_ids: ["c1", "c2"] }],
    }),
  );
  assert.equal(model.metrics.plannedCaseCount, 2);
  assert.equal(model.metrics.missingCaseDetailsCount, 2);
  assert.equal(model.metrics.completion, 50);
  assert.equal(model.evidenceComplete, false);
  assert.ok(model.gates.every((gate) => gate.state !== "pass"));
});
test("known critical defects stay visible when stories and tests are absent", () => {
  const model = deriveReleaseReadiness(
    source({
      requirements: [],
      testCases: [],
      executions: [],
      executionResults: [],
      issues: [
        { id: "bug", fix_version: "R1", status: "Open", severity: "Critical" },
      ],
    }),
  );
  assert.equal(model.decisionState, "attention");
  assert.equal(model.metrics.openCriticalBugCount, 1);
});
test("an empty denominator remains unavailable and cannot look like zero percent quality", () => {
  const model = deriveReleaseReadiness(
    source({
      requirements: [],
      testCases: [],
      executions: [],
      executionResults: [],
    }),
  );
  assert.equal(model.metrics.passRate, null);
  assert.equal(model.metrics.completion, null);
  assert.equal(model.metrics.coverage, null);
  assert.equal(model.decisionState, "insufficient");
});
test("release and sprint filters both apply and build is not a release alias", () => {
  const model = deriveReleaseReadiness(
    source({
      sprint: " S1 ",
      requirements: [
        { id: "s1", fix_version: " r1 ", sprint: "s1", test_case_ids: ["c1"] },
        { id: "s2", fix_version: "R1", sprint: "S2", test_case_ids: ["c2"] },
      ],
      executions: [
        { id: "run", release: "r1", sprint: "s1", test_case_ids: ["c1"] },
        {
          id: "wrong",
          release: "R2",
          build: "R1",
          sprint: "S1",
          test_case_ids: ["c2"],
        },
      ],
    }),
  );
  assert.equal(model.requirements.length, 1);
  assert.equal(model.executions.length, 1);
  assert.equal(model.metrics.plannedCaseCount, 1);
});
test("a linked defect retains traceability even when its release field differs", () => {
  const model = deriveReleaseReadiness(
    source({
      issues: [
        {
          id: "bug",
          fix_version: "R2",
          status_category: "done",
          severity: "Critical",
          linked_test_case_ids: ["c1"],
        },
        {
          id: "open",
          fix_version: "R2",
          status: "Open",
          linked_test_case_ids: ["c1"],
        },
      ],
    }),
  );
  assert.equal(model.issues.length, 2);
  assert.equal(model.metrics.openBugCount, 1);
  assert.equal(model.metrics.openCriticalBugCount, 0);
});
test("a bounded sample never clears a review", () => {
  const model = deriveReleaseReadiness(source({ evidenceComplete: false }));
  assert.equal(model.decisionState, "review");
  assert.ok(model.gates.every((gate) => gate.state === "warning"));
  assert.equal("readinessScore" in model.metrics, false);
  assert.equal("confidence" in model.metrics, false);
});
test("old or invalid dates do not present evidence as current", () => {
  assert.equal(
    deriveReleaseReadiness(
      source({
        executionResults: [row("r", "passed", { created_at: "2026-08-01" })],
      }),
    ).decisionState,
    "review",
  );
  assert.equal(
    deriveReleaseReadiness(
      source({ executionResults: [row("r", "passed", { created_at: "bad" })] }),
    ).latestEvidenceAt,
    null,
  );
});
