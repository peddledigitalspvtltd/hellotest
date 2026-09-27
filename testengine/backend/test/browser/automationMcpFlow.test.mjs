import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerAutomationMcp } from '../../dist/lib/automationMcp.js';
import { createPrivilegedRunGuard, resolveTestEngineSharedSecret } from '../../dist/lib/testEngineSecurity.js';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {connectAutomationBrowser,runAutomationBrowserAgent}=require('../../../../services/automation/backend/lib/automationBrowserAgent.js');

test('backend agent uses real MCP Chromium snapshots, validates strict locators and closes its session', {timeout:60000}, async t=>{
  const old=process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;process.env.RECORDER_ALLOWED_PRIVATE_HOSTS='127.0.0.1';
  t.after(()=>{if(old===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=old;});
  const app=Fastify();
  app.get('/fixture',async(_request,reply)=>reply.type('text/html').send('<!doctype html><title>Order fixture</title><label>Email<input name="email"></label><button onclick="document.title=\'First saved\'">Save</button><button onclick="document.title=\'Second saved\'">Save</button>'));
  await registerAutomationMcp(app,createPrivilegedRunGuard(resolveTestEngineSharedSecret()));
  const base=await app.listen({host:'127.0.0.1',port:0});t.after(()=>app.close());
  const browser=await connectAutomationBrowser({integration:{base_url:base},startUrl:`${base}/fixture`,allowBrowserActions:true});t.after(()=>browser.close());
  let turn=0;
  const result=await runAutomationBrowserAgent({prompt:'Fill Email and save the second record. Expected Second saved.',startUrl:`${base}/fixture`,browser,parse:JSON.parse,complete:async prompt=>{
    assert.match(prompt,/Email/);assert.match(prompt,/Save/);
    return JSON.stringify(++turn===1?{tool_calls:[{name:'browser_validate_locator',arguments:{locator:'getByRole("button", { name: "Save" }).nth(1)'}}]}:{steps:[{step_id:'save',step_type:'web',automation_code:'await page.getByRole("button", { name: "Save" }).nth(1).click();'}]});
  }});
  assert.equal(result.steps.length,1);
  const ambiguous=await browser.call('browser_click',{locator:'getByRole("button", {name:"Save"})'});assert.equal(ambiguous.isError,true);assert.match(ambiguous.content[0].text,/2 elements/);
  const selected=await browser.call('browser_click',{locator:'getByRole("button", {name:"Save"}).nth(1)'});assert.ok(!selected.isError);
  const invalid=await browser.call('browser_navigate',{url:'https://example.com'});assert.equal(invalid.isError,true);
  await browser.close();await assert.rejects(browser.call('browser_snapshot',{}),/expired|closed/);
});
