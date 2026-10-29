import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
const require = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('../../../platform/frontend/', import.meta.url);
const base = (await readFile(new URL('agentWorkspace.test.mjs', import.meta.url), 'utf8')).match(/const fixture = `([\s\S]*?)`;\nconst specialists/)[1];
const setup = `
window.enablePreviewFixture();
window.sprintSetupCalls={lookups:[],readiness:[],execute:[],preview:[]};
api.evidenceScope.options=async query=>{window.sprintSetupCalls.lookups.push(query);const all=[{id:'sprint-a',label:'Sprint Alpha'},{id:'sprint-b',label:'Sprint Beta'}];return {items:all.filter(item=>!query.search||(item.label+' '+item.id).toLowerCase().includes(query.search.toLowerCase())),has_more:!query.search};};
api.agenticWorkflows.connections=async()=>[
 {id:'stories-api',name:'HelloTest Stories API',kind:'http',url:'https://testing.example/api',authenticated:true,methods:['GET'],tools:[]},
 {id:'no-key',name:'Unauthenticated API',kind:'http',url:'https://testing.example/api',authenticated:false,methods:['GET'],tools:[]},
 {id:'write-only',name:'Write only API',kind:'http',url:'https://testing.example/api',authenticated:true,methods:['POST'],tools:[]},
 {id:'mcp',name:'MCP server',kind:'mcp',url:'https://testing.example/mcp',authenticated:true,methods:['POST'],tools:[]}
];
api.agenticWorkflows.update=async(id,input)=>{window.previewWorkflow={...window.previewWorkflow,...input,id};return structuredClone(window.previewWorkflow);};
api.agenticWorkflows.get=async()=>structuredClone(window.previewWorkflow);
api.agenticWorkflows.readiness=async(id,target,input)=>{window.sprintSetupCalls.readiness.push({id,target,input});return {ready:true,execution_mode:'review',blockers:[],warnings:[],limits:{max_steps:20,max_specialists:20,timeout_ms:3600000,input_limit_bytes:16000},steps:[]};};
api.agenticWorkflows.run=async(id,input)=>{window.sprintSetupCalls.preview.push({id,input});throw new Error('Native execution must not call preview');};
api.agenticWorkflows.execute=async(id,input)=>{window.sprintSetupCalls.execute.push({id,input});window.previewRecord={id:'native-sprint-run',workflow_id:id,workflow_name:'Sprint Automator',project_id:'project',app_type_id:'app',status:'completed',execution_mode:'review',trigger_kind:'manual',workflow_snapshot:{...window.previewWorkflow,execution_mode:'review'},input_payload:input.input_payload,node_results:[],output_payload:{summary:'Native Sprint workflow accepted.'},created_at:'2026-10-27T10:00:00Z',started_at:'2026-10-27T10:00:00Z',completed_at:'2026-10-27T10:01:00Z'};return structuredClone(window.previewRecord);};
api.agenticWorkflows.getRun=async()=>structuredClone(window.previewRecord);
`;
const fixture = base.replace('const client = new QueryClient', setup+'\nconst client = new QueryClient');

test('guided Sprint setup saves and restores input, invalidates stale readiness and submits the native execution payload', { timeout: 100000 }, async () => {
  const name = 'sprint-setup-'+randomUUID(), html = new URL(name+'.html', root), tsx = new URL(name+'.tsx', root);
  let browser, page;
  try {
    await writeFile(html, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    await writeFile(tsx, fixture);
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    page = await browser.newPage({ viewport: { width: 1440, height: 1100 } }); page.setDefaultTimeout(15000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Unexpected test API request' }) }));
    await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5197'}/${name}.html?route=${encodeURIComponent('/agentic-workflows?view=workflows')}`);
    await page.getByRole('button', { name: /Data flow Sprint Automator/ }).click();
    const setupPanel = page.locator('.sprint-automator-setup');
    await setupPanel.waitFor();
    await setupPanel.getByLabel('Sprint', { exact: true }).locator('option[value="sprint-a"]').waitFor({ state: 'attached' });
    assert.equal(await setupPanel.getByLabel('Stories API connection').getByRole('option').count(), 2);
    await setupPanel.getByLabel('Search Sprints').fill('Beta');
    await setupPanel.getByLabel('Sprint', { exact: true }).locator('option[value="sprint-a"]').waitFor({ state: 'detached' });
    await setupPanel.getByLabel('Sprint', { exact: true }).locator('option[value="sprint-b"]').waitFor({ state: 'attached' });
    assert.equal(await setupPanel.getByLabel('Sprint', { exact: true }).locator('option[value="sprint-a"]').count(), 0);
    await setupPanel.getByLabel('Sprint', { exact: true }).selectOption('sprint-b');
    await setupPanel.getByLabel('Search Sprints').fill('');
    await setupPanel.getByLabel('Stories API connection').selectOption('stories-api');
    await setupPanel.getByLabel('Generation model').selectOption('model');
    await setupPanel.getByLabel('Test Cases per Story').fill('7');
    await setupPanel.getByLabel('Test Case format').selectOption('gherkin');
    await setupPanel.getByLabel('Browser Start URL (optional)').fill('https://invoice.example/app');
    await setupPanel.getByLabel('Generation guidance (optional)').fill('Prioritize invoice amount boundaries.');
    assert.equal(await setupPanel.getByRole('link', { name: 'Settings → API Keys' }).getAttribute('href'), '/admin-space?section=settings#api-keys');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.waitForFunction(() => window.previewWorkflow?.settings?.sprint_input_defaults?.max_cases_per_story === 7);
    const saved = await page.evaluate(() => structuredClone(window.previewWorkflow));
    assert.deepEqual(saved.settings.sprint_input_defaults, { sprint_id: 'sprint-b', integration_id: 'model', max_cases_per_story: 7, authoring_mode: 'gherkin', automation_start_url: 'https://invoice.example/app', generation_instructions: 'Prioritize invoice amount boundaries.' });
    const apiNode = saved.nodes.find(node => node.data.apiResource === 'sprintStories');
    assert.equal(apiNode.data.connectionId, 'stories-api'); assert.equal(apiNode.data.apiUrl, 'https://testing.example/api'); assert.equal(apiNode.data.apiMethod, 'GET'); assert.equal(apiNode.data.retryCount, '0');
    await page.getByRole('button', { name: 'Back to workflows', exact: true }).click();
    await page.locator('.agentic-catalog-stage').getByText('Sprint Automator', { exact: true }).click();
    assert.equal(await setupPanel.getByLabel('Sprint', { exact: true }).inputValue(), 'sprint-b');
    assert.equal(await setupPanel.getByLabel('Test Cases per Story').inputValue(), '7');
    assert.equal(await setupPanel.getByLabel('Generation guidance (optional)').inputValue(), 'Prioritize invoice amount boundaries.');
    await page.getByRole('button', { name: 'Readiness', exact: true }).click();
    await page.getByRole('button', { name: 'Save and check readiness', exact: true }).click();
    await page.getByRole('button', { name: 'Ready to execute', exact: true }).waitFor();
    await setupPanel.getByLabel('Sprint', { exact: true }).selectOption('sprint-a');
    await page.getByRole('button', { name: 'Readiness', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Ready to execute', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Workflow input', exact: true }).click();
    const rawInput = page.getByLabel('Workflow input JSON');
    const validInput = await rawInput.inputValue();
    await rawInput.fill('{"sprint_id":');
    await setupPanel.getByRole('alert').filter({ hasText: 'invalid JSON' }).waitFor();
    assert.equal(await setupPanel.getByLabel('Test Cases per Story').isDisabled(), true);
    assert.equal(await rawInput.inputValue(), '{"sprint_id":');
    await rawInput.fill(validInput);
    await page.getByRole('button', { name: 'Close workflow input', exact: true }).click();
    await page.screenshot({ path: '/tmp/hellotest-sprint-setup-desktop.png', fullPage: true, animations: 'disabled' });
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.screenshot({ path: '/tmp/hellotest-sprint-setup-mobile.png', fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: 'Execute workflow', exact: true }).click();
    await page.waitForFunction(() => window.sprintSetupCalls.execute.length === 1);
    const calls = await page.evaluate(() => structuredClone(window.sprintSetupCalls));
    assert.equal(calls.preview.length, 0);
    assert.equal(calls.execute[0].input.input_payload.sprint_id, 'sprint-a');
    assert.equal(calls.execute[0].input.input_payload.integration_id, 'model');
    assert.equal(calls.execute[0].input.input_payload.max_cases_per_story, 7);
    assert.equal(calls.execute[0].input.input_payload.authoring_mode, 'gherkin');
    assert.equal(calls.readiness.at(-1).input.sprint_id, 'sprint-a');
    assert.ok(calls.lookups.every(query => query.field === 'sprint_id' && query.limit === 10 && query.project_id === 'project'));
    assert.deepEqual(errors, []);
  } catch (failure) {
    console.error(failure);
    if (page) { await writeFile('/tmp/hellotest-sprint-setup-failure.txt', await page.locator('body').innerText().catch(() => '')); await page.screenshot({ path: '/tmp/hellotest-sprint-setup-failure.png', fullPage: true, timeout: 3000 }).catch(() => {}); }
    throw failure;
  } finally { await browser?.close(); await Promise.allSettled([unlink(html), unlink(tsx)]); }
});
