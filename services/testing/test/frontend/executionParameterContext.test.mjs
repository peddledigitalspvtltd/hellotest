import { sourceFile } from "../../../platform/frontend/test/helpers/sourceFile.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as acorn from "acorn";
import { collectStepParameters, resolveStepParameterText } from "../../../platform/frontend/src/shared/lib/stepParameters.ts";
import { normalizeGherkinParameterReferences, resolveGherkinParameterText } from "../../frontend/lib/gherkin.ts";

const modules = {};
function load(name) {
  if (modules[name]) return modules[name];
  const exports = modules[name] = {};
  const source = readFileSync(sourceFile(`${name}.ts`, "lib"), "utf8");
  const script = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function("require", "exports", script)((id) => id === "acorn" ? acorn : load(id.replace(/^\.\//, "")), exports);
  return exports;
}
const { buildParameterCsvTemplate, resolveExecutionParameterContext } = load("executionParameterContext");

test('durable opaque privacy metadata stays protected when the original private resource is absent', () => {
  const result=resolveExecutionParameterContext({execution:null,caseSnapshot:{parameter_values:{'t.public':'Visible'},test_data_options:{private_parameter_names:['@R.opaque_input','blank']}}});
  assert.equal(result.values['t.public'],'Visible');
  for(const name of ['r.opaque_input','t.blank']){
    const entry=result.entries.find(row=>row.name===name);
    assert.equal(entry?.sensitive,true);assert.equal(entry.value,null);assert.equal(entry.resolved,true);
  }
  assert.deepEqual(result.unresolved,[]);
});

test('reviewed case values and explicit blanks retain backend and engine source priority',()=>{
 const policy={version:2,case:{parameter_overrides:['t.name','r.empty']},suite:{},run:{}};
 const caseSnapshot={parameter_values:{'t.name':'Reviewed Person','r.empty':''},test_data_options:{runtime_policy:policy},
  test_data_set_snapshot:{mode:'table',rows:[{'t.name':'Dataset Person','r.empty':'dataset default'}],parameter_data_layers:{case:{rows:[{'t.name':'Dataset Person','r.empty':'dataset default'}]}}}};
 const execution={test_configuration:{snapshot:{variables:[{key:'t.name',value:'Configuration Person'},{key:'r.empty',value:'configuration default'}]}}};
 const result=resolveExecutionParameterContext({caseSnapshot,execution});
 assert.equal(result.values['t.name'],'Reviewed Person');assert.equal(result.values['r.empty'],'');
 assert.equal(resolveExecutionParameterContext({caseSnapshot,execution:{...execution,parameter_values:{'t.name':'Explicit Run'}}}).values['t.name'],'Explicit Run');
 assert.equal(resolveExecutionParameterContext({caseSnapshot,execution,capturedValues:{'t.name':'Captured'}}).values['t.name'],'Captured');
});

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

test('shared step contexts isolate group values and select protected rows for table and key/value sources', () => {
  const caseSnapshot = { test_data_set_snapshot: { name:'Case data', mode:'table', columns:['login'], rows:[{login:'case'}], shared_rows:[{}] } };
  for(const login of ['group-one','group-two']) {
    const stepSnapshot = { group_kind:'reusable', shared_parameter_values:{login} };
    const resolved = resolveExecutionParameterContext({execution:null,caseSnapshot,stepSnapshot});
    assert.equal(resolved.values['r.login'],login);
  }
  assert.equal(resolveExecutionParameterContext({execution:null,caseSnapshot}).values['r.login'],'case');
  const keyValue = {...caseSnapshot,test_data_set_snapshot:{mode:'key_value',rows:[{key:'login',value:'suite'}],shared_rows:[{'r.login':'suite'}]}};
  assert.equal(resolveExecutionParameterContext({execution:null,caseSnapshot:keyValue,stepSnapshot:{group_kind:'reusable',shared_parameter_values:{login:'group'}}}).values['r.login'],'suite');
  const secret = resolveExecutionParameterContext({execution:null,caseSnapshot:null,stepSnapshot:{group_kind:'reusable',shared_parameter_values:{},shared_parameter_sensitive_names:['r.login']}});
  assert.equal(secret.entries[0].sensitive,true);
  assert.deepEqual(secret.values,{});
});

test('frozen hierarchy displays the same protected values and sources as runtime execution', async () => {
  const { composeScopedTestData } = await import('../../../platform/backend/src/utils/scopedTestData.js');
  const { resolveParameterLayers } = await import('../../../platform/backend/src/utils/stepParameterResolution.js');
  for (const override of [false,true]) {
    const snapshot=composeScopedTestData({hierarchical:true,caseData:{mode:'table',rows:[{'t.case':'case row','r.shared':'case row'}]},
      suiteData:{mode:'table',rows:[{'s.suite':'suite row'}]},runData:{mode:'table',rows:[{'t.case':'run row','s.suite':'run row','r.shared':'run row'}]},
      caseOptions:{override_shared_steps:false},runOptions:{override_test_case_data:override,override_suite_data:override,override_shared_steps:override},sharedNames:new Set(['r.shared'])}).snapshot;
    const caseSnapshot={parameter_values:{'t.default':'case default'},suite_parameter_values:{'s.default':'suite default'},test_data_set_snapshot:snapshot,test_data_options:{runtime_policy:snapshot.data_scope_policy}};
    const execution={parameter_values:{'t.default':'run default','s.default':'run default'}};
    const stepSnapshot={group_kind:'reusable',group_name:'Login',shared_parameter_values:{'r.shared':'group default'}};
    const expected=resolveParameterLayers({caseValues:caseSnapshot.parameter_values,suiteValues:caseSnapshot.suite_parameter_values,runValues:execution.parameter_values,dataSet:snapshot,sharedValues:stepSnapshot.shared_parameter_values,isSharedStep:true});
    const actual=resolveExecutionParameterContext({caseSnapshot,execution,stepSnapshot});
    assert.deepEqual(actual.values,expected);
    assert.equal(actual.entries.find(item=>item.name==='r.shared').sourceLabel,override?'Run data · Row 1':'Login');
  }
});
