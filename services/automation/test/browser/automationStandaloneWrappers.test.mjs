import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { writeFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { spawn } from "node:child_process";

const require = createRequire(new URL("../../../../testengine/backend/package.json", import.meta.url));
const { chromium } = require("playwright");
import { assertTypeScriptExportCompiles } from "./playwrightExportFixture.mjs";
const root = new URL("../../../platform/frontend/", import.meta.url);
const { normalizeGeneratedProgram } = createRequire(import.meta.url)("../../backend/lib/automationGeneratedProgram.js");

test("standalone source executes imported test/function wrappers and local dependencies without HelloTest", { timeout: 90000 }, async () => {
  const server = createServer((req, res) => {
    if (req.url.startsWith("/data")) {
      res.setHeader("Content-Type", "application/json");
      if (new URL(req.url, "http://fixture").searchParams.get("fixture_token") !== "fixture-credential") { res.statusCode = 401; res.end("{}"); return; }
      res.end(JSON.stringify({ "display names": [{ value: "Alice" }] }));
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end('<input placeholder="Display name"><button onclick="document.querySelector(\'p\').textContent=document.querySelector(\'input\').value">Submit</button><p></p><button title="Help">Help</button><img alt="Fixture logo">');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const name = `standalone-wrappers-${randomUUID()}`;
  const directory = await mkdtemp(path.join(tmpdir(), "qaira-standalone-wrappers-"));
  let browser;
  try {
    const steps = [
      { id: "wrapped", step_order: 1, action: "Fill the configured user", step_type: "web", automation_code: `import {test as scenario,expect as check} from '@playwright/test';
scenario('Saved case',async ({page:currentPage},info)=>{await currentPage.locator('Form.Name').fill('@t.name');check(info.title).toContain('Standalone flow');});` },
      { id: "function", step_order: 2, action: "Submit the user", step_type: "web", automation_code: `export default async function({page,web}){await web.click('Form.Submit');await expect(page.locator('p')).toHaveText('Alice');}` },
      { id: "local-import", step_order: 3, action: "Check local dependency", step_type: "web", automation_code: `import {check} from './local-check.mjs';await check(page,'Alice');` },
      { id: "same-name-import", step_order: 4, action: "Check isolated import", step_type: "web", automation_code: `import {check} from './second-check.mjs';await check(page,'Alice');` },
      { id: "namespace", step_order: 5, action: "Check namespace wrapper", step_type: "web", automation_code: `import * as pw from '@playwright/test';pw.test('Namespace wrapper',async({page})=>{await pw.expect(page.locator('p')).toHaveText('Alice');});` },
      { id: "quoted-json-path", step_order: 6, action: "Capture a quoted JSON path", step_type: "api", api_request: { method: "GET", url: "/data", auth: { type: "api_key", credential_reference: "QAIRA_FIXTURE_API_TOKEN", key_name: "fixture_token", location: "query" }, validations: [{ kind: "json_path", target: "$['display names'][0].value", expected: "Alice" },{kind:"json_schema",expected:JSON.stringify({type:"object",required:["display names"],properties:{"display names":{type:"array"}}})}], captures: [{ path: "$['display names'][0].value", parameter: "@r.user" }] } },
      { id: "capture", step_order: 7, action: "Reuse the API capture", step_type: "web", automation_code: `const {test,expect}=require('playwright/test');test('Capture',async({page})=>{await web.expectText('p','@r.user');});` },
      { id: "skipped-import", step_order: 8, action: "Skip unavailable dependency", step_type: "web", automation_code: `// @hellotest-options skip\nimport {ghost} from './must-not-resolve.mjs';await ghost();` },
      { id: "generated-wrapper", step_order: 9, action: "Execute normalized Engineer bindings", step_type: "web", automation_code: normalizeGeneratedProgram(`export default async function({playwrightPage,bindings,driver}){await expect(playwrightPage.locator('p')).toHaveText('Alice');await expect(bindings.page.locator('p')).toHaveText('Alice');expect(driver).toBeUndefined();await test.step('Nested check',async()=>{await web.expectText('p','Alice');});}`) }
,
      {"id":"literal-bytes","step_order":10,"action":"Keep multiline literal values exact","step_type":"web","automation_code":"const multiline = `first\nsecond`;\nconst continued = \"first\\\nsecond\";\nexpect(multiline).toBe(\"first\\nsecond\");\nexpect(continued).toBe(\"firstsecond\");"},
      {"id":"raw-wrapper-bindings","step_order":11,"action":"Execute complete raw function bindings","step_type":"web","automation_code":"export default async function({playwrightPage,bindings,driver}){await expect(playwrightPage.locator(\"p\")).toHaveText(\"Alice\");await expect(bindings.playwrightPage.locator(\"p\")).toHaveText(\"Alice\");expect(driver).toBeUndefined();}"},
      {"id":"positional-wrapper-bindings","step_order":12,"action":"Execute positional function bindings","step_type":"web","automation_code":"async function automation(page,web,expect,params,capture,playwrightPage,driver,bindings){await expect(playwrightPage.locator(\"p\")).toHaveText(\"Alice\");await expect(bindings.playwrightPage.locator(\"p\")).toHaveText(\"Alice\");expect(driver).toBeUndefined();}"}
      ,{ id: "repository-guards",step_order:13,action:"Preserve semantic locators and diagnose unresolved repository metadata",step_type:"web",automation_code:`await page.fill('Form.Name','Alice');await page.click('Form.Submit');expect(await page.waitForSelector('Form.Title')).not.toBeNull();await expect(page.locator('form.title')).toBeVisible();await expect(page.locator('Form.Logo')).toHaveAttribute('alt','Fixture logo');await expect(page.locator('title=Help')).toBeVisible();await expect(page.locator('alt=Fixture logo')).toHaveAttribute('alt','Fixture logo');expect(()=>locator("page.getByRole('button',{name:'Submit',checked:true})")).toThrow(/Unsupported repository locator options/);expect(()=>locator("page.getByRole('button',{name:'Help',name:'Submit'})")).toThrow(/Unsupported repository locator options/);expect(()=>locator('Legacy.Field')).toThrow(/Ambiguous historical repository/);expect(()=>locator('Form.Missing')).toThrow(/Missing repository reference/);expect(()=>locator("page.getByWidget('Save')")).toThrow(/Unsupported repository locator method/);expect(()=>locator("page.getByRole('button',{name:\/Save\/})")).toThrow(/requires a literal name/);` }
    ];
    const options = { testCase: { id: "case", title: "Standalone flow" }, baseURL: origin, values: { "t.name": "Alice" }, repository: [
      { id: "name", page_key: "Form", locator_intent: "Name", locator: 'page.getByPlaceholder("Display name")', metadata: { screen_name: "Form", object_name: "Name" } },
      { id: "submit", page_key: "Form", locator_intent: "Submit", locator: 'page.getByRole("button",{"name":"Sub","exact":false}).first()', metadata: { screen_name: "Form", object_name: "Submit" } }
      ,{id:'title',page_key:'Form',locator_intent:'Title',locator:'page.getByTitle("Hel",{"exact":false})',metadata:{screen_name:'Form',object_name:'Title',reference_aliases:['Legacy.Field']}}
      ,{id:'logo',page_key:'Form',locator_intent:'Logo',locator:'page.getByAltText("Fixture logo")',metadata:{screen_name:'Form',object_name:'Logo',reference_aliases:['Legacy.Field']}}
    ], steps };
    const fixture = `import {buildPlaywrightExport} from '/services/automation/frontend/lib/playwrightExport';window.spec=buildPlaywrightExport(${JSON.stringify(options)});window.native=buildPlaywrightExport(${JSON.stringify({ testCase: { id: "native", title: "Native requires Appium" }, values: {}, steps: [{ id: "native", step_order: 1, step_type: "ios", action: "Tap native", automation_code: "await ios.tap('~submit');" }] })});window.hooks=buildPlaywrightExport(${JSON.stringify({ testCase: { id: "hook", title: "Saved hooks" }, values: {}, steps: [{ id: "hooks", step_order: 1, step_type: "web", action: "Suite hooks", automation_code: "test.beforeEach(async()=>{});test('Saved',async()=>{});" }] })});`;
    await writeFile(new URL(`${name}.tsx`, root), fixture);
    await writeFile(new URL(`${name}.html`, root), `<html><body><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${process.env.VITE_TEST_URL || "http://127.0.0.1:5197"}/${name}.html`);
    await page.waitForFunction(() => Boolean(window.spec));
    const { spec, native, hooks } = await page.evaluate(() => ({ spec: window.spec, native: window.native, hooks: window.hooks }));
    assert.deepEqual(errors, []);
    assert.match(spec, /Section 1 \[wrapped\]/);
    assert.match(spec, /External helper file required: \.\/local-check\.mjs/);
    assert.match(spec, /jsonpath-plus/);
    assert.match(spec, /automation\.spec\.ts/);
    assert.match(spec, /Ambiguous historical repository reference/);
    assert.doesNotMatch(spec, /@ts-(?:nocheck|ignore)/);
    assert.doesNotMatch(spec, /@hellotest\//);
    assert.doesNotMatch(spec, /must-not-resolve/);
    assert.match(native, /Export limitation:.*Appium/);
    assert.match(hooks, /Export limitation:.*hooks/);
    const playwrightModule = path.join(path.dirname(require.resolve("playwright/package.json")),"test.mjs");
    const jsonPathModule = require.resolve("jsonpath-plus");
    const ajvModule=require.resolve("ajv");
    const runnable = spec.replaceAll("'@playwright/test'", JSON.stringify(playwrightModule)).replaceAll('"@playwright/test"', JSON.stringify(playwrightModule)).replaceAll("'jsonpath-plus'", JSON.stringify(jsonPathModule)).replaceAll("'ajv'",JSON.stringify(ajvModule));
    await writeFile(path.join(directory, "automation.spec.ts"), spec);
    const helper = `export async function check(page,expected){const value=await page.locator('p').innerText();if(value!==expected)throw new Error('Local helper assertion failed');}`;
    await writeFile(path.join(directory, "local-check.mjs"), helper);
    await writeFile(path.join(directory, "second-check.mjs"), helper);
    assertTypeScriptExportCompiles([path.join(directory, "automation.spec.ts")]);
    await writeFile(path.join(directory, "automation.spec.ts"), runnable);
    await writeFile(path.join(directory, "playwright.config.cjs"), `module.exports=${JSON.stringify({ testDir: directory, testMatch: "*.spec.ts", outputDir: path.join(directory, "results"), workers: 1, reporter: "json", use: { headless: true, launchOptions: { executablePath: process.env.CHROME_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" } } })}`);
    const result = await new Promise(resolve => {
      let output = "", errors = "";
      const child = spawn(process.execPath, [path.join(path.dirname(require.resolve("playwright/package.json")),"cli.js"), "test", "--config", path.join(directory, "playwright.config.cjs")], { env: {...process.env, QAIRA_FIXTURE_API_TOKEN:"fixture-credential"} });
      child.stdout.on("data", chunk => output += chunk);
      child.stderr.on("data", chunk => errors += chunk);
      child.on("close", code => resolve({ code, output, errors }));
    });
    assert.equal(result.code, 0, result.output + "\n" + result.errors);
    const report = JSON.parse(result.output);
    assert.equal(report.stats.expected, 1);
    assert.equal(report.stats.unexpected, 0);
    const attachments = report.suites.flatMap(suite => suite.specs || []).flatMap(spec => spec.tests || []).flatMap(item => item.results || []).flatMap(result => result.attachments || []);
    assert.ok(attachments.some(item => item.contentType === "image/jpeg"), "standalone capture stores compressed JPEG attachments");
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    await Promise.all([rm(new URL(`${name}.tsx`, root), { force: true }), rm(new URL(`${name}.html`, root), { force: true }), rm(directory, { recursive: true, force: true })]);
  }
});
