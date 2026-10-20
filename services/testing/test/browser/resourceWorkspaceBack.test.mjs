import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
const require=createRequire(new URL('../../../../testengine/backend/package.json',import.meta.url));
const {chromium}=require('playwright');const {expect}=require('playwright/test');
const root=new URL('../../../platform/frontend/',import.meta.url);
test('resource Back closes on one click and stays closed through refetch and reopening',{timeout:90000},async()=>{
 const template=await readFile(new URL('./testCaseDataSets.test.mjs',import.meta.url),'utf8');
 let fixture=runInNewContext(template.match(/const fixture\s*=\s*(`[\s\S]*?`);/)[1]);
 fixture=fixture.replace("import {TestCasesPage} from '/services/testing/frontend/pages/TestCasesPage';", "import {TestEnvironmentPage} from '/services/testing/frontend/pages/TestEnvironmentPage';\nconst resourceView=new URLSearchParams(location.search).get('resource')||'data';const resourceKey=resourceView==='environments'?'environment':resourceView==='configurations'?'configuration':'dataSet';");
 fixture=fixture.replace('element:<TestCasesPage/>','element:<TestEnvironmentPage view={resourceView}/>').replace("initialEntries:['/test-cases?case=case1']","initialEntries:['/test-cases?'+resourceKey+'=record']");
 fixture=fixture.replace('const client=new QueryClient', `api.testEnvironments.list=async()=>[{id:'record',project_id:'p',app_type_id:'a',name:'QA target',base_url:'https://example.test',variables:[]}];api.testConfigurations.list=async()=>[{id:'record',project_id:'p',app_type_id:'a',name:'Chrome target',browser:'chromium',viewport_width:1280,viewport_height:720,variables:[]}];api.testDataSets.list=async()=>[{...data,id:'record'}];const client=new QueryClient`);
 fixture=fixture.replace('window.navigate=to=>router.navigate(to);','window.navigate=to=>router.navigate(to);window.routeSearch=()=>router.state.location.search;window.refetch=()=>client.invalidateQueries();');
 const name='resource-back-'+randomUUID();let browser;
 try{
  await writeFile(new URL(name+'.tsx',root),fixture);await writeFile(new URL(name+'.html',root),`<!doctype html><html><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/**',route=>{errors.push('Unexpected backend call');return route.abort();});
  for(const [view,label,key] of [['environments','Back to environment tiles','environment'],['configurations','Back to configuration tiles','configuration'],['data','Back to test data tiles','dataSet']]){
   await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5197'}/${name}.html?resource=${view}`);
   const back=page.getByRole('button',{name:label,exact:true});await expect(back,JSON.stringify(errors)).toBeVisible();await back.click();await expect(back).toHaveCount(0);
   assert.ok(!(await page.evaluate(()=>window.routeSearch())).includes(key+'='));
   await page.evaluate(()=>window.refetch());await expect(back).toHaveCount(0);
   await page.locator('button.record-card.tile-card, .configuration-card-open').first().click();await expect(back).toBeVisible();await back.click();await expect(back).toHaveCount(0);
   await page.evaluate(key=>window.navigate('/test-cases?'+key+'=record'),key);await expect(back).toBeVisible();await back.click();await expect(back).toHaveCount(0);
  }
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await Promise.all([rm(new URL(name+'.tsx',root),{force:true}),rm(new URL(name+'.html',root),{force:true})]);}
});
