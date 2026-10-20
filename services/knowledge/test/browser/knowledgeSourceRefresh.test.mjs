import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
const require = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('../../../platform/frontend/', import.meta.url);
const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { KnowledgeSourceDetail } from '/services/knowledge/frontend/components/KnowledgeSourceDetail';
import { knowledgeApi } from '/services/knowledge/frontend/api.client';
import '/src/styles.css';import '/src/dark-theme.css';import '/src/modal-system.css';
const readonly = new URLSearchParams(location.search).has('readonly');
window.contextRefreshCalls = 0;
window.currentContextReady = false;
knowledgeApi.knowledgeRepo.sourceDetail = async () => ({
 source:{id:'case-source',project_id:'project-fixture',title:'Checkout case context',source_kind:'test_case',extraction_status:'ready'},
 revision:{id:'revision-1',version:1,is_current:true,index_state:{required_indexes_ready:true,lexical_state:'ready',dense_state:'ready',indexed_chunk_count:4}},
 fragments:window.currentContextReady ? [{id:'current-step',content:'Submit payment. Expected: order confirmed.'}] : [],
 context_unavailable_reason:window.currentContextReady ? undefined : 'Refresh or reingest this application source to use permission-scoped context.',
 authorization:{partial:!window.currentContextReady}
});
knowledgeApi.knowledgeRepo.sourceRevisions = async () => ({revisions:[]});
knowledgeApi.knowledgeRepo.refresh.run = async projectId => { if(projectId !== 'project-fixture')throw Error('Wrong project');window.contextRefreshCalls++;return {project_id:projectId,status:'queued',requested:true,last_result:{}}; };
const client = new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><KnowledgeSourceDetail sourceId="case-source" projectId="project-fixture" canManage={!readonly} onClose={()=>{}} onChanged={()=>{}} /></QueryClientProvider>);
`;

test('blocked legacy knowledge explains the gap and refreshes only after a manager requests it', { timeout: 60000 }, async () => {
  const name = 'knowledge-source-refresh-' + randomUUID();
  const html = new URL(name + '.html', root), tsx = new URL(name + '.tsx', root);
  let browser;
  try {
    await writeFile(html, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    await writeFile(tsx, fixture);
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
    page.setDefaultTimeout(10000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const url = `${process.env.VITE_TEST_URL || 'http://127.0.0.1:5197'}/${name}.html`;
    await page.goto(url);
    await page.getByText('Refresh required', { exact: true }).waitFor();
    await page.getByText('Refresh or reingest this application source to use permission-scoped context.', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.contextRefreshCalls), 0);
    assert.equal(await page.getByText('Searchable', { exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Refresh project context', exact: true }).click();
    await page.getByRole('button', { name: 'Refresh requested', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.contextRefreshCalls), 1);
    // A queued job is not a successful reindex. Only the next verified source
    // response can restore the Searchable state and its evidence passages.
    await page.getByText('Refresh required', { exact: true }).waitFor();
    await page.evaluate(() => { window.currentContextReady = true; });
    await page.getByRole('button', { name: 'Reload current revision', exact: true }).click();
    await page.getByText('Searchable', { exact: true }).waitFor();
    await page.getByText('Submit payment. Expected: order confirmed.', { exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 850 });
    await page.goto(url + '?readonly=1');
    await page.getByText('Ask a project knowledge manager to refresh this source.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Refresh project context', exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => window.contextRefreshCalls), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await Promise.all([unlink(html).catch(() => {}), unlink(tsx).catch(() => {})]);
  }
});
