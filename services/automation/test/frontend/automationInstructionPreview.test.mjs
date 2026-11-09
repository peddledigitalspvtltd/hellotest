import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";


import ts from "typescript";
import * as instructions from "../../frontend/lib/automationInstructions.ts";
import {readableAutomation} from "../helpers/readableAutomationLoader.mjs";
import * as instructionMapping from "../../shared/automationInstructionMapping.mjs";

const require = createRequire(new URL('../../../platform/frontend/package.json', import.meta.url));
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const exports = {};
const source = readFileSync(new URL("../../frontend/components/AutomationInstructionPreview.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX
} }).outputText;
new Function("require", "exports", compiled)(specifier => specifier === "../lib/automationInstructions" ? instructions : specifier === "../lib/automationReadableInstructions" ? readableAutomation : specifier === "../../shared/automationInstructionMapping.mjs" ? instructionMapping : require(specifier), exports);
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
  const apiRequest = { method: "POST", url: "https://api.example.test/orders?name=@t.name", validations: [{kind:"status",expected:"201"}], captures: [{parameter:"@r.order",path:"$.id"}] };
  const request = render({ apiRequest, view: "instructions" });
  assert.match(request, /POST/);
  assert.match(request, /orders\?name=@t.name/);
  assert.match(request, /aria-label="Sign in API request"/);
  assert.equal((request.match(/class="automation-instruction-line"/g) || []).length, 3);
  const source = render({apiRequest,view:"source"});
  assert.match(source, /validations/);
  assert.match(source, /201/);
  assert.match(source, /captures/);
  assert.match(source, /@r.order/);
  assert.equal((source.match(/class="automation-instruction-line"/g) || []).length, JSON.stringify(apiRequest,null,2).split("\n").length);
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


test("multiple commands on one physical line render as separate readable instructions", () => {
  const html = render({code:'await web.goto("/login"); await web.fill("#email", "user");',view:"instructions"});
  assert.equal((html.match(/class="automation-instruction-line"/g)||[]).length,2);
  assert.ok(html.indexOf("Open URL")<html.indexOf("Type"));
  const source=render({code:'await web.goto("/login"); await web.fill("#email", "user");',view:"source"});
  assert.equal((source.match(/class="automation-instruction-line"/g)||[]).length,2);
});

test("mapped instructions render in Instructions while Source retains the authoritative Playwright code", () => {
  const code='await page.getByRole("button", {name:"Place order",exact:true}).click({timeout:1234});';
  const source_sha256=instructionMapping.automationSourceSha256(code);
  const mapping={schema:'hellotest.playwrightInstructions.v1',step_id:'order',source_sha256,
    operations:[{operation_id:'op-1',source_sha256,start:0,end:code.length,kind:'action',depth:0}],
    instructions:[{operation_id:'op-1',label:'Click checkout button',args:['Place order','timeout 1234 ms'],kind:'action',depth:0}]};
  const mapped=render({code,stepId:'order',instructionMapping:mapping,view:'instructions'});
  assert.match(mapped,/Click checkout button/);assert.match(mapped,/timeout 1234 ms/);
  assert.doesNotMatch(mapped,/getByRole/);
  const source=render({code,stepId:'order',instructionMapping:mapping,view:'source'});
  assert.match(source,/getByRole/);assert.match(source,/timeout:1234/);assert.doesNotMatch(source,/Click checkout button/);
  for(const props of [{code:code.replace('1234','4321')},{stepId:'other'},{instructionMapping:{...mapping,operations:[{...mapping.operations[0],source_sha256:'0'.repeat(64)}]}}]){
    const stale=render({code,stepId:'order',instructionMapping:mapping,view:'instructions',...props});
    assert.doesNotMatch(stale,/Click checkout button/,'source edits, foreign steps and stale operation hashes must use the source parser');
    assert.match(stale,/Click/);
  }
});
