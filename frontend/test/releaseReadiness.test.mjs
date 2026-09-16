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

test("six observed checks keep blocked, missing and bounded evidence distinct", () => {
  const clear = deriveReleaseReadiness(source());
  assert.deepEqual(clear.gates.map(gate => gate.id), ["critical-defects", "failed-outcomes", "priority-coverage", "remaining-evidence", "blocked-evidence", "evidence-freshness"]);
  assert.ok(clear.gates.every(gate => gate.state === "pass"));
  const blocked = deriveReleaseReadiness(source({ executionResults: [row("blocked", "blocked")] }));
  assert.deepEqual(blocked.gates.find(gate => gate.id === "blocked-evidence"), { id: "blocked-evidence", state: "block", count: 1, total: 1 });
  assert.equal(blocked.metrics.passRate, null, "blocked evidence remains outside the assessed denominator");
  const absent = deriveReleaseReadiness(source({ executionResults: [] }));
  assert.equal(absent.gates.find(gate => gate.id === "blocked-evidence").state, "warning");
  assert.equal(absent.gates.find(gate => gate.id === "evidence-freshness").count, null);
  for (const patch of [{ evidenceComplete: false }, { testCases: [] }]) {
    const limited = deriveReleaseReadiness(source(patch));
    assert.ok(limited.gates.every(gate => gate.state !== "pass"), "unknown evidence never passes either new check");
  }
});

test("freshness uses the existing fourteen-day activity boundary and retains unknown dates", () => {
  for (const [date, expectedAge, state] of [["2026-08-27T10:00:00Z", 14, "pass"], ["2026-08-26T10:00:00Z", 15, "warning"], ["invalid", null, "warning"]]) {
    const model = deriveReleaseReadiness(source({ executionResults: [row("dated", "passed", { created_at: date })] }));
    assert.deepEqual(model.gates.find(gate => gate.id === "evidence-freshness"), { id: "evidence-freshness", state, count: expectedAge, total: 14 });
  }
});

test("Story inspectors expose only exact linked cases, open defects and scoped runs", () => {
  const model = deriveReleaseReadiness(source({
    requirements: [{ id: "s1", fix_version: "R1", test_case_ids: ["c1", "c1"], defect_ids: ["BUG-1"] }],
    testCases: [{ id: "c1", requirement_ids: ["s1"] }, { id: "c2", requirement_id: "s1" }, { id: "unrelated" }],
    executions: [{ id: "run", release: "R1", test_case_ids: ["c1"] }, { id: "planned", release: "R1", direct_test_case_ids: ["c2"] }, { id: "other-release", release: "R2", test_case_ids: ["c1"] }, { id: "unrelated", release: "R1", test_case_ids: ["unrelated"] }],
    issues: [{ id: "b1", jira_bug_key: "BUG-1", status: "Open" }, { id: "b2", linked_test_case_ids: ["c2"], status: "Open" }, { id: "closed", linked_requirement_ids: ["s1"], status_category: "done" }, { id: "unrelated", fix_version: "R1", status: "Open" }],
    executionResults: [row("a", "passed", { data_set_iteration_key: "a" }), row("b", "passed", { data_set_iteration_key: "b" })],
  }));
  assert.deepEqual(model.hotspots[0].caseIds, ["c1", "c2"]);
  assert.deepEqual(model.hotspots[0].openIssueIds, ["b1", "b2"]);
  assert.deepEqual(model.hotspots[0].runIds, ["run", "planned"], "planned runs stay reachable before any result exists, without duplicate row links");
});

test("case evidence retains every planned ID, exact Story links and result-only run membership", () => {
  const model = deriveReleaseReadiness(source({
    requirements: [
      { id: "s1", fix_version: "R1", test_case_ids: ["c1", "missing", "missing"] },
      { id: "other-story", fix_version: "R2", test_case_ids: ["outside"] },
    ],
    testCases: [
      { id: "c1", title: "Linked case", display_id: "TC-1", requirement_ids: ["s1"] },
      { id: "reverse", title: "Reverse relationship", requirement_id: "s1" },
      { id: "run-only", title: "Run-only case" },
      { id: "outside", title: "Another release" },
      { id: "catalog-only", title: "Not in scope" },
    ],
    executions: [
      { id: "run", release: "R1", test_case_ids: ["run-only", "run-missing"] },
      { id: "other-run", release: "R2", test_case_ids: ["outside"] },
    ],
    executionResults: [row("observed", "passed", { test_case_id: "result-only" })],
  }));
  assert.deepEqual(model.caseEvidence.map(item => item.id), ["c1", "missing", "reverse", "run-only", "run-missing", "result-only"]);
  const byId = new Map(model.caseEvidence.map(item => [item.id, item]));
  assert.equal(byId.get("c1").title, "Linked case");
  assert.equal(byId.get("c1").displayId, "TC-1");
  assert.deepEqual(byId.get("c1").storyIds, ["s1"]);
  assert.deepEqual(byId.get("reverse").storyIds, ["s1"]);
  assert.deepEqual(byId.get("run-only").storyIds, []);
  assert.deepEqual(byId.get("run-only").runIds, ["run"]);
  assert.deepEqual(byId.get("result-only").runIds, ["run"]);
  assert.equal(byId.get("missing").title, null);
  assert.equal(byId.get("missing").detailsAvailable, false);
  assert.equal(byId.get("result-only").detailsAvailable, false);
  assert.equal(byId.get("result-only").status, "passed", "known results remain visible when reusable metadata is missing");
  assert.equal(model.metrics.plannedCaseCount, 6);
  assert.equal(model.metrics.designKnownCount, 3);
  assert.equal(model.metrics.missingCaseDetailsCount, 3);
  assert.equal(model.evidenceComplete, false);
} );

test("case status preserves failures and blocked rows across runs while assessment requires all rows", () => {
  const model = deriveReleaseReadiness(source({
    requirements: [{ id: "s1", fix_version: "R1", test_case_ids: ["failed", "blocked", "passed", "partial", "not-run"] }],
    testCases: ["failed", "blocked", "passed", "partial", "not-run"].map(id => ({ id })),
    executions: [
      { id: "run", release: "R1", test_case_ids: ["failed", "blocked", "passed", "partial", "not-run"], case_snapshots: [{ test_case_id: "partial", expected_iterations: 2 }] },
      { id: "other", release: "R1", test_case_ids: ["failed", "passed"] },
    ],
    executionResults: [
      row("failure", "failed", { test_case_id: "failed" }),
      row("block", "blocked", { test_case_id: "failed", execution_id: "other" }),
      row("blocked-row", "blocked", { test_case_id: "blocked" }),
      row("old-failure", "failed", { test_case_id: "passed", created_at: "2026-09-09" }),
      row("passing-a", "passed", { test_case_id: "passed" }),
      row("passing-b", "passed", { test_case_id: "passed", execution_id: "other", data_set_iteration_key: "b" }),
      row("partial-pass", "passed", { test_case_id: "partial" }),
    ],
  }));
  const byId = new Map(model.caseEvidence.map(item => [item.id, item]));
  assert.deepEqual(model.caseEvidence.map(item => [item.id, item.status, item.assessed]), [
    ["failed", "failed", false], ["blocked", "blocked", false], ["passed", "passed", true],
    ["partial", "unassessed", false], ["not-run", "not-run", false],
  ]);
  assert.deepEqual(byId.get("passed").results.map(item => item.id), ["passing-a", "passing-b"]);
  assert.equal(model.metrics.passingCaseCount, 1, "passing cases and passing result rows have different units");
  assert.equal(model.metrics.passedCount, 3);
  assert.equal(model.metrics.executedCaseCount, 1);
  assert.equal(model.metrics.passRate, 75, "blocked rows remain outside the established assessed-outcome denominator");
});

test("a fully observed failing case is assessed but never counted as a passing case", () => {
  const model = deriveReleaseReadiness(source({ executionResults: [row("failed", "failed")] }));
  assert.equal(model.caseEvidence[0].assessed, true);
  assert.equal(model.caseEvidence[0].status, "failed");
  assert.equal(model.metrics.executedCaseCount, 1);
  assert.equal(model.metrics.passingCaseCount, 0);
});

test("per-run evidence accounts for missing frozen rows without inventing rows for unplanned Stories", () => {
  const model = deriveReleaseReadiness(source({
    requirements: [{ id: "s1", fix_version: "R1", test_case_ids: ["c1", "story-only"] }],
    executions: [
      { id: "run", release: "R1", test_case_ids: ["c1"], case_snapshots: [{ test_case_id: "c1", expected_iterations: 3 }] },
      { id: "planned", release: "R1", direct_test_case_ids: ["c1"], case_snapshots: [{ test_case_id: "c1", expected_iterations: 2 }] },
      { id: "observed-only", release: "R1" },
    ],
    executionResults: [
      row("a", "passed"),
      row("b", "passed", { execution_id: "observed-only", data_set_iteration_key: "b" }),
      row("c", "passed", { execution_id: "observed-only", data_set_iteration_key: "c" }),
    ],
  }));
  const [record, noRun] = model.caseEvidence;
  assert.deepEqual(record.runEvidence.map(item => [item.runId, item.expectedRows, item.missingRows, item.results.length]), [
    ["run", 3, 2, 1], ["planned", 2, 2, 0], ["observed-only", 2, 0, 2],
  ]);
  assert.equal(record.expectedRows, 7);
  assert.equal(record.missingRows, 4);
  assert.equal(record.status, "unassessed");
  assert.equal(record.missingRows, model.metrics.missingIterationCount);
  assert.equal(noRun.status, "not-run");
  assert.deepEqual(noRun.runEvidence, []);
  assert.equal(noRun.expectedRows, 0, "no run snapshot means no known row plan");
  assert.equal(noRun.missingRows, 0);
});

test("completed Stories use authoritative status categories and exact supported fallback statuses", () => {
  const requirements = [
    { status: "Custom workflow name", status_category: "done" },
    { status: "Done", status_category: "indeterminate" },
    { status: " QA_DONE " }, { status: "qa done" }, { status: "Accepted" }, { status: "Completed" },
    { status: "Closed" }, { status: "Resolved" }, { status: "Complete" },
    { status: "not done" }, { status: "Done pending verification" }, { status: "Cancelled" },
  ].map((fields, index) => ({ id: `s${index}`, fix_version: "R1", ...fields }));
  const model = deriveReleaseReadiness(source({ requirements }));
  assert.equal(model.metrics.completedRequirementCount, 8);
  assert.equal(model.metrics.requirementCount, 12);
});

test("linked issue IDs distinguish exact trace links from release membership", () => {
  const model = deriveReleaseReadiness(source({
    requirements: [{ id: "s1", fix_version: "R1", test_case_ids: ["c1"], defect_ids: ["EXT-1"] }],
    issues: [
      { id: "forward", jira_bug_key: "EXT-1", status: "Closed", fix_version: "R2" },
      { id: "reverse-story", linked_requirement_ids: ["s1"], status: "Open" },
      { id: "reverse-case", linked_test_case_ids: ["c1"], status: "Open" },
      { id: "reverse-run", linked_test_run_id: "run", status: "Open" },
      { id: "scope-only", fix_version: "R1", status: "Open" },
      { id: "outside", fix_version: "R2", status: "Open" },
    ],
  }));
  assert.deepEqual(model.linkedIssueIds, ["forward", "reverse-story", "reverse-case", "reverse-run"]);
  assert.equal(model.metrics.linkedBugCount, 4);
  assert.equal(model.metrics.openBugCount, 4);
});
