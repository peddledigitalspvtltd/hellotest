// Production Library UI with isolated APIs, including an existing broad catalog cache.
import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFile, writeFile, unlink} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../../../testengine/backend/package.json',import.meta.url));
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=new URL('../../../platform/frontend/',import.meta.url);
const base=(await readFile(new URL('testCaseCatalogPage.test.mjs',import.meta.url),'utf8')).match(/const fixture = `([\s\S]*?)`;\n\ntest/)[1];
const setup=`
const originalListPage=api.testCases.listPage;
api.testCases.listPage=async input=>{
 if(input.ids!==undefined&&window.pauseWorkflowReview)await new Promise(resolve=>{window.releaseWorkflowReview=resolve;window.pendingWorkflowReview=structuredClone(input)});
 if(input.ids==='')return {items:[],is_last:true,next_cursor:null};
 return originalListPage(input);
};
`;
const fixture=base.replace('const client=new QueryClient',setup+'\nconst client=new QueryClient');

test('workflow Review shows only its exact saved cases in tile and list modes, without a broad-cache flash', {timeout:60000},async()=>{
 const name='workflow-case-review-'+randomUUID(),html=new URL(name+'.html',root),tsx=new URL(name+'.tsx',root);let browser,page;
 try{
  await writeFile(html,`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
  await writeFile(tsx,fixture);
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
  page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',route=>route.fulfill({status:503,contentType:'application/json',body:'{"message":"Unexpected isolated API request"}'}));
  await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5197'}/${name}.html`);
  const cards=page.locator('.test-case-library-scroll .test-case-catalog-card');
  await cards.nth(1).waitFor();
  await page.evaluate(()=>{window.pauseWorkflowReview=true;window.fixtureNavigate('/test-cases?review_cases=case-1%2Ccase-60%2Ccase-70');});
  await page.waitForFunction(()=>Boolean(window.pendingWorkflowReview));
  assert.equal(await cards.count(),0,'Unrestricted cached Library records must not appear while scoped data loads');
  await page.getByText('Workflow Test Case review',{exact:true}).waitFor();
  await page.evaluate(()=>{window.pauseWorkflowReview=false;window.releaseWorkflowReview();});
  await page.waitForFunction(()=>document.querySelectorAll('.test-case-library-scroll .test-case-catalog-card').length===3);
  const text=await page.locator('.test-case-library-scroll').innerText();
  assert.match(text,/Checkout coverage 01/);assert.match(text,/Distant boundary coverage/);assert.match(text,/Checkout coverage 70/);assert.doesNotMatch(text,/Checkout coverage 02/);
  assert.equal(await page.getByRole('group',{name:'Test case library quality metrics'}).count(),0,'Whole-library metrics are not presented as the review set metrics');
  const input=await page.evaluate(()=>window.calls.catalog.find(item=>item.ids));
  assert.equal(input.project_id,'case-project');assert.equal(input.app_type_id,'case-app');assert.equal(input.unassigned_module,false);
  assert.equal(input.ids,'case-1,case-60,case-70');
  await page.getByRole('button',{name:'List view',exact:true}).click();
  await page.getByRole('table').waitFor();
  assert.doesNotMatch(await page.locator('.test-case-library-scroll').innerText(),/Checkout coverage 02/);
  const callsBeforeInvalid=await page.evaluate(()=>window.calls.catalog.length);
  await page.evaluate(()=>window.fixtureNavigate('/test-cases?review_cases='));
  await page.getByRole('alert').filter({hasText:'This review link is invalid'}).waitFor();
  assert.equal(await cards.count(),0);
  assert.equal(await page.evaluate(()=>window.calls.catalog.length),callsBeforeInvalid,'Invalid links must not issue an unrestricted API query');
  assert.deepEqual(errors,[]);
 }catch(error){if(page)await page.screenshot({path:'/tmp/workflow-case-review-failure.png',fullPage:true}).catch(()=>{});throw error;}
 finally{await browser?.close();await Promise.allSettled([unlink(html),unlink(tsx)]);}
});
