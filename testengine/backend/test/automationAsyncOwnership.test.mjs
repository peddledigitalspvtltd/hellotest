import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { assertAutomationAsyncOwnership } from '../dist/lib/automationAsyncOwnership.js';
const require=createRequire(import.meta.url);
const {compileRecordedProgram}=require('../../../services/automation/backend/lib/automationRecordedProgram');

test('awaited closed validation polls own implicit read promises in both compiler layouts',()=>{
 const operations=[{name:'browser_fill',arguments:{locator:'#password',value:'@r.password'}},
  {name:'browser_assert',arguments:{assertion:'value',locator:'#password',value:'@r.password'}},
  {name:'browser_assert',arguments:{assertion:'field_valid',locator:'#password'}}];
 for(const layout of ['compact','inline'])assert.doesNotThrow(()=>assertAutomationAsyncOwnership(compileRecordedProgram(operations,{layout}).source));
 for(const source of ['await expect.poll(()=>page.locator("#field").evaluate(element=>element.validity.valid)).toBe(true);',
  'return expect.poll(()=>page.locator("#field").inputValue()).not.toBe("bad");',
  'const pending=expect.poll(()=>page.title()).toBe("Ready");await pending;',
  'await expect.poll(async()=>await page.title()).toBe("Ready");'])assert.doesNotThrow(()=>assertAutomationAsyncOwnership(source),source);
});

test('detached polls and arbitrary callbacks retain the browser promise ownership guard',()=>{
 for(const source of ['expect.poll(()=>page.locator("#field").evaluate(element=>true)).toBe(true);',
  'const pending=expect.poll(()=>page.title()).toBe("Ready");',
  'setTimeout(()=>page.locator("#field").fill("detached"),0);',
  '[1].forEach(()=>page.locator("#field").click());',
  'await customCallback(()=>page.locator("#field").evaluate(element=>true));',
  'await expect.poll(()=>{page.locator("#field").click();return true;}).toBe(true);',
  'await expect.poll(()=>page.locator("#field").click()&&true).toBe(true);',
  'setTimeout(()=>expect.poll(()=>page.title()).toBe("Ready"),0);'])assert.throws(()=>assertAutomationAsyncOwnership(source),/browser.*promise/,source);
});
