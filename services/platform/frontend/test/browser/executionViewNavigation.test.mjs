import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile,writeFile,rm} from 'node:fs/promises';
const require=createRequire(new URL('../../../../../testengine/backend/package.json',import.meta.url));
const {chromium}=require('playwright');
const root=new URL('../../',import.meta.url);
test('Test Runs navigation leaves Scheduled Runs without remounting the page',{timeout:45000},async()=>{
 const source=await readFile(new URL('../../../../testing/test/browser/runCatalogDetails.test.mjs',import.meta.url),'utf8');
 let fixture=source.match(/const fixtureSource = `([\s\S]*?)`;\n/)[1];
 fixture=fixture.replace('MemoryRouter, useLocation','MemoryRouter, NavLink, useLocation').replace('>Navigation</aside>','><NavLink to="/executions">Test Runs</NavLink><NavLink to="/executions?view=scheduled-runs">Scheduled Runs</NavLink><NavLink to="/executions?view=local-runs">Local Runs</NavLink></aside>');
 const name='execution-navigation-'+randomUUID();let browser;
 try{
  await writeFile(new URL(name+'.tsx',root),fixture);await writeFile(new URL(name+'.html',root),`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
  browser=await chromium.launch({headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto((process.env.VITE_TEST_URL||'http://127.0.0.1:5197')+'/'+name+'.html?route='+encodeURIComponent('/executions?view=scheduled-runs'));
  await page.getByRole('heading',{name:'Test Plans',exact:true}).waitFor();
  for(const view of ['Scheduled Runs','Local Runs']){
   await page.getByRole('link',{name:view,exact:true}).click();
   if(view==='Scheduled Runs')await page.getByRole('heading',{name:'Test Plans',exact:true}).waitFor();
   await page.getByRole('link',{name:'Test Runs',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('[data-testid="location"]').textContent==='/executions');
   await page.getByRole('heading',{name:'Runs',exact:true}).waitFor();
   assert.equal(await page.getByRole('heading',{name:'Test Plans',exact:true}).count(),0);
  }
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await Promise.all(['tsx','html'].map(extension=>rm(new URL(name+'.'+extension,root),{force:true})));}
});
