import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {chromium} from 'playwright';
import {captureAutomationBrowserSnapshot,assertAutomationBrowserCondition} from '../../dist/lib/automationMcp.js';
import {AutomationObservedSubjects} from '../../dist/lib/automationObservedSubjects.js';

test('a heavy real page returns bounded useful partial evidence and scoped capture completes the native input proof',{timeout:30000},async t=>{
 const app=Fastify();app.get('/heavy',async(_req,reply)=>reply.type('text/html').send('<!doctype html><title>Heavy current form</title>'
  +Array.from({length:400},(_,i)=>`<input id="off${i}" aria-label="Offscreen ${i}" style="position:absolute;left:-10000px;top:${i*30}px">`).join('')
  +'<nav style="position:fixed;top:0;left:20px"><a id="employee-management" href="/employees">Employee Management</a><button id="log-out">Log Out</button></nav>'
  +'<form id="current-form" style="position:fixed;top:40px;left:20px"><label>Current name<input id="current-name"></label><button type="button" id="current-save">Save current</button><p role="status" id="current-status">Ready</p></form>'));
 const base=await app.listen({host:'127.0.0.1',port:0}),browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{})});
 t.after(async()=>{await browser.close();await app.close();});const page=await browser.newPage();await page.goto(base+'/heavy');
 const subjects=new AutomationObservedSubjects();await subjects.beginSnapshot();
 const started=Date.now(),partial=await captureAutomationBrowserSnapshot(page,undefined,started+2500,subjects);
 assert.ok(Date.now()-started<3200);assert.ok(partial.partial||partial.truncated);assert.ok(partial.scanned_elements>400);
 for(const id of ['employee-management','log-out','current-name','current-save'])assert.ok(partial.elements.find(element=>element.attributes?.id===id)?.locator_candidates.length,id);
 assert.ok(partial.elements.every(element=>!element.locator_candidates.length||element.locators_validated===true));
 await subjects.beginSnapshot();const scoped=await captureAutomationBrowserSnapshot(page,'#current-form',Date.now()+4000,subjects);
 assert.equal(scoped.partial,false,JSON.stringify(scoped.warnings));assert.equal(scoped.scope,'#current-form');
 const input=scoped.elements.find(element=>element.attributes?.id==='current-name');assert.ok(input?.locator_candidates.includes('#current-name'));
 const handle=await subjects.resolve(page,'#current-name',Date.now()+1000);await handle.fill('Scoped fixture value');
 const checked=await assertAutomationBrowserCondition(page,{assertion:'value',locator:'#current-name',value:'Scoped fixture value'},{deadline:Date.now()+1000,origin:base});
 assert.equal(checked.assertion_outcome,'satisfied');await subjects.clear();
});
