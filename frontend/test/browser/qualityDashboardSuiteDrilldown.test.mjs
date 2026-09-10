import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('../../', import.meta.url);
const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '/src/auth/AuthContext';
import { api, sessionStorage } from '/src/lib/api';
import { setCurrentScope } from '/src/hooks/useCurrentProject';
import { DesignPage } from '/src/pages/DesignPage';
import '/src/styles.css';
import '/src/workspace-layout.css';
const session = { token: 'isolated-fixture', user: { id: 'qa', role: 'admin', name: 'QA Reviewer', email: 'qa@example.test' } };
sessionStorage.write(session);
localStorage.setItem('hellotest.current_project_id', 'project');
localStorage.setItem('hellotest.current_app_type_by_project', JSON.stringify({ project: 'web', other: 'other-web' }));
for (const methods of Object.values(api)) if (methods && typeof methods === 'object') for (const [name, value] of Object.entries(methods)) if (typeof value === 'function') methods[name] = async () => [];
api.auth.session = async () => session;
api.settings.getWorkspacePreferences = async () => ({ preferences: {} });
api.featureFlags.snapshot = async () => ({ flags: new Proxy({}, { get: () => true }) });
api.metadata.domain = async () => ({});
const apps = [{ id: 'web', project_id: 'project', name: 'Web app' }, { id: 'mobile', project_id: 'project', name: 'Mobile app' }, { id: 'other-web', project_id: 'other', name: 'Other project app' }];
const suites = [{ id: 'web-suite', display_id: 'SUITE-1', name: 'Web checks', app_type_id: 'web', test_case_ids: [] }, { id: 'mobile-suite', display_id: 'SUITE-2', name: 'Mobile regression', app_type_id: 'mobile', test_case_ids: [] }];
api.projects.list = async () => [{ id: 'project', name: 'Quality project' }, { id: 'other', name: 'Other project' }];
api.appTypes.list = async query => apps.filter(app => app.project_id === query.project_id);
window.suiteQueries = [];
api.testSuites.list = async query => {
  window.suiteQueries.push(query);
  if (query.project_id === 'project') return new Promise(resolve => { window.resolveSuiteLookup = () => resolve(structuredClone(suites)); });
  if (query.project_id === 'other') return [];
  return structuredClone(suites.filter(suite => suite.app_type_id === query.app_type_id));
};
window.switchSuiteProject = () => setCurrentScope('other', 'other-web');
function Fixture() { const route = useLocation(); return <><DesignPage /><output data-testid='route' hidden>{route.pathname + route.search}</output></>; }
createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={['/design?project=project&suite=' + (new URLSearchParams(location.search).get('suite') || 'mobile-suite')]}><AuthProvider><Fixture /></AuthProvider></MemoryRouter></QueryClientProvider>);
`;

test('dashboard suite links resolve across applications without leaking late project results', { timeout: 60000 }, async () => {
  const name = `suite-drilldown-${randomUUID()}`;
  const html = new URL(`${name}.html`, root); const tsx = new URL(`${name}.tsx`, root);
  let browser;
  try {
    await writeFile(html, `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    await writeFile(tsx, fixture);
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(10000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const url = `${process.env.VITE_TEST_URL || 'http://127.0.0.1:5180'}/${name}.html`;

    await page.goto(url);
    await page.waitForFunction(() => typeof window.resolveSuiteLookup === 'function');
    assert.match(await page.getByTestId('route').textContent(), /suite=mobile-suite/, 'Keep the record token while project lookup is pending');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('hellotest.current_app_type_by_project')).project), 'web');
    await page.evaluate(() => window.resolveSuiteLookup());
    await page.getByRole('button', { name: 'Edit Suite', exact: true }).click();
    assert.equal(await page.getByRole('dialog', { name: 'Edit Suite', exact: true }).getByLabel('Suite name').inputValue(), 'Mobile regression');
    await page.getByRole('button', { name: 'Close suite editor', exact: true }).click();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('hellotest.current_app_type_by_project')).project), 'mobile');
    assert.equal(await page.evaluate(() => localStorage.getItem('hellotest.current_project_id')), 'project');
    assert.match(await page.getByTestId('route').textContent(), /suite=mobile-suite/);
    assert.deepEqual(await page.evaluate(() => window.suiteQueries.filter(query => query.project_id)), [{ project_id: 'project' }]);

    // A selected suite must also close when it is unavailable in a new project.
    await page.evaluate(() => window.switchSuiteProject());
    await page.waitForFunction(() => !document.querySelector('[data-testid="route"]').textContent.includes('suite='));
    assert.equal(await page.getByRole('button', { name: 'Edit Suite', exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('hellotest.current_app_type_by_project')).other), 'other-web');

    // A display ID is also a supported suite route token.
    await page.goto(url + '?suite=SUITE-2');
    await page.waitForFunction(() => typeof window.resolveSuiteLookup === 'function');
    await page.evaluate(() => window.resolveSuiteLookup());
    await page.getByRole('button', { name: 'Edit Suite', exact: true }).click();
    assert.equal(await page.getByRole('dialog', { name: 'Edit Suite', exact: true }).getByLabel('Suite name').inputValue(), 'Mobile regression');
    await page.getByRole('button', { name: 'Close suite editor', exact: true }).click();
    assert.match(await page.getByTestId('route').textContent(), /suite=SUITE-2/);

    // Resolve a project A lookup only after the user has changed to project B.
    await page.goto(url);
    await page.waitForFunction(() => typeof window.resolveSuiteLookup === 'function');
    await page.evaluate(() => window.switchSuiteProject());
    await page.waitForFunction(() => window.suiteQueries.some(query => query.project_id === 'other'));
    await page.waitForFunction(() => !document.querySelector('[data-testid="route"]').textContent.includes('suite='));
    await page.evaluate(() => window.resolveSuiteLookup());
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => localStorage.getItem('hellotest.current_project_id')), 'other');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('hellotest.current_app_type_by_project')).other), 'other-web');
    assert.equal(await page.getByRole('button', { name: 'Edit Suite', exact: true }).count(), 0);
    assert.doesNotMatch(await page.getByTestId('route').textContent(), /suite=/);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await Promise.allSettled([unlink(html), unlink(tsx)]);
  }
});
