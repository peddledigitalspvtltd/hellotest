import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, rm, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require('playwright');
const root = new URL('../../../platform/frontend/', import.meta.url);
const finding = {
  id: 'checkout-contract', title: 'Create a checkout order', method: 'POST', path: '/checkout',
  description: '**Source contract**\n\n| Request | Response |\n| --- | --- |\n| POST checkout | One order |',
  preconditions: ['Authorized customer exists', 'A cart contains one product'],
  steps: [{ action: 'Submit the approved checkout request', expected_result: 'One order is created' }, { action: 'Inspect an undocumented retry' }],
  evidence: [{ path: 'routes/checkout.ts', line: 42, excerpt: 'POST /checkout' }]
};
const run = {
  id: 'source-review', project_id: 'project', app_type_id: 'app', agent_type: 'api_tests', status: 'completed', progress: 100,
  source: { type: 'zip', name: 'checkout.zip', file_count: 1 }, created_at: '2026-10-15T10:00:00Z', stages: [], warnings: [], summary: {}, error: null,
  result: { schema_version: 1, agent_type: 'api_tests', summary: {}, warnings: [], stages: [], artifacts: [], findings: { objects: [], test_cases: [finding], components: [], knowledge: [] }, llm_review: { session_id: 'model-review-1', response: 'Cached model response must not bypass current source access.' }, llm_reviews: [1, 2].map(batch => ({ session_id: `model-review-${batch}`, batch, response: 'Cached model response must not bypass current source access.' })) }
};
const savedReview = {
  session_state: 'completed', citations: [{ id: 'source-contract', scope: 'knowledge', label: 'Checkout contract' }], guardrails: [],
  provenance: { generation_mode: 'llm', requires_human_review: true },
  result: { response: 'Review the contract and new retry case.', activity_summary: 'Reviewed source.', recommendations: [], assumptions: [], evidence_gaps: [], citation_ids: ['source-contract'], findings: [{ title: 'Retry contract gap', detail: 'The documented retry needs a case.', citation_ids: ['source-contract'] }], artifacts: [{ kind: 'test_case', title: 'Model proposed retry coverage', description: 'Verify the approved retry rule.', priority: 'P2', citation_ids: ['source-contract'], steps: [{ action: 'Repeat the approved checkout request', expected_result: 'One order remains' }] }] }
};
const fixture = `import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {AuthProvider} from '/src/auth/AuthContext';import {api,sessionStorage} from '/src/lib/api';import {setCurrentScope} from '/src/platform/hooks/useCurrentProject';import {RepositoryAgents} from '/services/agentic/frontend/agents/RepositoryAgents';import '/src/styles.css';import '/src/modal-system.css';import '/src/product-experience.css';
const session={token:'fixture',user:{id:'reviewer',role:'admin'}};sessionStorage.write(session);setCurrentScope('project','app');for(const methods of Object.values(api))if(methods&&typeof methods==='object')for(const[key,value]of Object.entries(methods))if(typeof value==='function')methods[key]=async()=>[];api.auth.session=async()=>session;api.featureFlags.snapshot=async()=>({flags:new Proxy({},{get:()=>true})});api.settings.getWorkspacePreferences=async()=>({preferences:{}});api.repositoryAgents.catalog=async()=>({agents:[],limits:{max_archive_bytes:1048576,max_files:100},runtime:{available:true,detail:'Fixture'}});api.repositoryAgents.get=async()=>(${JSON.stringify(run)});window.writes=[];window.reviewLoads=[];api.agenticWorkflows.getSession=async id=>{window.reviewLoads.push(id);if(id==='model-review-2')throw Error('Source access changed.');return ${JSON.stringify(savedReview)}};api.repositoryAgents.publish=async(...args)=>{window.writes.push(args);throw Error('Publishing requires a separate explicit action')};
createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><AuthProvider><main style={{padding:16,minWidth:0}}><RepositoryAgents projectId='project' appTypeId='app' scopeLabel='Checkout' agentType='api_tests' runId='source-review' enabled={true} onOpen={()=>{}} onBack={()=>{}}/></main></AuthProvider></MemoryRouter></QueryClientProvider>);`;

test('source-agent outcomes show prerequisites, formatted contracts and native step previews without publishing', { timeout: 45000 }, async () => {
  const name = 'repository-outcome-' + randomUUID(); let browser;
  try {
    await writeFile(new URL(name + '.tsx', root), fixture);
    await writeFile(new URL(name + '.html', root), `<html><head><meta name='viewport' content='width=device-width,initial-scale=1'></head><body><div id='root'></div><script type='module' src='/${name}.tsx'></script></body></html>`);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => { errors.push('Unexpected live API request'); return route.abort(); });
    await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5197'}/${name}.html`);
    await page.getByRole('heading', { name: 'Review generated findings', exact: true }).waitFor();
    await page.locator('.repository-agent-findings summary').click();
    const preview = page.locator('.repository-agent-finding-detail');
    assert.match(await preview.locator('.repository-agent-facts').innerText(), /Authorized customer exists\nA cart contains one product/);
    assert.equal(await preview.getByRole('table').count(), 1);
    assert.equal(await preview.locator('.ai-test-generator-step-row').count(), 2);
    await preview.getByText('Expected outcome is not established by source evidence.', { exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Model proposed retry coverage', exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.reviewLoads), ['model-review-1'], 'Closed batches do not request all saved reviews eagerly');
    assert.equal(await page.getByText('Cached model response must not bypass current source access.', { exact: true }).count(), 0);
    await page.getByText('Review batch 2', { exact: true }).click();
    const secondBatch = page.getByRole('region', { name: 'Source review batch 2', exact: true });
    await secondBatch.getByRole('alert').getByText('Source access changed.', { exact: false }).waitFor();
    assert.equal(await secondBatch.locator('.agent-outcome-panel').count(), 0);
    assert.deepEqual(await page.evaluate(() => window.writes), []);
    await mkdir('/tmp/qaira-agent-outcomes', { recursive: true });
    await page.screenshot({ path: '/tmp/qaira-agent-outcomes/repository-desktop.png', fullPage: true });
    for (const width of [768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `No overflow at ${width}px`);
      const expected = await preview.getByText('One order is created', { exact: true }).boundingBox();
      assert.ok(expected && expected.x >= 0 && expected.x + expected.width <= width, `Expected results remain inside the visible layout at ${width}px`);
    }
    await page.screenshot({ path: '/tmp/qaira-agent-outcomes/repository-mobile.png', fullPage: true });
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await Promise.all([rm(new URL(name + '.tsx', root), { force: true }), rm(new URL(name + '.html', root), { force: true })]);
  }
});
