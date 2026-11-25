import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { fulfillAutomationFixtureRequest } from '../../../automation/test/browser/helpers/automationFixtureTransport.mjs';

const require = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require('playwright');
const { expect } = require('playwright/test');
const root = new URL('../../../platform/frontend/', import.meta.url);

test('Studio opens the shared Automation Engineer and builds a linked manual case in place', { timeout: 120_000 }, async () => {
  const template = await readFile(new URL('../../../testing/test/browser/testCaseDataSets.test.mjs', import.meta.url), 'utf8');
  const fixture = runInNewContext(template.match(/const fixture\s*=\s*(`[\s\S]*?`);/)[1])
    .replace("import {TestCasesPage} from '/services/testing/frontend/pages/TestCasesPage';", "import {AgenticWorkflowsPage} from '/services/agentic/frontend/pages/AgenticWorkflowsPage';import '/src/product-experience.css';")
    .replace("path:'/test-cases',element:<TestCasesPage/>", "path:'/agentic-workflows',element:<AgenticWorkflowsPage/>")
    .replace("initialEntries:['/test-cases?case=case1']", "initialEntries:['/agentic-workflows?view=agents']")
    .replace('window.navigate=to=>router.navigate(to);', 'window.navigate=to=>router.navigate(to);window.agentRouter=router;')
    .replace('const client=new QueryClient', `
      window.created=[];window.builds=[];
      const manualSteps=[{id:'manual-open',test_case_id:'case1',step_order:1,step_type:'web',action:'Open checkout',expected_result:'The checkout heading is visible'}];
      const cases=[{...item,title:'Manual checkout',test_data_set_ids:[],test_data_sets:[]}];
      const savedSteps=[];
      api.testEnvironments.list=async()=>[{id:'checkout-env',project_id:'p',app_type_id:'a',name:'Checkout QA'}];
      api.testCases.list=async()=>cases;
      api.testCases.get=async id=>cases.find(testCase=>testCase.id===id);
      api.testSteps.list=async input=>input.test_case_id==='case1'?manualSteps:savedSteps;
      api.testCases.create=async input=>{
        window.created.push(structuredClone(input));
        const {steps,...record}=input;
        cases.push({...cases[0],...record,id:'engineer-case',display_id:'AT-1',step_count:steps.length});
        savedSteps.push(...steps.map((step,index)=>({...step,id:'step-'+index,test_case_id:'engineer-case'})));
        return {id:'engineer-case'};
      };
      const job={id:'engineer-build',project_id:'p',app_type_id:'a',category:'automation_build',status:'queued',description:'Develop the checkout case.',metadata:{agent_activity:true,input_test_case_ids:['engineer-case']},events:[]};
      api.testCases.buildAutomationBatch=async input=>{window.builds.push(structuredClone(input));return {transaction_id:job.id}};
      api.testCases.automationBuildStatus=async()=>job;
      api.testCases.automationAgentActivities=async()=>({items:window.builds.length?[job]:[],next_cursor:null});
      const client=new QueryClient`);
  const name = 'studio-automation-engineer-' + randomUUID();
  const tsx = new URL(name + '.tsx', root);
  const html = new URL(name + '.html', root);
  let browser;
  try {
    await writeFile(tsx, fixture);
    await writeFile(html, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(15_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
      if (await fulfillAutomationFixtureRequest(page, route)) return;
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/automation/browser-preflight')) return route.fulfill({ json: { reachable: true, missing_variables: [] } });
      if (path.endsWith('/agent-runs/scorecards')) return route.fulfill({ json: { items: [] } });
      if (path.endsWith('/agent-runs/descriptors')) return route.fulfill({ json: [] });
      errors.push(`Unexpected API ${path}`);
      await route.abort();
    });

    await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5197'}/${name}.html`, { waitUntil: 'commit' });
    try {
      await page.getByRole('button', { name: 'Open Automation Engineer', exact: true }).click({ timeout: 30_000 });
    } catch (error) {
      throw new Error(`The Agent Studio library did not open. Browser errors: ${JSON.stringify(errors)}. ${await page.locator('body').innerText()}`, { cause: error });
    }
    await expect(page.getByRole('heading', { name: 'Automation Engineer', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start review', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Build from a manual test', exact: true }).click();
    const build = page.getByRole('dialog', { name: 'Set up an automation build' });
    await build.getByText('Test cases', { exact: true }).click();
    await build.getByRole('checkbox', { name: /Manual checkout/ }).check();
    await build.getByLabel('Automation case name', { exact: true }).fill('Checkout browser automation');
    await build.getByLabel('Automation case type', { exact: true }).selectOption('web');
    await build.getByLabel('Automation case start URL', { exact: true }).fill('https://store.example.test/checkout');
    await build.getByLabel('Test environment', { exact: true }).selectOption('checkout-env');
    await build.getByLabel('Build instructions (optional)', { exact: true }).fill('Use the checkout heading as the final assertion.');
    await build.getByRole('button', { name: 'Create & build', exact: true }).click();
    try {
      await expect(page.getByRole('region', { name: 'Automation build tools', exact: true })).toBeVisible({ timeout: 15_000 });
    } catch (error) {
      const state = await page.evaluate(() => ({ created: window.created.length, builds: window.builds.length, location: window.agentRouter.state.location }));
      throw new Error(`Expected the saved build workspace. State: ${JSON.stringify(state)}. Browser errors: ${JSON.stringify(errors)}. ${await page.locator('body').innerText()}`, { cause: error });
    }

    const receipt = await page.evaluate(() => ({ created: window.created, builds: window.builds, location: window.agentRouter.state.location }));
    assert.equal(receipt.created.length, 1);
    assert.deepEqual(receipt.created[0].manual_test_case_ids, ['case1']);
    assert.equal(receipt.created[0].steps[0].expected_result, 'The checkout heading is visible');
    assert.equal(receipt.created[0].test_data_options.test_environment_id, 'checkout-env');
    assert.equal(receipt.builds.length, 1);
    assert.deepEqual(receipt.builds[0].test_case_ids, ['engineer-case']);
    assert.equal(receipt.builds[0].ai_feature, 'ai.agentic.automation-engineer');
    assert.equal(receipt.builds[0].allow_browser_actions, true);
    assert.equal(receipt.builds[0].test_environment_id, 'checkout-env');
    assert.equal(receipt.builds[0].verification_mode, 'verify');
    assert.match(receipt.builds[0].additional_context, /checkout heading as the final assertion/);
    assert.equal(receipt.location.pathname, '/agentic-workflows');
    assert.equal(new URLSearchParams(receipt.location.search).get('tab'), 'build');
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await Promise.all([rm(tsx, { force: true }), rm(html, { force: true })]);
  }
});
