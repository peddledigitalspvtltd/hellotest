import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
const require = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('../../../platform/frontend/', import.meta.url);

test('Defect creation commits once, keeps failed attachment files and retries only failures', { timeout: 90000 }, async () => {
  const source = await readFile(new URL('./catalogPages.test.mjs', import.meta.url), 'utf8');
  let fixture = runInNewContext(source.match(/const fixture = (`[\s\S]*?`);/)[1]);
  fixture = fixture.replace("import '/src/catalog-list.css';", "import '/src/catalog-list.css';import '/src/product-experience.css';");
  fixture = fixture.replace("initialEntries:['/issues']", "initialEntries:['/issues?create=1']");
  fixture = fixture.replace('const client=new QueryClient(', `
window.created=[];window.uploadAttempts=[];let failedOnce=false;
api.issues.createMetadata=api.issues.editMetadata;
api.issues.create=async input=>{window.created.push(input);const row={...input,id:'saved-defect',display_id:'BUG-NEW',revision:1,created_at:'2026-10-06T00:00:00Z'};bugs.unshift(row);return{id:row.id,display_id:row.display_id}};
api.attachments.meta=async()=>({enabled:true,uploadLimit:1000000});api.attachments.list=async()=>[];
api.attachments.upload=async(scope,file)=>{window.uploadAttempts.push({scope,name:file.name});if(file.name==='retry.log'&&!failedOnce){failedOnce=true;await new Promise(resolve=>window.releaseUpload=resolve);throw new Error('Temporary upload failure')}return{id:'file-'+file.name,filename:file.name}};
const client=new QueryClient(`);
  const name = 'defect-attachment-retry-' + randomUUID();
  let browser;
  try {
    await writeFile(new URL(name+'.tsx', root), fixture);
    await writeFile(new URL(name+'.html', root), `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser = await chromium.launch({ headless:true, ...(process.env.CHROME_EXECUTABLE ? {executablePath:process.env.CHROME_EXECUTABLE} : {}) });
    const page = await browser.newPage({ viewport:{width:1440,height:1000}, reducedMotion:'reduce' });
    page.setDefaultTimeout(15000);
    const errors=[];page.on('pageerror', error=>errors.push(error.message));
    await page.route('**/api/**', route=>{errors.push('Unexpected real API request');return route.abort()});
    await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5173'}/${name}.html`);
    const modal=page.getByRole('dialog',{name:'Report Defect',exact:true});await modal.waitFor();
    const dialogBounds=await modal.boundingBox();assert.ok(Math.abs(dialogBounds.x+dialogBounds.width/2-720)<2,'Defect dialog is centered');
    const form=modal.locator('form');
    await form.getByRole('button',{name:/^Severity:/}).click();
    await page.getByRole('combobox',{name:'Search Severity',exact:true}).fill('High');
    await page.keyboard.press('Enter');
    assert.equal(await form.locator('.bug-field-severity select').inputValue(),'high');
    await form.getByRole('button',{name:'Add context',exact:true}).click();
    await page.getByRole('menuitem',{name:'Reproduction & results',exact:true}).click();
    assert.equal(await form.locator('#defect-reproduction').evaluate(node=>node.open),true);
    assert.equal(await form.locator('.issue-form-section--impact').evaluate(node=>node.open),false);
    assert.equal(await form.locator('.issue-form-section--root-cause').evaluate(node=>node.open),false);
    await form.getByRole('textbox',{name:'Defect Title',exact:true}).fill('  Notifications retain a stale counter  ');
    await form.locator('.issue-form-section--evidence [contenteditable=true]').first().fill('Reading an alert does not refresh the counter.');
    const artifacts=process.env.BROWSER_SCREENSHOT_DIR || '/tmp/qaira-authoring-review';await mkdir(artifacts,{recursive:true});
    await page.screenshot({path:artifacts+'/create-defect-desktop.png'});
    await page.setViewportSize({width:390,height:844});
    assert.equal(await modal.evaluate(node=>node.getBoundingClientRect().right<=innerWidth),true);
    await page.screenshot({path:artifacts+'/create-defect-mobile.png'});
    await page.evaluate(()=>document.documentElement.dataset.theme='dark');
    await form.getByRole('button',{name:/^Priority:/}).click();
    const options=page.locator('.context-select-popover');const box=await options.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=391,'Owned picker fits the mobile viewport');
    await page.screenshot({path:artifacts+'/create-defect-mobile-dark.png'});
    await page.keyboard.press('Escape');assert.equal(await modal.count(),1);
    await page.evaluate(()=>document.documentElement.dataset.theme='light');
    await page.setViewportSize({width:1440,height:1000});
    await form.locator('.jira-attachment-panel input[type=file]').setInputFiles([
      {name:'retry.log',mimeType:'text/plain',buffer:Buffer.from('retry evidence')},
      {name:'success.log',mimeType:'text/plain',buffer:Buffer.from('uploaded evidence')}
    ]);
    await form.getByRole('button',{name:'Create',exact:true}).click();
    await page.waitForFunction(()=>window.uploadAttempts.length===2);
    await page.locator('.issue-detail-form').waitFor();
    assert.equal(await page.locator('.issue-detail-form').getByRole('textbox',{name:'Defect Title',exact:true}).isDisabled(),true,'Draft stays locked while files upload');
    await page.evaluate(()=>window.releaseUpload());
    const retry=page.getByRole('button',{name:'Retry file uploads',exact:true});await retry.waitFor();
    assert.equal(await page.evaluate(()=>window.created.length),1);
    assert.equal(await page.evaluate(()=>window.created[0].title),'Notifications retain a stale counter');
    assert.equal(await page.evaluate(()=>window.created[0].severity),'high');
    assert.equal(await page.locator('.jira-attachment-panel[aria-label="Retry failed Defect attachments"] .jira-attachment-card').count(),1);
    await retry.click();
    await page.waitForFunction(()=>window.uploadAttempts.length===3);
    await retry.waitFor({state:'detached'});
    const writes=await page.evaluate(()=>({created:window.created.length,uploads:window.uploadAttempts}));
    assert.equal(writes.created,1,'Retry never repeats entity creation');
    assert.deepEqual(writes.uploads.map(item=>item.name),['retry.log','success.log','retry.log']);
    assert.ok(writes.uploads.every(item=>item.scope.project_id==='catalog-project'&&item.scope.entity_id==='saved-defect'));
    assert.deepEqual(errors,[]);
  } finally {
    await browser?.close();await Promise.all(['tsx','html'].map(extension=>rm(new URL(name+'.'+extension,root),{force:true})));
  }
});
