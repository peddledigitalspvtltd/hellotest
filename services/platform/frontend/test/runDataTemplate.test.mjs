import { sourceFile } from "./helpers/sourceFile.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import * as acorn from "acorn";
import { readFileSync } from "node:fs";

const modules = {};
function load(name) {
  if (modules[name]) return modules[name];
  const exports = modules[name] = {};
  const source = readFileSync(sourceFile(`${name}.ts`, "lib"), "utf8");
  new Function("require", "exports", ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(id => id === "acorn" ? acorn : load(id.replace(/^\.\//, "")), exports);
  return exports;
}
const { parseRunDataCsv, expandSelectedSuiteIds } = load("runDataTemplate");
const { collectStepParameters, resolveStepParameterText } = load("stepParameters");

test("CSV rows preserve whitespace, commas, quotes, line breaks and explicit blank overrides", () => {
  assert.deepEqual(parseRunDataCsv('\uFEFF"@email","@t.name","s.tenant"\r\n" first@example.test ","","a,\"\"b\"\"\nnext"\r\n'), {
    columns: ["r.email", "t.name", "s.tenant"], rows: [{ "r.email": " first@example.test ", "t.name": "", "s.tenant": 'a,"b"\nnext' }]
  });
});
test("malformed or ambiguous templates cannot silently alter parameters", () => {
  for (const csv of ['@name,r.name\na,b', 'name,\na,b', 'name,region\na', 'name\n"unclosed', 'name\n"closed"bad', 'name\n']) assert.throws(() => parseRunDataCsv(csv), Error, csv);
});
test("CSV expansion is bounded before repeated long headers exceed the API payload limit", () => {
  const name = `customer_${"x".repeat(1000)}`;
  assert.throws(() => parseRunDataCsv(`${name}\n${"value\n".repeat(4000)}`), /3 MB test-data import limit/);
  assert.throws(() => parseRunDataCsv(`name\n${"value\n".repeat(5001)}`), /5,000 data rows/);
  assert.equal(parseRunDataCsv(`${name}\n${"value\n".repeat(1000)}`).rows.length, 1000);
});
test("scope expansion includes nested suites exactly once and tolerates legacy cycles", () => {
  assert.deepEqual([...expandSelectedSuiteIds([{ id: "a", parent_id: "c" }, { id: "b", parent_id: "a" }, { id: "c", parent_id: "b" }, { id: "other" }], ["a"])], ["a", "b", "c"]);
});
test("unscoped text and explicit run text share the same complete replacement", () => {
  const text = "Use @name then @r.name, @t.name, @s.name";
  assert.equal(resolveStepParameterText(text, { "r.name": "a long value", "t.name": "test", "s.name": "suite" }), "Use a long value then a long value, test, suite");
  assert.deepEqual(collectStepParameters([{ id: "step", action: text }]).map(item => item.name).sort(), ["r.name", "s.name", "t.name"]);
});


test("suite CSV qualifies bare columns while preserving explicit case and run scopes", () => {
  assert.deepEqual(parseRunDataCsv("customer,t.expected,r.build\nAlex,approved,42\n", "s"), {
    columns: ["s.customer", "t.expected", "r.build"], rows: [{ "s.customer": "Alex", "t.expected": "approved", "r.build": "42" }]
  });
  assert.throws(() => parseRunDataCsv("customer,s.customer\nAlex,Priya\n", "s"), /same parameter/);
});
