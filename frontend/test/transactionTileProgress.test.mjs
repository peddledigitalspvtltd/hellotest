import assert from "node:assert/strict";
import test from "node:test";
import { transactionTileProgress } from "../src/lib/transactionTileProgress.ts";

test("batch tile progress counts successes, failures, unclassified processed items and pending work", () => {
  const result = transactionTileProgress({ status: "running", metadata: { total_items: 10, processed_items: 7, imported: 4, failed: 2 } }, 80);
  assert.equal(result.value, 70);
  assert.equal(result.breakdown.total, 10);
  assert.deepEqual(result.breakdown.segments.map(({ key, count }) => [key, count]), [["passed", 4], ["failed", 2], ["unknown", 1], ["pending", 3]]);
  assert.equal(result.breakdown.unit, undefined, "Actual item counts must not be presented as percentage counts");
});

test("export counts do not double-count the same processed records or fabricate successful outcomes", () => {
  const exported = transactionTileProgress({ status: "completed", metadata: { total_rows: 4, processed_items: 4, imported: 4, exported: 4 } }, 100);
  assert.deepEqual(exported.breakdown.segments.map(({ count }) => count), [4, 0, 0, 0]);
  const unclassified = transactionTileProgress({ status: "completed", metadata: { total_items: 4, processed_items: 4 } }, 100);
  assert.deepEqual(unclassified.breakdown.segments.map(({ count }) => count), [0, 0, 4, 0]);
});

test("batch progress uses explicit percentages only when item counts are unavailable", () => {
  const result = transactionTileProgress({ status: "running", metadata: { progress_percent: 35 } }, 35);
  assert.equal(result.value, 35);
  assert.equal(result.breakdown.unit, "percent");
  assert.deepEqual(result.breakdown.segments.map(({ count }) => count), [35, 65]);
});
