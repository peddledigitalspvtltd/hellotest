import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';

const require = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('../../../platform/frontend/', import.meta.url);
const baseSource = await readFile(new URL('agentWorkspace.test.mjs', import.meta.url), 'utf8');
const baseFixture = baseSource.match(/const fixture = `([\s\S]*?)`;\nconst specialists/)[1];
const executionFixture = `
window.enablePreviewFixture();
window.executionRecords = [];
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.copiedJson = text; } } });
api.agenticWorkflows.execute = realExecute;
api.agenticWorkflows.cancelRun = realCancel;
api.agenticWorkflows.update = async (id, payload) => { window.previewWorkflow = { ...window.previewWorkflow, ...payload, id, updated_at: new Date().toISOString() }; return structuredClone(window.previewWorkflow); };
api.agenticWorkflows.get = async () => structuredClone(window.previewWorkflow);
api.agenticWorkflows.getRun = async id => structuredClone(window.executionRecords.find(run => run.id === id) || window.previewRecord);
api.agenticWorkflows.listRuns = async () => [...structuredClone(window.executionRecords), ...(window.previewRecord ? [structuredClone(window.previewRecord)] : [])];
api.agenticWorkflows.readiness = async () => {
  const workflow = window.previewWorkflow;
  const blockers = workflow.nodes.filter(node => !['trigger','agent','llmAgent','aggregator','output'].includes(node.data.kind)).map(node => ({ node_id: node.id, node_name: node.data.label, message: 'This node is preview-only. Choose a registered specialist.' }));
  return { ready: !blockers.length, execution_mode: 'review', blockers, warnings: [], limits: { max_steps: 8, max_specialists: 4, timeout_ms: 180000, input_limit_bytes: 16384 }, steps: workflow.nodes.map(node => ({ node_id: node.id, name: node.data.label, kind: node.data.kind, specialist_id: node.data.agentId || null })) };
};
window.makeReviewRun = (id, input) => {
  const workflow = window.previewWorkflow;
  const run = { id, workflow_id: workflow.id, execution_mode: 'review', workflow_name: workflow.name, project_id: 'project', app_type_id: 'app', status: 'running', trigger_kind: 'manual', workflow_snapshot: { ...structuredClone(workflow), execution_mode: 'review' }, input_payload: input.input_payload,
    node_results: workflow.nodes.map((node, index) => ({ node_id: node.id, node_name: node.data.label, node_type: node.data.kind, specialist_id: node.data.agentId || null, status: index === 0 ? 'completed' : index === 1 ? 'running' : 'queued', attempts: index < 2 ? 1 : 0, input: { input: { request: 'Review checkout', story_id: 'story-checkout', source_index: index } }, ...(index === 0 ? { output: { request: 'Review checkout', story_id: 'story-checkout' } } : {}) })),
    output_payload: { execution_mode: 'review', summary: 'Reviewing permitted story evidence.' }, created_at: '2026-09-10T10:00:00Z', started_at: '2026-09-10T10:00:00Z' };
  window.executionRecords = [run]; return structuredClone(run);
};
window.completeReviewRun = () => {
  const run = window.executionRecords[0]; run.status = 'needs_review'; run.completed_at = '2026-09-10T10:00:02Z';
  run.output_payload.summary = 'Review workflow finished with evidence limitations. Inspect each specialist review before acting.';
  run.node_results = run.node_results.map(step => ({ ...step, status: 'completed', attempts: 1, output: step.specialist_id ? { session_id: 'saved-' + step.node_id, specialist_id: step.specialist_id, response: 'Checkout retry acceptance needs one additional boundary review.', citation_ids: ['story-checkout'], readiness: { status: 'limited_evidence', evidence_count: 2 }, provenance: { generation_mode: 'deterministic' } } : {} }));
};
window.advanceReviewRun = () => {
  const run = window.executionRecords[0];
  run.node_results[1].status = 'completed'; run.node_results[1].output = { response: 'Story boundaries reviewed.' };
  run.node_results[2].status = 'running'; run.node_results[2].attempts = 1;
  return run.node_results[2].node_name;
};
window.cancelReviewRun = id => { const run = window.executionRecords.find(item => item.id === id); run.status = 'cancelled'; run.completed_at = '2026-09-10T10:00:03Z'; run.output_payload.summary = 'Review execution cancelled. Completed step results are preserved.'; run.node_results = run.node_results.map(step => ({ ...step, status: step.status === 'running' ? 'cancelled' : step.status === 'queued' ? 'skipped' : step.status })); return structuredClone(run); };
`;
const fixture = baseFixture.replace('const realAsk =', 'const realExecute = api.agenticWorkflows.execute; const realCancel = api.agenticWorkflows.cancelRun;\nconst realAsk =')
  .replace('const client = new QueryClient', executionFixture + '\nconst client = new QueryClient');

test('review workflows expose readiness, actual progress, stop and evidence review across layouts', { timeout: 100000 }, async () => {
  const name = 'workflow-execution-' + randomUUID();
  const html = new URL(name + '.html', root), tsx = new URL(name + '.tsx', root);
  const screenshots = '/tmp/qaira-workflow-execution-after';
  let browser, page;
  try {
    await writeFile(html, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    await writeFile(tsx, fixture); await mkdir(screenshots, { recursive: true });
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    page.setDefaultTimeout(12000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const requests = []; let failFirstStart = true;
    await page.route('**/api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({message:'Unexpected API request in isolated fixture'}) }));
    await page.route('**/agentic-workflows/*/executions**', async route => {
      const input = route.request().postDataJSON(); requests.push(input);
      if (failFirstStart) { failFirstStart = false; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Temporary worker outage. Try again.' }) }); }
      const run = await page.evaluate(input => window.makeReviewRun('execution-created', input), input);
      await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify(run) });
    });
    await page.route('**/agentic-workflow-runs/*/cancel**', async route => {
      const id = new URL(route.request().url()).pathname.split('/').at(-2);
      const run = await page.evaluate(id => window.cancelReviewRun(id), id);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(run) });
    });
    const baseUrl = `${process.env.VITE_TEST_URL || 'http://127.0.0.1:5179'}/${name}.html?route=${encodeURIComponent('/agentic-workflows?view=workflows')}`;
    await page.goto(baseUrl);
    await page.getByRole('button', { name: 'Create Agentic Workflow', exact: true }).click();
    await page.getByRole('button', { name: 'Execute workflow', exact: true }).waitFor();
    assert.equal(requests.length, 0, 'readiness checks do not execute models');
    await page.getByRole('button', { name: 'Readiness', exact: true }).click();
    await page.getByRole('button', { name: 'Save and check readiness', exact: true }).click();
    await page.getByText('Ready to execute a review', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Execute workflow', exact: true }).isEnabled(), true);
    await page.screenshot({ path: screenshots + '/01-workflow-readiness-desktop.png', fullPage: true });
    await page.getByLabel('Step kind', { exact: true }).selectOption('condition');
    assert.equal(requests.length, 0, 'invalid definitions do not execute models');
    await page.getByRole('button', { name: 'Save and check readiness', exact: true }).click();
    await page.getByText('Resolve these steps before execution', { exact: true }).waitFor();
    assert.equal(requests.length, 0, 'invalid definitions do not execute models');
    await page.getByLabel('Step kind', { exact: true }).selectOption('trigger');
    await page.getByRole('button', { name: 'Save and check readiness', exact: true }).click();
    await page.getByText('Ready to execute a review', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Execute workflow', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Temporary worker outage' }).waitFor();
    await page.getByRole('button', { name: 'Execute workflow', exact: true }).click();
    const live = page.getByRole('region', { name: 'Workflow execution', exact: true });
    await live.waitFor();
    assert.equal(await page.getByRole('dialog', { name: 'Workflow execution details', exact: true }).count(), 0, 'starting runs stays in the workspace canvas');
    assert.equal(await live.locator('.studio-execution-steps').count(), 0, 'live canvas starts with its Steps panel collapsed');
    assert.equal(await live.locator('.studio-inspector').count(), 0, 'live canvas opens data only when requested');
    await live.getByRole('button', { name: 'Following execution', exact: true }).waitFor();
    const activeNode = live.locator('.studio-node[data-status="running"]');
    await activeNode.waitFor();
    assert.equal(await activeNode.locator('.studio-node-progress rect').count(), 1);
    assert.equal(await live.locator('.studio-node[data-status="queued"]').first().evaluate(element => getComputedStyle(element).borderTopStyle), 'dashed');
    await page.waitForFunction(() => { const node = document.querySelector('.studio-node[data-status="running"]'), canvas = document.querySelector('.studio-execution .studio-canvas'); if (!node || !canvas) return false; const a=node.getBoundingClientRect(),b=canvas.getBoundingClientRect(); return a.x>=b.x&&a.right<=b.right&&a.y>=b.y&&a.bottom<=b.bottom; });
    const zoom = await live.locator('.react-flow__viewport').evaluate(element => new DOMMatrix(getComputedStyle(element).transform).a);
    assert.ok(zoom >= .79, 'execution follows the running node at a readable zoom');
    const nextNodeName = await page.evaluate(() => window.advanceReviewRun());
    await activeNode.getByText(nextNodeName, { exact: true }).waitFor();
    await page.waitForFunction(() => { const node=document.querySelector('.studio-node[data-status="running"]'),canvas=document.querySelector('.studio-execution .studio-canvas');if(!node||!canvas)return false;const a=node.getBoundingClientRect(),b=canvas.getBoundingClientRect();return a.x>=b.x&&a.right<=b.right&&a.y>=b.y&&a.bottom<=b.bottom; });
    assert.equal(await live.locator('.studio-execution-edge.is-completed').count(), 1, 'finished connections are solid while progress moves forward');
    assert.equal(await live.locator('.studio-execution-edge.is-running').count(), 1);
    const activeNodeId = await activeNode.evaluate(element => element.closest('.react-flow__node').dataset.id);
    await page.screenshot({ path: screenshots + '/02-live-canvas-following.png', fullPage: true });
    await activeNode.click();
    const inputTab = live.getByRole('button', { name: 'Input', exact: true });
    await inputTab.click();
    const recordedInput = JSON.parse(await live.getByRole('textbox', { name: 'Node input JSON', exact: true }).inputValue());
    assert.equal(recordedInput.story_id, 'story-checkout');
    await live.getByRole('button', { name: 'Copy input JSON', exact: true }).click();
    assert.deepEqual(JSON.parse(await page.evaluate(() => window.copiedJson)), recordedInput);
    assert.equal(await live.getByRole('button', { name: 'Follow execution', exact: true }).getAttribute('aria-pressed'), 'false', 'inspecting data pauses following until resumed');
    await page.getByRole('button', { name: 'Review summary', exact: true }).click();
    await page.getByRole('heading', { name: 'In progress', exact: true }).waitFor();
    assert.equal(requests.length, 2); assert.equal(requests[0].request_id, requests[1].request_id, 'transport retry preserves the same idempotency key');
    assert.equal(await page.getByRole('button', { name: 'Stop execution', exact: true }).isEnabled(), true);
    assert.equal(await page.locator('.workflow-review-steps li').count(), 4);
    assert.equal(await page.getByRole('button', { name: 'Execution canvas', exact: true }).count(), 1);
    await page.screenshot({ path: screenshots + '/02-executing-desktop.png', fullPage: true });
    await page.evaluate(() => window.completeReviewRun());
    await page.getByRole('heading', { name: 'Review required', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Open review', exact: true }).count(), 2);
    assert.equal(await page.getByRole('button', { name: 'Stop execution', exact: true }).count(), 0);
    await live.getByRole('button', { name: 'Execution canvas', exact: true }).click();
    await live.getByRole('button', { name: 'Output', exact: true }).click();
    const recordedOutput = JSON.parse(await live.getByRole('textbox', { name: 'Node output JSON', exact: true }).inputValue());
    assert.equal(recordedOutput.session_id, 'saved-' + activeNodeId);
    await live.getByRole('button', { name: 'Copy output JSON', exact: true }).click();
    assert.deepEqual(JSON.parse(await page.evaluate(() => window.copiedJson)), recordedOutput);
    assert.equal(await live.locator('.studio-node[data-status="completed"]').first().evaluate(element => getComputedStyle(element).borderTopStyle), 'solid');
    await page.screenshot({ path: screenshots + '/03-review-results-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; document.getAnimations().forEach(animation => { try { animation.finish(); } catch {} }); });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'mobile results do not create horizontal page overflow');
    await page.screenshot({ path: screenshots + '/04-review-results-dark-mobile.png', fullPage: true });
    await page.getByRole('button', { name: 'Back to workflow editor', exact: true }).click();
    await page.evaluate(() => { window.makeReviewRun('execution-cancel', { input_payload: {} }); window.navigateWorkspace('/agentic-workflows?view=runs&workflow_run=execution-cancel'); });
    await page.getByRole('button', { name: 'Review summary', exact: true }).click();
    await page.getByRole('heading', { name: 'In progress', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Stop execution', exact: true }).click();
    await page.getByRole('heading', { name: 'Stopped', exact: true }).waitFor();
    await page.getByText('Not reached', { exact: true }).first().waitFor();
    assert.deepEqual(errors, []);
  } catch (error) {
    if (page) { await page.screenshot({ path: screenshots + '/failure.png', fullPage: true }).catch(() => {}); await writeFile(screenshots + '/failure.txt', await page.locator('body').innerText().catch(() => '')); }
    throw error;
  } finally {
    await browser?.close();
    await Promise.allSettled([unlink(html), unlink(tsx)]);
  }
});
