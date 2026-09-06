import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const modules = {};
function load(name) {
  if (modules[name]) return modules[name];
  const exports = {};
  modules[name] = exports;
  const source = readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), "utf8");
  const script = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function("require", "exports", script)((id) => load(id.replace(/^\.\//, "")), exports);
  return exports;
}
const { buildAutomationCreateParameters } = load("automationCreateParameters");

test("creation suggestions include its linked data columns, all source defaults, suite defaults, and run captures", () => {
  const result = buildAutomationCreateParameters({
    dataSet: { id: "selected-data", mode: "table", columns: ["First Name", "region"], rows: [{ "First Name": "Jay", region: "IN" }] },
    sources: [
      { testCase: { parameter_values: { user: "first-source" } }, steps: [{ id: "source-1", action: "Save @r.session", expected_result: "", automation_code: "", api_request: null }] },
      { testCase: { parameter_values: { user: "second-source", plan: "premium" } }, steps: [] }
    ],
    draftSteps: [{ id: "draft", action: "Use @t.region", expected_result: "@r.receipt exists" }],
    suites: [{ id: "suite", parameter_values: { tenant: "accounts" } }, { id: "unlinked", parameter_values: { unrelated: "ignore" } }],
    suiteIds: ["suite"]
  });
  assert.deepEqual(result.values, { "t.first name": "Jay", "t.region": "IN", "t.user": "first-source", "t.plan": "premium", "s.tenant": "accounts" });
  for (const name of ["t.first name", "t.user", "t.plan", "s.tenant", "r.session", "r.receipt"]) assert.ok(result.definitions.some((item) => item.name === name), name);
  assert.equal(result.definitions.find((item) => item.name === "t.first name").token, "@t.[first name]");
  assert.ok(!result.definitions.some((item) => item.name === "s.unrelated"));
});

test("secret linked parameters stay suggestible without exposing source defaults or values", () => {
  const result = buildAutomationCreateParameters({
    dataSet: { mode: "key_value", rows: [{ key: "token", value: "secret", is_secret: true }] },
    sources: [{ testCase: { parameter_values: { token: "source-secret" } }, steps: [] }],
    draftSteps: [], suites: [], suiteIds: []
  });
  assert.equal(result.values["t.token"], undefined);
  assert.equal(result.definitions.find((item) => item.name === "t.token").sensitive, true);
});
