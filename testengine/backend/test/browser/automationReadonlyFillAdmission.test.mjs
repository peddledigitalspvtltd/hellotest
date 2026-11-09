import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
import Fastify from 'fastify';
import {registerAutomationMcp} from '../../dist/lib/automationMcp.js';
const require=createRequire(import.meta.url);
const {connectAutomationBrowser}=require('../../../../services/automation/backend/lib/automationBrowserAgent.js');
const {projectModelSnapshot}=require('../../../../services/automation/backend/lib/automationBrowserModelTargets.js');
const receipt=result=>JSON.parse(result.content.find(block=>block.type==='text').text);
const success=async(browser,name,args={})=>{const result=await browser.call(name,args);assert.notEqual(result.isError,true,JSON.stringify(result));return result;};

test('native readonly fill is not attempted, dropdown interaction remains valid and editable transient controls keep native waiting',{timeout:60000},async t=>{
 const previous=process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;process.env.RECORDER_ALLOWED_PRIVATE_HOSTS='127.0.0.1';
 t.after(()=>{if(previous===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=previous;});
 const app=Fastify(),dependencies={};let native;
 dependencies.launchBrowser=async options=>{native=await chromium.launch(options);return native;};
 app.get('/readonly',async(_request,reply)=>reply.type('text/html').send('<!doctype html><title>Location dropdown</title><script>window.events={input:0,change:0};function chooseLocation(){const input=document.querySelector("#location");input.value="London";input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new Event("change",{bubbles:true}));document.querySelector("#options").hidden=true}</script><label>Location<input id="location" readonly value="Unselected" onclick="document.querySelector(\'#options\').hidden=false" oninput="window.events.input++" onchange="window.events.change++"></label><div id="options" role="listbox" hidden><button role="option" onclick="chooseLocation()">London</button></div>'));
 app.get('/transient',async(_request,reply)=>reply.type('text/html').send('<!doctype html><title>Transient input</title><script>window.inputEvents=0;function prepare(){const input=document.querySelector("#entry");input.disabled=true;input.hidden=true;setTimeout(()=>{input.hidden=false;input.disabled=false},1700)}</script><label>Employee<input id="entry" oninput="window.inputEvents++"></label><button id="prepare" onclick="prepare()">Prepare transient input</button>'));
 app.get('/disabled',async(_request,reply)=>reply.type('text/html').send('<!doctype html><title>Pending native fill</title><label>Employee<input id="entry" disabled></label><button>Available control</button>'));
 await registerAutomationMcp(app,async()=>{},dependencies);const base=await app.listen({host:'127.0.0.1',port:0});t.after(()=>app.close());
 const open=async path=>{const browser=await connectAutomationBrowser({integration:{base_url:base},startUrl:base+path,allowBrowserActions:true});await success(browser,'browser_navigate',{url:base+path});const snapshot=await success(browser,'browser_snapshot');return {browser,page:native.contexts()[0].pages()[0],snapshot};};

 await t.test('readonly metadata and native denial contain no input value, events or unknown outcome',async()=>{
  const {browser,page,snapshot}=await open('/readonly');try{
   const input=receipt(snapshot).elements.find(row=>row.attributes?.id==='location');assert.equal(input.readonly,true);
   const model=projectModelSnapshot({tool:'browser_snapshot',result:snapshot});assert.equal(model.targets.find(target=>target.name==='Location').readonly,true);
   const began=Date.now(),denied=await browser.call('browser_fill',{locator:'getByLabel("Location", {exact:true})',value:'PRIVATE_ATTEMPTED_VALUE'}),failure=receipt(denied);
   assert.equal(denied.isError,true);assert.equal(failure.code,'BROWSER_FILL_READONLY');assert.equal(failure.action_outcome,'not_attempted');assert.equal(failure.retry_safe,true);assert.notEqual(failure.session_disposition,'quarantined');assert.ok(Date.now()-began<5000);
   assert.doesNotMatch(JSON.stringify(denied),/PRIVATE_ATTEMPTED_VALUE/);assert.equal(await page.locator('#location').inputValue(),'Unselected');assert.deepEqual(await page.evaluate(()=>window.events),{input:0,change:0});
   // The failed fill does not close the session or forbid the actual observed
   // dropdown interaction. Each newly displayed option is observed first.
   await success(browser,'browser_click',{locator:'getByLabel("Location", {exact:true})'});
   const options=await success(browser,'browser_snapshot');assert.ok(receipt(options).elements.some(row=>row.text==='London'));
   await success(browser,'browser_click',{locator:'getByRole("option", {name:"London",exact:true})'});
   const checked=await success(browser,'browser_assert',{assertion:'value',locator:'getByLabel("Location", {exact:true})',value:'London'});assert.equal(receipt(checked).assertion_outcome,'satisfied');
   assert.equal(await page.locator('#location').inputValue(),'London');assert.deepEqual(await page.evaluate(()=>window.events),{input:1,change:1});
  }finally{await browser.close();}
 });

 await t.test('temporarily hidden and disabled readonly-false control still waits and fills once',async()=>{
  const {browser,page,snapshot}=await open('/transient');try{
   assert.equal(receipt(snapshot).elements.find(row=>row.attributes?.id==='entry').readonly,false);
   await success(browser,'browser_click',{locator:'#prepare'});assert.equal(await page.locator('#entry').isVisible(),false);assert.equal(await page.locator('#entry').isDisabled(),true);
   const began=Date.now(),filled=await success(browser,'browser_fill',{locator:'#entry',value:'Fixture employee'});
   assert.equal(receipt(filled).action_outcome,'completed');assert.ok(Date.now()-began>=1000,'Native fill must await the actual enabled and visible control');
   assert.equal(await page.locator('#entry').inputValue(),'Fixture employee');assert.equal(await page.evaluate(()=>window.inputEvents),1);
  }finally{await browser.close();}
 });

 await t.test('a genuine dispatched native fill timeout remains unknown and cannot invite safe retry',async()=>{
  const {browser,snapshot}=await open('/disabled');try{
   assert.equal(receipt(snapshot).elements.find(row=>row.attributes?.id==='entry').readonly,false);
   dependencies.toolTimeoutMs=2000;
   const failed=await browser.call('browser_fill',{locator:'#entry',value:'PRIVATE_PENDING_VALUE'}),failure=receipt(failed);
   assert.equal(failed.isError,true);assert.equal(failure.code,'BROWSER_ACTION_OUTCOME_UNKNOWN');assert.equal(failure.action_outcome,'unknown');assert.equal(failure.retry_safe,false);assert.doesNotMatch(JSON.stringify(failed),/PRIVATE_PENDING_VALUE/);
  }finally{dependencies.toolTimeoutMs=undefined;await browser.close();}
 });
});
