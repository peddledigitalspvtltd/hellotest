import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const compile = (name) => {
  const exports = {};
  const source = readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), "utf8");
  new Function("require", "exports", ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)((dependency) => compile(dependency.replace("./", "")), exports);
  return exports;
};
const { runEditDraft, changedRunFields, runEditLocks, retainRunSelections } = compile("runEdit");
const run = { id: "run", name: "Current run", status: "queued", trigger: "manual", ended_at: null, started_at: null, suite_ids: ["suite"], test_case_ids: ["suite-case", "direct-case"], direct_test_case_ids: ["suite-case", "direct-case"], assigned_to_ids: ["owner"], start_date: "2026-09-09", end_date: "2026-09-10", test_environment: { id: "deleted-environment" } };

test("run edit keeps explicit direct pins overlapping suites and unavailable attachments", () => {
  const draft = runEditDraft(run);
  assert.deepEqual(draft.test_case_ids, ["suite-case", "direct-case"]);
  assert.equal(draft.test_environment_id, "deleted-environment");
  assert.deepEqual(changedRunFields(draft, { ...draft, suite_ids: [] }), { suite_ids: [] });
  assert.deepEqual(runEditDraft({ ...run, direct_test_case_ids: [] }).test_case_ids, []);
  const legacy = runEditDraft({ ...run, direct_test_case_ids: undefined, case_snapshots: [{ test_case_id: "suite-case", suite_id: "suite" }, { test_case_id: "direct-case", suite_id: null }] });
  assert.deepEqual(legacy.test_case_ids, ["direct-case"]);
});

test("run changes send only changed fields and explicit nulls when dates or attachments are cleared", () => {
  const initial = runEditDraft(run);
  assert.deepEqual(changedRunFields(initial, structuredClone(initial)), {});
  assert.deepEqual(changedRunFields(initial, { ...initial, name: "Edited plan", start_date: "", end_date: "", test_environment_id: "", assigned_to_ids: [] }), {
    name: "Edited plan", start_date: null, end_date: null, test_environment_id: null, assigned_to_ids: []
  });
  assert.deepEqual(run.suite_ids, ["suite"], "draft edits do not mutate the fetched run");
});

test("running manual runs allow scope edits while running automation and terminal runs lock scope", () => {
  assert.deepEqual(runEditLocks(run), { finished: false, runtimeLocked: false, scopeLocked: false });
  assert.deepEqual(runEditLocks({ ...run, status: "running", started_at: "now" }), { finished: false, runtimeLocked: true, scopeLocked: false });
  assert.deepEqual(runEditLocks({ ...run, status: "running", run_mode: "remote", started_at: "now" }), { finished: false, runtimeLocked: true, scopeLocked: true });
  assert.deepEqual(runEditLocks({ ...run, ended_at: "now" }), { finished: true, runtimeLocked: true, scopeLocked: true });
});

test("scope options retain absent selected records once without replacing available records", () => {
  const options = [{ id: "current", name: "Current suite" }];
  const result = retainRunSelections(options, ["current", "deleted", "deleted"], (id) => ({ id, name: "Saved suite" }));
  assert.deepEqual(result, [{ id: "current", name: "Current suite" }, { id: "deleted", name: "Saved suite" }]);
  assert.equal(options.length, 1);
});

test("delivery edits keep saved mappings until an explicit selection changes or clears them", () => {
  const initial = runEditDraft({ ...run, release: "Saved release", sprint: "Saved Sprint", release_id: "release-1", iteration_id: "sprint-1" });
  assert.deepEqual(changedRunFields(initial, { ...initial, name: "Renamed run" }), { name: "Renamed run" });
  assert.deepEqual(changedRunFields(initial, { ...initial, release: "Next release", release_id: "release-2", sprint: "", iteration_id: "" }), {
    release: "Next release", sprint: "", release_id: "release-2", iteration_id: ""
  });
});
