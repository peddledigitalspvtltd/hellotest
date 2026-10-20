import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require('playwright');
const { expect } = require('playwright/test');
const root = new URL('../../../platform/frontend/', import.meta.url);

test('removing either standalone or linked automation deletes only its AT record without clearing instructions or converting identity', { timeout: 120_000 }, async () => {
  const template = await readFile(new URL('../../../testing/test/browser/testCaseDataSets.test.mjs', import.meta.url), 'utf8');
  let fixture = runInNewContext(template.match(/const fixture\s*=\s*(`[\s\S]*?`);/)[1]);
  fixture = fixture.replace("import {TestCasesPage} from '/services/testing/frontend/pages/TestCasesPage';", "import {AutomationPage} from '/services/automation/frontend/pages/AutomationPage';").replace('element:<TestCasesPage/>', 'element:<AutomationPage/>');
  fixture = fixture.replace('const client=new QueryClient', `
    item.automated='yes';item.display_id='AT_7';item.automation_status='ready';
    item.manual_test_case_ids=new URLSearchParams(location.search).has('linked')?['manual']:[];
    steps.forEach(step=>step.automation_code='await web.click("Login.Submit");');
    window.removed=[];window.stepWrites=[];
    api.testCases.delete=async id=>{window.removed.push(id);return {deleted:true}};
    api.testSteps.update=async(id,input)=>{window.stepWrites.push({id,input});return {updated:true}};
    api.testCases.automationAgentActivity=async()=>null;
    const client=new QueryClient`);
  const name = 'automation-case-identity-' + randomUUID();
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
    for (const suffix of ['', '?linked=1']) {
      await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5197'}/${name}.html${suffix}`);
      await page.getByRole('tab', { name: /^Details/ }).click();
      await page.getByRole('button', { name: 'Remove automation case', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: "Warning, can't revert" });
      await expect(dialog).toBeVisible();
      assert.deepEqual(await page.evaluate(() => window.removed), []);
      await dialog.getByRole('button', { name: 'Delete automation case', exact: true }).click();
      await expect.poll(() => page.evaluate(() => window.removed)).toEqual(['case1']);
      assert.deepEqual(await page.evaluate(() => window.stepWrites), []);
      assert.deepEqual(await page.evaluate(() => window.updates), []);
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await Promise.all([rm(new URL(name + '.tsx', root), { force: true }), rm(new URL(name + '.html', root), { force: true })]);
  }
});
