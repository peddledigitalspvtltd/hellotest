import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { createRequire } from 'node:module';
import { registerAutomationMcp } from '../../dist/lib/automationMcp.js';
import { createPrivilegedRunGuard, resolveTestEngineSharedSecret } from '../../dist/lib/testEngineSecurity.js';

const require=createRequire(import.meta.url);
const {deriveProgramTools}=require('../../../../services/automation/backend/lib/automationProgramTools.js');
const {connectAutomationBrowser}=require('../../../../services/automation/backend/lib/automationBrowserAgent.js');
const {createBrowserParameterResolver}=require('../../../../services/automation/backend/lib/automationBrowserParameters.js');

test('source-derived tools preserve native hidden-child text, title whitespace, parameters and fuzzy locator semantics', {timeout:60000},async t=>{
 const previous=process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;process.env.RECORDER_ALLOWED_PRIVATE_HOSTS='127.0.0.1';
 t.after(()=>{if(previous===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=previous;});
 let clicked=0;
 const app=Fastify();
 app.get('/program',async(_req,reply)=>reply.type('text/html').send('<!doctype html><meta charset="utf-8"><title> Sign\u200b   In </title><label>Email<input id="email"></label><div id="result">Visible<span hidden> hidden detail</span><script>ignoredScriptText</script><style>ignoredStyleText</style></div><div id="hidden" hidden>Hidden value</div><button onclick="fetch(\'/clicked\',{method:\'POST\'})">Continue</button><button>Continue later</button>'));
 app.post('/clicked',async()=>{clicked++;return {ok:true};});
 await registerAutomationMcp(app,createPrivilegedRunGuard(resolveTestEngineSharedSecret()));
 const base=await app.listen({host:'127.0.0.1',port:0});t.after(()=>app.close());
 const browser=await connectAutomationBrowser({integration:{base_url:base},startUrl:`${base}/program`,allowBrowserActions:true});t.after(()=>browser.close());
 const data=createBrowserParameterResolver({caseValues:{'t.email':'owned-parameter@example.test'}});
 const execution={required:true,step_id:'current'};
 const derive=code=>deriveProgramTools({execution,payload:{steps:[{step_id:'current',automation_code:code}]}});
 const tools=derive(`
   await page.goto('${base}/program');
   await page.waitForLoadState('domcontentloaded');
   const email=page.getByLabel('Email');
   await email.fill('@t.email');
   await expect(email).toHaveValue('@t.email');
   await expect(page.locator('#result')).toHaveText('Visible hidden detail');
   await expect(page.locator('#result')).toContainText('hidden detail');
   await expect(page.locator('#hidden')).toHaveText('Hidden value');
   await expect(page).toHaveTitle('  Sign\\n In ');
 `);
 assert.equal(tools.length,7);assert.ok(tools.some(tool=>tool.arguments.assertion==='text_content'));
 for(const tool of tools){
  const result=data.redactResult(await browser.call(tool.name,data.resolve(tool.name,tool.arguments)));
  assert.ok(!result.isError,JSON.stringify({tool,result}));assert.doesNotMatch(JSON.stringify(result),/owned-parameter@example.test/);
 }
 const legacy=await browser.call('browser_assert',{assertion:'text',locator:'#result',value:'Visible'});assert.ok(!legacy.isError,'existing visible-inner-text assertions keep their established semantics');
 const nativeMismatch=await browser.call('browser_assert',{assertion:'text_content',locator:'#result',value:'Visible'});
 assert.equal(nativeMismatch.isError,true,'hidden child text must invalidate the native expected string');
 assert.equal(JSON.parse(nativeMismatch.content[0].text).code,'BROWSER_ASSERTION_NOT_SATISFIED');
 assert.doesNotMatch(JSON.stringify(nativeMismatch),/hidden detail|ignoredScriptText|ignoredStyleText/,'native matcher diagnostics must not expose actual private DOM text');
 const fuzzy=derive(`await page.getByRole('button',{name:'Continue'}).click();`)[0];
 const ambiguous=await browser.call(fuzzy.name,fuzzy.arguments);assert.equal(ambiguous.isError,true);assert.equal(JSON.parse(ambiguous.content[0].text).action_outcome,'not_attempted');assert.equal(clicked,0,'native fuzzy matching must not silently become one exact click');
 const urlMatch=derive(`await expect(page).toHaveURL(/program/);`)[0];
 const matched=await browser.call(urlMatch.name,urlMatch.arguments);assert.ok(!matched.isError,JSON.stringify(matched));
 const inventedRoute=derive(`await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page).toHaveURL(/review-details/);`);
 const result=await browser.call(inventedRoute[0].name,inventedRoute[0].arguments);assert.ok(!result.isError,JSON.stringify(result));assert.equal(clicked,1);
 const mismatch=await browser.call(inventedRoute[1].name,inventedRoute[1].arguments);
 assert.equal(mismatch.isError,true);const receipt=JSON.parse(mismatch.content[0].text);
 assert.equal(receipt.code,'BROWSER_ASSERTION_NOT_SATISFIED');assert.equal(receipt.action_outcome,'not_attempted');assert.equal(receipt.assertion_outcome,'not_satisfied');
 assert.equal(clicked,1,'a false invented URL must fail its read-only check without replaying the preceding confirmed click');
 await browser.close();
});
