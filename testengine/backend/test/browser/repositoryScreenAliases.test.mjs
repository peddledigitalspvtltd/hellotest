import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('merged screen aliases execute helper and native Playwright operations against canonical repository fields',{timeout:45000},async t=>{
  const root=await mkdtemp(join(tmpdir(),'hellotest-screen-alias-'));
  const oldRoot=process.env.ARTIFACT_ROOT;process.env.ARTIFACT_ROOT=root;
  const {createWebRunSession}=await import('../../dist/lib/webEngine.js');
  const app=Fastify();app.get('/',async(_req,reply)=>reply.type('text/html').send('<!doctype html><label>Email<input id="email"></label><button id="primary" onclick="document.querySelector(\'output\').textContent=\'Canonical\'">Primary</button><button id="secondary" onclick="document.querySelector(\'output\').textContent=\'Wrong\'">Secondary</button><output></output>'));
  const base=await app.listen({host:'127.0.0.1',port:0});
  const session=createWebRunSession({engine_run_id:'screen-alias-fixture',browser:'chromium',headless:true,web_engine:{active:'playwright'},environment:{base_url:base},run_timeout_seconds:20,max_repair_attempts:0,artifact_policy:{video_mode:'off',trace_mode:'off',screenshot_on_success:false,screenshot_on_failure:false,capture_console:false,capture_network:false},steps:[],object_repository:[
    {id:'redirect',page_key:'Login',object_name:'Email',locator_intent:'Email',locator:'#retired',metadata:{merged_into_entry_id:'email'}},
    {id:'email',page_key:'Account',object_name:'Email',locator_intent:'Email',locator:'getByRole("textbox", {name: "Email"})',metadata:{reference_aliases:['Login.Email']}},
    {id:'secondary',page_key:'Login',screen_name:'Account',object_name:'Submit',locator_intent:'Login.Submit',locator:'#secondary',reference_aliases:['Login.Submit','Old.Submit']},
    {id:'primary',page_key:'Login',object_name:'Submit',locator_intent:'Submit',locator:'#primary'},
    {id:'conflict',page_key:'Other',object_name:'Submit',locator_intent:'Submit',locator:'#email',metadata:{reference_aliases:['Old.Submit']}}
  ]});
  t.after(async()=>{await session.stop('failed');await app.close();await rm(root,{recursive:true,force:true});if(oldRoot===undefined)delete process.env.ARTIFACT_ROOT;else process.env.ARTIFACT_ROOT=oldRoot;});
  await session.start();
  const passed=await session.runStep({id:'source',order:1,step_type:'web',action:'Use merged fields',automation_code:'await page.fill("Login.Email","reader");\nawait page.locator("Login.Email").press("Tab");\nawait expect(page.locator("Account.Email")).toHaveValue("reader");\nawait page.fill("Login.Email","updated");\nawait expect(page.locator("Account.Email")).toHaveValue("updated");\nconst emailHandle = await page.waitForSelector("Login.Email", {state:"visible"});\nif (!emailHandle) throw new Error("Email handle missing");\nawait emailHandle.dispose();\nawait page.click("Login.Email");\nawait web.click("Login.Submit");\nawait expect(page.locator("output")).toHaveText("Canonical");'});
  assert.equal(passed.status,'passed',passed.note);
  const ambiguous=await session.runStep({id:'ambiguous',order:2,step_type:'web',action:'Reject ambiguous historical field',automation_code:'await web.click("Old.Submit");'});
  assert.equal(ambiguous.status,'failed');assert.match(ambiguous.note,/historical repository reference matches multiple fields/);
});
