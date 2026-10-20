import assert from "node:assert/strict";
import test from "node:test";
import { automationSavedPlanReceipt, mergeRefreshedAutomationDrafts } from "../../frontend/lib/automationBuildTracking.ts";

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

test("partial durable saves refresh their own Plan, while validated previews do not claim persistence", () => {
  const draft = { test_case_id: "case", step_id: "one", instruction_status: "validated", updated_at: "first" };
  assert.equal(automationSavedPlanReceipt({ step_progress: [draft] }, "case").caseId, "");
  const saved = { ...draft, instruction_status: "saved", saved_at: "saved-one" };
  const first = automationSavedPlanReceipt({ step_progress: [saved], outcome_status: "incomplete" }, "case");
  assert.equal(first.caseId, "case");
  assert.equal(automationSavedPlanReceipt({ step_progress: [saved] }, "other").caseId, "");
  const next = automationSavedPlanReceipt({ step_progress: [saved, { ...saved, step_id: "two", saved_at: "saved-two" }] }, "case");
  assert.notEqual(next.signature, first.signature);
  assert.equal(automationSavedPlanReceipt({ output_test_case_ids: ["case"] }, "case").caseId, "case");
});

test("successive checkpoints refresh prior generated code while retaining an author edit", () => {
  const original = { one: "original", two: "original" };
  const firstSaved = { one: "first generated", two: "original" };
  const afterFirst = mergeRefreshedAutomationDrafts(original, original, firstSaved);
  const nextSaved = { one: "revised generated", two: "second generated" };
  const afterNext = mergeRefreshedAutomationDrafts({ ...afterFirst, two: "author draft" }, firstSaved, nextSaved);
  assert.equal(afterNext.one, "revised generated");
  assert.equal(afterNext.two, "author draft");
});
