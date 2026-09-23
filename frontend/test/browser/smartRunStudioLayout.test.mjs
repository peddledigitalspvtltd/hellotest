import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile, rm } from 'node:fs/promises';
const require = createRequire(new URL('../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require('playwright');
const root = new URL('../../', import.meta.url);

test('Smart Run keeps context and run settings separate and uses the full review canvas', { timeout: 90000 }, async () => {
  const files = [];
  let browser;
  try {
    let fixture = await readFile(new URL('../../src/smartRunStudioPreview.tsx', import.meta.url), 'utf8');
    fixture = fixture.replaceAll('"./', '"/src/');
    fixture = `import { AuthProvider } from '/src/auth/AuthContext';
import { MemoryRouter } from 'react-router-dom';
import { api, sessionStorage } from '/src/lib/api';
` + fixture;
    fixture = fixture.replace('const queryClient =', `const session = { token: 'fixture', user: { id: 'qa', role: 'admin', email: 'qa@example.test', name: 'QA' } };
sessionStorage.write(session);
localStorage.setItem('hellotest.current_project_id', 'project-1');
localStorage.setItem('hellotest.current_app_type_by_project', JSON.stringify({'project-1':'app-1'}));
for (const methods of Object.values(api)) if (methods && typeof methods === 'object') for (const name of Object.keys(methods)) if (typeof methods[name] === 'function') methods[name] = async () => [];
api.auth.session = async () => session;
api.featureFlags.snapshot = async () => ({ flags: new Proxy({}, { get: () => true }) });
api.settings.getWorkspacePreferences = async () => ({ preferences: {} });
api.metadata.domain = async () => ({ test_environments: { browsers: [], mobile_os: [] }, test_data_sets: { modes: [] } });
const queryClient =`);
    fixture = fixture.replace('<Preview />', '<AuthProvider><MemoryRouter><Preview /></MemoryRouter></AuthProvider>');
    const name = `smart-run-layout-${randomUUID()}`;
    for (const [extension, content] of [['tsx', fixture], ['html', `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`]]) {
      const file = new URL(`${name}.${extension}`, root); files.push(file); await writeFile(file, content);
    }
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5191'}/${name}.html`);
    const modal = page.getByRole('dialog', { name: 'AI Smart Run', exact: true });
    await modal.waitFor();
    await page.getByRole('tab', { name: 'Context', exact: true }).waitFor();
    assert.equal(await page.locator('#smart-run-settings-panel').isVisible(), false);
    assert.equal(await page.locator('#smart-run-context-panel').isVisible(), true);
    const main = await page.locator('.execution-smart-plan-pane').boundingBox();
    assert.ok(main.width > 1000, `Ranked coverage should fill the canvas (${main.width}px)`);
    const overflow = await modal.evaluate(element => element.scrollWidth - element.clientWidth);
    assert.ok(overflow <= 1, `The modal must not scroll horizontally (${overflow}px)`);
    await page.screenshot({ path: '/tmp/qaira-smart-run-context-1600.png' });
    await page.getByRole('tab', { name: 'Run settings', exact: true }).click();
    assert.equal(await page.locator('#smart-run-context-panel').isVisible(), false);
    assert.equal(await page.locator('#smart-run-settings-panel').isVisible(), true);
    await page.getByLabel('Run Name', { exact: true }).waitFor();
    await page.getByRole('tab', { name: 'Context', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Create AI Smart Run', exact: true }).isEnabled(), true);
    await page.locator('.execution-smart-plan-pane').getByRole('button', { name: 'Clear', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Create AI Smart Run', exact: true }).isEnabled(), false);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('tab', { name: 'Run settings', exact: true }).click();
    await page.getByLabel('Run Name', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: '/tmp/qaira-smart-run-settings-390.png' });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await Promise.all(files.map(file => rm(file, { force: true })));
  }
});
