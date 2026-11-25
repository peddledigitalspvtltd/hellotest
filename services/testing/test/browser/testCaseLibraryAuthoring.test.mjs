import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { assertAccessibleControls } from '../../../platform/frontend/test/browser/axeControls.mjs';

const require = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require('playwright');
const root = new URL('../../../platform/frontend/', import.meta.url);

test('manual case library tiles, list selection and saved authoring retain their owning queries and draft', { timeout: 90000 }, async () => {
  const source = await readFile(new URL('./testCaseDataSets.test.mjs', import.meta.url), 'utf8');
  let fixture = runInNewContext(source.match(/const fixture\s*=\s*(`[\s\S]*?`);/)[1]);
  fixture = fixture.replace("initialEntries:['/test-cases?case=case1']", "initialEntries:['/test-cases']");
  fixture = fixture.replace('const client=new QueryClient', `
const native={...item,id:'native',display_id:'AT-2',title:'Automated checkout',automated:'yes',manual_test_case_id:item.id,test_data_set_ids:[],test_data_sets:[]};
window.libraryRequests=[];
window.libraryMetricsRequests=[];
window.releaseCaseSteps=null;
api.testSteps.list=()=>new Promise(resolve=>{window.releaseCaseSteps=()=>resolve(steps);});
api.testCases.listPage=async input=>{
  window.libraryRequests.push(structuredClone(input));
  const manual={...item,linked_automation_cases:[{id:native.id,display_id:native.display_id,title:native.title}]};
  if(input.manual_test_case_id) return {items:input.manual_test_case_id===manual.id?[native]:[],next_cursor:null,is_last:true};
  const items=[manual,native].filter(row=>input.exclude_automated ? row.automated!=='yes' : true);
  return {items,next_cursor:null,is_last:true};
};
api.testCases.reviewSummary=async()=>({pending:0,overall_pending:0});
api.testCases.metrics=async input=>{
  window.libraryMetricsRequests.push(structuredClone(input));
  return {catalog:{total:1,automationPercent:100,blocked:0,failed:0,finalizedResults:0,passedResults:0,recentPassRate:null},coverage:{total:1,covered:0,automated:1,automationKnown:1,withHistory:0,withSuites:0},modules:[]};
};
const client=new QueryClient`);
  fixture += "\nimport '/src/product-experience.css';import '/src/walkthrough-overrides.css';";
  const name = 'case-library-authoring-' + randomUUID();
  let browser;
  try {
    await writeFile(new URL(name + '.tsx', root), fixture);
    await writeFile(new URL(name + '.html', root), `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(45000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => { errors.push('Unexpected fixture API request'); return route.abort(); });
    await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5197'}/${name}.html`);
    await page.getByRole('button', { name: 'Checkout @r.title', exact: true }).waitFor();
    const tile = page.locator('.test-case-catalog-card').filter({ hasText: 'Checkout @r.title' });
    assert.equal(await page.getByRole('combobox', { name: 'Catalog scope', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Automated checkout', exact: true }).count(), 0);
    assert.equal(await tile.locator('[aria-label="Latest manual and automation evidence"]').count(), 0);
    assert.equal(await tile.locator('button.link-button').count(), 0);
    await page.getByRole('checkbox', { name: 'Select Test Case Checkout @r.title', exact: true }).check();
    await page.getByRole('button', { name: 'List view', exact: true }).click();
    const selected = page.getByRole('checkbox', { name: 'Select Test Case Checkout @r.title', exact: true });
    await selected.waitFor();
    assert.equal(await selected.isChecked(), true, 'switching renderers retains case identity selection');
    assert.equal(await page.getByText('Automated checkout', { exact: true }).count(), 0);
    await assertAccessibleControls(page);
    await page.locator('.data-table-primary-title').filter({ hasText: 'Checkout @r.title' }).click();
    const title = page.locator('.test-case-title-field input');
    await title.waitFor();
    await page.getByRole('status', { name: 'Loading steps', exact: true }).waitFor();
    await title.fill('Reviewed checkout');
    await page.waitForTimeout(220);
    assert.equal(await page.locator('[data-loading-host]').count(), 0, 'a local step request never covers the editable page with a held global loader');
    await page.evaluate(() => window.releaseCaseSteps());
    await page.getByRole('status', { name: 'Loading steps', exact: true }).waitFor({ state: 'hidden' });
    assert.equal(await title.inputValue(), 'Reviewed checkout', 'late step data does not replace an authored metadata edit');
    await page.getByRole('button', { name: 'Save test case', exact: true }).click();
    await page.waitForFunction(() => window.updates.some(input => input.title === 'Reviewed checkout'));
    assert.equal(await title.inputValue(), 'Reviewed checkout');
    await assertAccessibleControls(page, '.test-case-workspace-shell');
    const { catalog, linkedAutomation, metrics } = await page.evaluate(() => ({
      catalog: window.libraryRequests.filter(request => !request.manual_test_case_id),
      linkedAutomation: window.libraryRequests.filter(request => request.manual_test_case_id),
      metrics: window.libraryMetricsRequests
    }));
    assert.ok(catalog.length > 0 && catalog.every(request => request.exclude_automated === true));
    assert.ok(metrics.length > 0 && metrics.every(request => request.exclude_automated === true));
    assert.ok(linkedAutomation.some(request => request.manual_test_case_id === 'case1' && request.automated === 'yes'));
    await mkdir('/tmp/qaira-case-library', { recursive: true });
    await page.screenshot({ path: '/tmp/qaira-case-library/authoring-after-save.png', fullPage: true });
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await Promise.all(['tsx', 'html'].map(extension => rm(new URL(name + '.' + extension, root), { force: true })));
  }
});
