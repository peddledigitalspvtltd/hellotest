import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const runtimeUrl = process.env.HELLOTEST_RUNTIME_TEST_BUILD
  ? pathToFileURL(path.join(process.env.HELLOTEST_RUNTIME_TEST_BUILD, "lib/runtimeContext.js"))
  : new URL("../dist/lib/runtimeContext.js", import.meta.url);
const { buildInitialContext, interpolateText, registerContextValue } = await import(runtimeUrl.href);

test('legacy unscoped inputs use inherited test data while explicit namespaces remain isolated',()=>{
 const context=buildInitialContext({case_parameters:{'t.name':'Inherited Person','t.display name':'Display Person'},parameters_frozen:true});
 assert.equal(interpolateText('@name / @[Display name] / @r.name',context),'Inherited Person / Display Person / ');
 registerContextValue(context,'r.name','');
 assert.equal(interpolateText('@name',context),'','an explicit empty runtime value must not borrow a filled case default');
 assert.equal(interpolateText('person@example.test',context),'person@example.test');
});

test('reviewed case inputs beat source data without blocking later explicit run values and captures',()=>{
 const envelope={parameters_frozen:true,case_parameters:{'t.name':'Reviewed Person','r.empty':''},configuration:{variables:[{key:'t.name',value:'Configuration Person'},{key:'r.empty',value:'configuration default'}]},
  data_set:{mode:'table',parameter_data_layers:{case:{rows:[{'t.name':'Dataset Person','r.empty':'dataset default'}]}}},data_policy:{version:2,case:{parameter_overrides:['t.name','r.empty']},suite:{},run:{}}};
 assert.equal(buildInitialContext(envelope).values['t.name'],'Reviewed Person');
 assert.equal(buildInitialContext(envelope).values['r.empty'],'');
 assert.equal(buildInitialContext({...envelope,run_parameters:{'t.name':'Explicit Run'}}).values['t.name'],'Explicit Run');
 assert.equal(buildInitialContext(envelope,{'t.name':'Captured'}).values['t.name'],'Captured');
});

test("data-set column references resolve spaces, dots, numeric prefixes and escaped delimiters", () => {
  const context = buildInitialContext({ data_set: { mode: "table", rows: [{
    "First Name": "Jay", "account.email": "jay@example.test", "2FA": "enabled", "choice]value": "yes", "folder\\name": "docs"
  }] } });
  assert.equal(interpolateText("@r.[First Name] <@r.[account.email]> @r.[2FA] @r.[choice\\]value] @r.[folder\\\\name]", context),
    "Jay <jay@example.test> enabled yes docs");
});

test("quoted suite/run captures keep their scope and do not fall back to test parameters", () => {
  const context = { values: { "t.build number": "test" } };
  registerContextValue(context, "@s.[Build Number]", "suite");
  registerContextValue(context, "@r.[Build Number]", "run");
  assert.equal(interpolateText("@t.[Build Number] @s.[Build Number] @r.[Build Number]", context), "test suite run");
  assert.equal(interpolateText("@s.[Missing Value]", context), "");
});

test("resolved column contents remain literal and ordinary references remain compatible", () => {
  const context = { values: { "t.first name": "@t.email", "t.email": "resolved", "s.tenant": "Acme", "t.t": "unintended" } };
  assert.equal(interpolateText("@t.[First Name] @t.email @s.tenant", context), "@t.email resolved Acme");
  assert.equal(interpolateText("mail@t.email", context), "mail@t.email");
  assert.equal(interpolateText("@t. @s. @r.", context), "@t. @s. @r.");
});

test("selected data rows override case defaults for quoted columns", () => {
  const context = buildInitialContext({
    case_parameters: { "first name": "override" },
    data_set: { source: "test_case", mode: "table", rows: [{ "First Name": "inherited" }] }
  });
  assert.equal(interpolateText("@r.[First Name]", context), "inherited");
});
