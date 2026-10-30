import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { writeFile, rm, mkdir } from 'node:fs/promises';

const require = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require('playwright');
const { expect } = require('playwright/test');
const root = new URL('../../../platform/frontend/', import.meta.url);
const fixture = `
import React from 'react';import {createRoot} from 'react-dom/client';import {createMemoryRouter,RouterProvider} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {AuthProvider} from '/src/auth/AuthContext';import {LocalizationProvider} from '/src/context/LocalizationContext';
import {TestCasesPage} from '/services/testing/frontend/pages/TestCasesPage';import {api,sessionStorage} from '/src/lib/api';import {setCurrentScope} from '/src/platform/hooks/useCurrentProject';
import '/src/styles.css';import '/src/dark-theme.css';import '/src/modal-system.css';import '/src/workspace-layout.css';import '/src/catalog-list.css';import '/src/product-experience.css';
const session={token:'ai-review-fixture',user:{id:'author',name:'Author',role:'admin'}};sessionStorage.write(session);setCurrentScope('p','a');
for(const methods of Object.values(api))if(methods&&typeof methods==='object')for(const [key,value] of Object.entries(methods))if(typeof value==='function')methods[key]=async()=>[];
api.auth.session=async()=>session;api.settings.getLocalization=async()=>({strings:{}});api.settings.getWorkspacePreferences=async()=>({preferences:{}});
const flags={flags:new Proxy({},{get:()=>true})};api.featureFlags.snapshot=async()=>flags;
api.metadata.domain=async()=>({test_cases:{default_status:'active',default_automated:'no',statuses:[{value:'active',label:'Active'}]},jira:{sprints:[],versions:[]}});
api.metadata.workspaceScopes=async()=>({projects:[{id:'p',name:'Project',has_access:true}]});api.appTypes.list=async()=>[{id:'a',project_id:'p',name:'Web',type:'web'}];
const integration={id:'model',name:'Review model',type:'llm',model:'Configured model',is_active:true};api.integrations.list=async query=>query?.type==='llm'?[integration]:[];
let item={id:'case1',display_id:'TC-1',app_type_id:'a',title:'Existing checkout case',description:'Keep the saved intent.',suite_ids:[],module_ids:[],requirement_ids:[],labels:[],external_references:[],automated:'no',authoring_mode:'structured',test_case_type:'functional',priority:1,status:'active',review_status:'not_requested',revision:1,author_id:'author',parameter_values:{},test_data_set_ids:[],detail_complete:true,step_count:2};
const steps=[{id:'s1',test_case_id:'case1',step_order:1,action:'Open checkout',expected_result:'Checkout opens',step_type:'web',automation_code:'',api_request:null},{id:'s2',test_case_id:'case1',step_order:2,action:'Complete checkout',expected_result:'Receipt appears',step_type:'web',automation_code:'',api_request:null}];
api.testCases.listPage=async()=>({items:[item],next_cursor:null,is_last:true});api.testCases.list=async()=>[item];api.testCases.get=async()=>item;api.testSteps.list=async()=>steps;
const candidate=(id,title)=>({client_id:id,title,description:'Review '+id,priority:3,authoring_mode:'structured',test_case_type:'functional',parameter_values:{customer:'reviewer'},requirement_ids:[],requirement_titles:[],steps:[{step_order:1,step_type:'web',action:id+' first action',expected_result:id+' first outcome'},{step_order:2,step_type:'api',action:id+' second action',expected_result:id+' second outcome'}],step_count:2});
window.accepted=[];window.updates=[];window.requests=[];
api.testCases.previewDesignedCases=async input=>{window.requests.push(input);return {generated:3,cases:[candidate('alpha','Alpha scenario'),candidate('beta','Beta scenario'),candidate('gamma','Gamma scenario')],integration,requirements:[],app_type:{id:'a',name:'Web'}}};
api.testCases.acceptDesignedCases=async input=>{window.accepted.push(input);return {created:[]}};
api.testCases.previewCaseAuthoring=async input=>{window.requests.push(input);const draft={...candidate('improved','Improved checkout'),priority:item.priority};return {case:{...draft,parameter_count:1},requirement:null,integration,app_type:{id:'a',name:'Web'}}};
api.testCases.update=async(id,input)=>{window.updates.push(input);item={...item,...input,revision:item.revision+1};return item};
const client=new QueryClient({defaultOptions:{queries:{retry:false}}});client.setQueryData(['feature-flags'],flags);
const initial=new URLSearchParams(location.search).get('flow')==='improve'?'/test-cases?case=case1':'/test-cases';
const router=createMemoryRouter([{path:'/test-cases',element:<TestCasesPage/>}],{initialEntries:[initial]});
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><AuthProvider><LocalizationProvider userId='author'><main style={{height:'100vh',overflowY:'auto',padding:24,boxSizing:'border-box'}}><RouterProvider router={router}/></main></LocalizationProvider></AuthProvider></QueryClientProvider>);
`;

async function withFixture(flow, run) {
  const name = 'ai-case-review-' + randomUUID();
  let browser;
  try {
    await writeFile(new URL(name + '.tsx', root), fixture);
    await writeFile(new URL(name + '.html', root), `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(20_000);
    page.setDefaultNavigationTimeout(60_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => { errors.push('Unexpected API request: ' + route.request().url()); return route.abort(); });
    await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5197'}/${name}.html?flow=${flow}`);
    await mkdir('/tmp/qaira-ai-case-review', { recursive: true });
    try { await run(page); }
    catch (error) {
      await page.screenshot({ path: '/tmp/qaira-ai-case-review/' + flow + '-failure.png', fullPage: true });
      throw error;
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await Promise.all(['html', 'tsx'].map(extension => rm(new URL(name + '.' + extension, root), { force: true })));
  }
}

async function verifyMobileEditor(page, dialog, screenshot) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
  const detail = dialog.locator('.ai-artifact-detail');
  await detail.scrollIntoViewIfNeeded();
  for (const target of [dialog, detail, dialog.locator('.ai-test-generator-step-row').first()]) {
    assert.equal(await target.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, 'Review editor fits a narrow viewport');
  }
  await expect(dialog.getByRole('textbox', { name: 'Step 1 action', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Move step 1 down', exact: true })).toBeVisible();
  await page.screenshot({ path: '/tmp/qaira-ai-case-review/' + screenshot + '-mobile-dark.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
}

test('generation review preserves edits, selected identities and reordered cases/steps in the acceptance request', { timeout: 120_000 }, async () => {
  await withFixture('generate', async page => {
    await page.getByRole('button', { name: 'Open create test case options', exact: true }).click();
    await page.getByRole('menuitem', { name: 'AI Test Cases Generation', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'AI Test Case Generator', exact: true });
    await dialog.getByRole('button', { name: 'Generate drafts', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: 'Alpha scenario', exact: true })).toBeVisible();
    const outline = dialog.getByRole('navigation', { name: 'Proposal outline' });
    await expect(outline.getByRole('button', { name: 'Move case 1 up', exact: true })).toBeDisabled();
    await expect(outline.getByRole('button', { name: 'Move case 3 down', exact: true })).toBeDisabled();
    await outline.getByRole('checkbox', { name: 'Select Gamma scenario', exact: true }).uncheck();
    await outline.locator('.ai-artifact-item > button').filter({ hasText: 'Beta scenario' }).click();
    await dialog.getByRole('button', { name: 'Edit draft', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Test case title', exact: true }).fill('Reviewed beta');
    await dialog.getByRole('textbox', { name: 'Description', exact: true }).fill('Reviewed description for beta');
    await dialog.getByRole('combobox', { name: 'Priority', exact: true }).selectOption('5');
    await dialog.getByRole('textbox', { name: 'Step 1 expected result', exact: true }).fill('Edited beta first outcome');
    await dialog.getByRole('button', { name: 'Move step 2 up', exact: true }).click();
    await expect(dialog.getByRole('textbox', { name: 'Step 1 action', exact: true })).toHaveValue('beta second action');
    await expect(dialog.getByRole('textbox', { name: 'Step 2 expected result', exact: true })).toHaveValue('Edited beta first outcome');
    await expect(dialog.getByRole('textbox', { name: 'Step 1 action', exact: true })).toBeFocused();
    await outline.getByRole('button', { name: 'Move case 2 up', exact: true }).click();
    assert.deepEqual(await outline.locator('.ai-artifact-item > button strong').allTextContents(), ['Reviewed beta', 'Alpha scenario', 'Gamma scenario']);
    await expect(outline.getByRole('checkbox', { name: 'Select Gamma scenario', exact: true })).not.toBeChecked();
    await expect(dialog.getByRole('textbox', { name: 'Test case title', exact: true })).toHaveValue('Reviewed beta');
    await dialog.getByRole('textbox', { name: 'Search generated test cases', exact: true }).fill('Reviewed beta');
    await expect(outline.getByRole('button', { name: 'Move case 1 down', exact: true })).toBeDisabled();
    await dialog.getByRole('textbox', { name: 'Search generated test cases', exact: true }).fill('');
    await expect(outline.getByRole('button', { name: 'Move case 1 down', exact: true })).toBeEnabled();
    const accept = dialog.getByRole('button', { name: 'Accept Into Test Case Library (2)', exact: true });
    await dialog.getByRole('textbox', { name: 'Step 1 expected result', exact: true }).fill('');
    await expect(accept).toBeDisabled();
    await expect(dialog.getByRole('status').filter({ hasText: 'Complete the action and expected result for step 1.' })).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Step 1 expected result', exact: true }).fill('Reviewed beta second outcome');
    await page.screenshot({ path: '/tmp/qaira-ai-case-review/generation-review-desktop.png', fullPage: true });
    await verifyMobileEditor(page, dialog, 'generation-review');
    await dialog.getByRole('textbox', {name:'Description',exact:true}).fill('');
    await expect(accept).toBeDisabled();
    await dialog.getByRole('textbox', {name:'Description',exact:true}).fill('Reviewed description for beta');
    await accept.click();
    await page.waitForFunction(() => window.accepted.length === 1);
    const payload = await page.evaluate(() => window.accepted[0]);
    assert.deepEqual(payload.cases.map(row => row.title), ['Reviewed beta', 'Alpha scenario']);
    assert.equal(payload.cases[0].description, 'Reviewed description for beta');
    assert.equal(payload.cases[0].priority, 5);
    assert.deepEqual(payload.cases[0].steps, [
      { step_order: 1, step_type: 'api', action: 'beta second action', expected_result: 'Reviewed beta second outcome' },
      { step_order: 2, step_type: 'web', action: 'beta first action', expected_result: 'Edited beta first outcome' }
    ]);
    assert.deepEqual(payload.cases[0].parameter_values, { customer: 'reviewer' });
    assert.equal((await page.evaluate(() => window.requests[0])).requirement_ids.length, 0, 'A Story remains optional');
  });
});

test('improve review keeps source priority, edited fields and step order through the real apply/confirmation flow', { timeout: 120_000 }, async () => {
  await withFixture('improve', async page => {
    await page.getByRole('button', { name: 'AI Improve Test Cases', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'AI Improve Test Case', exact: true });
    await dialog.getByRole('button', { name: 'Generate drafts', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: 'Improved checkout', exact: true })).toBeVisible();
    assert.equal(await dialog.getByRole('button', { name: /^Move case / }).count(), 0, 'A single improvement has no case-order controls');
    await dialog.getByRole('button', { name: 'Edit draft', exact: true }).click();
    await expect(dialog.getByRole('combobox', { name: 'Priority', exact: true })).toHaveValue('1');
    await dialog.getByRole('textbox', { name: 'Test case title', exact: true }).fill('Reviewed improved checkout');
    await dialog.getByRole('textbox', { name: 'Description', exact: true }).fill('Reviewed recovery details');
    await dialog.getByRole('combobox', { name: 'Priority', exact: true }).selectOption('2');
    await dialog.getByRole('button', { name: 'Move step 1 down', exact: true }).click();
    await expect(dialog.getByRole('textbox', { name: 'Step 2 action', exact: true })).toBeFocused();
    await expect(dialog.getByRole('button', { name: 'Move step 2 down', exact: true })).toBeDisabled();
    await dialog.getByRole('textbox', { name: 'Step 1 expected result', exact: true }).fill('Improved API response is recorded');
    const apply = dialog.getByRole('button', { name: 'Apply Reviewed Improvement (1)', exact: true });
    await dialog.getByRole('textbox', { name: 'Step 2 action', exact: true }).fill('');
    await expect(apply).toBeDisabled();
    await dialog.getByRole('textbox', { name: 'Step 2 action', exact: true }).fill('Reviewed first action');
    await page.screenshot({ path: '/tmp/qaira-ai-case-review/improve-review-desktop.png', fullPage: true });
    await verifyMobileEditor(page, dialog, 'improve-review');
    await dialog.getByRole('button', { name: 'Finish editing draft', exact: true }).click();
    await apply.click();
    const confirmation = page.getByRole('dialog', { name: 'Replace saved steps?', exact: true });
    await confirmation.getByRole('button', { name: 'Replace steps', exact: true }).click();
    await page.waitForFunction(() => window.updates.length === 1);
    const update = await page.evaluate(() => window.updates[0]);
    assert.equal(update.title, 'Reviewed improved checkout');
    assert.equal(update.description, 'Reviewed recovery details');
    assert.equal(update.priority, 2);
    assert.deepEqual(update.steps, [
      { step_order: 1, step_type: 'api', action: 'improved second action', expected_result: 'Improved API response is recorded' },
      { step_order: 2, step_type: 'web', action: 'Reviewed first action', expected_result: 'improved first outcome' }
    ]);
    assert.deepEqual(update.parameter_values, { 't.customer': 'reviewer' });
  });
});
