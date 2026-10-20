import test from 'node:test';import assert from 'node:assert/strict';import {readFile,writeFile,rm} from 'node:fs/promises';import {randomUUID} from 'node:crypto';import {runInNewContext} from 'node:vm';import {createRequire} from 'node:module';
const require=createRequire(new URL('../../../../testengine/backend/package.json',import.meta.url));const {chromium}=require('playwright');const {expect}=require('playwright/test');const root=new URL('../../../platform/frontend/',import.meta.url);
test('suite and run override controls follow manual, automation and mixed scope independently',{timeout:90000},async()=>{
 const template=await readFile(new URL('./runDataSetup.test.mjs',import.meta.url),'utf8');let fixture=runInNewContext(template.match(/const source\s*=\s*(`[\s\S]*?`);/)[1]);
 fixture=fixture.replace('return {project_id:input.project_id,','return {shared_group_kinds:query.get("kind")==="mixed"?["steps","sections"]:[query.get("kind")],project_id:input.project_id,');
 fixture=fixture.replace('onDataOptionsChange={setDataOptions}','onDataOptionsChange={value=>{state.options=value;setDataOptions(value);}}');
 const name='shared-policy-'+randomUUID();let browser;
 try{await writeFile(new URL(name+'.tsx',root),fixture);await writeFile(new URL(name+'.html',root),`<!doctype html><html><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const kind of ['steps','sections','mixed']){
  await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5197'}/${name}.html?kind=${kind}`);
  for(const suiteMode of [false,true]){
   await page.evaluate(value=>window.__runData.setMode(value),suiteMode);
   await expect(page.locator('.run-data-options legend')).toHaveText(`Allow This ${suiteMode?'Suite':'Run'} To Override`);
   const manual=page.getByRole('checkbox',{name:'Override Shared Groups Test Data',exact:true});const automation=page.getByRole('checkbox',{name:'Override Shared Sections Test Data',exact:true});
   await expect(manual).toHaveCount(kind==='sections'?0:1);await expect(automation).toHaveCount(kind==='steps'?0:1);
   if(kind==='mixed'){
    await automation.uncheck();await expect(manual).toBeChecked();assert.equal(await page.evaluate(()=>window.__runData.options.override_shared_sections),false);
    await manual.uncheck();await automation.check();await expect(manual).not.toBeChecked();assert.equal(await page.evaluate(()=>window.__runData.options.override_shared_steps),false);
    await manual.check();await automation.check();
   }
  }
 }
 assert.deepEqual(errors,[]);
 }finally{await browser?.close();await Promise.all([rm(new URL(name+'.tsx',root),{force:true}),rm(new URL(name+'.html',root),{force:true})]);}
});
