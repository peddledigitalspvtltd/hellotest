import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require('playwright');
const expect = require('playwright/test').expect.configure({ timeout: 15000 });
const root = new URL('../../../platform/frontend/', import.meta.url);
const fixture = `import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {AgentActivityDisclosure} from '@hellotest/ai/agent-activity';import {api,sessionStorage} from '/src/lib/api';import {AuthProvider} from '/src/auth/AuthContext';import '/src/product-experience.css';
let session={token:'activity-fixture',user:{id:'reviewer',role:'admin',name:'Reviewer',email:'reviewer@example.test'}};sessionStorage.write(session);api.auth.session=async()=>session;window.nativeOpens=[];window.switchActivityAccount=()=>{session={...session,token:'activity-fixture-next',user:{...session.user,id:'second-reviewer'}};sessionStorage.write(session);window.dispatchEvent(new StorageEvent('storage',{key:'hellotest.session'}));};
const client=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});
createRoot(document.getElementById('root')).render(<AuthProvider><QueryClientProvider client={client}><main style={{maxWidth:900,margin:'24px auto',padding:12}}><AgentActivityDisclosure projectId="project" appTypeId="app" system="quality" initialSourceRunId="native-one" renderDetail={run=><button type="button" onClick={()=>window.nativeOpens.push(run.source_run_id)}>Open native quality record</button>} /></main></QueryClientProvider></AuthProvider>);`;
const run = (id, status) => ({ id, system: 'quality', source_run_id: id === 'one' ? 'native-one' : 'native-two', agent_id: 'quality.web', descriptor_hash: 'fixture', descriptor: { name: 'Web quality agent', objective: 'Review recorded browser evidence', instructions: { version: '1' }, output: { contract: 'quality_report' } }, status, native_status: status, progress: 100, title: `Quality review ${id}`, updated_at: '2026-11-16T10:00:00Z', payload: { requires_human_review: true, prompt_template_version: 'fixture-v1' } });

test('common activity loads history on demand, paginates, retains native review and isolates account changes and revoked details', { timeout: 120000 }, async () => {
  const name = 'agent-activity-' + randomUUID(), requests = [], errors = [];
  let browser, denied = false, secondRequested = false, releaseSecond;
  const secondResponse = new Promise(resolve => { releaseSecond = resolve; });
  try {
    await writeFile(new URL(name + '.tsx', root), fixture);
    await writeFile(new URL(name + '.html', root), `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url()); requests.push(url.pathname);
      if (!url.pathname.startsWith('/api/agent-runs')) { errors.push('Unexpected API ' + url.pathname); return route.abort(); }
      if (denied) return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'Agent access was removed.' }) });
      if (url.pathname === '/api/agent-runs') {
        assert.equal(url.searchParams.get('project_id'), 'project'); assert.equal(url.searchParams.get('app_type_id'), 'app'); assert.equal(url.searchParams.get('system'), 'quality');
        if (route.request().headers().authorization === 'Bearer activity-fixture-next') { secondRequested = true; await secondResponse; return route.fulfill({contentType:'application/json',body:JSON.stringify({items:[run('second','succeeded')],has_more:false,next_cursor:null,coverage:[]})}); }
        const older = url.searchParams.get('cursor');
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: older ? [run('one', 'succeeded'), run('two', 'failed')] : [run('one', 'succeeded')], has_more: !older, next_cursor: older ? null : 'older', coverage: [], pending: { more_available: false } }) });
      }
      const id = url.pathname.split('/').pop();
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ run: run(id, id === 'one' ? 'succeeded' : 'failed'), events: [{ id: 'event-' + id, phase: 'verified', level: 'info', message: 'Recorded browser evidence retained', occurred_at: '2026-11-16T10:00:01Z', payload: { duration_ms: 80 } }], events_limited: false }) });
    });
    await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5197'}/${name}.html`, { timeout: 60000 });
    await expect(page.getByText('Agent activity history', { exact: true })).toBeVisible(); assert.equal(requests.length, 0);
    await page.getByText('Agent activity history', { exact: true }).click();
    const history = page.getByRole('region', { name: 'Agent activity across runtimes', exact: true });
    await expect(history.locator('.agent-activity-row')).toHaveCount(1);
    await expect(history.getByText('Recorded browser evidence retained', { exact: true })).toBeVisible();
    await history.getByRole('button', { name: 'Open native quality record', exact: true }).click(); assert.deepEqual(await page.evaluate(() => window.nativeOpens), ['native-one']);
    await history.getByRole('button', { name: /Load older/i }).click(); await expect(history.locator('.agent-activity-row')).toHaveCount(2);
    await history.getByRole('button', { name: 'Close details', exact: true }).click(); await expect(history.locator('.agent-activity-detail')).toHaveCount(0);
    await history.locator('.agent-activity-row').last().click(); await expect(history.getByRole('region', { name: 'Selected agent run' })).toBeVisible();
    await page.evaluate(() => document.documentElement.dataset.theme = 'dark'); await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await history.evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'Activity history fits narrow screens in dark mode.');
    await page.evaluate(() => window.switchActivityAccount());
    await expect.poll(() => secondRequested).toBe(true);
    await expect(history.locator('.agent-activity-row')).toHaveCount(0); await expect(history.locator('.agent-activity-detail')).toHaveCount(0);
    releaseSecond(); await expect(history.locator('.agent-activity-row')).toHaveCount(1); await expect(history.locator('.agent-activity-row')).toContainText('Quality review second');
    await history.locator('.agent-activity-row').click(); await expect(history.locator('.agent-activity-detail')).toBeVisible();
    denied = true; await history.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(history.getByRole('alert')).toBeVisible(); await expect(history.locator('.agent-activity-detail')).toHaveCount(0); await expect(history.locator('.agent-activity-row')).toHaveCount(0);
    assert.deepEqual(errors, []);
  } catch(error) { error.message += '\nBrowser errors: ' + JSON.stringify(errors); throw error; } finally { releaseSecond(); await browser?.close(); await Promise.all([rm(new URL(name + '.tsx', root), { force: true }), rm(new URL(name + '.html', root), { force: true })]); }
});
