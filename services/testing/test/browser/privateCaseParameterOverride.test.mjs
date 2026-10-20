import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile, writeFile, rm, mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';

const require = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const {chromium} = require('playwright');
const expect = require('playwright/test').expect.configure({timeout: 15000});
const root = new URL('../../../platform/frontend/', import.meta.url);

async function fixtureFor(kind) {
  const template = await readFile(new URL('./testCaseDataSets.test.mjs', import.meta.url), 'utf8');
  let fixture = runInNewContext(template.match(/const fixture\s*=\s*(`[\s\S]*?`);/)[1]);
  if (kind === 'automation') {
    fixture = fixture.replace("import {TestCasesPage} from '/services/testing/frontend/pages/TestCasesPage';", "import {AutomationPage} from '/services/automation/frontend/pages/AutomationPage';import '/src/product-experience.css';")
      .replace('element:<TestCasesPage/>', 'element:<AutomationPage/>');
  }
  return fixture.replace('const client=new QueryClient', `
    const privateDefaults = {'t.case_opaque':'fixture-original-case-value','r.run_opaque':'fixture-original-run-value','t.untouched_opaque':'fixture-untouched-value'};
    const privateNames = Object.keys(privateDefaults);
    Object.assign(data, {mode:'key_value',columns:['key','value','is_secret'],rows:Object.entries(privateDefaults).map(([key,value])=>({key,value,is_secret:true}))});
    const manual = {...item,id:'manual1',display_id:'TC_12',title:'Manual private defaults',parameter_values:{...privateDefaults},test_data_set_ids:[],test_data_sets:[],test_data_options:{private_parameter_names:privateNames}};
    item = {...item,display_id:${JSON.stringify(kind === 'automation' ? 'AT_12' : 'TC_12')},title:'Private parameter overrides',automated:${JSON.stringify(kind === 'automation' ? 'yes' : 'no')},automation_status:'ready',parameter_values:{'t.public':'Own public'},test_data_options:{override_shared_steps:true,private_parameter_names:privateNames},${kind === 'automation' ? "manual_test_case_id:'manual1',manual_test_case_ids:['manual1'],test_data_set_ids:[],test_data_sets:[]" : "test_data_set_ids:['data'],test_data_sets:[data]"}};
    steps.splice(0,steps.length,{id:'s1',test_case_id:'case1',step_order:1,action:'Enter @t.case_opaque and @r.run_opaque then use @t.untouched_opaque and @t.password',expected_result:'Accepted',step_type:'web',automation_code:'',api_request:null});
    const project = () => ({...item,${kind === 'automation' ? "inherited_parameter_values:{...manual.parameter_values},effective_parameter_values:{...manual.parameter_values,...item.parameter_values},parameter_sources:Object.fromEntries(privateNames.map(name=>[name,{kind:Object.hasOwn(item.parameter_values,name)?'automation':'linked_manual',test_case_id:Object.hasOwn(item.parameter_values,name)?item.id:manual.id,display_id:'TC_12'}]))," : ''}effective_private_parameter_names:privateNames});
    api.testCases.list=async()=>[project()];api.testCases.listPage=async()=>({items:[project()],is_last:true,next_cursor:null});
    api.testCases.get=async id=>structuredClone(id==='manual1'?manual:project());
    api.testCases.update=async(id,input)=>{window.updates.push(structuredClone(input));item={...item,...input,revision:item.revision+1};return {updated:true,revision:item.revision};};
    api.testCases.automationAgentActivity=async()=>null;api.testCases.automationAgentActivities=async()=>({items:[],next_cursor:null});
    api.testCases.metrics=async()=>({catalog:{total:1}});api.testDataSets.list=async()=>[data];
    window.privateSources=()=>({manual:{...manual.parameter_values},data:Object.fromEntries(data.rows.map(row=>[row.key,row.value]))});
    const client=new QueryClient`);
}

for (const kind of ['manual', 'automation']) {
  test(`${kind} case can replace, intentionally blank and reset hidden parameters without copying inherited secrets`, {timeout: 120000}, async () => {
    const name = 'private-case-overrides-' + randomUUID();
    let browser, page;
    try {
      await writeFile(new URL(name + '.tsx', root), await fixtureFor(kind));
      await writeFile(new URL(name + '.html', root), `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
      browser = await chromium.launch({headless: true, executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
      page = await browser.newPage({viewport: {width: 1440, height: 1050}});
      page.setDefaultTimeout(15000);
      page.setDefaultNavigationTimeout(60000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/**', route => { errors.push('Unexpected real API request'); return route.abort(); });
      await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5197'}/${name}.html`);
      const sourceBefore = await page.evaluate(() => window.privateSources());
      const openParameters = async () => {
        if (kind === 'automation') {
          await page.getByRole('tab', {name: /^Plan/}).click();
          await page.getByRole('button', {name: 'Parameters', exact: true}).click();
        } else await page.getByRole('button', {name: /^Test Params/}).click();
        return page.getByRole('dialog', {name: kind === 'automation' ? 'Automation case parameter values' : 'Test Params', exact: true});
      };
      const row = (dialog, name) => dialog.locator('.step-parameter-row').filter({has: page.locator('code').filter({hasText: new RegExp('^@' + name.replace('.', '\\.') + '$')})});
      const save = async predicate => {
        await page.keyboard.press('Escape');
        if (kind === 'automation') {
          await page.getByRole('tab', {name: /^Details/}).click();
          await page.getByRole('button', {name: 'Save details', exact: true}).click();
        } else await page.getByRole('button', {name: 'Save test case', exact: true}).click();
        await page.waitForFunction(predicate);
        return page.evaluate(() => window.updates.at(-1).parameter_values);
      };
      const assertOriginalsHidden = async dialog => {
        const visibleText = await page.locator('body').innerText();
        for (const original of Object.values(sourceBefore.manual)) assert.equal(visibleText.includes(original), false);
        for (const key of ['t.case_opaque', 'r.run_opaque', 't.untouched_opaque', 't.password']) {
          const input = row(dialog, key).locator('input[type="password"]');
          await expect(input).toBeEnabled();
          await expect(input).toHaveValue('');
          await expect(input).toHaveAttribute('placeholder', /Hidden value/);
          await expect(row(dialog, key).getByRole('combobox')).toBeDisabled();
        }
      };

      let dialog = await openParameters();
      await assertOriginalsHidden(dialog);
      const newPassword = row(dialog, 't.password').locator('input[type="password"]');
      await newPassword.pressSequentially('fresh-first-password');
      await expect(newPassword).toHaveValue('fresh-first-password', {timeout: 5000});
      await expect(dialog).not.toContainText('fresh-first-password');
      await row(dialog, 't.case_opaque').locator('input[type="password"]').fill('replacement-case-input');
      await row(dialog, 'r.run_opaque').locator('input[type="password"]').fill('replacement-run-input');
      const screenshots = process.env.BROWSER_SCREENSHOT_DIR || '/tmp/qaira-private-case-parameters';
      await mkdir(screenshots, {recursive: true});
      await dialog.screenshot({path: `${screenshots}/${kind}-desktop.png`});
      await page.setViewportSize({width: 390, height: 844});
      assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, 'private replacement controls fit the mobile dialog');
      await dialog.screenshot({path: `${screenshots}/${kind}-mobile.png`});
      await page.setViewportSize({width: 1440, height: 1050});
      let saved = await save(() => window.updates.at(-1)?.parameter_values?.['r.run_opaque'] === 'replacement-run-input');
      assert.equal(saved['t.case_opaque'], 'replacement-case-input');
      assert.equal(saved['r.run_opaque'], 'replacement-run-input', 'case defaults for run-scoped names are persisted at case level');
      assert.equal(saved['t.password'], 'fresh-first-password', 'the first keystroke in a newly authored private input is preserved');
      assert.equal(saved['t.public'], 'Own public');
      assert.equal(Object.hasOwn(saved, 't.untouched_opaque'), false);
      assert.deepEqual(await page.evaluate(() => window.privateSources()), sourceBefore, 'an override never updates its manual case or Data Set');

      dialog = await openParameters();
      await assertOriginalsHidden(dialog);
      await expect(row(dialog, 't.case_opaque')).toContainText(/override/i);
      await row(dialog, 't.case_opaque').getByRole('button', {name: 'Use empty value', exact: true}).click();
      saved = await save(() => window.updates.at(-1)?.parameter_values && Object.hasOwn(window.updates.at(-1).parameter_values, 't.case_opaque') && window.updates.at(-1).parameter_values['t.case_opaque'] === '');
      assert.equal(saved['t.case_opaque'], '', 'blank is an explicit override, never an inherited fallback');
      assert.equal(Object.hasOwn(saved, 't.untouched_opaque'), false);

      dialog = await openParameters();
      await assertOriginalsHidden(dialog);
      await row(dialog, 't.case_opaque').getByRole('button', {name: /^Reset to .* value$/}).click();
      await expect(row(dialog, 't.case_opaque')).toContainText(/Inherited from/);
      saved = await save(() => window.updates.at(-1)?.parameter_values && !Object.hasOwn(window.updates.at(-1).parameter_values, 't.case_opaque'));
      assert.equal(Object.hasOwn(saved, 't.case_opaque'), false);
      assert.equal(Object.hasOwn(saved, 't.untouched_opaque'), false);
      assert.equal(saved['r.run_opaque'], 'replacement-run-input');
      assert.equal(saved['t.password'], 'fresh-first-password', 'subsequent saves preserve the untouched case private override');
      assert.deepEqual(await page.evaluate(() => window.privateSources()), sourceBefore);
      dialog = await openParameters();
      await assertOriginalsHidden(dialog);
      await expect(row(dialog, 't.case_opaque').getByRole('button', {name: /^Reset to .* value$/})).toHaveCount(0);
      assert.deepEqual(errors, []);
    } finally {
      await browser?.close();
      await Promise.all([rm(new URL(name + '.tsx', root), {force: true}), rm(new URL(name + '.html', root), {force: true})]);
    }
  });
}
