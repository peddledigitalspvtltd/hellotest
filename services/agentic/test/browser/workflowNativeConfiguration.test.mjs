import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';

const require = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('../../../platform/frontend/', import.meta.url);
const profiles = JSON.parse(await readFile(new URL('../../shared/workflowNativeTasks.json', import.meta.url), 'utf8'));
const base = (await readFile(new URL('agentWorkspace.test.mjs', import.meta.url), 'utf8')).match(/const fixture = `([\s\S]*?)`;\nconst specialists/)[1];
const setup = `
window.enablePreviewFixture();
api.evidenceScope.options = async () => ({items:[{id:'sprint-a',label:'Sprint A'},{id:'sprint-b',label:'Sprint B'}],has_more:false});
api.agenticWorkflows.connections = async () => [{id:'native-http',name:'HelloTest API',kind:'http',url:'https://hellotest.example/api',authenticated:true,methods:['GET','POST','PUT','DELETE']}];
api.agenticWorkflows.update = async (id, payload) => {window.previewWorkflow={...window.previewWorkflow,...payload,id};return structuredClone(window.previewWorkflow);};
`;

test('Sprint template saves editable per-node guidance and previews the current Sprint API URL', { timeout: 90000 }, async () => {
  const name = 'native-workflow-config-' + randomUUID(), html = new URL(name + '.html', root), tsx = new URL(name + '.tsx', root);
  const output = '/tmp/qaira-workflow-native-configuration'; let browser, page;
  try {
    await mkdir(output, { recursive: true });
    await writeFile(html, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    await writeFile(tsx, base.replace('function RouteObserver()', setup + '\nfunction RouteObserver()'));
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    page = await browser.newPage({ viewport: { width: 1512, height: 1050 } }); page.setDefaultTimeout(12000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Unexpected live request in configuration fixture' }) }));
    await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5197'}/${name}.html?route=${encodeURIComponent('/agentic-workflows?view=workflows')}`);
    await page.locator('.studio-template-card').filter({ hasText: 'Sprint Automator' }).click();
    await page.getByRole('combobox', { name: 'Sprint', exact: true }).click();
    await page.getByRole('option', { name: /Sprint A/ }).click();
    await page.locator('.react-flow__node[data-id="sprint-stories"]').click();
    await page.getByLabel('API connection', {exact:true}).selectOption('native-http');
    const endpoint = page.getByRole('textbox', { name: 'Endpoint URL', exact: true });
    const url = new URL(await endpoint.inputValue());
    assert.equal(url.origin, 'https://hellotest.example'); assert.equal(url.pathname, '/api/requirements');
    assert.equal(url.searchParams.get('project_id'), 'project'); assert.equal(url.searchParams.get('sprint_id'), 'sprint-a');
    assert.equal(url.searchParams.get('include_page'), 'true'); assert.equal(await endpoint.evaluate(element => element.readOnly), true);
    await page.getByRole('combobox', { name: 'Sprint', exact: true }).click();
    await page.getByRole('option', { name: /Sprint B/ }).click();
    assert.equal(new URL(await endpoint.inputValue()).searchParams.get('sprint_id'), 'sprint-b', 'the URL reflects the current trigger, not the previously selected Sprint');
    await endpoint.scrollIntoViewIfNeeded(); await page.screenshot({ path: output + '/sprint-http-url.png', fullPage: true });
    for (const id of Object.keys(profiles)) {
      await page.locator(`.react-flow__node[data-id="${id}"]`).click();
      assert.equal(await page.getByLabel('Task', { exact: true }).inputValue(), profiles[id].task);
      assert.equal(await page.getByLabel('Instructions', { exact: true }).inputValue(), profiles[id].instructions);
      assert.equal(await page.getByLabel('Guardrails', { exact: true }).inputValue(), profiles[id].guardrails);
      await page.getByLabel('Task', { exact: true }).fill('Custom task for ' + id);
      await page.getByLabel('Instructions', { exact: true }).fill('Custom instructions for ' + id);
      await page.getByLabel('Guardrails', { exact: true }).fill('Custom guardrails for ' + id);
      await page.getByText('Model, evidence and review settings', {exact:true}).click();
      await page.getByLabel('Node temperature', {exact:true}).fill('0.45');
      await page.getByLabel('Node maximum output tokens', {exact:true}).fill('4096');
      await page.getByLabel('Node evidence mode', {exact:true}).selectOption('none');
      await page.getByLabel('Task-specific review criteria', {exact:true}).fill('Specific review criteria for ' + id);
    }
    await page.getByRole('checkbox', { name: /Inspect the browser before building/ }).uncheck();
    assert.equal(await page.getByRole('combobox', {name:'Readiness handling',exact:true}).inputValue(), 'verify-inputs');
    await page.getByRole('combobox', {name:'Readiness handling',exact:true}).selectOption('require-ready');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    const saved = await page.evaluate(() => window.previewWorkflow);
    for (const id of Object.keys(profiles)) {
      const node = saved.nodes.find(item => item.id === id);
      assert.equal(node.data.task, 'Custom task for ' + id); assert.equal(node.data.instructions, 'Custom instructions for ' + id); assert.equal(node.data.guardrails, 'Custom guardrails for ' + id);
      assert.equal(node.data.aiConfiguration.temperature, 0.45);
      assert.equal(node.data.aiConfiguration.max_output_tokens, 4096);
      assert.equal(node.data.aiConfiguration.context.mode, 'none');
      assert.equal(node.data.reviewCriteria, 'Specific review criteria for ' + id);
    }
    assert.equal(saved.nodes.find(node => node.id === 'automation-engineer').data.inspectBrowser, false);
    assert.equal(saved.nodes.find(node => node.id === 'automation-engineer').data.readinessPolicy, 'require-ready');
    await page.getByRole('button', { name: 'Restore task defaults', exact: true }).click();
    assert.equal(await page.getByLabel('Instructions', { exact: true }).inputValue(), profiles['automation-engineer'].instructions);
    await page.getByLabel('Guardrails', { exact: true }).fill('');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    assert.equal(await page.getByLabel('Guardrails', { exact: true }).inputValue(), '', 'intentionally empty node guidance is not silently reset');
    await page.getByLabel('Task', { exact: true }).scrollIntoViewIfNeeded(); await page.screenshot({ path: output + '/automation-guidance-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 900 });
    await page.getByLabel('Task', { exact: true }).scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.screenshot({ path: output + '/automation-guidance-mobile.png', fullPage: true });
    assert.deepEqual(errors, []);
  } catch (error) {
    if (page) { await page.screenshot({ path: output + '/failure.png', fullPage: true }).catch(() => {}); await writeFile(output + '/failure.txt', await page.locator('body').innerText().catch(() => '')); }
    throw error;
  } finally { await browser?.close(); await Promise.allSettled([unlink(html), unlink(tsx)]); }
});
