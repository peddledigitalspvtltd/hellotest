import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { collectStepParameters, resolveStepParameterText } from "../src/lib/stepParameters.ts";
import { normalizeGherkinParameterReferences, resolveGherkinParameterText } from "../src/lib/gherkin.ts";

const modules = {};
function load(name) {
  if (modules[name]) return modules[name];
  const exports = modules[name] = {};
  const source = readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), "utf8");
  const script = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function("require", "exports", script)((id) => load(id.replace(/^\.\//, "")), exports);
  return exports;
}
const { buildParameterCsvTemplate, resolveExecutionParameterContext } = load("executionParameterContext");

test("case, suite, run and selected row share canonical namespaces and explicit empty precedence", () => {
  const input = {
    caseSnapshot: { test_case_title: "Login @t.email and @t.declared", parameter_values: { "t.email": "case", "t.untouched": "case fallback" }, suite_parameter_values: { "@t.email": "suite override", email: "suite namespace" } },
    execution: { test_environment: { snapshot: { variables: [{ key: "@t.email", value: "environment" }] } }, test_configuration: { snapshot: { variables: [{ key: "@t.email", value: "configuration" }] } }, parameter_values: { "t.email": "run" }, test_data_set: { snapshot: { name: "Accounts", mode: "table", columns: ["email", "t.untouched"], rows: [{ email: "first" }, { "@t.[email]": "", "s.email": "row suite", "r.email": "row run" }] } } }, rowIndex: 1
  };
  const before = structuredClone(input);
  const result = resolveExecutionParameterContext(input);
  assert.deepEqual(result.values, { "t.email": "", "t.untouched": "case fallback", "s.email": "row suite", "r.email": "row run" });
  assert.deepEqual(result.unresolved, ["t.declared"]);
  assert.equal(result.entries.find((entry) => entry.name === "t.email").sourceLabel, "Accounts · Row 2");
  assert.equal(resolveStepParameterText("Use @t.email|@s.email|@r.email", result.values), "Use |row suite|row run");
  assert.deepEqual(input, before);
});

test("hidden values and templates stay undisclosed even when a lower layer or capture supplies the same name", () => {
  const result = resolveExecutionParameterContext({ caseSnapshot: { parameter_values: { secret: "case leak" } }, execution: {
    test_environment: { snapshot: { variables: [{ key: "r.token", value: "secret token", is_secret: true }], template_variables: [{ key: "r.token", value: "secret template" }] } },
    test_data_set: { snapshot: { mode: "key_value", rows: [{ key: "secret", value: "hidden", is_secret: true }] } }
  }, capturedValues: { "r.token": "captured leak" } });
  assert.deepEqual(result.values, {});
  assert.equal(result.entries.every((entry) => entry.sensitive && entry.value === null && entry.template === null), true);
  assert.equal(result.entries.find((entry) => entry.name === "r.secret").source, "data_set");
  assert.equal(result.entries.find((entry) => entry.name === "r.token").source, "capture");
  assert.doesNotMatch(buildParameterCsvTemplate(result.entries), /case leak|secret token|secret template|captured leak|hidden/);
});

test("CSV templates include declared title and step references, quoted headers, and no runtime values", () => {
  const declarations = collectStepParameters([{ id: "step", action: normalizeGherkinParameterReferences("Given <email> and <s.tenant> and @r.[Build, \"Name\"]"), expected_result: "@t.missing" }]);
  assert.equal(buildParameterCsvTemplate(declarations), '\uFEFF"r.build, ""name""","r.email","s.tenant","t.missing"\r\n"","","",""\r\n');
  assert.equal(resolveGherkinParameterText("Given <email> <s.email>", { "s.email": "suite" }), "Given <email> suite");
  assert.equal(resolveGherkinParameterText("Given <email>", { "r.email": "" }), "Given ");
});

test("frozen generated values and source templates are distinct, and overrides do not mutate either", () => {
  const result = resolveExecutionParameterContext({ execution: null, caseSnapshot: { parameter_values: { email: "fixed@example.test" }, parameter_template_values: { email: "{{yopmail}}" } } });
  assert.equal(result.values["r.email"], "fixed@example.test");
  assert.equal(result.entries[0].template, "{{yopmail}}");
  assert.equal(result.entries[0].source, "case");
});

test("known Gherkin behavior detects angle declarations while XML request content remains literal", () => {
  const context = resolveExecutionParameterContext({ execution: null, caseSnapshot: { test_case_title: "Checkout <customer>" }, steps: [{ id: "step", action: "Given <email> is supplied", expected_result: "Then <s.tenant> is used", api_request: { body: "<payload><message>literal</message></payload>" } }] });
  assert.deepEqual(context.unresolved, ["r.customer", "r.email", "s.tenant"]);
});
