import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('../../../../testengine/backend/node_modules/playwright');
const { buildExecutionReportModel } = require('../../src/services/executionReportModel');
const { renderDetailedExecutionHtml } = require('../../src/services/executionReportHtml');

test('portable report filters, hierarchy, print expansion and mobile geometry work offline under CSP', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'qaira-html-report-'));
  const source = process.env.REPORT_HTML_INPUT;
  const localPath = source || path.join(directory, 'report.html');
  if (!source) {
    const execution = { id: 'run', name: 'Customer portal · Release 2026.09', status: 'completed', case_snapshots: [
      { test_case_id: 'payment', test_case_title: 'Checkout payment completes', suite_id: 'suite1', suite_name: 'Checkout smoke', module_id: 'module1', module_name: 'Payment', test_data_set_snapshot: { mode: 'table', rows: [{ persona: 'Standard' }, { persona: 'Premium' }] } },
      { test_case_id: 'keyboard', test_case_title: 'Keyboard focus remains visible', suite_id: 'suite2', suite_name: 'Accessibility' }
    ], step_snapshots: [{ test_case_id: 'payment', snapshot_step_id: 'step', step_order: 1, action: 'Submit payment', expected_result: 'Confirmation displays' }] };
    const results = [{ id: 'a', test_case_id: 'payment', data_set_iteration_index: 0, status: 'passed', duration_ms: 1200 }, { id: 'b', test_case_id: 'payment', data_set_iteration_index: 1, status: 'failed', error: 'Payment authorization declined', logs: '{"stepStatuses":{"step":"failed"},"stepNotes":{"step":"Unexpected discount applied"}}', duration_ms: 3400 }];
    await fs.writeFile(localPath, renderDetailedExecutionHtml(buildExecutionReportModel(execution, results)));
  }
  const browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    await page.goto(pathToFileURL(localPath).href);
    await page.locator('.toolbar:not([hidden])').waitFor();
    const total = await page.locator('.case-card').count();
    assert.ok(total >= 3);
    await page.screenshot({ path: '/tmp/qaira-execution-report-desktop.png' });
    await page.getByLabel('Outcome', { exact: true }).selectOption('failed');
    await page.waitForFunction(() => [...document.querySelectorAll('.case-card:not([hidden])')].every(card => card.dataset.status === 'failed'));
    assert.equal(await page.locator('.case-card:not([hidden])').count(), 1);
    await page.getByLabel('Find a case').fill('no such case exists');
    await page.locator('#no-matches:not([hidden])').waitFor();
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    assert.equal(await page.locator('.case-card:not([hidden])').count(), total);
    assert.equal(await page.getByLabel('Find a case').evaluate(node => node === document.activeElement), true);
    const secondSuite = await page.getByLabel('Suite', { exact: true }).locator('option').nth(2).getAttribute('value');
    await page.getByLabel('Suite', { exact: true }).selectOption(secondSuite);
    assert.ok(await page.locator('.case-card[hidden]').count() > 0);
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await page.getByRole('button', { name: 'Collapse all' }).click();
    assert.equal(await page.locator('.case-card > details[open]').count(), 0);
    await page.getByRole('button', { name: 'Expand visible' }).click();
    assert.equal(await page.locator('.case-card > details[open]').count(), total);
    await page.locator('#results').scrollIntoViewIfNeeded();
    await page.screenshot({ path: '/tmp/qaira-execution-report-details.png' });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 844 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `no page overflow at ${width}px`);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: '/tmp/qaira-execution-report-mobile.png' });
    await page.getByRole('button', { name: 'Collapse all' }).click();
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    assert.equal(await page.locator('details:not([open])').count(), 0);
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    assert.equal(await page.locator('.case-card > details[open]').count(), 0);
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
  } finally { await browser.close(); await fs.rm(directory, { recursive: true, force: true }); }
});
