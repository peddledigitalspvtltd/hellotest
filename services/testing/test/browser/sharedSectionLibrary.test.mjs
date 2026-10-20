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

async function libraryFixture({ limited = false } = {}) {
  const source = await readFile(new URL('./sharedStepAuthoringSave.test.mjs', import.meta.url), 'utf8');
  let fixture = runInNewContext(source.match(/const fixture\s*=\s*(`[\s\S]*?`);/)[1]);
  fixture = fixture.replace("initialEntries:['/shared-steps?group=group-1']", "initialEntries:['/shared-steps?view=automation&group=group-1']");
  if (limited) fixture = fixture.replace("role:mode==='permissions'?'member':'admin'", "role:'member'");
  return fixture.replace('const client=new QueryClient', `
    groups[0] = {...groups[0], name:'Reusable sign in', authoring_mode:'structured', gherkin_document:'',
      parameter_values:{'t.target':'https://fixture.example.test/login','t.email':'saved@example.test','t.password':'fixture-private-original'},
      steps:[
        {id:'section-open',step_order:1,action:'Open sign in',expected_result:'Sign in is displayed',step_type:'web',automation_code:'await page.goto(params["t.target"]);',api_request:null},
        {id:'section-api',step_order:2,action:'Check account service',expected_result:'The service responds',step_type:'api',automation_code:'await page.goto("https://fixture.example.test/stale-web-program");',api_request:{method:'GET',url:'https://fixture.example.test/account',validations:[{kind:'status',expected:'200'}]}}
      ]
    };
    window.improves=0;api.testCases.rephraseStep=async input=>{window.improves++;return{step:{action:'Reviewed '+input.step.action,expected_result:'Reviewed outcome',step_type:'api'}};};
    const client=new QueryClient`);
}

async function withLibrary(options, run) {
  const name = 'shared-section-library-' + randomUUID();
  const html = new URL(name + '.html', root);
  const tsx = new URL(name + '.tsx', root);
  let browser, page;
  try {
    await writeFile(tsx, await libraryFixture(options));
    await writeFile(html, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
    page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => { errors.push('Unexpected live API request'); return route.abort(); });
    page.setDefaultTimeout(15000);
    await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5197'}/${name}.html`);
    await page.getByLabel('Group name').waitFor();
    await run(page);
    assert.deepEqual(errors, []);
  } catch (error) {
    if (page) {
      await writeFile('/tmp/qaira-shared-section-library-failure.txt', await page.locator('body').innerText());
      await page.screenshot({ path: '/tmp/qaira-shared-section-library-failure.png', fullPage: true });
    }
    throw error;
  } finally {
    await browser?.close();
    await Promise.all([rm(html, { force: true }), rm(tsx, { force: true })]);
  }
}

function parameterRow(page, dialog, name) {
  return dialog.locator('.step-parameter-row').filter({ has: page.locator('code').filter({ hasText: new RegExp('^@' + name.replaceAll('.', '\\.') + '$') }) });
}

async function openParameters(page) {
  await page.getByRole('button', { name: /^(?:Group Params|Parameters|Test Params)/ }).click();
  const dialog = page.getByRole('dialog', { name: /Shared Section Group Params/ });
  await dialog.waitFor();
  return dialog;
}

async function setInstructions(page, sectionName, code) {
  await page.getByRole('button', { name: `Add instruction to ${sectionName}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Shared Section instructions', exact: true });
  await dialog.waitFor();
  await dialog.locator('summary').filter({ hasText: /^Automation code/ }).click();
  await dialog.getByLabel('Step automation code', { exact: true }).fill(code);
  await dialog.getByRole('button', { name: 'Save automation', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function sectionMenu(page, name, action) {
  await page.getByRole('button', { name: `${name} actions`, exact: true }).click();
  await page.getByRole('menuitem', { name: action, exact: true }).click();
}

test('Shared Section authoring adds instructions and keeps all three views aligned until group save', { timeout: 120000 }, async () => {
  await withLibrary({}, async page => {
    const save = page.getByRole('button', { name: 'Save Shared Section Group', exact: true });
    await expect(page.getByRole('button', { name: 'Visual builder', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add step', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Add instruction to Open sign in', exact: true }).click();
    const cancelled = page.getByRole('dialog', { name: 'Shared Section instructions', exact: true });
    await cancelled.waitFor();
    await page.keyboard.press('Escape');
    await expect(cancelled).toHaveCount(0);
    assert.equal(await page.evaluate(() => window.writes.length), 0);
    await page.getByRole('button', { name: 'Section 2: Check account service', exact: true }).click();
    const apiInstructions = page.getByRole('region', { name: 'Check account service API request', exact: true });
    await expect(apiInstructions).toContainText('https://fixture.example.test/account');
    await expect(page.locator('body')).not.toContainText('stale-web-program');
    await page.getByRole('button', { name: 'Add section', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Add section', exact: true });
    await dialog.getByLabel('Section name', { exact: true }).fill('Enter account details');
    await dialog.getByLabel('Expected result', { exact: true }).fill('The account values are entered');
    await dialog.getByRole('button', { name: 'Add section', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await setInstructions(page, 'Enter account details', 'await page.getByLabel("Email").fill(params["t.email"]);\nawait page.getByLabel("Password").fill(params["t.password"]);');
    await page.getByRole('button', { name: 'Edit Enter account details', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Edit section', exact: true });
    await dialog.getByLabel('Expected result', { exact: true }).fill('The reviewed account values are entered');
    await dialog.locator('summary').filter({ hasText: 'Execution options' }).click();
    await dialog.getByRole('checkbox', { name: 'Screenshot on failure', exact: true }).check();
    await dialog.getByRole('button', { name: 'Apply section', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole('button', { name: 'Add instruction to Enter account details', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Shared Section instructions', exact: true });
    await dialog.getByRole('combobox', { name: 'Keyword', exact: true }).selectOption('reload');
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    await dialog.getByRole('button', { name: 'Save automation', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    assert.equal(await page.evaluate(() => window.writes.length), 0, 'section and instruction changes are local drafts');
    await page.getByRole('button', { name: 'Section 3: Enter account details', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Enter account details instructions', exact: true })).toContainText('Email');

    dialog = await openParameters(page);
    await expect(parameterRow(page, dialog, 't.email')).toHaveCount(1);
    await parameterRow(page, dialog, 't.email').locator('textarea').fill('temporary@example.test');
    await parameterRow(page, dialog, 't.email').locator('textarea').fill('');
    const password = parameterRow(page, dialog, 't.password').locator('input[type="password"]');
    await expect(password).toBeEnabled();
    await expect(password).toHaveValue('');
    await password.fill('fixture-private-replacement');
    await expect(dialog).not.toContainText('fixture-private-original');
    await expect(dialog).not.toContainText('fixture-private-replacement');
    await page.keyboard.press('Escape');
    await expect(page.locator('body')).not.toContainText('fixture-private-replacement');

    await page.getByRole('tab', { name: 'Source', exact: true }).click();
    const source = page.getByRole('region', { name: 'Automation section source', exact: true });
    await expect(source).toContainText('Enter account details');
    await expect(source).toContainText('params["t.email"]');
    await expect(source).toContainText('https://fixture.example.test/account');
    await expect(source).not.toContainText('fixture-private-original');
    await expect(source).not.toContainText('fixture-private-replacement');
    await page.getByRole('tab', { name: 'Gherkin', exact: true }).click();
    const panel = page.locator('#shared-step-group-authoring-panel');
    await expect(panel).toContainText('Enter account details');
    await expect(panel).not.toContainText('page.getByLabel');
    assert.equal(await page.evaluate(() => window.writes.length), 0);
    await save.click();
    await page.waitForFunction(() => window.writes.length === 1);
    const write = await page.evaluate(() => window.writes[0].input);
    assert.equal(write.steps.length, 3);
    assert.equal(write.steps[2].step_type, 'web');
    assert.equal(write.steps[2].expected_result, 'The reviewed account values are entered');
    assert.match(write.steps[2].automation_code, /getByLabel\("Email"\)/);
    assert.match(write.steps[2].automation_code, /@hellotest-options screenshotOnFailure/);
    assert.match(write.steps[2].automation_code, /await page\.reload\(\)/);
    assert.equal(write.steps[1].api_request.url, 'https://fixture.example.test/account');
    assert.equal(write.parameter_values['t.email'], '', 'an intentional empty parameter remains an explicit default');
    assert.equal(write.parameter_values['t.password'], 'fixture-private-replacement');

    const instructionsTab = page.getByRole('tab', { name: 'Instructions', exact: true });
    await instructionsTab.click();
    await page.getByRole('button', { name: 'Section 3: Enter account details', exact: true }).click();
    await page.screenshot({ path: '/tmp/qaira-shared-section-library-desktop.png', fullPage: true });
    await instructionsTab.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Source', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('End');
    await expect(page.getByRole('tab', { name: 'Gherkin', exact: true })).toHaveAttribute('aria-selected', 'true');
    await instructionsTab.click();
    await page.getByRole('button', { name: 'Section 3: Enter account details', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'section authoring fits a narrow viewport');
    await page.screenshot({ path: '/tmp/qaira-shared-section-library-mobile.png', fullPage: true });
  });
});

test('Shared Section actions preserve draft implementations and remove stale params after clearing', { timeout: 120000 }, async () => {
  await withLibrary({}, async page => {
    await page.getByRole('button', { name: 'Edit Open sign in', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Edit section', exact: true });
    await dialog.locator('summary').filter({ hasText: 'Execution options' }).click();
    await dialog.getByRole('checkbox', { name: 'Optional step', exact: true }).check();
    await dialog.getByRole('button', { name: 'Apply section', exact: true }).click();
    await page.getByRole('button', { name: 'Add section', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Add section', exact: true });
    await dialog.getByLabel('Section name', { exact: true }).fill('Check final state');
    await dialog.getByRole('button', { name: 'Add section', exact: true }).click();
    await sectionMenu(page, 'Open sign in', 'Cut section');
    await sectionMenu(page, 'Check account service', 'Paste after section');
    await expect(page.getByRole('button', { name: 'Section 1: Check account service', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Section 2: Open sign in', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Section 3: Check final state', exact: true })).toBeVisible();
    await sectionMenu(page, 'Check final state', 'Cut section');
    await sectionMenu(page, 'Check account service', 'Paste after section');
    await expect(page.getByRole('button', { name: 'Section 2: Check final state', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Section 3: Open sign in', exact: true })).toBeVisible();
    await sectionMenu(page, 'Check final state', 'Remove section');
    await sectionMenu(page, 'Open sign in', 'Copy section');
    await sectionMenu(page, 'Check account service', 'Paste after section');
    await expect(page.getByRole('button', { name: /^Section \d+: Open sign in$/ })).toHaveCount(2);
    await sectionMenu(page, 'Check account service', 'Clear implementation');
    assert.equal(await page.evaluate(() => window.writes.length), 0);
    await page.getByRole('button', { name: 'Save Shared Section Group', exact: true }).click();
    await page.waitForFunction(() => window.writes.length === 1);
    let write = await page.evaluate(() => window.writes[0].input);
    assert.equal(write.steps.length, 3);
    assert.equal(write.steps[0].action, 'Check account service');
    assert.equal(write.steps[0].automation_code, '');
    assert.equal(write.steps[0].api_request, null);
    assert.equal(write.steps[2].id, 'section-open', 'cut and paste retain the moved section identity');
    assert.notEqual(write.steps[1].id, write.steps[2].id, 'copy and paste allocate a new section identity');
    assert.equal(write.steps[1].automation_code, '// @hellotest-options optional\nawait page.goto(params["t.target"]);');
    assert.equal(write.steps[2].automation_code, write.steps[1].automation_code);

    await page.getByRole('button', { name: 'Open sign in actions', exact: true }).first().click();
    await page.getByRole('menuitem', { name: 'Remove section', exact: true }).click();
    await sectionMenu(page, 'Open sign in', 'Clear implementation');
    dialog = await openParameters(page);
    await expect(parameterRow(page, dialog, 't.target')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Save Shared Section Group', exact: true }).click();
    await page.waitForFunction(() => window.writes.length === 2);
    write = await page.evaluate(() => window.writes[1].input);
    assert.equal(write.steps.length, 2);
    assert.deepEqual(write.steps.map(step => step.step_order), [1, 2]);
    assert.equal(Object.hasOwn(write.parameter_values, 't.target'), false);
  });
});

test('Shared Section viewers without code permissions keep metadata access without implementation leaks', { timeout: 90000 }, async () => {
  await withLibrary({ limited: true }, async page => {
    await expect(page.getByRole('tab', { name: 'Source', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Add instruction to / })).toHaveCount(0);
    await page.getByRole('button', { name: 'Section 1: Open sign in', exact: true }).click();
    await expect(page.locator('body')).not.toContainText('page.goto');
    await expect(page.locator('body')).not.toContainText('fixture-private-original');
    await page.getByRole('tab', { name: 'Gherkin', exact: true }).click();
    await expect(page.locator('#shared-step-group-authoring-panel')).toContainText('Open sign in');
    await expect(page.locator('#shared-step-group-authoring-panel')).not.toContainText('fixture.example.test/account');
    await page.getByRole('button', { name: 'Save Shared Section Group', exact: true }).click();
    await page.waitForFunction(() => window.writes.length === 1);
    const write = await page.evaluate(() => window.writes[0].input);
    assert.equal(write.steps[0].action, 'Open sign in');
    for (const step of write.steps) {
      assert.equal(Object.hasOwn(step, 'automation_code'), false, 'metadata saves omit implementation fields for server-side preservation');
      assert.equal(Object.hasOwn(step, 'api_request'), false);
    }
  });
});

test('Shared Section wording improvement preserves its platform and executable assets', { timeout: 90000 }, async () => {
  await withLibrary({}, async page => {
    await sectionMenu(page, 'Open sign in', 'Improve wording');
    await page.waitForFunction(() => window.improves === 1);
    await expect(page.getByRole('button', { name: 'Section 1: Reviewed Open sign in', exact: true })).toBeVisible();
    assert.equal(await page.evaluate(() => window.writes.length), 0);
    await page.getByRole('button', { name: 'Save Shared Section Group', exact: true }).click();
    await page.waitForFunction(() => window.writes.length === 1);
    const write = await page.evaluate(() => window.writes[0].input);
    assert.equal(write.steps[0].action, 'Reviewed Open sign in');
    assert.equal(write.steps[0].expected_result, 'Reviewed outcome');
    assert.equal(write.steps[0].step_type, 'web', 'wording suggestions cannot change execution platform');
    assert.equal(write.steps[0].automation_code, 'await page.goto(params["t.target"]);');
    assert.equal(write.steps[1].api_request.url, 'https://fixture.example.test/account');
  });
});
