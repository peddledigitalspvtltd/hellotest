import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { assertAccessibleControls } from '../../../platform/frontend/test/browser/axeControls.mjs';
const require=createRequire(new URL('../../../../testengine/backend/package.json',import.meta.url));
const {chromium}=require('playwright');
const root=new URL('../../../platform/frontend/',import.meta.url);

test('last-step recording retains focus, and explicit Next case saves comments to its exact original attempt',{timeout:90000},async()=>{
 const source=await readFile(new URL('./runCatalogDetails.test.mjs',import.meta.url),'utf8');
 let fixture=source.match(/const fixtureSource = `([\s\S]*?)`;\n/)[1];
 fixture=fixture.replace('function Fixture() {',`window.noteWrites=[];
 api.executionResults.update=async(id,input)=>{window.noteWrites.push({id,input});const found=results.find(item=>item.id===id);Object.assign(found,input,{revision:(found.revision||1)+1});return {updated:true,revision:found.revision};};
 function Fixture() {`);
 const name='walkthrough-runner-'+randomUUID();let browser;
 try {
  await writeFile(new URL(name+'.tsx',root),fixture);await writeFile(new URL(name+'.html',root),`<!doctype html><html lang="en"><head><title>Runner evidence fixture</title></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const page=await browser.newPage({viewport:{width:1500,height:1000}});
  await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5197'}/${name}.html?route=${encodeURIComponent('/executions?view=suite-runs&execution=running&testCase=case-5')}`);
  await page.getByRole('heading',{name:'Checkout scenario 5',exact:true}).waitFor();
  await assertAccessibleControls(page,'.execution-case-run-workspace');
  await page.getByRole('button',{name:'Mark step 1 passed',exact:true}).click();
  await page.waitForFunction(()=>window.noteWrites.length>0);
  assert.equal(await page.getByRole('heading',{name:'Checkout scenario 5',exact:true}).isVisible(),true,'Completing a step never advances to another case');
  await page.locator('.execution-step-evidence-summary').click();
  await page.getByLabel('Step 1 comments',{exact:true}).fill('Observation belongs only to original case 5.');
  await page.getByRole('button',{name:'Next case',exact:true}).click();
  await page.getByRole('heading',{name:'Checkout scenario 6',exact:true}).waitFor();
  const saved=await page.evaluate(()=>window.noteWrites.filter(item=>String(item.input.logs||'').includes('Observation belongs')));
  assert.ok(saved.length);assert.ok(saved.every(item=>item.id==='running-case-5'),'Comment stays on exact result, case, row and attempt origin');
  await page.screenshot({path:'/tmp/walkthrough-runner-next-case.png'});
 } finally {await browser?.close();await Promise.all(['tsx','html'].map(extension=>rm(new URL(name+'.'+extension,root),{force:true})));}
});
