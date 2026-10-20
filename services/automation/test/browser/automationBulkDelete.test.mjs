import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../../../testengine/backend/package.json',import.meta.url));
const {chromium}=require('playwright'),{expect}=require('playwright/test');
const root=new URL('../../../platform/frontend/',import.meta.url);
test('catalog deletes the explicit reviewed selection, preserves manual cases and stable AT IDs, and retains selection after a rejection',{timeout:120000},async()=>{
 const template=await readFile(new URL('../../../testing/test/browser/testCaseDataSets.test.mjs',import.meta.url),'utf8');
 let fixture=runInNewContext(template.match(/const fixture\s*=\s*(`[\s\S]*?`);/)[1]);
 fixture=fixture.replace("import {TestCasesPage} from '/services/testing/frontend/pages/TestCasesPage';","import {AutomationPage} from '/services/automation/frontend/pages/AutomationPage';").replace('element:<TestCasesPage/>','element:<AutomationPage/>').replace("initialEntries:['/test-cases?case=case1']","initialEntries:['/test-cases']");
 fixture=fixture.replace('const client=new QueryClient',`
 let records=[{...item,id:'first',title:'First automation',display_id:'AT_42',automated:'yes',manual_test_case_ids:['manual']},{...item,id:'second',title:'Second automation',display_id:'AT_88',automated:'yes'},{...item,id:'third',title:'Retained automation',display_id:'AT_101',automated:'yes'},{...item,id:'manual',title:'Original manual',display_id:'TC_9',automated:'no'}];
 window.deletes=[];window.rejectDelete=false;window.records=()=>records;
 api.testCases.list=async()=>structuredClone(records);api.testCases.listPage=async()=>({items:structuredClone(records),is_last:true,next_cursor:null});api.testCases.automationAgentActivity=async()=>null;
 api.testCases.deleteAutomationCases=async input=>{window.deletes.push(input);if(window.rejectDelete)throw new Error('Active execution must finish before deletion.');records=records.filter(item=>!input.test_case_ids.includes(item.id));return {deleted:true,deleted_count:input.test_case_ids.length,deleted_ids:input.test_case_ids,unlinked_manual_case_ids:['manual']}};
 const client=new QueryClient`);
 const name='automation-bulk-delete-'+randomUUID();let browser;
 try{
  await writeFile(new URL(name+'.tsx',root),fixture);await writeFile(new URL(name+'.html',root),`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.route('**/api/**',route=>{errors.push('Unexpected API '+route.request().url());return route.abort()});
  await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5197'}/${name}.html`);
  await page.getByRole('checkbox',{name:'Select First automation',exact:true}).check();await page.getByRole('checkbox',{name:'Select Second automation',exact:true}).check();
  await page.getByRole('button',{name:'Delete selected',exact:true}).click();let dialog=page.getByRole('dialog',{name:"Warning, can't revert"});await expect(dialog).toContainText('2 selected automation cases');assert.deepEqual(await page.evaluate(()=>window.deletes),[]);await dialog.getByRole('button',{name:'Cancel',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.deletes),[]);
  await page.getByRole('button',{name:'Delete selected',exact:true}).click();await dialog.getByRole('button',{name:'Delete automation cases',exact:true}).click();
  await expect(page.getByRole('checkbox',{name:'Select First automation',exact:true})).toHaveCount(0);await expect(page.getByRole('checkbox',{name:'Select Retained automation',exact:true})).toBeVisible();
  assert.deepEqual(await page.evaluate(()=>window.deletes),[{project_id:'p',app_type_id:'a',test_case_ids:['first','second']}]);assert.equal(await page.evaluate(()=>window.records().find(item=>item.id==='manual')?.display_id),'TC_9');await expect(page.locator('.automation-case-tile').filter({hasText:'Retained automation'})).toContainText('AT_101');
  await page.getByRole('button',{name:'Select all',exact:true}).click();await expect(page.getByRole('checkbox',{name:'Select Retained automation',exact:true})).toBeChecked();await page.evaluate(()=>window.rejectDelete=true);await page.getByRole('button',{name:'Delete selected',exact:true}).click();await dialog.getByRole('button',{name:'Delete automation cases',exact:true}).click();await expect(page.getByText('Active execution must finish before deletion.',{exact:true})).toBeVisible();await expect(page.getByRole('checkbox',{name:'Select Retained automation',exact:true})).toBeChecked();assert.equal(await page.evaluate(()=>window.records().length),2);assert.deepEqual(errors,[]);
 }finally{await browser?.close();await Promise.all([rm(new URL(name+'.tsx',root),{force:true}),rm(new URL(name+'.html',root),{force:true})]);}
});
