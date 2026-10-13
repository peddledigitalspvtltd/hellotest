import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../../../testengine/backend/package.json',import.meta.url));
const {chromium}=require('playwright');
const root=new URL('../../../platform/frontend/',import.meta.url);
test('Defect tiles bound rich descriptions and unbroken titles without altering the detail record', {timeout:90000},async()=>{
 const source=await readFile(new URL('./catalogPages.test.mjs',import.meta.url),'utf8');
 let fixture=runInNewContext(source.match(/const fixture\s*=\s*(`[\s\S]*?`);/)[1]);
 fixture=fixture.replace('function matching(input){',`bugs.splice(2);bugs[0].title='X'.repeat(2000);bugs[1].title='Reviewed failure '.repeat(300);bugs.forEach(bug=>{bug.message='<p>'+('Observed checkout failure '.repeat(300))+'</p><h2>Steps to reproduce</h2><p>'+('Long reproduction '.repeat(500))+'</p>';});window.pauseContinuation=false;window.fixtureRecords=bugs;function matching(input){`);
 fixture+="\nimport '/src/product-experience.css';";
 const name='defect-tile-bounds-'+randomUUID(),html=new URL(name+'.html',root),tsx=new URL(name+'.tsx',root);let browser;
 try{
  await writeFile(tsx,fixture);await writeFile(html,`<!doctype html><html><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
  browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/**',r=>{errors.push('Unexpected API');return r.abort();});
  await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5197'}/${name}.html`);const cards=page.locator('.issue-catalog-card');await cards.first().waitFor();assert.equal(await cards.count(),2);
  const sizes=[];for(const card of await cards.all()){
   const title=card.locator('.tile-card-title-group strong');assert.ok((await title.innerText()).length<=96);assert.ok((await title.getAttribute('title')).length>96);
   const description=card.locator('.catalog-card-description-summary');assert.ok((await description.innerText()).length<=220);assert.equal((await description.boundingBox()).height,54);assert.ok((await title.boundingBox()).height<=42);sizes.push((await card.boundingBox()).height);
  }
  assert.ok(Math.abs(sizes[0]-sizes[1])<2,JSON.stringify(sizes));assert.ok(await page.evaluate(()=>window.fixtureRecords[0].message.length>1000));assert.deepEqual(errors,[]);
 }finally{await browser?.close();await Promise.all([rm(html,{force:true}),rm(tsx,{force:true})]);}
});
