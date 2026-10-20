import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require('playwright');
const expect = require('playwright/test').expect.configure({ timeout: 15_000 });
const root = new URL('../../../platform/frontend/', import.meta.url);

async function creationFixture() {
  const template = await readFile(new URL('./testCaseDataSets.test.mjs', import.meta.url), 'utf8');
  let fixture = runInNewContext(template.match(/const fixture\s*=\s*(`[\s\S]*?`);/)[1]);
  fixture = fixture.replace("import {TestCasesPage} from '/services/testing/frontend/pages/TestCasesPage';", "import {TestCasesPage} from '/services/testing/frontend/pages/TestCasesPage';import {AutomationPage} from '/services/automation/frontend/pages/AutomationPage';import '/src/product-experience.css';");
  fixture = fixture.replace('const client=new QueryClient', `
    item={...item,title:'Manual checkout',parameter_values:{'t.user':'Saved Alice'},test_data_set_ids:[],test_data_sets:[]};
    const manualSteps=steps.map(step=>({...step,group_id:null,group_name:null,group_kind:null,reusable_group_id:null}));
    const automated=[];
    window.createInputs=[];window.parameterWrites=[];window.createFailure=true;window.saveFailure=false;
    api.testDataSets.list=async()=>[data];
    api.testCases.list=async()=>[item,...automated];
    api.testCases.listPage=async query=>({items:query.manual_test_case_id?automated:[item],next_cursor:null,is_last:true});
    api.testCases.get=async id=>{
      const entry=automated.find(row=>[row.id,row.display_id].includes(id));
      return structuredClone(entry?{...entry,inherited_parameter_values:{...item.parameter_values},effective_parameter_values:{...item.parameter_values,...entry.parameter_values},parameter_sources:Object.fromEntries(Object.keys(item.parameter_values).map(name=>[name,{kind:'linked_manual',test_case_id:item.id,display_id:item.display_id}]))}:item);
    };
    api.testSteps.list=async input=>structuredClone(input.test_case_id==='case1'?manualSteps:automated.find(row=>row.id===input.test_case_id)?.steps||[]);
    api.testCases.update=async(id,input)=>{
      window.parameterWrites.push(input);
      if(window.holdParameterSave)await new Promise(resolve=>window.releaseParameterSave=resolve);
      if(window.saveFailure)throw new Error('Parameter revision changed. Review and retry.');
      if(input.expected_revision!==item.revision)throw new Error('Stale parameter revision');
      item={...item,...input,revision:item.revision+1};return structuredClone(item);
    };
    api.testCases.create=async input=>{
      window.createInputs.push(input);
      if(window.createFailure)throw new Error('Creation temporarily unavailable');
      if(window.holdCreate)await new Promise(resolve=>window.releaseCreate=resolve);
      const created={...item,...input,id:'auto'+(automated.length+1),display_id:'AT_'+(automated.length+1),revision:1,detail_complete:true};
      created.steps=input.steps.map((step,index)=>({...step,id:'auto-step-'+index,test_case_id:created.id}));
      automated.push(created);return structuredClone(created);
    };
    api.testCases.automationAgentActivity=async()=>null;api.testCases.automationAgentActivities=async()=>({items:[],next_cursor:null});
    api.testCases.metrics=async()=>({catalog:{total:automated.length}});
    window.getManual=()=>structuredClone(item);
    const client=new QueryClient`);
  fixture = fixture.replace("{path:'/test-cases',element:<TestCasesPage/>}", "{path:'/test-cases',element:<TestCasesPage/>},{path:'/automation',element:<AutomationPage/>}");
  return fixture + '\nwindow.fixtureRouter=router;window.refetchCases=()=>client.invalidateQueries({queryKey:["test-cases"]});';
}

async function withFixture(run) {
  const name = 'manual-automation-create-' + randomUUID();
  let browser;
  try {
    await writeFile(new URL(name + '.tsx', root), await creationFixture());
    await writeFile(new URL(name + '.html', root), `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => { errors.push('Unexpected API request'); return route.abort(); });
    await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5197'}/${name}.html`);
    try { await run(page); } catch (error) {
      throw new Error(`${error.message}\n${await page.locator('body').innerText().catch(() => '')}`, { cause: error });
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await Promise.all([rm(new URL(name + '.tsx', root), { force: true }), rm(new URL(name + '.html', root), { force: true })]);
  }
}

async function editManualParameter(page, value) {
  await page.getByRole('button', { name: /^Test Params/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Test Params', exact: true });
  const parameter = dialog.locator('.step-parameter-row').filter({ has: page.locator('code').filter({ hasText: /^@t\.user$/ }) });
  await parameter.locator('textarea').first().fill(value);
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: /^Automation Cases/ }).click();
}

test('manual-to-automation creation waits for parameter values, closes durably after success, and refreshes linked coverage', { timeout: 120_000 }, async () => withFixture(async page => {
  await page.evaluate(() => { window.holdParameterSave = true; });
  await editManualParameter(page, 'Draft Bob');
  await page.getByRole('button', { name: 'Create automation case', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preparing automation…', exact: true })).toBeDisabled();
  await page.waitForFunction(() => typeof window.releaseParameterSave === 'function');
  assert.equal(await page.evaluate(() => window.fixtureRouter.state.location.pathname), '/test-cases');
  assert.equal(await page.evaluate(() => window.createInputs.length), 0);
  await page.evaluate(() => { window.holdParameterSave = false; window.releaseParameterSave(); });
  const create = page.getByRole('dialog', { name: 'Create automation case', exact: true });
  await expect(create).toBeVisible();
  assert.equal(await page.evaluate(() => window.getManual().parameter_values['t.user']), 'Draft Bob');
  const writes = await page.evaluate(() => window.parameterWrites);
  assert.equal(writes.length, 1);
  assert.deepEqual(Object.keys(writes[0]).sort(), ['expected_revision', 'parameter_values', 'test_data_options']);
  assert.deepEqual(writes[0].test_data_options.parameter_overrides, ['t.user']);
  assert.equal(writes[0].expected_revision, 1);
  await create.getByRole('button', { name: 'Author steps', exact: true }).click();
  const startUrl = create.getByRole('textbox', { name: 'Automation case start URL', exact: true });
  await expect(startUrl).toHaveAttribute('type', 'url');
  await expect(startUrl).toHaveAttribute('required', '');
  await expect(create.getByRole('button', { name: 'Create case', exact: true })).toBeDisabled();
  await startUrl.fill('https://user:password@checkout.example.test/start');
  await expect(create.getByRole('button', { name: 'Create case', exact: true })).toBeDisabled();
  await startUrl.fill('https://checkout.example.test/start?workspace=reviewed');
  await create.getByRole('button', { name: 'Create case', exact: true }).click();
  await expect(create).toBeVisible();
  await expect(create.getByRole('textbox', { name: 'Automation case name', exact: true })).toHaveValue('Manual checkout · Automation');
  assert.equal(await page.evaluate(() => window.createInputs.length), 1);
  await page.evaluate(() => { window.createFailure = false; window.holdCreate = true; });
  await create.getByRole('button', { name: 'Create case', exact: true }).click();
  await page.waitForFunction(() => typeof window.releaseCreate === 'function');
  await expect(create.getByRole('button', { name: 'Creating...', exact: true })).toBeDisabled();
  assert.equal(await page.evaluate(() => window.createInputs.length), 2);
  await page.evaluate(() => window.releaseCreate());
  await expect(create).toHaveCount(0);
  await page.waitForFunction(() => window.fixtureRouter.state.location.search === '?case=auto1');
  await page.evaluate(() => window.refetchCases());
  await expect(create).toHaveCount(0);
  const saved = await page.evaluate(() => window.createInputs.at(-1));
  assert.deepEqual(saved.parameter_values, {});
  assert.deepEqual(saved.manual_test_case_ids, ['case1']);
  assert.equal(saved.automated, 'yes');
  assert.equal(saved.automation_start_url, 'https://checkout.example.test/start?workspace=reviewed');
  await page.getByRole('tab', { name: /^Build tools/ }).click();
  await expect(page.getByRole('textbox', { name: 'Agent start URL', exact: true })).toHaveValue(saved.automation_start_url);
  await page.getByRole('tab', { name: /^Plan/ }).click();
  await page.getByRole('button', { name: 'Parameters', exact: true }).click();
  const inherited = page.getByRole('dialog', { name: 'Automation case parameter values', exact: true });
  const inheritedUser = inherited.locator('.step-parameter-row').filter({ has: page.locator('code').filter({ hasText: /^@t\.user$/ }) });
  await expect(inheritedUser.locator('textarea').first()).toHaveValue('Draft Bob');
  await expect(inheritedUser).toContainText('Inherited from Manual case TC-1');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.navigate('/test-cases?case=case1'));
  await page.getByRole('tab', { name: /^Automation Cases/ }).click();
  await expect(page.getByText('Manual checkout · Automation', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create automation case', exact: true }).click();
  await expect(create).toBeVisible();
  await expect(create.getByRole('textbox', { name: 'Automation case start URL', exact: true })).toHaveValue('');
  await create.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(create).toHaveCount(0);
  await page.waitForFunction(() => !new URLSearchParams(window.fixtureRouter.state.location.search).has('create'));
  await page.evaluate(() => window.refetchCases());
  await expect(create).toHaveCount(0);
  assert.equal(await page.evaluate(() => window.createInputs.length), 2);
}));

test('failed manual parameter persistence keeps creation on the manual case and retries only the parameter save', { timeout: 90_000 }, async () => withFixture(async page => {
  await page.evaluate(() => { window.saveFailure = true; window.holdParameterSave = true; });
  await editManualParameter(page, 'Reviewed Carol');
  await page.getByRole('button', { name: 'Create automation case', exact: true }).click();
  await page.waitForFunction(() => typeof window.releaseParameterSave === 'function');
  await page.evaluate(() => { window.holdParameterSave = false; window.releaseParameterSave(); });
  await expect(page.getByRole('button', { name: 'Create automation case', exact: true })).toBeEnabled();
  assert.equal(await page.evaluate(() => window.fixtureRouter.state.location.pathname), '/test-cases');
  await expect(page.getByRole('dialog', { name: 'Create automation case', exact: true })).toHaveCount(0);
  assert.equal(await page.evaluate(() => window.createInputs.length), 0);
  await page.evaluate(() => { window.saveFailure = false; });
  await page.getByRole('button', { name: 'Create automation case', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Create automation case', exact: true })).toBeVisible();
  assert.equal(await page.evaluate(() => window.getManual().parameter_values['t.user']), 'Reviewed Carol');
  assert.ok((await page.evaluate(() => window.parameterWrites)).every(write => Object.keys(write).every(key => ['parameter_values', 'expected_revision', 'test_data_options'].includes(key))));
}));

test('manual-to-automation creation flushes an unsaved dataset selection with its shared-data policy', { timeout: 90_000 }, async () => withFixture(async page => {
  const section = page.locator('.editor-accordion-section').filter({ has: page.locator('.editor-accordion-toggle-copy>strong', { hasText: /^Data Sets$/ }) });
  await section.waitFor();
  if (await section.locator('.editor-accordion-toggle').getAttribute('aria-expanded') === 'false') await section.locator('.editor-accordion-toggle').click();
  await section.getByRole('button', { name: 'Link Existing Data Set', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Link Existing Data Set', exact: true });
  await picker.getByRole('radio').check();
  await picker.getByRole('button', { name: 'Link Data Set', exact: true }).click();
  await section.getByRole('checkbox', { name: 'Override Shared Groups Test Data' }).uncheck();
  await page.getByRole('tab', { name: /^Automation Cases/ }).click();
  await page.getByRole('button', { name: 'Create automation case', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Create automation case', exact: true });
  await expect(create).toBeVisible();
  const writes = await page.evaluate(() => window.parameterWrites);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].test_data_set_ids, ['data']);
  assert.equal(writes[0].test_data_options.override_shared_steps, false);
  assert.deepEqual(writes[0].parameter_values, { 't.user': 'Saved Alice' });
  assert.equal(writes[0].title, undefined, 'data handoff does not save unrelated metadata drafts');
  await create.getByRole('button', { name: 'Author steps', exact: true }).click();
  await create.getByRole('textbox', { name: 'Automation case start URL', exact: true }).fill('https://checkout.example.test/start');
  await page.evaluate(() => { window.createFailure = false; });
  await create.getByRole('button', { name: 'Create case', exact: true }).click();
  await expect(create).toHaveCount(0);
  const saved = await page.evaluate(() => window.createInputs[0]);
  assert.deepEqual(saved.test_data_set_ids, ['data']);
  assert.deepEqual(saved.parameter_values, {}, 'manual inputs remain inherited defaults, not copied automation values');
}));
