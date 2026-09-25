import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
const require = createRequire(new URL('../../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require('playwright');
const root = new URL('../../', import.meta.url);

test('Run and case Back buttons dismiss deep links with one click and allow reopening', { timeout: 90000 }, async () => {
  const source = await readFile(new URL('../../../../testing/test/browser/runCatalogDetails.test.mjs', import.meta.url), 'utf8');
  const fixture = runInNewContext(source.match(/const fixtureSource = (`[\s\S]*?`);/)[1]);
  const name = 'run-back-' + randomUUID();
  let browser;
  try {
    await writeFile(new URL(name + '.tsx', root), fixture);
    await writeFile(new URL(name + '.html', root), `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => { errors.push('Unexpected API call: ' + route.request().url()); return route.abort(); });
    const base = `${process.env.VITE_TEST_URL || 'http://127.0.0.1:5188'}/${name}.html`;
    for (const runId of ['direct', 'suite']) {
      await page.goto(`${base}?route=${encodeURIComponent('/executions?view=suite-runs&execution=' + runId)}`);
      await page.getByRole('button', { name: 'Back to run library', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Back to run library', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('[data-testid="location"]').textContent.includes('execution='));
      await page.waitForFunction(() => !document.querySelector('[aria-label="Back to run library"]'));
      const runName = runId === 'direct' ? 'Direct checkout run' : 'Suite checkout run';
      await page.getByRole('article', { name: `Open run ${runName}`, exact: true }).getByRole('button', { name: 'Open run', exact: true }).click();
      await page.getByRole('button', { name: 'Back to run library', exact: true }).waitFor();
    }
    await page.goto(`${base}?route=${encodeURIComponent('/executions?view=suite-runs&execution=direct&testCase=case-1')}`);
    await page.getByRole('heading', { name: 'Checkout scenario 1', exact: true }).waitFor();
    await page.locator('.execution-case-run-header').getByRole('button', { name: /^Back to / }).click();
    await page.waitForFunction(() => !document.querySelector('[data-testid="location"]').textContent.includes('testCase='));
    await page.waitForFunction(() => !document.querySelector('.execution-case-run-header'));
    await page.evaluate(() => window.fixtureUpdateResultEvidence('Refreshed evidence after closing case.'));
    assert.equal(await page.locator('.execution-case-run-header').count(), 0, 'refetch cannot restore the dismissed case');
    await page.getByRole('button', { name: 'Open Checkout scenario 1 case workspace', exact: true }).click();
    await page.getByRole('heading', { name: 'Checkout scenario 1', exact: true }).waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await Promise.all(['.tsx', '.html'].map(ext => rm(new URL(name + ext, root), { force: true })));
  }
});
