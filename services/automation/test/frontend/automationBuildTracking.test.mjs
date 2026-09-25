import assert from "node:assert/strict";
import test from "node:test";
import { mergeRefreshedAutomationDrafts } from "../../frontend/lib/automationBuildTracking.ts";

test("completed builds refresh untouched steps and retain edits made while an agent runs", () => {
  const baseline = { a: { action: "Sign in", code: "old" }, b: { action: "Check balance", code: "old" } };
  const current = { a: baseline.a, b: { action: "Check available balance", code: "custom" } };
  const refreshed = { a: { action: "Sign in", code: "generated" }, b: { action: "Check balance", code: "generated" }, c: { action: "Sign out", code: "generated" } };
  const result = mergeRefreshedAutomationDrafts(current, baseline, refreshed);
  assert.deepEqual(result.a, refreshed.a);
  assert.deepEqual(result.b, current.b);
  assert.deepEqual(result.c, refreshed.c);
  assert.equal(baseline.a.code, "old");
});

test("refresh drops stale server step IDs and retains new in-flight drafts for surviving IDs", () => {
  assert.deepEqual(mergeRefreshedAutomationDrafts({ old: "stale", new: "user code" }, { old: "stale" }, { new: "generated code" }), { new: "user code" });
});
