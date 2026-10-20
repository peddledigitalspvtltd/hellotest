import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require('playwright');
const { expect } = require('playwright/test');
const root = new URL('../../../platform/frontend/', import.meta.url);

test('manual coverage loads every linked automation page, shows provenance and opens the separate workspace', { timeout: 120_000 }, async () => {
  const template = await readFile(new URL('./testCaseDataSets.test.mjs', import.meta.url), 'utf8');
  let fixture = runInNewContext(template.match(/const fixture\s*=\s*(`[\s\S]*?`);/)[1]);
  fixture = fixture.replace('const client=new QueryClient', `
    const outcome={id:'linked:case1:run1:auto1',execution_id:'run1',test_case_id:'case1',status:'failed',derived:true,result_origin:'linked_automation',source_result_id:'result1',source_test_case_id:'auto1',source_display_id:'AT_1',duration_ms:100,app_type_id:'a',error:'Expected checkout status',logs:null,executed_by:'author'};
    item.automation_test_case_ids=['auto1','auto2'];
    item.automation_coverage={status:'failed',linked_case_count:2,latest_result:outcome};
    const automation=[1,2].map(number=>({...item,id:'auto'+number,display_id:'AT_'+number,title:'Automation variant '+number,automated:'yes',automation_status:'ready',manual_test_case_ids:['case1'],recent_results:[{...outcome,id:'result'+number,test_case_id:'auto'+number,derived:false,result_origin:'direct'}]}));
    window.caseQueries=[];
    api.testCases.listPage=async query=>{
      window.caseQueries.push(query);
      if(query.manual_test_case_id){return {items:[automation[query.cursor?1:0]],next_cursor:query.cursor?null:'next',is_last:Boolean(query.cursor)}}
      return {items:[item],next_cursor:null,is_last:true};
    };
    api.testCases.get=async id=>automation.find(row=>[row.id,row.display_id].includes(id))||item;
    api.executionResults.list=async()=>[outcome];
    window.manualFixture=item;
    const client=new QueryClient`);
  fixture = fixture.replace("{path:'/test-cases',element:<TestCasesPage/>}", "{path:'/test-cases',element:<TestCasesPage/>},{path:'/automation',element:<div data-testid='automation-destination'>Automation workspace</div>},{path:'/executions',element:<div data-testid='evidence-destination'>Automation evidence</div>}");
  fixture += '\nwindow.fixtureRouter=router;';
  const name = 'manual-automation-identity-' + randomUUID();
  let browser;
  try {
    await writeFile(new URL(name + '.tsx', root), fixture);
    await writeFile(new URL(name + '.html', root), `<html><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(60_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => { errors.push('Unexpected API request'); return route.abort(); });
    await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5197'}/${name}.html`);
    await page.getByRole('tab', { name: /^Automation Cases/ }).click();
    const coverage = page.getByRole('region', { name: 'Automation coverage outcome' });
    await expect(coverage).toContainText('AT_1');
    await expect(coverage).toContainText(/failed/i);
    await expect(page.getByText('Automation variant 1', { exact: true })).toBeVisible();
    await expect(page.getByText('Automation variant 2', { exact: true })).toBeVisible();
    const linkedQueries = await page.evaluate(() => window.caseQueries.filter(query => query.manual_test_case_id));
    assert.equal(linkedQueries.length, 2);
    assert.ok(linkedQueries.every(query => query.manual_test_case_id === 'case1' && query.automated === 'yes'));
    await coverage.getByRole('button', { name: 'Open automation evidence' }).click();
    await expect(page.getByTestId('evidence-destination')).toBeVisible();
    assert.deepEqual(await page.evaluate(() => Object.fromEntries(new URLSearchParams(window.fixtureRouter.state.location.search))), { view: 'suite-runs', execution: 'run1', testCase: 'auto1' });
    await page.evaluate(() => window.navigate('/test-cases?case=case1'));
    await page.getByRole('tab', { name: /^Automation Cases/ }).click();
    await page.getByRole('button', { name: 'Create automation case', exact: true }).click();
    await expect(page.getByTestId('automation-destination')).toBeVisible();
    assert.deepEqual(await page.evaluate(() => Object.fromEntries(new URLSearchParams(window.fixtureRouter.state.location.search))), { create: '1', manual: 'case1' });
    assert.equal(await page.evaluate(() => window.manualFixture.automated), 'no');
    await page.evaluate(() => window.navigate('/test-cases?case=AT_1'));
    await expect(page.getByTestId('automation-destination')).toBeVisible();
    await page.waitForFunction(() => window.fixtureRouter.state.location.search === '?case=AT_1');
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await Promise.all([rm(new URL(name + '.tsx', root), { force: true }), rm(new URL(name + '.html', root), { force: true })]);
  }
});

test('a delegated manual outcome stays read-only and opens the source automation evidence', { timeout: 120_000 }, async () => {
  const template = await readFile(new URL('./runCatalogDetails.test.mjs', import.meta.url), 'utf8');
  let fixture = runInNewContext(template.match(/const fixtureSource\s*=\s*(`[\s\S]*?`);/)[1]);
  fixture = fixture.replace('function Fixture() {', `
    cases[0].automated='no';cases[1].automated='yes';cases[1].display_id='AT_2';
    results=results.map(result=>result.execution_id==='running'&&result.test_case_id==='case-1'
      ? {...result,id:'linked:case-1:running',status:'passed',derived:true,covers_entire_case:true,result_origin:'linked_automation',source_result_id:'running-case-2',source_test_case_id:'case-2',source_display_id:'AT_2',data_set_iteration_index:null,data_set_iteration_key:null,logs:null}
      : result);
    function Fixture() {`);
  const name = 'delegated-automation-outcome-' + randomUUID();
  let browser;
  try {
    await writeFile(new URL(name + '.tsx', root), fixture);
    await writeFile(new URL(name + '.html', root), `<html><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(60_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => { errors.push('Unexpected API request'); return route.abort(); });
    const route = '/executions?view=suite-runs&execution=running&testCase=case-1';
    await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5197'}/${name}.html?route=${encodeURIComponent(route)}`);
    const provenance = page.getByRole('region', { name: 'Linked automation outcome' });
    await expect(provenance).toContainText('AT_2');
    await expect(page.getByLabel('Set case outcome', { exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Start new attempt', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save traceability', exact: true })).toHaveCount(0);
    await provenance.getByRole('button', { name: 'Open automation evidence' }).click();
    await expect(page.getByTestId('location')).toContainText('testCase=case-2');
    await expect(provenance).toHaveCount(0);
    assert.ok(!(await page.evaluate(() => window.fixtureApiCalls)).some(call => ['create', 'update', 'transition'].includes(call.method)));
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await Promise.all([rm(new URL(name + '.tsx', root), { force: true }), rm(new URL(name + '.html', root), { force: true })]);
  }
});
