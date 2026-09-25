import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const { chromium } = createRequire(new URL('../../../../../testengine/backend/package.json', import.meta.url))('playwright');
const root = new URL('../../', import.meta.url);

test('shell menus and navigation search follow flags and project permissions, including live changes', { timeout: 60000 }, async () => {
  const source = await readFile(new URL('./workspaceShell.test.mjs', import.meta.url), 'utf8');
  let fixture = source.match(/const fixture=`([\s\S]*?)`;\nconst adminFixture/)[1];
  fixture = fixture.replace(/function Screen\(\)\{.*\}\nconst router/, `import {CreateRunActionButton} from '/services/testing/frontend/components/CreateRunActionButton';
    function Screen(){window.refreshAccess=useAuth().refreshSession; return <><h1>Permitted workspace</h1><CreateRunActionButton source="TEST_RUNS" projectId="project" onCreateManualRun={()=>window.runMode='manual'} onCreateLocalRun={()=>window.runMode='local'} onCreateRemoteRun={()=>window.runMode='remote'}/></>}\nconst router`);
  fixture = fixture.replace('const router=createMemoryRouter', `
    import policy from '/src/platform/lib/featurePolicy.generated.json';
    let flags = Object.fromEntries(policy.feature_keys.map(key=>[key,key!=='hellotest.ai.chatbot']));
    api.featureFlags.snapshot=async()=>({...policy,flags:{...flags}});
    window.setCapabilityFlag=async(key,value)=>{flags[key]=value; await client.invalidateQueries()};
    window.setCapabilityPermissions=async(grants)=>{session.user={...session.user,role:'member',workspace_permissions:['workspace.view'],project_permissions:{project:grants}}; await window.refreshAccess()};
    const router=createMemoryRouter`);
  const name = 'capability-navigation-' + randomUUID();
  const html = new URL(name + '.html', root), tsx = new URL(name + '.tsx', root);
  let browser;
  try {
    await writeFile(tsx, fixture);
    await writeFile(html, `<!doctype html><html><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(10000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => route.abort());
    await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5294'}/${name}.html`);
    const sidebar = page.locator('#app-sidebar');
    const dashboard = sidebar.locator('a[href="/?view=analytics"]');
    await dashboard.waitFor();
    await page.evaluate(() => window.setCapabilityFlag('hellotest.analytics.dashboards', false));
    await dashboard.waitFor({ state: 'hidden' });
    assert.equal(await sidebar.locator('a[href="/?view=readiness"],a[href="/?view=custom"]').count(), 0);
    await page.getByRole('heading', { name: 'This capability is turned off', exact: true }).waitFor();
    await page.locator('.workspace-context-actions').getByRole('button', { name: 'Find a capability' }).click();
    await page.getByRole('searchbox').fill('dashboard');
    assert.equal(await page.getByRole('dialog').locator('a[href^="/?view="]').count(), 0);
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.setCapabilityFlag('hellotest.analytics.dashboards', true));
    await dashboard.waitFor();
    await page.evaluate(() => window.setCapabilityPermissions(['dashboard.view']));
    await sidebar.locator('a[href="/test-cases"]').waitFor({ state: 'hidden' });
    await sidebar.locator('a[href="/issues"]').waitFor({ state: 'hidden' });
    await dashboard.waitFor();
    assert.equal(await page.locator('.create-run-action-button').count(), 0, 'No run action without a grant');
    await page.evaluate(() => window.setCapabilityPermissions(['dashboard.view', 'automation.run.local']));
    await page.getByRole('button', { name: 'Create Local Run', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Create Manual Run', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Open create run options' }).count(), 0);
    await page.evaluate(() => window.setCapabilityPermissions(['dashboard.view', 'automation.run.local', 'automation.run.remote']));
    await page.getByRole('button', { name: 'Open create run options' }).click();
    await page.getByRole('menuitem', { name: 'Remote Run', exact: true }).waitFor();
    await page.evaluate(() => window.setCapabilityPermissions(['dashboard.view', 'automation.run.remote']));
    await page.getByRole('menu').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Create Remote Run', exact: true }).click();
    assert.equal(await page.evaluate(() => window.runMode), 'remote');
    await page.evaluate(() => window.setCapabilityFlag('hellotest.automation.remote_execution', false));
    await page.locator('.create-run-action-button').waitFor({ state: 'hidden' });
    await page.evaluate(() => window.fixtureNavigate('/test-cases'));
    await page.getByRole('heading', { name: "You need access to this area", exact: true }).waitFor();
    await page.evaluate(() => window.setCapabilityPermissions(['dashboard.view', 'testcase.view']));
    await sidebar.locator('a[data-nav-identity="cases"]').waitFor();
    await page.getByRole('heading', { name: 'Permitted workspace', exact: true }).waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await Promise.allSettled([unlink(html), unlink(tsx)]);
  }
});

test('an unavailable optional panel displays a closable dialog while retaining the host draft', { timeout: 30000 }, async () => {
  const name = 'capability-dialog-' + randomUUID();
  const html = new URL(name + '.html', root), tsx = new URL(name + '.tsx', root);
  let browser;
  try {
    await writeFile(tsx, `import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
      import {capabilityView} from '/src/platform/capabilities/CapabilityView';
      import '/src/styles.css'; import '/src/workspace-layout.css';
      window.__HELLOTEST_CONFIG__={CAPABILITY_UI_URLS:{ai:'/unavailable-ai/manifest.json'}};
      window.__HELLOTEST_UI_HOST__={protocol:1};
      const Panel=capabilityView('ai','OptionalPanel',()=>{throw Error('Unexpected fallback')},'AI review');
      function Host(){const[open,setOpen]=useState(false);return <><input aria-label='Host draft' defaultValue='Unsaved changes'/><button onClick={()=>setOpen(true)}>Review with AI</button><Panel open={open} onClose={()=>setOpen(false)}/></>}
      createRoot(document.getElementById('root')).render(<Host/>);`);
    await writeFile(html, `<!doctype html><html><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
    const page = await browser.newPage();
    await page.route('**/unavailable-ai/manifest.json', route => route.fulfill({ status: 503, body: 'Unavailable' }));
    await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5294'}/${name}.html`);
    await page.getByRole('button', { name: 'Review with AI', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'AI review', exact: true });
    await dialog.getByRole('heading', { name: 'Unable to load AI review', exact: true }).waitFor();
    await dialog.getByRole('button', { name: 'Try again', exact: true }).click();
    await dialog.getByRole('heading', { name: 'Unable to load AI review', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('textbox', { name: 'Host draft', exact: true }).inputValue(), 'Unsaved changes');
    assert.notEqual(await page.evaluate(() => document.body.style.overflow), 'hidden');
  } finally { await browser?.close(); await Promise.allSettled([unlink(html), unlink(tsx)]); }
});
