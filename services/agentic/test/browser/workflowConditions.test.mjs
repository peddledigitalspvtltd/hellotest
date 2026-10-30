import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const operations=require(fileURLToPath(new URL('../../backend/workflows/nodeOperations.js',import.meta.url)));
const root = new URL('../../../platform/frontend/', import.meta.url);
const fixture = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WorkflowConditionFields } from '/services/agentic/frontend/workflows/WorkflowConditionFields';
import '/src/styles.css'; import '/src/dark-theme.css';
import '/services/agentic/frontend/workflows/WorkflowStudio.css';
function Fixture() {
 const [data,setData]=useState({kind:'condition',conditionPath:'input.status',conditionOperator:'equals',conditionValue:'"passed"'});
 const [disabled,setDisabled]=useState(false);
 return <main className="agentic-studio" style={{height:'100vh',width:'100%',overflow:'auto',display:'block'}}>
  <button onClick={()=>setDisabled(value=>!value)}>Toggle read only</button>
  <aside className="studio-inspector" style={{width:'min(100%,420px)',height:'auto',overflow:'visible'}}><div className="studio-inspector-pane">
   <fieldset disabled={disabled}><WorkflowConditionFields data={data} onChange={patch=>setData(current=>({...current,...patch}))}/></fieldset>
  </div></aside><output hidden>{JSON.stringify(data)}</output>
 </main>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
`;

test('condition editor authors typed all/any groups, preserves legacy fields, and respects read-only mode', {timeout:60000}, async()=>{
 const name='workflow-conditions-'+randomUUID(),html=new URL(name+'.html',root),tsx=new URL(name+'.tsx',root);
 let browser;
 try {
  await writeFile(html,`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
  await writeFile(tsx,fixture);
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
  const page=await browser.newPage({viewport:{width:1100,height:900}});page.setDefaultTimeout(12000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5197'}/${name}.html`);
  const state=async()=>JSON.parse(await page.locator('output').textContent());
  await page.getByLabel('Value path',{exact:true}).fill('input.priority');
  await page.getByLabel('Comparison',{exact:true}).selectOption('greaterOrEqual');
  await page.getByLabel('Compare with JSON',{exact:true}).fill('2');
  assert.equal((await state()).conditionPath,'input.priority');assert.equal((await state()).conditions,undefined);
  assert.equal(await page.getByLabel('Combine conditions',{exact:true}).count(),0);
  await page.getByRole('button',{name:'Add condition',exact:true}).click();
  assert.equal(await page.getByLabel('Value path 2',{exact:true}).evaluate(element=>element===document.activeElement),true,'Adding a comparison focuses its value path');
  await page.getByLabel('Combine conditions',{exact:true}).selectOption('any');
  await page.getByLabel('Value path 2',{exact:true}).fill('input.approved');
  await page.getByLabel('Comparison 2',{exact:true}).selectOption('isTrue');
  assert.equal(await page.getByLabel('Compare with JSON 2',{exact:true}).count(),0);
  assert.deepEqual((await state()).conditions,[{conditionPath:'input.priority',conditionOperator:'greaterOrEqual',conditionValue:'2'},{conditionPath:'input.approved',conditionOperator:'isTrue',conditionValue:'"passed"'}]);
  assert.equal((await state()).conditionCombinator,'any');
  const input={priority:1,approved:true,story:{id:'story-a'}};
  const routed=await operations.execute({run:{input_payload:{}},node:{data:await state()},sources:[{node_id:'source',output:{data:input}}]});
  assert.equal(routed.matched,true);assert.deepEqual(routed.data,input);
  assert.deepEqual(operations._internals.mapValues({story:'$input.story.id'},{input:routed.data}),{story:'story-a'},'The selected branch passes the unchanged input to downstream field mappings');
  await page.getByLabel('Combine conditions',{exact:true}).selectOption('all');
  const all=await operations.execute({run:{input_payload:{}},node:{data:await state()},sources:[{node_id:'source',output:{data:input}}]});
  assert.equal(all.matched,false);
  await page.getByLabel('Comparison 2',{exact:true}).selectOption('equals');
  await page.getByLabel('Compare with JSON 2',{exact:true}).fill('invalid json');
  assert.equal(await page.getByLabel('Compare with JSON 2',{exact:true}).getAttribute('aria-invalid'),'true');
  await page.getByText('Enter JSON, such as "passed", 3, or true.',{exact:true}).waitFor();
  await page.getByLabel('Compare with JSON 2',{exact:true}).fill('false');
  assert.equal(await page.getByLabel('Compare with JSON 2',{exact:true}).getAttribute('aria-invalid'),null);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  await mkdir('/tmp/qaira-workflow-conditions',{recursive:true});await page.screenshot({path:'/tmp/qaira-workflow-conditions/group-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'Remove condition 1',exact:true}).click();
  assert.equal(await page.getByLabel('Value path',{exact:true}).evaluate(element=>element===document.activeElement),true,'Removing a comparison preserves keyboard focus on the remaining row');
  assert.equal(await page.getByLabel('Combine conditions',{exact:true}).count(),0);
  assert.equal((await state()).conditions,undefined);assert.equal((await state()).conditionPath,'input.approved');
  assert.equal((await state()).conditionValue,'false');
  for(let index=1;index<20;index++) await page.getByRole('button',{name:'Add condition',exact:true}).click();
  assert.equal((await state()).conditions.length,20);assert.equal(await page.getByRole('button',{name:'Add condition',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'Toggle read only',exact:true}).click();
  assert.equal(await page.getByLabel('Value path',{exact:true}).isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:'Remove condition 1',exact:true}).isDisabled(),true);
  assert.deepEqual(errors,[]);
 } finally {await browser?.close();await Promise.allSettled([unlink(html),unlink(tsx)]);}
});
