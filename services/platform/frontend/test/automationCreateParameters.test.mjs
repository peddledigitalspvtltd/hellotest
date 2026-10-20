import { sourceFile } from "./helpers/sourceFile.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as acorn from "acorn";

const modules = {};
function load(name) {
  if (modules[name]) return modules[name];
  const exports = {};
  modules[name] = exports;
  const source = readFileSync(sourceFile(`${name}.ts`, "lib"), "utf8");
  const script = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function("require", "exports", script)((id) => id === "acorn" ? acorn : load(id.replace(/^\.\//, "")), exports);
  return exports;
}
const { buildAutomationCreateParameters } = load("automationCreateParameters");

test("creation suggestions include linked data, source defaults, referenced suite inputs and run captures", () => {
  const result = buildAutomationCreateParameters({
    dataSet: { id: "selected-data", mode: "table", columns: ["First Name", "region"], rows: [{ "First Name": "Jay", region: "IN" }] },
    sources: [
      { testCase: { parameter_values: { user: "first-source" } }, steps: [{ id: "source-1", action: "Save @r.session", expected_result: "", automation_code: "", api_request: null }] },
      { testCase: { parameter_values: { user: "second-source", plan: "premium" } }, steps: [] }
    ],
    draftSteps: [{ id: "draft", action: "Use @r.region with @s.tenant", expected_result: "@r.receipt exists" }],
    suites: [{ id: "suite", parameter_values: { tenant: "accounts", other_case: "unrelated shared input" } }, { id: "unlinked", parameter_values: { unrelated: "ignore" } }],
    suiteIds: ["suite"]
  });
  assert.deepEqual(result.values, { "r.first name": "Jay", "r.region": "IN", "t.user": "first-source", "t.plan": "premium", "s.tenant": "accounts" });
  for (const name of ["r.first name", "t.user", "t.plan", "s.tenant", "r.session", "r.receipt"]) assert.ok(result.definitions.some((item) => item.name === name), name);
  assert.equal(result.definitions.find((item) => item.name === "r.first name").token, "@r.[first name]");
  assert.ok(!result.definitions.some((item) => item.name === "s.unrelated"));
  assert.ok(!result.definitions.some(item => item.name === "s.other_case"));
  assert.equal(result.values["s.other_case"], undefined);
});

test("secret linked parameters stay suggestible without exposing source defaults or values", () => {
  const result = buildAutomationCreateParameters({
    dataSet: { mode: "key_value", rows: [{ key: "token", value: "secret", is_secret: true }] },
    sources: [{ testCase: { parameter_values: { token: "source-secret" } }, steps: [] }],
    draftSteps: [], suites: [], suiteIds: []
  });
  assert.equal(result.values["r.token"], undefined);
  assert.equal(result.definitions.find((item) => item.name === "r.token").sensitive, true);
});

test("creation suggestions preserve exact scopes and use inherited effective defaults without materializing overrides", () => {
  const source = { parameter_values: { "t.blank": "" }, inherited_parameter_values: { "t.blank": "parent", "t.name": "Manual" },
    effective_parameter_values: { "t.blank": "", "t.name": "Manual", "r.email": "original@r.literal", "s.region": "West" } };
  const before = structuredClone(source);
  const result = buildAutomationCreateParameters({ sources: [{ testCase: source, steps: [] }], draftSteps: [], suites: [], suiteIds: [] });
  assert.deepEqual(result.values, { "t.blank": "", "t.name": "Manual", "r.email": "original@r.literal", "s.region": "West" });
  assert.deepEqual(source, before);
});

test("creation suggestions keep opaque inherited private defaults protected without copying originating resources", () => {
  const source = {parameter_values:{'r.opaque_input':'private-suggestion','t.alias':'private-suggestion','t.public':'Visible'},
    test_data_options:{private_parameter_names:['r.opaque_input']},effective_private_parameter_names:['t.inherited'],
    inherited_parameter_values:{'t.inherited':'private-inherited'}};
  const result = buildAutomationCreateParameters({sources:[{testCase:source,steps:[]}],draftSteps:[],suites:[],suiteIds:[]});
  assert.deepEqual(result.values,{'t.public':'Visible'});
  for(const name of ['r.opaque_input','t.alias','t.inherited']) assert.equal(result.definitions.find(row=>row.name===name)?.sensitive,true);
  assert.doesNotMatch(JSON.stringify(result),/private-suggestion|private-inherited/);
});

test("creation previews chosen manual overrides above dataset defaults, including deliberate blanks",()=>{
  const result=buildAutomationCreateParameters({
    dataSet:{mode:'table',columns:['r.email','r.region'],rows:[{'r.email':'dataset@example.test','r.region':'Dataset region'}]},
    sources:[{testCase:{parameter_values:{'r.email':'','r.region':'Manual region'},test_data_options:{parameter_overrides:['r.email']}},steps:[]},
      {testCase:{parameter_values:{'r.email':'secondary@example.test'}},steps:[]}],draftSteps:[],suites:[],suiteIds:[]
  });
  assert.equal(result.values['r.email'],'');
  assert.equal(result.values['r.region'],'Dataset region');
});
