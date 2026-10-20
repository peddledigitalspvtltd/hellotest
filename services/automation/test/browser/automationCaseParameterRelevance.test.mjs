import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require('playwright');
const expect = require('playwright/test').expect.configure({ timeout: 15000 });
const root = new URL('../../../platform/frontend/', import.meta.url);

test('automation shows case-relevant editable parameters with and without inherited data, and clears the previous case inventory', { timeout: 90000 }, async () => {
  const template = await readFile(new URL('../../../testing/test/browser/testCaseDataSets.test.mjs', import.meta.url), 'utf8');
  let fixture = runInNewContext(template.match(/const fixture\s*=\s*(`[\s\S]*?`);/)[1]);
  fixture = fixture.replace("import {TestCasesPage} from '/services/testing/frontend/pages/TestCasesPage';", "import {AutomationPage} from '/services/automation/frontend/pages/AutomationPage';")
    .replace("path:'/test-cases',element:<TestCasesPage/>", "path:'/automation',element:<AutomationPage/>")
    .replace("initialEntries:['/test-cases?case=case1']", "initialEntries:['/automation?case=case1']");
  fixture = fixture.replace('const client=new QueryClient', `
    item={...item,title:'Sign in',automated:'yes',automation_status:'ready',suite_ids:['suite'],test_data_set_ids:[],test_data_sets:[],
      parameter_values:{'t.account':'Case Alice','r.email':'old-own@example.test','r.blank':'','t.private_input':'never-render-private'},test_data_options:{private_parameter_names:['t.private_input']}};
    const second={...item,id:'case2',display_id:'AT_2',title:'Second case',suite_ids:[],parameter_values:{'t.second':'Second only'},test_data_options:{},revision:1};
    const linkedData={...data,name:'Inherited sign-in data',columns:['r.email'],rows:[{'r.email':'selected@example.test'}]};
    let inheritedData=false;
    const project=()=>({...item,effective_test_data_set_ids:inheritedData?['data']:[],inherited_parameter_values:{'t.manual':'Manual default'}});
    steps.splice(0,steps.length,{id:'s1',test_case_id:'case1',step_order:1,step_type:'web',action:'Enter @t.account for @s.tenant and notify @reviewer',expected_result:'Done',automation_code:'import { test } from "@playwright/test"; await page.fill("input", params["t.account"]); const note="@r.literal";'});
    api.testSuites.list=async()=>[{id:'suite',name:'Selected suite',parameter_values:{'s.tenant':'Acme','s.unrelated_case':'Other case value'}}];
    api.testCases.list=async()=>[project(),second];api.testCases.listPage=async()=>({items:[project(),second],is_last:true,next_cursor:null});
    api.testCases.get=async id=>structuredClone(id==='case2'?second:project());
    api.testSteps.list=async input=>structuredClone(input.test_case_id==='case2'?[{id:'second-step',test_case_id:'case2',step_order:1,step_type:'web',action:'Enter @t.second',expected_result:'Done',automation_code:''}]:steps);
    api.testCases.update=async(id,input)=>{window.updates.push(input);item={...item,...input,revision:item.revision+1};return project();};
    api.testCases.automationAgentActivity=async()=>null;api.testCases.automationAgentActivities=async()=>({items:[],next_cursor:null});
    api.testCases.metrics=async()=>({catalog:{total:2}});api.testDataSets.list=async()=>[linkedData];
    window.linkInheritedData=()=>{inheritedData=true;return client.invalidateQueries({queryKey:['test-case-detail']});};
    const client=new QueryClient`);
  const name = 'automation-case-parameter-relevance-' + randomUUID();
  let browser, page;
  try {
    await writeFile(new URL(name + '.tsx', root), fixture);
    await writeFile(new URL(name + '.html', root), `<!doctype html><html><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
    page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => { errors.push('Unexpected API: ' + route.request().url()); return route.abort(); });
    await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5197'}/${name}.html`);
    await page.getByRole('tab', { name: /^Test Data/ }).click();
    let section = page.getByRole('region', { name: 'Test Params', exact: true });
    await expect(section).toBeVisible();
    assert.equal(await section.locator('details').getAttribute('open'), null);
    await section.locator('summary').click();
    await expect(section).toContainText('Case Alice');
    await expect(section).toContainText('Manual default');
    await expect(section).toContainText('@s.tenant');
    await expect(section).toContainText('Hidden value');
    assert.doesNotMatch(await section.innerText(), /unrelated_case|@r\.reviewer|@r\.playwright|@r\.literal|never-render-private/);
    await section.getByRole('button', { name: 'Edit Test Params' }).click();
    let dialog = page.getByRole('dialog', { name: 'Automation case parameter values' });
    const row = name => dialog.locator('.step-parameter-row').filter({ has: page.locator('code').filter({ hasText: new RegExp('^@' + name.replace('.', '\\.') + '$') }) });
    await expect(row('r.blank').locator('textarea')).toHaveValue('');
    await expect(row('t.private_input').locator('input[type=password]')).toBeEnabled();
    await expect(row('t.private_input').locator('input[type=password]')).toHaveValue('');
    await row('r.blank').locator('textarea').fill('Edited case default');
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: /^Details/ }).click();
    await page.getByRole('button', { name: 'Save details', exact: true }).click();
    await page.waitForFunction(() => window.updates.some(input => input.parameter_values?.['r.blank'] === 'Edited case default'));
    assert.equal(await page.evaluate(() => window.updates.at(-1).parameter_values['t.private_input']), 'never-render-private');
    await page.evaluate(() => window.linkInheritedData());
    await page.getByRole('tab', { name: /^Test Data/ }).click();
    await expect(page.getByRole('region', { name: 'Test Params', exact: true })).toHaveCount(0);
    section = page.getByRole('region', { name: 'Data Sets', exact: true });
    await expect(section).toContainText('Inherited sign-in data');
    await section.locator('summary').click();
    await expect(section.locator('.automation-case-parameter-values')).toContainText('selected@example.test');
    await section.getByRole('button', { name: 'Edit Test Params' }).click();
    dialog = page.getByRole('dialog', { name: 'Automation case parameter values' });
    await expect(row('r.email').locator('textarea')).toHaveValue('selected@example.test');
    await row('r.email').locator('textarea').fill('case-override@example.test');
    await page.keyboard.press('Escape');
    await expect(section.locator('.automation-case-parameter-values')).toContainText('case-override@example.test');
    await page.evaluate(() => window.navigate('/automation?case=case2'));
    await page.getByRole('tab', { name: /^Test Data/ }).click();
    section = page.getByRole('region', { name: 'Test Params', exact: true });
    await section.locator('summary').click();
    await expect(section).toContainText('Second only');
    assert.doesNotMatch(await section.innerText(), /Case Alice|t.account|t.manual|r.email|r.blank|unrelated_case/);
    assert.deepEqual(errors, []);
  } catch (error) {
    throw new Error(`${error.message}\n${await page?.locator('body').innerText().catch(() => '')}`, { cause: error });
  } finally {
    await browser?.close();
    await Promise.all([rm(new URL(name + '.tsx', root), { force: true }), rm(new URL(name + '.html', root), { force: true })]);
  }
});
