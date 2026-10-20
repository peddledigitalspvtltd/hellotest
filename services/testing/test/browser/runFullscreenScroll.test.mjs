import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../../../testengine/backend/package.json',import.meta.url));
const {chromium}=require('playwright');const {expect}=require('playwright/test');
const root=new URL('../../../platform/frontend/',import.meta.url);
test('full-screen run review scrolls on desktop and mobile while hiding the sidebar',{timeout:90000},async()=>{
 const source=await readFile(new URL('./runCatalogDetails.test.mjs',import.meta.url),'utf8');
 const fixture=runInNewContext(source.match(/const fixtureSource\s*=\s*(`[\s\S]*?`);/)[1]);
 const name='run-scroll-'+randomUUID();let browser;
 try{
  await writeFile(new URL(name+'.tsx',root),fixture);await writeFile(new URL(name+'.html',root),`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const page=await browser.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5197'}/${name}.html?route=${encodeURIComponent('/executions?view=suite-runs&execution=running')}`);
  await expect(page.getByRole('heading',{name:'Active checkout run',exact:true})).toBeVisible();
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:600});await expect(page.locator('.sidebar')).toBeHidden();
   const area=page.locator('.page-content--execution-command-center');
   assert.ok(await area.evaluate(el=>el.scrollHeight>el.clientHeight),'run review exceeds viewport '+JSON.stringify(await area.evaluate(el=>({width:innerWidth,height:el.clientHeight,scroll:el.scrollHeight,overflow:getComputedStyle(el).overflowY,main:el.parentElement.clientHeight,body:document.body.scrollHeight,children:[...el.querySelectorAll('.workspace-master-detail,.workspace-master-detail-panel,.execution-command-center')].map(e=>({class:e.className,h:e.clientHeight,s:e.scrollHeight,overflow:getComputedStyle(e).overflowY}))}))));
   await area.evaluate(el=>el.scrollTop=0);await area.hover({position:{x:20,y:100}});await page.mouse.wheel(0,500);
   await expect.poll(()=>area.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
   await area.evaluate(el=>el.scrollTop=el.scrollHeight);assert.ok(await area.evaluate(el=>el.scrollTop+el.clientHeight>=el.scrollHeight-2),'bottom of run is reachable');
  }
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await Promise.all([rm(new URL(name+'.html',root),{force:true}),rm(new URL(name+'.tsx',root),{force:true})]);}
});
