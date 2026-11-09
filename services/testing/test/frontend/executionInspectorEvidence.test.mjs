import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const compile = (name, modules = {}) => {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(`../../frontend/lib/${name}.ts`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  new Function("require", "exports", source)(id => {
    assert.ok(modules[id], `Unexpected runtime import: ${id}`);
    return modules[id];
  }, exports);
  return exports;
};
const { selectExecutionInspectorEvidence: select } = compile("executionInspectorEvidence", {
  "./executionLogs": compile("executionLogs"),
  "./executionResultMetrics": compile("executionResultMetrics")
});
const step = (order, overrides = {}) => ({ id: `snapshot-${order}`, test_case_id: "case", step_order: order, ...overrides });
const evidence = (name) => ({ attachmentId: `attachment-${name}`, fileName: name });
const result = (overrides = {}) => ({
  id: "result", execution_id: "run", test_case_id: "case", status: "failed", created_at: "2026-11-06T10:00:00Z",
  logs: null, ...overrides
});
const inspect = (results, steps = [step(14), step(9)]) => select({ executionId: "run", testCaseId: "case", results, steps });

test("failure inspector selects failed Step 14 from shuffled Step 9 passed media", () => {
  const passed = evidence("step-9-passed.jpg");
  const failed = evidence("step-14-failed.jpg");
  for (const entries of [[["snapshot-9", passed], ["snapshot-14", failed]], [["snapshot-14", failed], ["snapshot-9", passed]]]) {
    for (const steps of [[step(9), step(14)], [step(14), step(9)]]) {
      const selected = inspect([result({ logs: JSON.stringify({
        stepEvidence: Object.fromEntries(entries), stepStatuses: { "snapshot-9": "passed", "snapshot-14": "failed" }
      }) })], steps);
      assert.equal(selected.step.step_order, 14);
      assert.equal(selected.evidence.attachmentId, failed.attachmentId);
      assert.equal(selected.evidence.fileName, "step-14-failed.jpg");
    }
  }
});

test("failure and blocked statuses take precedence over later passed media", () => {
  for (const status of ["failed", "blocked"]) {
    const selected = inspect([result({ logs: JSON.stringify({
      stepStatuses: { "snapshot-9": status, "snapshot-14": "passed" },
      stepEvidence: { "snapshot-14": evidence("latest-passed.jpg"), "snapshot-9": evidence("failure.jpg") }
    }) })]);
    assert.equal(selected.step.step_order, 9);
    assert.equal(selected.evidence.fileName, "failure.jpg");
  }
});

test("media fallback uses numeric snapshot order instead of IDs, file names or insertion order", () => {
  const selected = inspect([result({ status: "passed", logs: JSON.stringify({ stepEvidence: {
    "snapshot-9": evidence("step-99.jpg"), "snapshot-14": evidence("step-1.jpg")
  } }) })]);
  assert.equal(selected.step.step_order, 14);
  assert.equal(selected.evidence.fileName, "step-1.jpg");
});

test("native automation status can identify failure before the step status is recorded", () => {
  const selected = inspect([result({ logs: JSON.stringify({
    stepAutomationDetails: { "snapshot-9": { status: "failed" } },
    stepEvidence: { "snapshot-14": evidence("passed.jpg"), "snapshot-9": evidence("native-failure.jpg") }
  }) })]);
  assert.equal(selected.step.step_order, 9);
});

test("only media owned by a frozen step of the inspected case is eligible", () => {
  const selected = inspect([result({ logs: JSON.stringify({
    stepStatuses: { foreign: "failed", unknown: "failed", "test:post:hook:step": "failed" },
    stepEvidence: {
      foreign: evidence("other-case.jpg"), unknown: evidence("old-source-step.jpg"),
      "test:post:hook:step": evidence("hook.jpg"), "snapshot-9": evidence("owned.jpg")
    }
  }) })], [step(99, { id: "foreign", test_case_id: "other-case" }), step(9)]);
  assert.equal(selected.step.id, "snapshot-9");
  assert.equal(selected.evidence.fileName, "owned.jpg");
});

test("a failed current data row owns both inspector error and media despite a newer passed row", () => {
  const failedRow = result({ id: "failed-row", data_set_iteration_index: 0, data_set_iteration_key: "data:1", error: "Row one failed",
    logs: JSON.stringify({ stepStatuses: { "snapshot-14": "failed" }, stepEvidence: { "snapshot-14": evidence("row-one-failed.jpg") } }) });
  const passedRow = result({ id: "passed-row", data_set_iteration_index: 1, data_set_iteration_key: "data:2", status: "passed", created_at: "2026-11-06T11:00:00Z",
    logs: JSON.stringify({ stepStatuses: { "snapshot-14": "passed" }, stepEvidence: { "snapshot-14": evidence("row-two-passed.jpg") } }) });
  const selected = inspect([passedRow, failedRow]);
  assert.equal(selected.result.id, "failed-row");
  assert.equal(selected.result.data_set_iteration_index, 0);
  assert.equal(selected.result.error, "Row one failed");
  assert.equal(selected.evidence.fileName, "row-one-failed.jpg");
});

test("a newer reset in the same iteration prevents old failure evidence resurfacing", () => {
  const old = result({ id: "old-failure", data_set_iteration_index: 0, data_set_iteration_key: "data:0",
    logs: JSON.stringify({ stepEvidence: { "snapshot-14": evidence("old-failure.jpg") } }) });
  const reset = result({ id: "reset", data_set_iteration_index: 0, data_set_iteration_key: "data:1", status: "pending", created_at: "2026-11-06T11:00:00Z" });
  const selected = inspect([old, reset]);
  assert.equal(selected.result.id, "reset");
  assert.equal(selected.step, null);
  assert.equal(selected.evidence, null);
});

test("missing failed-row media cannot be replaced by a passed row's attachment", () => {
  const selected = inspect([
    result({ id: "failed-row", data_set_iteration_index: 0 }),
    result({ id: "passed-row", data_set_iteration_index: 1, status: "passed", created_at: "2026-11-06T11:00:00Z",
      logs: JSON.stringify({ stepEvidence: { "snapshot-14": evidence("other-row.jpg") } }) })
  ]);
  assert.equal(selected.result.id, "failed-row");
  assert.equal(selected.evidence, null);
  assert.equal(selected.step, null);
});

test("other runs and cases cannot supply inspector media even with identical step IDs", () => {
  const logs = JSON.stringify({ stepStatuses: { "snapshot-14": "failed" }, stepEvidence: { "snapshot-14": evidence("foreign.jpg") } });
  const selected = inspect([result({ execution_id: "other-run", logs }), result({ test_case_id: "other-case", logs })]);
  assert.equal(selected.result, null);
  assert.equal(selected.step, null);
  assert.equal(selected.evidence, null);
});

test("invalid and missing media do not hide the latest valid owned evidence", () => {
  const selected = inspect([result({ logs: JSON.stringify({
    stepStatuses: { "snapshot-14": "failed" },
    stepEvidence: { "snapshot-14": { fileName: "missing.jpg" }, "snapshot-9": evidence("available.jpg") }
  }) })]);
  assert.equal(selected.step.step_order, 9);
  assert.equal(inspect([result({ logs: "not-json" })]).evidence, null);
  assert.equal(inspect([]).evidence, null);
});
