import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const { chromium } = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url))('playwright');
const root = new URL('../../../platform/frontend/', import.meta.url);

test('case actions hide denied operations and preserve independently granted import and run options', { timeout: 60000 }, async () => {
  const source = await readFile(new URL('../../../platform/frontend/test/browser/splitActionMenus.test.mjs', import.meta.url), 'utf8');
  let fixture = source.match(/const fixture = `([\s\S]*?)`;\n/)[1];
  fixture = fixture.replace("import { AuthProvider }", "import { AuthProvider, useAuth }");
  fixture = fixture.replace('api.auth.session=async()=>session;', 'api.auth.session=async()=>({...session,user:{...session.user}});');
  fixture = fixture.replace("const flags={flags:new Proxy({},{get:()=>true})}", "const policy=(await import('/src/platform/lib/featurePolicy.generated.json')).default; const flags={...policy,flags:Object.fromEntries(policy.feature_keys.map(key=>[key,true]))}");
  fixture = fixture.replace('const router=createMemoryRouter', `function AccessChanges(){const {refreshSession}=useAuth(); window.setGrants=async grants=>{session.user={...session.user,role:'member',workspace_permissions:['workspace.view'],project_permissions:{'split-project':['testcase.view','project.view','app_type.view',...grants]}};await refreshSession()};return null} const router=createMemoryRouter`);
  fixture = fixture.replace('<AuthProvider><LocalizationProvider', '<AuthProvider><AccessChanges/><LocalizationProvider');
  const name = 'capability-actions-' + randomUUID();
  const html = new URL(name + '.html', root), tsx = new URL(name + '.tsx', root);
  let browser;
  try {
    await writeFile(tsx, fixture);
    await writeFile(html, `<!doctype html><html><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(12000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => route.abort());
    await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5294'}/${name}.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.getByRole('button', { name: 'Create Test Case', exact: true }).waitFor({ timeout: 30000 });
    await page.evaluate(() => window.setGrants([]));
    for (const name of ['Create Test Case', 'Create Module', 'Create Suite', 'Run manually', 'Bulk Import']) {
      await page.getByRole('button', { name, exact: true }).waitFor({ state: 'hidden' });
    }
    await page.evaluate(() => window.setGrants(['testcase.import']));
    try { await page.getByRole('button', { name: 'Bulk Import', exact: true }).waitFor(); }
    catch (error) { console.log('Permission action diagnostics:', await page.locator('body').innerText(), errors); throw error; }
    assert.equal(await page.getByRole('button', { name: 'Create Test Case', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Open create test case options' }).count(), 0);
    await page.evaluate(() => window.setGrants(['testcase.create', 'testcase.import']));
    await page.getByRole('button', { name: 'Create Test Case', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Open create test case options' }).click();
    await page.getByRole('menuitem', { name: 'Bulk Import', exact: true }).waitFor();
    assert.equal(await page.getByRole('menuitem', { name: 'AI Test Cases Generation', exact: true }).count(), 0);
    await page.evaluate(() => window.setGrants(['testcase.create']));
    await page.getByRole('menu').waitFor({ state: 'hidden' });
    await page.evaluate(() => window.setGrants(['automation.run.local']));
    await page.getByRole('button', { name: 'Run local automation', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Run manually', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Open selected test case run options' }).count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await Promise.allSettled([unlink(html), unlink(tsx)]);
  }
});
