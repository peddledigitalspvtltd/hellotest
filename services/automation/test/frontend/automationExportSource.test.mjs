import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "acorn";
import { createRequire } from "node:module";
import { prepareAutomationExportSource as prepare } from "../../frontend/lib/automationExportSource.ts";
const ts = createRequire(new URL("../../../../package.json",import.meta.url))("typescript");

const run = async (source, options = {}) => {
  const result = prepare(source, 0, options), calls = [];
  assert.equal(result.issue, undefined);
  const page = { goto: async value => calls.push(value) };
  const bindings = { page, playwrightPage: page, web: {}, driver: undefined };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const executable = options.typescript ? ts.transpileModule(result.code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText : result.code;
  await new AsyncFunction("page", "request", "context", "browser", "browserName", "testInfo", "web", "expect", "params", "capture", "test", "playwrightPage", "driver", "bindings", executable)(page, {}, {}, {}, "chromium", { title: "Standalone" }, {}, value => assert.equal(value, "Standalone"), {}, () => {}, () => { throw new Error("Nested test registration"); }, page, undefined, bindings);
  return { result, calls };
};

test("Playwright imports and aliased callbacks become one invoked section without nested tests", async () => {
  const { result, calls } = await run(`import {test as scenario,expect as check} from '@playwright/test';
scenario('Saved wrapper',async ({page:currentPage},info)=>{await currentPage.goto('/wrapper');check(info.title);});`);
  assert.deepEqual(calls, ["/wrapper"]);
  assert.deepEqual(result.imports, []);
  assert.doesNotMatch(result.code, /scenario\('Saved wrapper'/);
});

test("CommonJS Playwright imports are replaced without losing the test body", async () => {
  const { calls } = await run(`const {test,expect}=require('playwright/test');test('Saved',async({page})=>{await page.goto('/commonjs');});`);
  assert.deepEqual(calls, ["/commonjs"]);
});

test("supported automation function wrappers execute rather than becoming unused expressions", async () => {
  for (const source of [
    `async ({page})=>{await page.goto('/function');}`,
    `async ({playwrightPage,bindings})=>{if(playwrightPage!==bindings.playwrightPage)throw new Error('Mismatched page binding');await playwrightPage.goto('/function');}`,
    `export default async function automation({page}){await page.goto('/function');}`,
    `module.exports=async function(page,web){await page.goto('/function');}`
  ]) assert.deepEqual((await run(source)).calls, ["/function"]);
});

test("external imports stay at module level with per-section aliases and dependency notes", () => {
  const result = prepare(`import helper from './helpers.mjs';import {expectValue as check} from 'custom-checks';await helper(page);check(params);`, 3);
  assert.equal(result.issue, undefined);
  assert.deepEqual(result.dependencies, ["./helpers.mjs", "custom-checks"]);
  assert.match(result.imports.join("\n"), /__qaira_section_3_import_0/);
  assert.match(result.code, /const helper = __qaira_section_3_import_0/);
  assert.doesNotMatch(result.code, /import helper from/);
  parse(result.imports.join("\n"), { ecmaVersion: "latest", sourceType: "module" });
});

test("hooks, selection, multiple tests and invalid programs produce explicit export failures", () => {
  for (const source of [
    `test.beforeEach(async()=>{});test('one',async()=>{});`,
    `test.describe.configure({mode:'parallel'});`,
    `test['skip']('one',async()=>{});`,
    `test('one',async()=>{});test('two',async()=>{});`,
    `await import('@hellotest' + '/runtime');`,
    `await page.goto(`
  ]) {
    const result = prepare(source, 0);
    assert.ok(result.issue);
    assert.match(result.code, /^throw new Error\("Standalone export blocked:/);
    assert.deepEqual(result.imports, []);
    parse(result.code, { ecmaVersion: "latest", sourceType: "module" });
  }
});

test("application-only imports are blocked instead of leaking unresolved dependencies into the spec", () => {
  for (const source of [
    `import {web} from '@hellotest/automation/runtime';await web.click('#save');`,
    `await import('@hellotest/platform/backend');`,
    `import helper from '/services/automation/private';await helper();`,
    `const helper=require('@/internal');`
  ]) {
    const result = prepare(source, 0);
    assert.match(result.issue, /unavailable outside HelloTest/);
    assert.deepEqual(result.imports, []);
    assert.match(result.code, /^throw new Error/);
  }
});

test("empty instructions and empty entry points cannot become passing exported tests", () => {
  for (const source of ["", "// Retry the missing setup later", "import './setup.js';", "export default async function(){/* TODO */}", "test('Pending',async()=>{return;});"]) {
    const result=prepare(source,0,{typescript:true});
    assert.match(result.issue,/no executable instructions/);
    assert.match(result.code,/^throw new Error/);
  }
});

test("TypeScript compatibility annotations preserve callback behavior and source literal bytes", async () => {
  const input = "async function automation(page,web){const one = value => value;const two = (value='default')=>value;const rest=(...values)=>values[0];const literal=`first\nsecond`;if(literal!=='first\\nsecond')throw new Error('Literal changed');await page.goto(one(two(rest('/typed'))));}";
  const {result,calls}=await run(input,{typescript:true});
  assert.deepEqual(calls,["/typed"]);
  assert.match(result.code,/value: any/);
  assert.match(result.code,/\.\.\.values: any\[\]/);
  assert.ok(result.code.includes("`first\nsecond`"));
  assert.doesNotMatch(result.code,/@ts-(?:ignore|nocheck)/);
});
