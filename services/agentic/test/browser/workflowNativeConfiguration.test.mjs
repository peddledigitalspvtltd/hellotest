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
import '/src/walkthrough-overrides.css';
window.enablePreviewFixture();
api.evidenceScope.options = async () => ({items:[{id:'sprint-a',label:'Sprint A'},{id:'sprint-b',label:'Sprint B'}],has_more:false});
api.agenticWorkflows.connections = async () => [{id:'native-http',name:'HelloTest API',kind:'http',url:'https://hellotest.example/api',authenticated:true,methods:['GET','POST','PUT','DELETE']}];
api.agenticWorkflows.update = async (id, payload) => {window.previewWorkflow={...window.previewWorkflow,...payload,id};return structuredClone(window.previewWorkflow);};
api.workflowManualCases.list = async () => ({items:[{id:'manual-catalog',display_id:'TC-21',title:'Search Catalog'}]});
api.workflowTestEnvironments.list = async () => [{id:'qa-test',name:'Catalog QA',base_url:'https://qa.example.test/',variables:[]}];
`;

async function assertCompactToast(page, message) {
  const toast = page.getByRole('status').filter({ hasText: message });
  await toast.waitFor();
  const box = await toast.boundingBox();
  const { width } = page.viewportSize();
  assert.ok(box && box.height < 100 && box.width < Math.min(400, width - 16), 'Confirmation fits its message');
  assert.ok(box.y < 140 && width - box.x - box.width < 40, 'Confirmation sits in the top-right corner');
}

test('Automation Build Agent binds a saved case, browser mode and Test Environment', {timeout:90000}, async () => {
  const name = 'manual-automation-config-' + randomUUID(), html = new URL(name + '.html',root), tsx = new URL(name + '.tsx',root);
  let browser;
  try {
    await writeFile(html,`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    await writeFile(tsx,base.replace('function RouteObserver()',setup+'\nfunction RouteObserver()'));
    browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE ? {executablePath:process.env.CHROME_EXECUTABLE} : {})});
    const page=await browser.newPage({viewport:{width:1512,height:1050}});
    page.setDefaultTimeout(12000);
    await page.route('**/api/**',route=>route.fulfill({status:503,body:'Fixture only'}));
    await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5197'}/${name}.html?route=${encodeURIComponent('/agentic-workflows?view=workflows')}`,{waitUntil:'domcontentloaded',timeout:30000});
    await page.getByRole('button',{name:'Start from scratch',exact:true}).click();
    await page.getByRole('button',{name:'Add manual trigger',exact:true}).click();
    await page.getByRole('button',{name:'Add node',exact:true}).click();
    await page.getByRole('textbox',{name:'Search nodes',exact:true}).fill('web automation agent');
    await page.getByRole('button',{name:/^Web Automation Agent/}).click();
    assert.equal(await page.getByRole('combobox',{name:'Test Case source',exact:true}).inputValue(),'manual_case');
    assert.equal(await page.getByRole('combobox',{name:'Browser generation',exact:true}).inputValue(),'read_only');
    await page.getByRole('button',{name:'Hide inspector',exact:true}).click();
    assert.equal(await page.locator('.studio-workspace').evaluate(element=>element.classList.contains('has-inspector')),false);
    await page.getByRole('button',{name:'Show inspector',exact:true}).click();
    await page.getByRole('combobox',{name:'Manual Test Case',exact:true}).selectOption('manual-catalog');
    await page.getByRole('combobox',{name:'Test Environment',exact:true}).selectOption('qa-test');
    await page.getByRole('combobox',{name:'Browser generation',exact:true}).selectOption('perform_steps');
    const verificationMode = page.getByRole('combobox',{name:'After generating',exact:true});
    assert.equal(await verificationMode.locator('option[value="verify_cli"]').isEnabled(), true);
    await verificationMode.selectOption('verify_repair');
    await page.getByText(/one correction from the failure snapshot/).waitFor();
    await page.getByRole('button',{name:'Create Workflow',exact:true}).click();
    await page.waitForFunction(()=>Boolean(window.previewWorkflow));
    await assertCompactToast(page, 'Workflow created.');
    const data=await page.evaluate(()=>window.previewWorkflow.nodes.find(node=>node.data.label==='Web Automation Agent').data);
    assert.equal(data.automationSource,'manual_case');assert.equal(data.automationManualCaseId,'manual-catalog');
    assert.equal(data.testEnvironmentId,'qa-test');assert.equal(data.automationVerificationMode,'verify_repair');
    const librarySearch = page.getByRole('searchbox', { name: 'Search nodes', exact: true }).or(page.getByRole('textbox', { name: 'Search nodes', exact: true }));
    await page.getByRole('button', { name: 'Add node', exact: true }).click();
    await librarySearch.fill('automation agent');
    assert.equal(await page.getByRole('button', { name: /^Web Automation Agent/ }).count(), 1);
    await page.getByRole('button', { name: /^API Automation Agent/ }).click();
    assert.equal(await page.getByRole('combobox', { name: 'Automation Agent', exact: true }).inputValue(), 'api');
    assert.equal(await page.getByRole('combobox', { name: 'Browser generation', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await assertCompactToast(page, 'Workflow changes saved.');
    await page.setViewportSize({ width: 1512, height: 1050 });
    const added = await page.evaluate(() => window.previewWorkflow.nodes.find(node => node.data.label === 'API Automation Agent').data);
    assert.equal(added.artifactTask, 'automation-engineer');
    assert.equal(added.automationRuntime, 'api');
    await page.getByRole('button', { name: 'Add node', exact: true }).click();
    await librarySearch.fill('Browser Quality Agent');
    await page.getByRole('button', { name: /^Browser Quality Agent/ }).click();
    await page.getByRole('combobox', { name: 'Browser Quality Agent', exact: true }).selectOption('accessibility');
    await page.getByRole('combobox', { name: 'Test Environment', exact: true }).selectOption('qa-test');
    await page.getByLabel('Page path (optional)', { exact: true }).fill('/catalog');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.waitForFunction(() => window.previewWorkflow.nodes.some(node => node.data.kind === 'qualityAgent'
      && node.data.qualityAgentKind === 'accessibility' && node.data.testEnvironmentId === 'qa-test' && node.data.qualityTargetPath === '/catalog'));
  } finally { await browser?.close(); await Promise.allSettled([unlink(html),unlink(tsx)]); }
});

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
    await page.getByRole('button',{name:'Create Workflow from Sprint Automator',exact:true}).click();
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
      if (id === 'automation-engineer') await page.getByText('Build instructions and guardrails',{exact:true}).click();
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
    await page.getByRole('combobox', { name: 'Browser generation', exact: true }).selectOption('offline');
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
    assert.equal(saved.nodes.find(node => node.id === 'automation-engineer').data.automationBrowserMode, 'offline');
    assert.equal(await page.getByRole('combobox', { name: 'Browser generation', exact: true }).inputValue(), 'offline', 'Saving preserves the explicit browser scope.');
    assert.equal(saved.nodes.find(node => node.id === 'automation-engineer').data.readinessPolicy, 'require-ready');
    await page.getByRole('button', { name: 'Restore task defaults', exact: true }).click();
    assert.equal(await page.getByLabel('Instructions', { exact: true }).inputValue(), profiles['automation-engineer'].instructions);
    await page.getByLabel('Guardrails', { exact: true }).fill('');
    await page.getByRole('button', { name: 'Save changes', exact: true }).press('Enter');
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
