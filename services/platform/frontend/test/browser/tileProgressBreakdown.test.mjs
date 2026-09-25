import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
const require = createRequire(new URL('../../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('../../', import.meta.url);
const fixture = `import React from 'react';import {createRoot} from 'react-dom/client';
import {TileCardProgress} from '/src/shared/components/TileCardPrimitives';
import {ProjectMetricBreakdown} from '/services/manual/frontend/components/ProjectMetricBreakdown';
import '/src/styles.css';import '/src/dark-theme.css';import '/src/modal-system.css';import '/services/platform/frontend/pages/ProjectsPage.css';
const outcomes={total:10,segments:[{key:'passed',label:'Passed',count:6},{key:'failed',label:'Failed',count:1},{key:'blocked',label:'Blocked',count:1},{key:'pending',label:'Pending',count:2}]};
const coverage={total:4,segments:[{key:'covered',label:'Covered',count:3},{key:'uncovered',label:'Uncovered',count:1}]};
createRoot(document.getElementById('root')).render(<main style={{padding:20,display:'grid',gap:20,gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,280px),1fr))'}}>
<article data-testid="project" className="record-card tile-card"><ProjectMetricBreakdown label="Reference pass rate" percent={60} total={outcomes.total} segments={outcomes.segments} detail="Reference results"/></article>
<article data-testid="outcomes" className="record-card tile-card"><TileCardProgress label="Pass rate" value={60} breakdown={outcomes} title="Six of ten outcomes passed"/></article>
<article data-testid="coverage" className="record-card tile-card"><TileCardProgress label="Overall progress" value={75} breakdown={coverage} title="Three of four checks met"/></article>
<article data-testid="score" className="record-card tile-card"><TileCardProgress label="Readiness" value={75} breakdown={{total:100,unit:'percent',segments:[{key:'covered',label:'Readiness score',count:75},{key:'pending',label:'Remaining score',count:25}]}}/></article>
<article data-testid="tiny" className="record-card tile-card"><TileCardProgress label="Large run" value={99} breakdown={{total:1000,segments:[{key:'passed',label:'Passed',count:999},{key:'failed',label:'Failed',count:1}]}}/></article>
<article data-testid="empty" className="record-card tile-card"><TileCardProgress label="Empty run" value={null} displayValue="No runs" breakdown={{total:0,segments:[]}} title="No finalized results"/></article>
<article data-testid="restricted" className="record-card tile-card"><TileCardProgress label="Restricted run" value={null} displayValue="Unavailable" breakdown={outcomes} title="Result access required"/></article>
<article data-testid="zero" className="record-card tile-card"><TileCardProgress label="Pending run" value={0} breakdown={{total:5,segments:[{key:'pending',label:'Pending',count:5}]}}/></article>
</main>);`;

test('tile bars match Project status colors, count labels, proportions and tooltips at desktop and mobile widths', { timeout: 60000 }, async () => {
  const name = `tile-progress-${randomUUID()}`;
  const html = new URL(`${name}.html`, root), tsx = new URL(`${name}.tsx`, root);
  let browser;
  try {
    await writeFile(html, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    await writeFile(tsx, fixture);
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5189'}/${name}.html`);
    const outcomes = page.getByTestId('outcomes');
    const bar = outcomes.getByRole('progressbar', { name: 'Pass Rate', exact: true });
    await bar.waitFor();
    assert.equal(await bar.getAttribute('aria-valuenow'), '60');
    assert.equal(await bar.getAttribute('title'), '6 Passed, 1 Failed, 1 Blocked, 2 Pending');
    assert.match(await bar.getAttribute('aria-valuetext'), /60%.*6 Passed/);
    assert.equal(await outcomes.getAttribute('title'), null);
    assert.equal(await outcomes.locator('.tile-card-progress').getAttribute('title'), 'Six of ten outcomes passed');
    assert.deepEqual(await bar.locator('b').allTextContents(), ['6', '1', '1', '2']);
    for (const [key, count, label] of [['passed', 6, 'Passed'], ['failed', 1, 'Failed'], ['blocked', 1, 'Blocked'], ['pending', 2, 'Pending']]) {
      const segment = bar.locator(`.is-${key}`);
      assert.equal(await segment.getAttribute('title'), `${label}: ${count}`);
      const reference = page.getByTestId('project').locator(`.is-${key}`);
      assert.equal(await segment.evaluate(node => getComputedStyle(node).backgroundColor), await reference.evaluate(node => getComputedStyle(node).backgroundColor));
      assert.equal(await segment.evaluate(node => node.style.width), `${count * 10}%`);
    }
    assert.equal(await page.getByTestId('coverage').locator('.is-covered').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(133, 184, 255)');
    assert.deepEqual(await page.getByTestId('score').locator('b').allTextContents(), ['75%', '25%']);
    for (const id of ['empty', 'restricted']) {
      assert.equal(await page.getByTestId(id).getByRole('progressbar').count(), 0);
      assert.equal(await page.getByTestId(id).locator('.metric-status-segment').count(), 0);
    }
    assert.equal(await page.getByTestId('zero').getByRole('progressbar').getAttribute('aria-valuenow'), '0');
    assert.equal(await page.getByTestId('zero').locator('.is-pending').getAttribute('title'), 'Pending: 5');
    await mkdir('/tmp/qaira-tile-progress', { recursive: true });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${theme} ${width} fits viewport`);
        assert.equal(await bar.evaluate(node => node.getBoundingClientRect().height), 14);
        const tiny = page.getByTestId('tiny').locator('.is-failed');
        assert.equal(await tiny.getAttribute('title'), 'Failed: 1');
        assert.equal(await tiny.locator('b').evaluate(node => getComputedStyle(node).visibility), 'hidden');
        await page.screenshot({ path: `/tmp/qaira-tile-progress/${theme}-${width}.png`, fullPage: true });
      }
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await Promise.allSettled([unlink(html), unlink(tsx)]);
  }
});
