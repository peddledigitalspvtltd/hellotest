import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const exports = {};
const source = readFileSync(new URL("../src/components/AutomationInstructionPreview.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX
} }).outputText;
new Function("require", "exports", compiled)(require, exports);
const render = (props) => renderToStaticMarkup(createElement(exports.AutomationInstructionPreview, {
  sectionName: "Sign in", code: "", ...props
}));

test("instruction preview preserves full recorded/custom program order and comments", () => {
  const code = '// Prepare user\r\nconst user = params["t.user"];\r\nawait web.fill("Login.Email", user);\r\nif (user) {\r\n  await page.evaluate(() => document.title);\r\n}\r\n// @hellotest-options {"optional":true}';
  const lines = exports.automationProgramLines(code);
  assert.deepEqual(lines, [
    "// Prepare user", 'const user = params["t.user"];', 'await web.fill("Login.Email", user);',
    "if (user) {", "  await page.evaluate(() => document.title);", "}"
  ]);
  const html = render({ code });
  assert.equal((html.match(/class="automation-instruction-line(?: is-comment)?"/g) || []).length, 6);
  assert.ok(html.indexOf("Prepare user") < html.indexOf("const user"));
  assert.ok(html.indexOf("const user") < html.indexOf("web.fill"));
  assert.ok(html.indexOf("web.fill") < html.indexOf("page.evaluate"));
  assert.doesNotMatch(html, /@hellotest-options/);
  assert.match(html, /aria-label="Sign in implementation"/);
});

test("instruction preview escapes code content and does not expose editable controls", () => {
  const html = render({ code: 'await web.fill("#message", "<script>alert(1)</script>");' });
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>|<textarea|<input|contenteditable/i);
  assert.match(html, /aria-hidden="true"/);
});

test("structured API and empty programs render useful compact states", () => {
  const request = render({ apiRequest: { method: "POST", url: "https://api.example.test/orders?name=@t.name" } });
  assert.match(request, /POST/);
  assert.match(request, /orders\?name=@t.name/);
  assert.match(request, /aria-label="Sign in API request"/);
  assert.equal((request.match(/class="automation-instruction-line"/g) || []).length, 1);
  assert.match(render({ code: " \n " }), /No instructions yet/);
});

test("an executable API override takes precedence over the stored request preview", () => {
  const html = render({
    code: 'await api.request("GET /current-orders");',
    apiRequest: { method: "POST", url: "https://api.example.test/previous-request" }
  });
  assert.match(html, /current-orders/);
  assert.doesNotMatch(html, /previous-request/);
  assert.match(html, /aria-label="Sign in implementation"/);
});
