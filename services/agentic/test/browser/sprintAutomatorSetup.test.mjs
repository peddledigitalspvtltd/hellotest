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
    assert.equal(await setupPanel.getByRole('combobox').count(), 1, 'scope has one searchable Sprint control and no task settings');
    const sprint = setupPanel.getByRole('combobox', {name:'Sprint',exact:true});
    await sprint.click();
    await setupPanel.getByRole('option', {name:/Sprint Alpha/}).waitFor();
    await sprint.fill('Beta');
    await setupPanel.getByRole('option', {name:/Sprint Alpha/}).waitFor({state:'detached'});
    await setupPanel.getByRole('option', {name:/Sprint Beta/}).click();
    assert.equal(await sprint.inputValue(), 'Sprint Beta');
    await page.locator('.react-flow__node[data-id="sprint-stories"]').click();
    await page.getByLabel('API connection', {exact:true}).selectOption('stories-api');
    assert.equal(await page.getByRole('link', {name:'Settings → API Keys'}).getAttribute('href'), '/admin-space?section=settings#api-keys');
    await page.locator('.react-flow__node[data-id="test-case-generation"]').click();
    await page.getByLabel('Model connection',{exact:true}).selectOption('model');
    await page.getByLabel('Test Cases per Story').fill('7');
    await page.getByLabel('Test Case format').selectOption('gherkin');
    await page.getByLabel('Generation guidance (optional)').fill('Prioritize the successful invoice journey.');
    await page.locator('.react-flow__node[data-id="automation-engineer"]').click();
    await page.getByLabel('Application URL',{exact:true}).fill('https://invoice.example/app');
    await page.getByLabel('Username (optional)').fill('reviewer');
    await page.getByLabel('Test data JSON').fill('{"invoice_id":"known-invoice"}');
    assert.equal(await page.getByLabel('Password connection').count(),1);
    assert.equal(await page.getByRole('button', {name:'Save and check readiness',exact:true}).count(),0);
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.waitForFunction(() => window.previewWorkflow?.nodes?.find(n=>n.id==='test-case-generation')?.data.maxCasesPerStory === 7);
    await page.getByRole('button',{name:'Ready to execute',exact:true}).waitFor();
    const saved = await page.evaluate(() => structuredClone(window.previewWorkflow));
    assert.deepEqual(saved.settings.sprint_input_defaults, { sprint_id: 'sprint-b' });
    const generator = saved.nodes.find(node=>node.id==='test-case-generation');
    assert.equal(generator.data.llmIntegrationId,'model');
    assert.equal(generator.data.maxCasesPerStory,7);
    assert.equal(generator.data.authoringMode,'gherkin');
    assert.equal(generator.data.generationInstructions,'Prioritize the successful invoice journey.');
    const automation = saved.nodes.find(node=>node.id==='automation-engineer');
    assert.equal(automation.data.automationStartUrl,'https://invoice.example/app');
    assert.equal(automation.data.automationUsername,'reviewer');
    assert.equal(JSON.parse(automation.data.automationData).invoice_id,'known-invoice');
    const apiNode = saved.nodes.find(node => node.data.apiResource === 'sprintStories');
    assert.equal(apiNode.data.connectionId, 'stories-api'); assert.equal(new URL(apiNode.data.apiUrl).origin, 'https://testing.example'); assert.equal(new URL(apiNode.data.apiUrl).pathname, '/api/requirements'); assert.equal(new URL(apiNode.data.apiUrl).searchParams.get('sprint_id'), 'sprint-b'); assert.equal(apiNode.data.apiMethod, 'GET'); assert.equal(apiNode.data.retryCount, '0');
    await page.getByRole('button', { name: 'Back to workflows', exact: true }).click();
    await page.locator('.agentic-catalog-stage').getByText('Sprint Automator', { exact: true }).click();
    assert.equal(await sprint.inputValue(), 'Sprint Beta');
    await page.locator('.react-flow__node[data-id="test-case-generation"]').click();
    assert.equal(await page.getByLabel('Test Cases per Story').inputValue(), '7');
    assert.equal(await page.getByLabel('Generation guidance (optional)').inputValue(), 'Prioritize the successful invoice journey.');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.getByRole('button', { name: 'Ready to execute', exact: true }).waitFor();
    await sprint.click();
    await sprint.fill('Alpha');
    await sprint.press('ArrowDown');
    await setupPanel.getByRole('option',{name:/Sprint Alpha/}).waitFor();
    await sprint.press('Enter');
    assert.equal(await sprint.inputValue(),'Sprint Alpha');
    await page.getByRole('button', { name: 'Readiness', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Ready to execute', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Workflow input', exact: true }).click();
    const rawInput = page.getByLabel('Workflow input JSON');
    const validInput = await rawInput.inputValue();
    await rawInput.fill('{"sprint_id":');
    await setupPanel.getByRole('alert').filter({ hasText: 'invalid JSON' }).waitFor();
    assert.equal(await sprint.isDisabled(), true);
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
    assert.deepEqual(calls.execute[0].input.input_payload,{sprint_id:'sprint-a'});
    assert.ok(calls.readiness.length>=3,'Save changes checks readiness with the saved definition');
    assert.equal(calls.readiness.at(-1).input.sprint_id, 'sprint-a');
    assert.ok(calls.lookups.every(query => query.field === 'sprint_id' && query.limit === 10 && query.project_id === 'project'));
    assert.deepEqual(errors, []);
  } catch (failure) {
    console.error(failure);
    if (page) { await writeFile('/tmp/hellotest-sprint-setup-failure.txt', await page.locator('body').innerText().catch(() => '')); await page.screenshot({ path: '/tmp/hellotest-sprint-setup-failure.png', fullPage: true, timeout: 3000 }).catch(() => {}); }
    throw failure;
  } finally { await browser?.close(); await Promise.allSettled([unlink(html), unlink(tsx)]); }
});
