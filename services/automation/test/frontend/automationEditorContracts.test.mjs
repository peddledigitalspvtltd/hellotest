import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import Ajv from "ajv";
import { automationNumericArgument, automationParameterArgument, automationStringArgument, getAutomationKeywordInputSpec, parseAutomationKeywordCall } from "../../frontend/lib/automationKeywordInputs.ts";
import { markExpressionParameterBindings, usesExpressionParameterBindings } from "../../shared/automationParameterMode.mjs";

const require = createRequire(import.meta.url);
const { validateAuthoredApiRequest } = require("../../../platform/backend/src/utils/testStepAutomation.js");
const dependencies = { automationNumericArgument, automationParameterArgument, automationStringArgument, getAutomationKeywordInputSpec, parseAutomationKeywordCall, markExpressionParameterBindings, usesExpressionParameterBindings, Ajv };
function loadDeclarations(path, names, context) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const selected = tree.statements.filter(node => names.includes(node.name?.text) || ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => names.includes(declaration.name.getText(tree))));
  const script = ts.transpileModule(selected.map(node => node.getText(tree).replace(/^export /, "")).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(context), `${script}\nreturn {${names.join(",")}};`)(...Object.values(context));
}
const draftLib = loadDeclarations("../../frontend/lib/automationStepDraft.ts", ["AUTOMATION_KEYWORDS_BY_TYPE", "buildAutomationCodeFromDraft", "buildAutomationApiRequest", "parseApiHeaderDraft"], dependencies);
const editor = loadDeclarations("../../frontend/components/StepAutomationEditor.tsx", ["WEB_KEYWORD_OPTIONS", "ANDROID_KEYWORD_OPTIONS", "buildWebKeywordSnippet", "buildAndroidKeywordSnippet", "quoteCodeString", "formatOptionsObject", "playwrightLocatorExpression", "evaluateValidationResult", "compareApiValidationValues", "areAssertionValuesEqual", "createValidationLabel", "parseAssertionExpectedValue", "readJsonPathValue", "parseJsonPath", "stringifyJsonSelectionValue", "readPreviewCaptureValue", "apiValidationOperatorOptions"], {
  ...dependencies, ...draftLib,
  resolveStepParameterText: (value, params) => String(value || "").replace(/@[tsr]\.[\w-]+/gi, match => params[match.slice(1).toLowerCase()] ?? match)
});
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const draft = overrides => ({ step_type: "api", keyword: "api.request", objectRef: "https://api.example.test/orders", value: "", apiMethod: "GET", apiHeaders: "", apiBodyMode: "none", apiExpectedStatus: "200", ...overrides });
const preview = overrides => ({ response: { status: 200, headers: { "content-type": "application/json", "x-empty": "" }, duration_ms: 30, body_text: '{"id":"wrong type","count":"12"}', body_json: { id: "wrong type", count: "12" }, ...overrides } });

test("API editor preserves scoped and invalid authored status assertions for authoritative validation", () => {
  for (const expected of ["201", "@t.expectedStatus", "@s.[expected status]", "@r.status"]) {
    const request = draftLib.buildAutomationApiRequest(draft({ apiExpectedStatus: expected }));
    assert.deepEqual(request.validations, [{ kind: "status", expected }]);
    assert.doesNotThrow(() => validateAuthoredApiRequest(request));
  }
  const invalid = draftLib.buildAutomationApiRequest(draft({ apiExpectedStatus: "201garbage" }));
  assert.equal(invalid.validations[0].expected, "201garbage");
  assert.throws(() => validateAuthoredApiRequest(invalid), /HTTP status/);
  const existing = { method: "GET", url: "/before", headers: [], body_mode: "none", validations: [], captures: [{ path: "$.id", parameter: "@r.id" }], auth: { type: "bearer", credential_reference: "configured-token" }, timeout_ms: 12345, follow_redirects: false };
  const edited = draftLib.buildAutomationApiRequest(draft({ objectRef: "/after" }), existing);
  assert.deepEqual(edited.validations, []);
  assert.deepEqual(edited.captures, existing.captures);
  assert.deepEqual(edited.auth, existing.auth);
  assert.equal(edited.timeout_ms, 12345);
  assert.equal(edited.follow_redirects, false);
});

test("every selectable action is available in the full editor and API actions are canonical requests", () => {
  assert.deepEqual(draftLib.AUTOMATION_KEYWORDS_BY_TYPE.api, ["api.request"]);
  const web = new Set(editor.WEB_KEYWORD_OPTIONS.map(option => `web.${option.id}`));
  const mobile = new Set(editor.ANDROID_KEYWORD_OPTIONS.map(option => option.id));
  for (const keyword of draftLib.AUTOMATION_KEYWORDS_BY_TYPE.web) assert.ok(web.has(keyword), keyword);
  for (const type of ["android", "ios"]) for (const keyword of draftLib.AUTOMATION_KEYWORDS_BY_TYPE[type]) assert.ok(mobile.has(keyword.split(".")[1]), keyword);
});

test("full editor native verification snippets execute the requested assertions", async () => {
  const methods = { expectHidden: "toBeHidden", expectEnabled: "toBeEnabled", expectDisabled: "toBeDisabled", expectChecked: "toBeChecked", expectUnchecked: "not.toBeChecked", expectEditable: "toBeEditable", expectFocused: "toBeFocused", expectEmpty: "toBeEmpty", expectCount: "toHaveCount", expectValue: "toHaveValue" };
  for (const [id, expectedMethod] of Object.entries(methods)) {
    const calls = [];
    const assertions = new Proxy({}, { get: (_target, method) => method === "not" ? { toBeChecked: async () => calls.push(["not.toBeChecked"]) } : async (...args) => calls.push([method, ...args]) });
    const source = editor.buildWebKeywordSnippet({ id }, "Form.Field", id === "expectCount" ? "3" : "expected");
    await new AsyncFunction("page", "expect", source)({ locator: target => ({ target }) }, () => assertions);
    assert.equal(calls[0][0], expectedMethod, id);
    if (id === "expectCount") assert.equal(calls[0][1], 3);
    if (id === "expectValue") assert.equal(calls[0][1], "expected");
  }
  assert.equal(editor.buildWebKeywordSnippet({ id: "expectUrl" }, "", "/orders"), 'await web.expectUrl("/orders");');
});

test("full editor preserves all wait states and correct native platform and parameter bindings", async () => {
  for (const state of ["attached", "detached", "visible", "hidden"]) {
    const calls = [];
    await new AsyncFunction("web", editor.buildWebKeywordSnippet({ id: "waitForSelector" }, "Dialog.Status", state))({ waitForSelector: async (...args) => calls.push(args) });
    assert.deepEqual(calls, [["Dialog.Status", state]]);
  }
  for (const platform of ["android", "ios"]) {
    const calls = [];
    const source = editor.buildAndroidKeywordSnippet({ id: "type" }, "Login.Email", "@r.email", platform, true);
    assert.match(source, new RegExp(`await ${platform}\\.type\\(`));
    await new AsyncFunction(platform, "params", source)({ type: async (...args) => calls.push(args) }, { "r.email": "literal@r.other.test" });
    assert.deepEqual(calls, [["Login.Email", "literal@r.other.test"]]);
  }
});

test("partial response body cannot pass assertions or supply captured values while headers and status remain usable", () => {
  const response = preview({ truncated: true });
  for (const kind of ["body_contains", "body_not_contains", "json_path", "json_schema"]) {
    const result = editor.evaluateValidationResult(response, { kind, target: "$.id", expected: kind === "json_schema" ? '{"type":"object"}' : "wrong type" }, 0, {});
    assert.equal(result.passed, false, kind);
    assert.match(result.summary, /truncated/i, kind);
  }
  assert.equal(editor.readPreviewCaptureValue(response, "$.id"), null);
  assert.equal(editor.evaluateValidationResult(response, { kind: "status", expected: "200" }, 0, {}).passed, true);
  assert.equal(editor.evaluateValidationResult(response, { kind: "header_present", target: "content-type" }, 0, {}).passed, true);
});

test("preview JSON schema enforces types and constraints rather than only required names", () => {
  const schema = JSON.stringify({ type: "object", properties: { id: { type: "integer", minimum: 1 } }, required: ["id"] });
  assert.equal(editor.evaluateValidationResult(preview(), { kind: "json_schema", expected: schema }, 0, {}).passed, false);
  assert.equal(editor.evaluateValidationResult(preview({ body_text: '{"id":2}', body_json: { id: 2 } }), { kind: "json_schema", expected: schema }, 0, {}).passed, true);
  assert.equal(editor.evaluateValidationResult(preview({ body_text: "null", body_json: null }), { kind: "json_schema", expected: '{"type":"null"}' }, 0, {}).passed, true);
});

test("preview comparisons follow strict execution semantics and never replace invalid numeric inputs with success defaults", () => {
  for (const expected of ["", "@t.missing", "200bad"]) assert.equal(editor.evaluateValidationResult(preview(), { kind: "status", expected }, 0, {}).passed, false, expected);
  for (const expected of ["", "@t.missing", "-1", "0"]) assert.equal(editor.evaluateValidationResult(preview(), { kind: "response_time", expected }, 0, {}).passed, false, expected);
  assert.equal(editor.evaluateValidationResult(preview(), { kind: "header", target: "missing", operator: "exists" }, 0, {}).passed, false);
  assert.equal(editor.evaluateValidationResult(preview(), { kind: "header", target: "x-empty", operator: "exists" }, 0, {}).passed, true);
  assert.equal(editor.evaluateValidationResult(preview(), { kind: "header_present", target: "x-empty" }, 0, {}).passed, true);
  assert.equal(editor.evaluateValidationResult(preview(), { kind: "json_path", target: "$.count", expected: "12" }, 0, {}).passed, false, "numeric expectations must not equal a string response");
  assert.equal(editor.evaluateValidationResult(preview(), { kind: "json_path", target: "$.count", expected: "12", operator: "gte" }, 0, {}).passed, false);
  assert.equal(editor.evaluateValidationResult(preview(), { kind: "json_path", target: "$.id", expected: ".*", operator: "matches" }, 0, {}).passed, false);
});
