import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('plain JS, function helpers and instructions share configured waits and truthful assertions', {timeout:45000}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'hellotest-synchronization-'));
  process.env.ARTIFACT_ROOT = root;
  const { createWebRunSession } = await import('../../dist/lib/webEngine.js');
  const app = Fastify();let sideEffects=0;
  app.get('/side-effect',async()=>{sideEffects++;return{changed:true};});
  app.get('/', async (_req, reply) => reply.type('text/html').send(`<!doctype html><h1>Ready</h1><label>Ready<input id="ready" type="checkbox" checked></label>
    <button id="submit" onclick="setTimeout(()=>document.querySelector('output').textContent='Completed',180)">Submit</button>
    <button id="disabled" disabled>Later</button><output>Waiting</output>`));
  app.get('/slow', async (_req, reply) => { await new Promise(resolve => setTimeout(resolve, 2400)); return reply.type('text/html').send('<h1>Slow page</h1>'); });
  const base = await app.listen({ host:'127.0.0.1', port:0 });
  const session = createWebRunSession({ engine_run_id:'synchronization', browser:'chromium', headless:true, web_engine:{active:'playwright'}, environment:{base_url:base},
    run_timeout_seconds:20, max_repair_attempts:0, timeouts:{action_timeout_ms:1500,assertion_timeout_ms:3000,navigation_timeout_ms:1500},
    artifact_policy:{trace_mode:'off',video_mode:'off',screenshot_on_failure:false,screenshot_on_success:false,capture_console:false,capture_network:false}, steps:[] });
  t.after(async()=>{await session.stop('failed');await app.close();await rm(root,{recursive:true,force:true});});
  await session.start();
  let index=0;
  const run = input => session.runStep({id:`step-${++index}`,order:index,step_type:'web',action:'Fixture section',expected_result:null,...input});
  const helper = await run({ automation_code:'function label() { return "Completed"; }\nawait test.step("submit", async()=>{ await page.locator("#submit").click(); await web.expectText("output",label()); });' });
  assert.equal(helper.status,'passed',helper.note);
  assert.ok(helper.line_results.some(row=>row.status==='passed'));
  const waitForState = await run({automation_code:'await page.evaluate(()=>setTimeout(()=>document.querySelector("#disabled").disabled=false,180));\nawait web.expectEnabled("#disabled");\nawait web.expectHidden("#never-present");'});
  assert.equal(waitForState.status,'passed',waitForState.note);
  for (const action of ['Check #ready','Check #ready','Uncheck #ready','Uncheck #ready']) {
    const result=await run({action});assert.equal(result.status,'passed',result.note);
  }
  assert.equal((await run({automation_code:'await expect(page.locator("#ready")).not.toBeChecked();'})).status,'passed');
  const started=Date.now();
  const missing=await run({automation_code:'await page.locator("#does-not-exist").click();'});
  assert.equal(missing.status,'failed');assert.match(missing.note,/1500ms/);assert.ok(Date.now()-started<4500,'Native actions use the configured default timeout.');
  const unsupported=await run({action:'Click #submit',expected_result:'The system satisfies all enterprise security criteria'});
  assert.equal(unsupported.status,'failed');assert.match(unsupported.note,/explicit assertion/);
  for(const source of [
    `page.goto("${base}/side-effect");`,
    'expect(page.locator("h1")).toHaveText("Ready");',
    `Promise.all([page.goto("${base}/side-effect")]);`,
    'const button=page.locator("#submit");button.click();',
    `const pending=page.goto("${base}/side-effect");`
  ]) {
    const detached=await run({automation_code:source});
    assert.equal(detached.status,'failed');assert.match(detached.note,/browser operation promise|retained browser promise/);
  }
  assert.equal(sideEffects,0,'Detached source is rejected before browser side effects begin.');
  for(const source of [
    'const pending=page.locator("#submit").click();await pending;',
    'const pending=page.locator("#submit").click();await Promise.all([pending]);',
    'const pending=page.locator("#submit").click();const joined=Promise.all([pending]);await joined;',
    'const pending=page.locator("#submit").click();return pending;'
  ]) {
    const owned=await run({automation_code:source});assert.equal(owned.status,'passed',owned.note);
  }
  const slow=await run({automation_code:'await page.goto("/slow");'});
  assert.equal(slow.status,'failed');assert.match(slow.note,/1500ms/);
  const wrapped=await run({automation_code:'import {test,expect} from "@playwright/test";\ntest("one flow",async({page})=>{\n await page.goto("/");\n await test.step("verify",async()=>{await expect(page.locator("#ready")).toBeChecked();});\n});'});
  assert.equal(wrapped.status,'passed',wrapped.note);
  for (const wrapper of [
    '// @hellotest-options screenshotOnFailure\nexport default async function ({ page,expect }) { await expect(page.locator("h1")).toHaveText("Ready"); capture("t.wrapper","default"); }',
    '// @hellotest-options optional\nasync ({ page,expect }) => { await expect(page.locator("h1")).toHaveText("Ready"); capture("t.wrapper","arrow"); }'
  ]) {
    const result=await run({automation_code:wrapper});
    assert.equal(result.status,'passed',result.note);assert.ok(result.captures['t.wrapper'],'A metadata comment must not leave a wrapper uninvoked.');
  }
});
