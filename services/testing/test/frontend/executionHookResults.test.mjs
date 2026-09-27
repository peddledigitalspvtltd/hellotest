import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";

const require = createRequire(new URL("../../../platform/frontend/package.json", import.meta.url));
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const compile = (file, resolve = require) => {
  const exports = {};
  new Function("require", "exports", ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText)(resolve, exports);
  return exports;
};
const logs = compile("../../frontend/lib/executionLogs.ts");
const { ExecutionHookResults } = compile("../../frontend/components/ExecutionHookResults.tsx", id => {
  if (id.endsWith("executionLogs")) return logs;
  if (id.endsWith("executionAttachments")) return {};
  if (id.endsWith("StatusBadge")) return { StatusBadge: ({ value }) => React.createElement("span", {}, value) };
  if (id.endsWith(".css")) return {};
  return require(id);
});
const hookId = "test:post:cleanup:step";
const payload = JSON.stringify({ stepStatuses: { normal: "passed", [hookId]: "failed" }, stepNotes: {
  normal: "MAIN_CASE_STEP", [hookId]: "Delete test order\nCleanup timed out"
}, stepAutomationDetails: { [hookId]: { engine: "web", code: "PRIVATE_HOOK_CODE", line_results: [{ line: 2, status: "failed", attempt: 1, duration_ms: 54 }] } },
stepEvidence: { [hookId]: { attachmentId: "proof", fileName: "cleanup.png" } }, stepApiDetails: { [hookId]: { response: { status: 504 }, assertions: [{ passed: false }] } } });

test("hook failures remain visible with timing and assertions while case steps stay separate", () => {
  const output = renderToStaticMarkup(React.createElement(ExecutionHookResults, { logs: payload }));
  assert.match(output, /open=""/);
  for (const text of ["Delete test order", "Cleanup timed out", "After test", "54 ms", "HTTP 504", "0\/1 assertions passed"]) assert.match(output, new RegExp(text));
  assert.doesNotMatch(output, /MAIN_CASE_STEP|PRIVATE_HOOK_CODE|Open hook evidence/);
});

test("code and evidence require their explicit read permissions", () => {
  const output = renderToStaticMarkup(React.createElement(ExecutionHookResults, { logs: payload, canViewEvidence: true, canViewAutomationCode: true }));
  assert.match(output, /PRIVATE_HOOK_CODE/);
  assert.match(output, /Open hook evidence/);
  assert.equal(renderToStaticMarkup(React.createElement(ExecutionHookResults, { logs: "invalid" })), "");
});

test("a running hook is visible before a final step status arrives", () => {
  const output = renderToStaticMarkup(React.createElement(ExecutionHookResults, { logs: JSON.stringify({ stepAutomationDetails: { "test:pre:setup:step": { status: "running", engine: "android" } } }) }));
  assert.match(output, /Before test/);
  assert.match(output, /running/);
  assert.match(output, /ANDROID/);
});
