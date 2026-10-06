import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
const require = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { INTEGRATION_TYPE_OPTIONS } = createRequire(import.meta.url)('../../../platform/backend/src/domain/catalog.js');
const root = new URL('../../../platform/frontend/', import.meta.url);
const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '/src/auth/AuthContext';
import { api, sessionStorage } from '/src/lib/api';
import { setCurrentScope } from '/src/platform/hooks/useCurrentProject';
import { IntegrationsPage } from '/services/integration/frontend/pages/IntegrationsPage';
import '/src/styles.css'; import '/src/dark-theme.css'; import '/src/modal-system.css'; import '/src/workspace-layout.css';
const session = { token: 'isolated-fixture', user: { id: 'qa', role: 'admin', name: 'QA Reviewer', email: 'qa@example.test' } };
sessionStorage.write(session); localStorage.setItem('hellotest.current_project_id', 'project');
for (const methods of Object.values(api)) if (methods && typeof methods === 'object') for (const [name, value] of Object.entries(methods)) if (typeof value === 'function') methods[name] = async () => [];
api.auth.session = async () => session;
api.settings.getWorkspacePreferences = async () => ({ preferences: {} });
api.featureFlags.snapshot = async () => ({ flags: new Proxy({}, { get: () => true }) });
api.metadata.domain = async () => ({ integrations: { default_type: 'llm', types: ${JSON.stringify(INTEGRATION_TYPE_OPTIONS)} } });
api.projects.list = async () => [{ id: 'project', name: 'Quality project' }];
api.agenticWorkflows.list = async () => [];
const types = ${JSON.stringify(INTEGRATION_TYPE_OPTIONS.map(x=>x.value))};
const profiles = types.map(type => ({ id: 'saved-' + type, type, name: 'Profile ' + type, base_url: type === 'llm' ? 'https://model.example/v1' : 'https://provider.example', api_key: '********', model: 'test-model', username: 'qa', project_key: 'QA', is_active: true, config: { project_id: 'project', host: 'smtp.example', port: 587, password: '********', client_id: '123-test.apps.googleusercontent.com', owner: 'acme', repo: 'qa', branch: 'main', folder_id: 'folder', provider: 'browserstack', remote_url: 'https://hub-cloud.browserstack.com/wd/hub' } }));
api.integrations.list = async () => profiles;
window.connectionCalls = []; window.connectionMode = 'passed'; window.connectionWrites = 0;
api.integrations.create = api.integrations.update = async () => { window.connectionWrites++; return { id: 'new' }; };
api.integrations.testConnection = async (input, options) => {
 window.connectionCalls.push(input);
 const status = window.connectionMode;
 if (status === 'slow') return new Promise(resolve => { window.finishConnection = () => resolve({ ok: true, type: input.type, status: 'passed', summary: 'Old profile result', checks: [], latency_ms: 12, checked_at: new Date().toISOString() }); window.oldConnectionSignal = options.signal; });
 if (status === 'network') throw new Error('Connection request unavailable. Try again.');
 return { ok: status !== 'failed', type: input.type, status, summary: status === 'failed' ? 'Provider rejected credentials.' : status === 'warning' ? 'Connection has verification limits.' : 'Provider access verified.', checks: [{ id: 'auth', label: 'Provider authentication', status, detail: status === 'passed' ? 'The configured account authenticated successfully.' : 'Review provider permissions and limits.' }], next_step: status === 'passed' ? undefined : 'Review credentials and test again.', latency_ms: 24, checked_at: new Date().toISOString() };
};
window.switchIntegrationProject = () => setCurrentScope('other');
createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><AuthProvider><div className="app-shell app-layout" style={{ gridTemplateColumns: 'minmax(0,1fr)', padding: 0 }}><main className="workspace-main" data-route="/integrations"><IntegrationsPage /></main></div></AuthProvider></MemoryRouter></QueryClientProvider>);
`;
test('all integration forms test saved/draft settings, show outcomes, and discard stale checks', { timeout: 90000 }, async () => {
 const name = 'connection-check-' + randomUUID(); const html = new URL(name + '.html', root); const tsx = new URL(name + '.tsx', root); let browser;
 try {
  await writeFile(html, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
  await writeFile(tsx, fixture);
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5178'}/${name}.html`);
  const tile = type => page.locator('.record-card').filter({ has: page.locator('strong', { hasText: new RegExp('^Profile ' + type + '$') }) });
  await tile('llm').waitFor();
  for (const { value: type } of INTEGRATION_TYPE_OPTIONS) {
   await tile(type).click();
   const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Save integration', exact: true }) });
   await form.getByRole('button', { name: 'Test connection', exact: true }).click();
   await form.getByText('Provider access verified.', { exact: true }).waitFor();
   const input = await page.evaluate(() => window.connectionCalls.at(-1));
   assert.equal(input.integration_id, 'saved-' + type); assert.equal(input.type, type); assert.ok(!JSON.stringify(input).includes('********'));
   if (type === 'local-desktop') assert.equal(await form.getByLabel('Engine Host URL').inputValue(), 'https://provider.example');
   await page.getByRole('button', { name: 'Back to integration tiles', exact: true }).click();
  }
  await page.getByRole('button', { name: 'New Integration', exact: true }).click();
  const newForm = page.locator('form').filter({ has: page.getByRole('button', { name: 'Create integration', exact: true }) });
  const categories = { llm: 'ai', email: 'notification', google_auth: 'sso', google_drive: 'backup', github: 'repository', testengine: 'testgrid', 'local-desktop': 'testgrid', cloudrun: 'testgrid', ops: 'ops' };
  for (const [type, category] of Object.entries(categories)) {
   await newForm.getByLabel('Integration type', { exact: true }).selectOption(category);
   await newForm.getByLabel('Provider', { exact: true }).selectOption(type);
   await newForm.getByRole('button', { name: /Test connection|Test again/ }).click();
   await newForm.getByText('Provider access verified.', { exact: true }).waitFor();
   const input = await page.evaluate(() => window.connectionCalls.at(-1));
   assert.equal(input.type, type); assert.equal(input.integration_id, undefined);
  }
  await page.getByRole('button', { name: 'Back to integration tiles', exact: true }).click();
  await page.getByRole('button', { name: /^Open filters/ }).click();
  await page.getByRole('tab', { name: /^All types/ }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('checkbox', { name: 'Select Profile llm', exact: true }).check();
  const saved = page.getByRole('region', { name: 'Connection check for Profile llm', exact: true });
  await saved.getByRole('button', { name: 'Test connection', exact: true }).click();
  await saved.getByText('Provider access verified.', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.connectionCalls.at(-1)), { integration_id: 'saved-llm', type: 'llm' });
  await tile('llm').click();
  const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Save integration', exact: true }) });
  const panel = form.locator('.integration-connection-test');
  await page.evaluate(() => window.connectionMode = 'slow');
  await panel.getByRole('button', { name: 'Test connection', exact: true }).click();
  await form.getByLabel('Model', { exact: true }).fill('updated-model');
  await page.evaluate(() => window.finishConnection());
  assert.equal(await panel.getByText('Old profile result', { exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => window.oldConnectionSignal.aborted), true);
  for (const mode of ['warning', 'failed', 'network', 'passed']) {
   await page.evaluate(value => window.connectionMode = value, mode);
   await panel.getByRole('button', { name: /Test connection|Test again/ }).click();
   await panel.locator(mode === 'network' ? '.integration-connection-outcome.is-failed' : '.integration-connection-outcome.is-' + mode).waitFor();
  }
  await mkdir('/tmp/qaira-integration-design', { recursive: true });
  for (const width of [1440, 768, 390, 320]) {
   await page.setViewportSize({ width, height: 1000 }); await panel.scrollIntoViewIfNeeded();
   const bounds = await panel.boundingBox(); assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= width + 1);
   await page.screenshot({ path: '/tmp/qaira-integration-design/connection-' + width + '.png', fullPage: true });
  }
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark'); await page.waitForTimeout(250);
  await page.screenshot({ path: '/tmp/qaira-integration-design/connection-dark-320.png', fullPage: true });
  await page.evaluate(() => window.connectionMode = 'slow');
  await panel.getByRole('button', { name: 'Test again', exact: true }).click();
  await page.evaluate(() => window.switchIntegrationProject()); await page.evaluate(() => window.finishConnection());
  assert.equal(await page.getByText('Old profile result', { exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => window.connectionWrites), 0);
  assert.deepEqual(errors, []);
 } finally { await browser?.close(); await Promise.allSettled([unlink(html), unlink(tsx)]); }
});

test('Credentials creation selects HTTP only and keeps MCP management in Agent Studio', { timeout: 60000 }, async () => {
 const setup = `
agenticApi.workflowConnections.list = async () => [];
window.httpCredentialWrites=[];
agenticApi.workflowConnections.create = async input => { window.httpCredentialWrites.push(input); return {...input,id:'created-http'}; };
const httpExtension = {definition:{value:'http',label:'HTTP API',description:'Managed HTTP credentials'},records:[],renderEditor:({onSaved,onClose})=><WorkflowConnectionSettings kind="http" onSaved={onSaved} onClose={onClose}/>};
`;
 const variant=fixture.replace("import { IntegrationsPage } from '/services/integration/frontend/pages/IntegrationsPage';", "import { IntegrationsPage } from '/services/integration/frontend/pages/IntegrationsPage';\nimport {WorkflowConnectionSettings} from '/services/agentic/frontend/workflows/WorkflowConnectionSettings';\nimport {agenticApi} from '/services/agentic/frontend/api.client';")
  .replace('createRoot(document.getElementById', setup+'\ncreateRoot(document.getElementById')
  .replace('<IntegrationsPage />','<IntegrationsPage additionalProviders={[httpExtension]} />');
 const name='http-credentials-'+randomUUID(),html=new URL(name+'.html',root),tsx=new URL(name+'.tsx',root);let browser;
 try {
  await writeFile(html,`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);await writeFile(tsx,variant);
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5197'}/${name}.html`);await page.getByRole('button',{name:'New Integration',exact:true}).click();await page.getByLabel('Integration type',{exact:true}).selectOption('workflow');
  assert.deepEqual(await page.getByLabel('Provider',{exact:true}).locator('option').allTextContents(),['HTTP API']);assert.equal(await page.getByRole('option',{name:'Workflow connections',exact:true}).count(),0);assert.equal(await page.getByRole('option',{name:'Credentials',exact:true}).count(),1);
  await page.getByLabel('Connection name').fill('HTTP credential');await page.getByLabel('Server endpoint').fill('https://api.example.test/v1');await page.getByRole('button',{name:'Save connection',exact:true}).click();await page.waitForFunction(()=>window.httpCredentialWrites.length===1);
  const written=await page.evaluate(()=>window.httpCredentialWrites[0]);assert.equal(written.kind,'http');assert.equal(written.project_id,'project');assert.deepEqual(written.tools,[]);assert.deepEqual(errors,[]);
 } finally {await browser?.close();await Promise.all([unlink(html).catch(()=>{}),unlink(tsx).catch(()=>{})]);}
});
