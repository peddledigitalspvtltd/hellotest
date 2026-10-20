import assert from 'node:assert/strict';
import test from 'node:test';
import {formatAutomationSourceLines,joinAutomationInstructions,readAutomationInstructions,stripAutomationSettingsComments} from '../../frontend/lib/automationInstructions.ts';

test('statements on one line become separate instructions while multiline syntax stays together',()=>{
 const code='await web.goto("/login"); await web.fill(\n  "Login.Email",\n  params["t.email"]\n); if (ready) { await web.click("Login.Submit"); await web.expectText("Ready"); }';
 const document=readAutomationInstructions(code);
 assert.equal(document.valid,true);assert.equal(document.instructions.length,3);
 assert.equal(document.instructions[1].source,'await web.fill(\n  "Login.Email",\n  params["t.email"]\n);');
 assert.match(document.instructions[2].source,/^if \(ready\) \{/);
 const reordered=joinAutomationInstructions(document,[document.instructions[1],document.instructions[0],document.instructions[2]]);
 assert.ok(reordered.indexOf('web.fill')<reordered.indexOf('web.goto'));
 assert.equal(readAutomationInstructions(reordered).valid,true);
});

test('instruction edits retain settings, comments and literal template metadata',()=>{
 const code='// @hellotest-options skip\nawait web.click("Submit"); // recorded button\nconst message = `first\n// @hellotest-options literal\nlast`;\nawait web.expectText(message);';
 const document=readAutomationInstructions(code);
 assert.equal(document.instructions.length,3);
 assert.match(document.instructions[0].source,/recorded button$/);
 assert.match(document.instructions[1].source,/@hellotest-options literal/);
 const moved=joinAutomationInstructions(document,[document.instructions[1],document.instructions[0],document.instructions[2]]);
 assert.match(moved,/^\/\/ @hellotest-options skip\n/);
 assert.equal(readAutomationInstructions(moved).valid,true);
 const visible=stripAutomationSettingsComments(code);
 assert.doesNotMatch(visible,/@hellotest-options skip/);assert.match(visible,/@hellotest-options literal/);
});

test('readable formatting preserves executable behavior, nested blocks, regexes and template bytes',async()=>{
 const code='const events=[]; const note=`line 1\nline 2; literal`; if (true) { events.push(note); events.push(/a;b/.test("a;b")); } for (const item of [1,2]) { events.push(item); } return events;';
 const formatted=formatAutomationSourceLines(code);
 assert.match(formatted,/; \nconst note/);assert.match(formatted,/\{ \n  events.push/);
 assert.match(formatted,/`line 1\nline 2; literal`/);
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 assert.deepEqual(await new AsyncFunction(formatted)(),await new AsyncFunction(code)());
 assert.equal(readAutomationInstructions(formatted).valid,true);
});

test('incomplete drafts stay intact instead of splitting multiline JavaScript',()=>{
 const code='await web.fill(\n  "Login.Email",\n';
 const document=readAutomationInstructions(code);
 assert.equal(document.valid,false);assert.equal(document.instructions.length,1);assert.equal(document.instructions[0].source,code);
 assert.equal(formatAutomationSourceLines(code),code);
});

test('a single Playwright entry exposes body instructions without changing imports, hooks or wrapper',()=>{
 const code='import { test } from "@playwright/test";\ntest.beforeEach(async ({page}) => { await page.goto("/login"); });\ntest("Checkout", async ({page}) => {\n await page.fill("#email", "user"); await page.click("#submit");\n});\n';
 const document=readAutomationInstructions(code,{unwrapEntry:true});
 assert.equal(document.framed,true);assert.equal(document.instructions.length,2);
 assert.match(document.prefix,/import \{ test \}/);assert.match(document.prefix,/test.beforeEach/);
 const changed=joinAutomationInstructions(document,[document.instructions[1],document.instructions[0]]);
 assert.ok(changed.startsWith(document.prefix));assert.ok(changed.endsWith(document.suffix));
 assert.ok(changed.indexOf('page.click')<changed.indexOf('page.fill'));
 assert.equal(readAutomationInstructions(changed,{unwrapEntry:true}).valid,true);
 const ambiguous='test("A", async () => { await first(); }); test("B", async () => { await second(); });';
 assert.equal(readAutomationInstructions(ambiguous,{unwrapEntry:true}).framed,false);
 assert.equal(readAutomationInstructions(ambiguous,{unwrapEntry:true}).instructions.length,2);
});
