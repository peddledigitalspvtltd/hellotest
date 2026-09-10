import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { AI_METRIC_CRITERIA_REGISTRY } from "../src/lib/aiPromptRegistry.ts";

const { calculateMetrics } = createRequire(import.meta.url)("../../backend/api/src/services/qualityAnalytics.service.js");
const entry = (key) => {
  const found = AI_METRIC_CRITERIA_REGISTRY.filter((item) => item.key === key);
  assert.equal(found.length, 1);
  return `${found[0].formula} ${found[0].criteria}`;
};
const context = (overrides = {}) => ({
  requirements: [{ id: "story", priority: 3, test_case_ids: ["case"] }],
  testCases: [{ id: "case" }], plannedCaseIds: new Set(["case"]),
  results: [{ test_case_id: "case", status: "passed" }],
  issues: [], executions: [], suites: [], modules: [], ...overrides
});

test("dashboard release-confidence guidance matches the weighted backend score and every hard cap", () => {
  const description = entry("metric.dashboard.release_confidence");
  assert.match(description, /coverage × 25%.*completion × 20%.*pass rate × 35%.*containment × 20%/);
  for (const cap of [49, 69, 59, 39]) assert.match(description, new RegExp(`${cap}%`));
  assert.doesNotMatch(description, /automation-coverage gap|points per failed run/);
  assert.equal(calculateMetrics(context()).releaseConfidence, 100);
  assert.equal(calculateMetrics(context({ issues: [{ status: "open" }, { status: "resolved" }] })).releaseConfidence, 90);
  assert.equal(calculateMetrics(context({ requirements: [] })).releaseConfidence, 49);
  assert.equal(calculateMetrics(context({ requirements: [{ id: "gap", priority: 1, test_case_ids: [] }] })).releaseConfidence, 69);
  assert.equal(calculateMetrics(context({ results: [{ test_case_id: "case", status: "blocked" }] })).releaseConfidence, 59);
  assert.equal(calculateMetrics(context({ issues: [{ status: "open", severity: "critical" }] })).releaseConfidence, 39);
});

test("dashboard status and empty-scope guidance stays distinct from shared run methodology", () => {
  const completion = entry("metric.dashboard.execution_completion");
  const pass = entry("metric.dashboard.pass_rate");
  assert.match(completion, /passed, failed, blocked, skipped, aborted, or cancelled/);
  assert.match(completion, /run snapshots or latest results/);
  assert.match(pass, /newer running or pending result replaces an older finalized result/);
  assert.match(pass, /empty denominator returns 0%/);
  const statuses = ["passed", "failed", "blocked", "skipped", "aborted", "cancelled", "running"];
  const metrics = calculateMetrics(context({ plannedCaseIds: new Set(["unstarted", ...statuses]), results: statuses.map((status) => ({ test_case_id: status, status })) }));
  assert.equal(metrics.executionCompletion, 75);
  assert.equal(metrics.passRate, 33);
  assert.equal(calculateMetrics(context({ results: [{ test_case_id: "case", status: "running" }] })).passRate, 0);
  assert.match(entry("metric.execution.pass_rate"), /Never convert an absent denominator/);
});

test("dashboard evidence and elapsed-time descriptions disclose the actual zero-data and timestamp behavior", () => {
  const evidence = entry("metric.dashboard.evidence_confidence");
  assert.match(evidence, /coverage × 40%.*completion × 40%.*traceability × 20%/);
  assert.match(evidence, /no Bugs, traceability is 100% and contributes 20 points/);
  assert.match(evidence, /no freshness or partial-evidence caps/);
  assert.equal(calculateMetrics(context({ requirements: [], testCases: [], plannedCaseIds: new Set(), results: [] })).evidenceConfidence, 20);
  const cycle = entry("metric.execution.cycle_time");
  assert.match(cycle, /max\(0, ended_at − started_at\)/);
  assert.match(cycle, /regardless of current status/);
  assert.match(cycle, /no created_at fallback or 30-day duration cap/);
  const metrics = calculateMetrics(context({ executions: [
    { status: "running", started_at: "2026-01-01", ended_at: "2026-02-01" },
    { status: "failed", started_at: "2026-02-01", ended_at: "2026-01-01" },
    { status: "completed", created_at: "2026-01-01", ended_at: "2026-01-02" },
    { status: "completed", started_at: "invalid", ended_at: "2026-01-02" }
  ] }));
  assert.equal(metrics.executionCycleHours, 372);
});
