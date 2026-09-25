import assert from "node:assert/strict";
import test from "node:test";
import { buildHistoryStatusBreakdown, buildReadinessScoreBreakdown } from "../src/shared/lib/tileProgressBreakdown.ts";

const countsByStatus = breakdown => Object.fromEntries(breakdown.segments.map(segment => [segment.key, segment.count]));

test("history bars preserve the full selected result window and distinct outcome counts", () => {
  const history = ["passed", "failed", "passed", "blocked", "running", "pending", "paused", "aborted", "skipped", "not_applicable"]
    .map(status => ({ status }));
  const breakdown = buildHistoryStatusBreakdown(history);
  assert.equal(breakdown.total, history.length);
  assert.deepEqual(countsByStatus(breakdown), {
    passed: 2, failed: 1, blocked: 1, running: 1, pending: 1,
    paused: 1, aborted: 1, skipped: 1, not_applicable: 1, unknown: 0
  });
  assert.equal(breakdown.segments.reduce((total, segment) => total + segment.count, 0), breakdown.total);
  assert.equal(breakdown.unit, undefined, "History segments represent actual results, not percentages");
});

test("missing and unrecognized outcomes are counted as unknown rather than removed from the denominator", () => {
  const breakdown = buildHistoryStatusBreakdown([
    { status: "passed" }, { status: null }, {}, { status: "unrecognized" }, { status: " FAILED " }
  ]);
  assert.equal(breakdown.total, 5);
  assert.equal(countsByStatus(breakdown).unknown, 3);
  assert.equal(countsByStatus(breakdown).failed, 1);
  assert.equal(countsByStatus(breakdown).passed, 1);
});

test("empty history remains empty instead of inventing a pending or passed result", () => {
  const breakdown = buildHistoryStatusBreakdown([]);
  assert.equal(breakdown.total, 0);
  assert.ok(breakdown.segments.every(segment => segment.count === 0));
});

test("readiness is explicitly a percentage score and unavailable readiness has no breakdown", () => {
  assert.equal(buildReadinessScoreBreakdown(null), undefined);
  assert.equal(buildReadinessScoreBreakdown(Number.NaN), undefined);
  assert.deepEqual(buildReadinessScoreBreakdown(64), {
    total: 100, unit: "percent",
    segments: [
      { key: "covered", label: "Readiness score", count: 64 },
      { key: "pending", label: "Remaining score", count: 36 }
    ]
  });
  assert.equal(buildReadinessScoreBreakdown(150).segments[0].count, 100);
  assert.equal(buildReadinessScoreBreakdown(-1).segments[1].count, 100);
});
