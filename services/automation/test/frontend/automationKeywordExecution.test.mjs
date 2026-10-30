import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { isAutomationStepMapped } from "../../frontend/lib/automationStepPersistence.ts";
import { automationNumericArgument, automationParameterArgument, getAutomationKeywordInputSpec, parseAutomationKeywordCall } from "../../frontend/lib/automationKeywordInputs.ts";

const pageSource = readFileSync(new URL("../../frontend/pages/AutomationPage.tsx", import.meta.url), "utf8");
const sourceFile = ts.createSourceFile("AutomationPage.tsx", pageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = ["buildAutomationCodeFromDraft", "parseAutomationStepDraft", "inferAutomationStepType", "AUTOMATION_KEYWORDS_BY_TYPE"];
const selected = sourceFile.statements.filter((node) => declarations.includes(node.name?.text) || (ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) => declarations.includes(declaration.name.getText(sourceFile)))));
const script = ts.transpileModule(selected.map((node) => node.getText(sourceFile)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const { buildAutomationCodeFromDraft: build, parseAutomationStepDraft: parse } = new Function("automationNumericArgument", "automationParameterArgument", "getAutomationKeywordInputSpec", "parseAutomationKeywordCall", `${script}\nreturn { buildAutomationCodeFromDraft, parseAutomationStepDraft };`)(automationNumericArgument, automationParameterArgument, getAutomationKeywordInputSpec, parseAutomationKeywordCall);
const planExports = {};
new Function("require", "exports", ts.transpileModule(readFileSync(new URL("../../frontend/lib/automationPlan.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(() => ({ getAutomationKeywordInputSpec }), planExports);
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

test("saving executable code clears a competing legacy request while prose/options saves retain it", async () => {
  const start = pageSource.indexOf("  const updateAutomationStepCode = useMutation({");
  const fnStart = pageSource.indexOf("mutationFn:", start) + "mutationFn:".length;
  const fnEnd = pageSource.indexOf("\n    onSuccess:", fnStart);
  const mutationScript = ts.transpileModule(`const mutation = ${pageSource.slice(fnStart, fnEnd).trim().replace(/,$/, "")};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  async function save(code) {
    let payload;
    const step = { id: "api", test_case_id: "case", step_type: "web", automation_code: 'await api.request("GET /old");', api_request: { method: "GET", url: "/old" } };
    const context = { isAutomationStepMapped, canEditAutomationCode: true, stepCodeDrafts: { api: code }, stepOptionDrafts: {}, stepDrafts: { api: { name: "Updated action", expected_result: "Updated result" } }, applyAutomationStepOptions: (value) => value, parseAutomationStepOptions: () => ({}), parseAutomationStepDraft: parse, buildAutomationStepAction: (value) => value.name, api: { testSteps: { update: async (_id, input) => { payload = input; } } }, refreshAutomationStepAfterSave: async () => step };
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
