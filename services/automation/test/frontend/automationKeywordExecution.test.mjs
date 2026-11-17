import { automationOwnerSource, automationWorkspaceSource, findAutomationBinding,automationMutationProperty } from "./helpers/automationWorkspaceSources.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { isAutomationStepMapped, resolveAutomationMappingSave } from "../../frontend/lib/automationStepPersistence.ts";
import { automationNumericArgument, automationParameterArgument, automationStringArgument, getAutomationKeywordInputSpec, parseAutomationKeywordCall } from "../../frontend/lib/automationKeywordInputs.ts";
import { markExpressionParameterBindings, usesExpressionParameterBindings } from "../../shared/automationParameterMode.mjs";

const pageSource = automationWorkspaceSource();
const sourceFile = ts.createSourceFile("automationStepDraft.ts", readFileSync(new URL("../../frontend/lib/automationStepDraft.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = ["buildAutomationCodeFromDraft", "parseAutomationStepDraft", "inferAutomationStepType", "AUTOMATION_KEYWORDS_BY_TYPE"];
const selected = sourceFile.statements.filter((node) => declarations.includes(node.name?.text) || (ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) => declarations.includes(declaration.name.getText(sourceFile)))));
const script = ts.transpileModule(selected.map((node) => node.getText(sourceFile).replace(/^export /, "")).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const { buildAutomationCodeFromDraft: build, parseAutomationStepDraft: parse } = new Function("automationNumericArgument", "automationParameterArgument", "automationStringArgument", "markExpressionParameterBindings", "usesExpressionParameterBindings", "getAutomationKeywordInputSpec", "parseAutomationKeywordCall", `${script}\nreturn { buildAutomationCodeFromDraft, parseAutomationStepDraft };`)(automationNumericArgument, automationParameterArgument, automationStringArgument, markExpressionParameterBindings, usesExpressionParameterBindings, getAutomationKeywordInputSpec, parseAutomationKeywordCall);
const planExports = {};
new Function("require", "exports", ts.transpileModule(readFileSync(new URL("../../frontend/lib/automationPlan.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(() => ({ getAutomationKeywordInputSpec, automationParameterArgument }), planExports);
const draft = (keyword, objectRef = "", value = "") => ({ keyword, objectRef, value, step_type: keyword.startsWith("api") ? "api" : "web", apiMethod: "GET" });
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
async function run(input, params = {}) {
  const calls = [];
  const recorder = (namespace) => new Proxy({}, { get: (_target, keyword) => async (...args) => { calls.push([`${namespace}.${String(keyword)}`, ...args]); } });
  await new AsyncFunction("web", "android", "api", "params", build(input))(recorder("web"), recorder("android"), recorder("api"), params);
  return calls;
}

test("optional targets and no-argument actions remain valid mappings", () => {
  for (const keyword of ["web.openTab", "web.switchTab", "web.closeTab", "web.reload", "mobile.hideKeyboard"]) assert.equal(planExports.automationMappingIsComplete(draft(keyword)), true, keyword);
  for (const keyword of ["web.press", "web.expectText", "web.aiStep"]) assert.equal(planExports.automationMappingIsComplete(draft(keyword, "", "value")), true, keyword);
  for (const keyword of ["web.fill", "web.click", "android.type"]) assert.equal(planExports.automationMappingIsComplete(draft(keyword, "", "value")), false, keyword);
  assert.equal(planExports.automationMappingIsComplete(draft("api.expectStatus", "201")), true);
  assert.equal(planExports.automationMappingIsComplete(draft("api.expectStatus", "@t.[expected status]")), true);
  for (const status of ["", "OK", "20", "600", "201.5"]) assert.equal(planExports.automationMappingIsComplete(draft("api.expectStatus", status)), false, status);
  for (const keyword of ["api.expectJson", "api.capture"]) {
    assert.equal(planExports.automationMappingIsComplete(draft(keyword, "$.id")), false, keyword);
    assert.equal(planExports.automationMappingIsComplete(draft(keyword, "$.id", "@r.id")), true, keyword);
  }
});

test("optional browser targets and stale hidden values generate the intended action", async () => {
  assert.deepEqual(await run(draft("web.expectText", "", "Saved")), [["web.expectText", "Saved"]]);
  assert.deepEqual(await run(draft("web.press", "", "Enter")), [["web.press", null, "Enter"]]);
  assert.deepEqual(await run(draft("web.goto", "/orders", "stale value")), [["web.goto", "/orders"]]);
  assert.deepEqual(await run(draft("web.closeTab")), [["web.closeTab"]]);
  assert.deepEqual(await run(draft("mobile.hideKeyboard", "stale target", "stale value")), [["android.hideKeyboard"]]);
});

test("scrolling honors all directions and resolves selected numeric parameters", async () => {
  for (const [direction, coordinates] of [["right", [250, 0]], ["left", [-250, 0]], ["down", [0, 250]], ["up", [0, -250]]]) {
    assert.deepEqual(await run(draft("web.scroll", direction, "@t.pixels"), { "t.pixels": "250" }), [["web.scroll", ...coordinates]]);
  }
  assert.deepEqual(await run(draft("web.wait", "", "@s.[wait milliseconds]"), { "s.wait milliseconds": "42" }), [["web.wait", 42]]);
  assert.deepEqual(await run(draft("web.wait", "", "0")), [["web.wait", 0]]);
  assert.deepEqual(await run(draft("web.scroll", "@t.direction", "@t.pixels"), { "t.direction": "right", "t.pixels": "12" }), [["web.scroll", 12, 0]]);
  assert.deepEqual(await run(draft("web.waitForLoadState", "", "@t.state"), { "t.state": "networkidle" }), [["web.waitForLoadState", "networkidle"]]);
});

test("mobile swipe keeps zero coordinates and separate start/end fields", async () => {
  assert.deepEqual(await run(draft("mobile.swipe", "0,100", "200,0,@t.duration"), { "t.duration": "300" }), [["android.swipe", 0, 100, 200, 0, 300]]);
  assert.deepEqual(await run(draft("android.scrollIntoView", "Checkout.Pay", "up")), [["android.scrollIntoView", "Checkout.Pay", { direction: "up" }]]);
});

test("every executable browser wait state survives authoring and reopening", async () => {
  for (const state of ["attached", "detached", "visible", "hidden"]) {
    const input = draft("web.waitForSelector", "Dialog.Status", state);
    assert.deepEqual(await run(input), [["web.waitForSelector", "Dialog.Status", state]]);
    const reopened = parse({ automation_code: build(input), step_type: "web" });
    assert.equal(reopened.value, state);
    assert.equal(build(reopened), build(input));
  }
  assert.deepEqual(await run(draft("web.waitForSelector", "Dialog.Status", "@s.waitState"), { "s.waitstate": "detached" }), [["web.waitForSelector", "Dialog.Status", "detached"]]);
});

test("API source-only legacy options retain source compatibility after leaving the runnable catalog", () => {
  const oldCode = 'await api.expectJson("$.id", "42");';
  const reopened = parse({ automation_code: oldCode, step_type: "api" });
  assert.equal(reopened.keyword, "api.expectJson");
  assert.equal(build(reopened), oldCode);
  assert.deepEqual(resolveAutomationMappingSave({ currentCode: oldCode, previousMappingCode: build(reopened), nextMappingCode: build(reopened), mappingUnchanged: true }), { code: oldCode, requiresProgramEditor: false });
  assert.equal(isAutomationStepMapped({ step_type: "api", automation_code: oldCode, api_request: null }), false);
});

test("canonical API drafts and mixed cases reopen under the saved worker contract", () => {
  const request = { method: "POST", url: "/orders", body_mode: "json", body: '{"name":"Order"}' };
  const inferred = parse({ step_type: "web", automation_code: "", api_request: request });
  assert.equal(inferred.step_type, "api");
  assert.equal(inferred.keyword, "api.request");
  assert.equal(inferred.apiMethod, "POST");
  assert.equal(inferred.objectRef, "/orders");
  assert.equal(parse({ step_type: "api", automation_code: 'await web.goto("/orders");', api_request: request }).step_type, "api");
  const web = parse({ step_type: "web", automation_code: 'await web.goto("/web-orders");', api_request: request });
  assert.equal(web.step_type, "web");
  assert.equal(web.objectRef, "/web-orders");
  assert.equal(parse({ step_type: "ios", automation_code: 'await android.tap("~Pay");' }).keyword, "ios.tap");
});

test("stored numeric, nullable, escaped, and ios calls round-trip through keyword fields", () => {
  const step = (automation_code, step_type = "web") => ({ automation_code, step_type, action: "Recorded action", expected_result: "" });
  assert.equal(parse(step("await api.expectStatus(201);", "api")).objectRef, "201");
  assert.deepEqual(parseAutomationKeywordCall('await web.fill("Login.Email", "a\\\"b");\nawait web.click("Login.Submit");').args, ["Login.Email", 'a"b']);
  const key = parse(step('await web.press(null, "Enter");'));
  assert.equal(key.objectRef, "");
  assert.equal(key.value, "Enter");
  const wait = parse(step('await web.wait(Number(params["s.wait milliseconds"]));'));
  assert.equal(wait.value, "@s.[wait milliseconds]");
  for (const direction of ["up", "down", "left", "right"]) {
    for (const distance of ["250", "@t.pixels"]) {
      const scroll = parse(step(build(draft("web.scroll", direction, distance))));
      assert.equal(scroll.objectRef, direction);
      assert.equal(scroll.value, distance);
    }
  }
  const swipe = parse(step("await mobile.swipe(0, 100, 200, 0, 300);", "ios"));
  assert.equal(swipe.objectRef, "0,100");
  assert.equal(swipe.value, "200,0,300");
  assert.equal(parse(step('await ios.tap("Login.Submit");', "ios")).keyword, "ios.tap");
});

test("reopening native scoped parameter arguments keeps bindings instead of saving expression text as data", async () => {
  const step = automation_code => ({ automation_code, step_type: "web", action: "Enter configured value", expected_result: "" });
  const source = 'await web.fill(params["t.account.email"], params[\'s.Display name\']);';
  const reopened = parse(step(source));
  assert.equal(reopened.objectRef, "@t.[account.email]");
  assert.equal(reopened.value, "@s.[display name]");
  assert.equal(build(reopened), 'await web.fill("@t.[account.email]", "@s.[display name]");');
  assert.equal(parseAutomationKeywordCall('await web.fill("#name", params["t.choice]value"]);').args[1], '@t.[choice\\]value]');
  assert.equal(parseAutomationKeywordCall('await web.fill("#name", params[dynamicName]);').args[1], 'params[dynamicName]', 'custom expressions stay in the source editor');
  assert.equal(parseAutomationKeywordCall('await web.wait(Number(params[\'r.Delay\']));').args[0], '@r.delay');
});

test('marked keyword edits retain native argument provenance and emit newly selected data bindings as expressions',async()=>{
 const step=automation_code=>({automation_code,step_type:'web',action:'Enter configured value',expected_result:''});
 const source=markExpressionParameterBindings('await web.fill("#name", params["r.name"]);');
 const reopened=parse(step(source));
 assert.equal(reopened.parameterExpressions,true);assert.equal(reopened.value,'@r.name');
 assert.equal(build(reopened),source);
 const edited=build({...reopened,value:'Hello @r.name'});
 assert.equal(usesExpressionParameterBindings(edited),true);assert.match(edited,/String\(params\["r.name"\]\)/);
 const calls=[];await new AsyncFunction('web','params',edited)({fill:async(...args)=>calls.push(args)},{'r.name':'@r.other'});
 assert.deepEqual(calls,[['#name','Hello @r.other']],'inserted data is a literal after one lookup');
 const literal=markExpressionParameterBindings('await web.fill("#name", "@r.other");');
 const original=parse(step(literal));
 const changedTarget=build({...original,objectRef:'#renamed'});
 assert.match(changedTarget,/fill\("#renamed", "@r.other"\)/);
 assert.doesNotMatch(changedTarget,/params\["r.other"\]/,'unchanged literal input must not become a binding when its target is edited');
});

test("saving executable code clears a competing legacy request while prose/options saves retain it", async () => {
  const mutationScript = ts.transpileModule(`const mutation = ${automationMutationProperty('updateAutomationStepCode','mutationFn','workspaces/case/useAutomationCasePlanActions.tsx')};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  async function save(code) {
    let payload;
    const step = { id: "api", test_case_id: "case", step_type: "web", automation_code: 'await api.request("GET /old");', api_request: { method: "GET", url: "/old" } };
    const context = { isAutomationStepMapped, canEditAutomationCode: true, flushAutomationBuildParameters: async () => {}, stepCodeDrafts: { api: code }, stepOptionDrafts: {}, stepDrafts: { api: { name: "Updated action", expected_result: "Updated result" } }, applyAutomationStepOptions: (value) => value, parseAutomationStepOptions: () => ({}), parseAutomationStepDraft: parse, buildAutomationStepAction: (value) => value.name, api: { testSteps: { update: async (_id, input) => { payload = input; } } }, refreshAutomationStepAfterSave: async () => step };
    context.automationDraftStore = { read: key => ({ steps: context.stepDrafts, options: context.stepOptionDrafts, code: context.stepCodeDrafts, api: {} }[key]) };
    await new Function(...Object.keys(context), `${mutationScript}\nreturn mutation;`)(...Object.values(context))(step);
    return payload;
  }
  const proseSave = await save('await api.request("GET /old");');
  assert.equal(Object.hasOwn(proseSave, "api_request"), false);
  assert.equal(proseSave.action, "Updated action");
  assert.equal(proseSave.expected_result, "Updated result");
  assert.equal((await save('await api.request("GET /new");')).api_request, null);
  assert.equal((await save("")).api_request, null);
});
