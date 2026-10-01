import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
const require=createRequire(new URL('../../../../testengine/backend/package.json',import.meta.url));
const {chromium}=require('playwright');
const root=new URL('../../../platform/frontend/',import.meta.url);
test('bug template, validation, retry-safe queueing and completion work in the Defects UI',{timeout:90000},async()=>{
  const source=await readFile(new URL('./catalogPages.test.mjs',import.meta.url),'utf8');
  let fixture=runInNewContext(source.match(/const fixture = (`[\s\S]*?`);/)[1]);
  fixture=fixture.replace('const client=new QueryClient',`
window.imports=[];window.validations=[];window.failQueue=true;window.importComplete=true;
api.issues.previewImport=async input=>{window.validations.push(input);return {total:input.rows.length,rows:input.rows.map(row=>({...row,user_id:'reviewer',priority:'High'})),errors:input.rows.some(row=>row.assignee_id==='Unknown')?[{row:2,message:'Assignee: use a unique project member name, email or user ID.'}]:[]};};
api.issues.bulkImport=async input=>{window.imports.push(input);if(window.failQueue){window.failQueue=false;throw new Error('Connection lost; retry this import.');}return {transaction_id:'import-job-'+window.imports.length,queued:true,status:'queued'};};
api.issues.importStatus=async id=>({id,status:window.importComplete?'completed':'running',description:window.importComplete?'Imported 1 bugs.':'Importing bugs…',metadata:{imported:window.importComplete?1:0,progress_percent:window.importComplete?100:0}});
const client=new QueryClient`);
  const name='bug-import-'+randomUUID(),html=new URL(name+'.html',root),tsx=new URL(name+'.tsx',root);let browser,page;
  try{
    await writeFile(tsx,fixture);await writeFile(html,`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});page.setDefaultTimeout(10000);const errors=[];
    page.on('pageerror',error=>errors.push(error.message));await page.route('**/api/**',route=>{errors.push('Unexpected API '+route.request().url());return route.abort();});
    await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5294'}/${name}.html`);
    const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Bug template',exact:true}).click()]);
    assert.equal(download.suggestedFilename(),'hellotest-bug-import-template.csv');const template=await readFile(await download.path(),'utf8');assert.ok(template.includes('Reported by')&&template.includes('Steps to reproduce'));
    await page.getByRole('button',{name:'Import Bugs',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Bulk import Bugs',exact:true}),file=dialog.getByLabel('CSV file');
    const upload=content=>file.setInputFiles({name:'bugs.csv',mimeType:'text/csv',buffer:Buffer.from(content)});
    await upload('Title,Description\nValid title,');await dialog.getByRole('alert').filter({hasText:'Description'}).waitFor();assert.equal(await page.evaluate(()=>window.validations.length),0);
    await upload('Title,Description,Assignee\nValid title,Some details,Unknown');await dialog.getByText('Correct the CSV and reload it.').waitFor();assert.equal(await dialog.getByRole('button',{name:/Import .*Bugs?/}).isDisabled(),true);
    await upload(template);await dialog.getByText('1 row · Ready to import',{exact:true}).waitFor();
    await mkdir('/tmp/qaira-object-bugs',{recursive:true});await page.screenshot({path:'/tmp/qaira-object-bugs/import-preview.png',fullPage:true});
    await dialog.getByRole('button',{name:'Import 1 Bug',exact:true}).click();await dialog.getByText('Connection lost; retry this import.').waitFor();
    await dialog.getByRole('button',{name:'Import 1 Bug',exact:true}).click();await dialog.getByText('Import completed',{exact:true}).waitFor();
    const imports=await page.evaluate(()=>window.imports);assert.equal(imports.length,2);assert.equal(imports[0].import_id,imports[1].import_id);assert.equal(imports[0].project_id,'catalog-project');
    assert.match(await dialog.getByRole('link',{name:'View import progress and results'}).getAttribute('href'),/process=import-job/);
    await dialog.getByRole('button',{name:'Done',exact:true}).click();
    await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.setAttribute('data-theme','dark'));
    await page.getByRole('button',{name:'Import Bugs',exact:true}).click();await upload(template);await dialog.getByText('1 row · Ready to import',{exact:true}).waitFor();
    assert.ok((await dialog.getByRole('button',{name:'Import 1 Bug',exact:true}).boundingBox()).height<60);
    await dialog.getByRole('button',{name:'Close Bug import',exact:true}).waitFor();
    const bounds=await dialog.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=392);
    await page.screenshot({path:'/tmp/qaira-object-bugs/import-mobile.png',fullPage:true});
    await page.keyboard.press('Escape');assert.equal(await dialog.count(),0);
    await page.evaluate(()=>{window.importComplete=false});
    await page.getByRole('button',{name:'Import Bugs',exact:true}).click();await upload(template);await dialog.getByText('1 row · Ready to import',{exact:true}).waitFor();
    await dialog.getByRole('button',{name:'Import 1 Bug',exact:true}).click();await dialog.getByText('Importing bugs…',{exact:true}).waitFor();
    await dialog.getByRole('button',{name:'Done',exact:true}).click();
    await page.evaluate(()=>{window.importComplete=true});
    await page.getByText('Imported 1 bugs.',{exact:true}).waitFor();
    assert.deepEqual(errors,[]);
  }catch(error){throw new Error(`${error.message}\n${await page?.locator('body').innerText().catch(()=> '')}`,{cause:error});}
  finally{await browser?.close();await rm(html,{force:true});await rm(tsx,{force:true});}
});
