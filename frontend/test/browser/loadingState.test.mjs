// Real shared loaders and production CSS; isolated fixture with no backend writes.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('../../', import.meta.url);

const fixture = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { LoadingState } from '/src/components/LoadingState';
import { TileCardSkeletonGrid } from '/src/components/TileCardSkeletonGrid';
import { WorkspacePageSkeleton } from '/src/components/WorkspacePageSkeleton';
import '@fontsource/hanken-grotesk/400.css';
import '/src/styles.css';
import '/src/dark-theme.css';
import '/src/modal-system.css';
import '/src/workspace-layout.css';
if (new URLSearchParams(location.search).has('admin')) await import('/src/admin/admin.css');
function Fixture() {
  const initialLoading = !new URLSearchParams(location.search).has('idle');
  const [first, setFirst] = useState(initialLoading);
  const [second, setSecond] = useState(initialLoading);
  const [third, setThird] = useState(initialLoading);
  const [label, setLabel] = useState('Loading dialog details');
  const [readyClicks, setReadyClicks] = useState(0);
  window.loadingFixture = {
    startDialog: () => flushSync(() => setFirst(true)),
    startTiles: () => flushSync(() => setSecond(true)),
    finishDialog: () => flushSync(() => setFirst(false)),
    finishAll: () => flushSync(() => { setFirst(false); setSecond(false); setThird(false); })
  };
  return <main style={{minHeight:2600,padding:24}}>
    <header style={{position:'fixed',top:12,left:12,zIndex:10000,display:'flex',flexWrap:'wrap',gap:8,maxWidth:'90vw'}}>
      <button onClick={() => setFirst(false)}>Finish dialog</button>
      <button onClick={() => setSecond(false)}>Finish tiles</button>
      <button onClick={() => setThird(false)}>Finish workspace</button>
      <button onClick={() => {setFirst(true);setSecond(true);setThird(true)}}>Restart loading</button>
      <button onClick={() => setLabel('Loading updated details')}>Update label</button>
    </header>
    <section aria-label="Scrollable dialog" style={{position:'relative',transform:'translate(19px,37px)',filter:'opacity(1)',contain:'layout',overflow:'auto',width:'min(60vw,540px)',height:200,marginTop:100,border:'1px solid #8792a2',padding:20}}>
      <h1>Project workspace</h1><p>The application stays visible and usable while loading.</p>
      <div style={{height:1200}}>{first && <LoadingState label={label} description="Retrieving dialog details." />}</div>
    </section>
    {second && <TileCardSkeletonGrid count={3} />}
    {third && <WorkspacePageSkeleton label="Loading workspace" />}
    {!first && !second && !third && <button style={{position:'fixed',top:'50%',left:'50%'}} onClick={() => setReadyClicks(value => value + 1)}>Ready content {readyClicks}</button>}
  </main>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture /></React.StrictMode>);
`;

test('compact shared loader stays centered, holds for two seconds, and handles overlapping requests', { timeout: 60000 }, async () => {
  const name = 'loading-state-' + randomUUID();
  const html = new URL(name + '.html', root);
  const tsx = new URL(name + '.tsx', root);
  let browser;
  try {
    await writeFile(html, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    await writeFile(tsx, fixture);
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(7000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const baseUrl = process.env.VITE_TEST_URL || 'http://127.0.0.1:5173';
    await page.goto(`${baseUrl}/${name}.html`);
    const loader = page.locator('.screen-loading-overlay');
    const ring = page.locator('.screen-loading-ring');
    await loader.waitFor();
    const verifyCenter = async () => {
      assert.equal(await loader.count(), 1, 'Overlapping requests share one indicator');
      const bounds = await ring.boundingBox();
      const viewport = page.viewportSize();
      assert.ok(Math.abs(bounds.x + bounds.width / 2 - viewport.width / 2) <= .5, 'Ring is horizontally centered');
      assert.ok(Math.abs(bounds.y + bounds.height / 2 - viewport.height / 2) <= .5, 'Ring is vertically centered');
      assert.ok(Math.abs(bounds.width - Math.min(96, Math.min(viewport.width, viewport.height) * .2)) <= .5, 'Ring uses the smaller responsive size');
      const fontSize = await page.locator('.screen-loading-label').evaluate(node => parseFloat(getComputedStyle(node).fontSize));
      assert.ok(fontSize >= 14 && fontSize <= 16, 'Label stays compact and readable');
    };
    for (const viewport of [{ width:1440,height:1000 }, { width:800,height:600 }, { width:390,height:844 }, { width:320,height:568 }, { width:844,height:390 }]) {
      await page.setViewportSize(viewport);
      await verifyCenter();
      await page.getByRole('region', { name:'Scrollable dialog' }).evaluate(node => node.scrollTop = 600);
      await page.evaluate(() => window.scrollTo(0, 900));
      await verifyCenter();
      const labelBounds = await page.locator('.screen-loading-label').boundingBox();
      assert.ok(labelBounds.y + labelBounds.height <= viewport.height, 'Loading label stays on screen');
    }
    assert.equal(await loader.evaluate(node => getComputedStyle(node).pointerEvents), 'none');
    assert.equal(await loader.evaluate(node => getComputedStyle(node).backgroundColor), 'rgba(0, 0, 0, 0)');
    await page.getByRole('button', { name:'Update label', exact:true }).click();
    await page.getByRole('status', { name:'Loading updated details', exact:true }).waitFor();
    await page.getByRole('button', { name:'Finish dialog', exact:true }).click();
    await page.getByRole('status', { name:'Loading tiles', exact:true }).waitFor();
    await verifyCenter();
    await page.getByRole('button', { name:'Finish tiles', exact:true }).click();
    await page.getByRole('status', { name:'Loading workspace', exact:true }).waitFor();
    await verifyCenter();
    await page.getByRole('button', { name:'Finish workspace', exact:true }).click();
    await loader.waitFor({ state:'detached' });
    await page.getByRole('button', { name:'Restart loading', exact:true }).click();
    await loader.waitFor();
    await verifyCenter();
    await page.emulateMedia({ reducedMotion:'reduce' });
    assert.ok(await page.locator('.screen-loading-orbit').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).animationName === 'none')));
    const screenshotDir = process.env.BROWSER_SCREENSHOT_DIR || '/tmp/qaira-loading-state';
    await mkdir(screenshotDir, { recursive:true });
    await page.setViewportSize({ width:800,height:600 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path:`${screenshotDir}/light.png` });
    await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
    await verifyCenter();
    await page.screenshot({ path:`${screenshotDir}/dark.png` });
    await page.goto(`${baseUrl}/${name}.html?admin`);
    await loader.waitFor();
    await verifyCenter();
    await page.getByRole('button', { name:'Finish dialog', exact:true }).click();
    await page.getByRole('status', { name:'Loading tiles', exact:true }).waitFor();
    assert.deepEqual(errors, []);

    // Drive real component timers without wall-clock timing races. Start idle so
    // loading the fixture cannot consume any part of the visibility interval.
    const timingPage = await browser.newPage({ viewport: { width:800,height:600 } });
    timingPage.setDefaultTimeout(7000);
    timingPage.on('pageerror', error => errors.push(error.message));
    await timingPage.clock.install({ time:new Date('2026-09-16T00:00:00Z') });
    await timingPage.goto(`${baseUrl}/${name}.html?idle`);
    await timingPage.getByRole('button', { name:'Ready content 0', exact:true }).waitFor();
    await timingPage.clock.pauseAt(new Date('2026-09-16T01:00:00Z'));
    const timedLoader = timingPage.locator('.screen-loading-overlay');
    const action = name => timingPage.evaluate(name => window.loadingFixture[name](), name);
    const advance = ms => timingPage.clock.runFor(ms);
    const rememberIndicator = () => timingPage.evaluate(() => { window.savedLoadingIndicator = document.querySelector('.screen-loading-overlay'); });
    const verifySameIndicator = async () => assert.equal(await timingPage.evaluate(() => window.savedLoadingIndicator === document.querySelector('.screen-loading-overlay')), true, 'Pending work retains the same visible indicator');
    await timingPage.evaluate(() => {
      window.loaderAppearances = 0;
      new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE && (node.matches('.screen-loading-overlay') || node.querySelector('.screen-loading-overlay'))) window.loaderAppearances++;
        }
      }).observe(document.body, { childList:true, subtree:true });
    });

    await action('startDialog');
    await advance(100);
    assert.equal(await timedLoader.count(), 0, 'Very short work does not show an indicator');
    await action('finishAll');
    await advance(300);
    assert.equal(await timingPage.evaluate(() => window.loaderAppearances), 0, 'Canceled debounce never flashes the indicator');

    await action('startDialog');
    await advance(159);
    assert.equal(await timedLoader.count(), 0, 'Indicator waits for the debounce interval');
    await advance(1);
    await timedLoader.waitFor();
    await advance(400);
    await action('finishAll');
    assert.equal(await timedLoader.count(), 1, 'Indicator survives unmounting its final consumer');
    assert.equal(await timedLoader.evaluate(node => getComputedStyle(node).pointerEvents), 'none');
    await timingPage.getByRole('button', { name:'Ready content 0', exact:true }).click();
    await timingPage.getByRole('button', { name:'Ready content 1', exact:true }).waitFor();
    await advance(1599);
    assert.equal(await timedLoader.count(), 1, 'Finished work retains its indicator for two seconds after appearing');
    assert.equal(await timedLoader.evaluate(node => node.classList.contains('is-exiting')), false, 'The full two-second interval precedes the fade');
    await advance(1);
    assert.equal(await timedLoader.count(), 1, 'Indicator remains mounted for its exit transition');
    assert.equal(await timedLoader.evaluate(node => node.classList.contains('is-exiting')), true, 'Completed loading fades out gracefully');
    await advance(180);
    assert.equal(await timedLoader.count(), 0, 'Indicator leaves after the minimum interval and exit transition');
    assert.equal(await timingPage.locator('[data-loading-host]').count(), 0, 'Finished loader removes its independent host');

    await action('startDialog');
    await advance(160);
    await timedLoader.waitFor();
    await rememberIndicator();
    await advance(500);
    await action('finishAll');
    await advance(1200);
    await action('startDialog');
    await verifySameIndicator();
    await advance(481);
    await verifySameIndicator();
    assert.equal(await timedLoader.count(), 1, 'New work during the hold cancels the previous dismissal');
    await action('finishAll');
    await advance(90);
    await action('startTiles');
    await verifySameIndicator();
    await advance(250);
    await verifySameIndicator();
    assert.equal(await timedLoader.evaluate(node => node.classList.contains('is-exiting')), false, 'New work restores the indicator from its fade');
    await timingPage.getByRole('status', { name:'Loading tiles', exact:true }).waitFor();
    assert.equal(await timedLoader.count(), 1, 'New work during exit cancels the old removal timer');
    await action('finishAll');
    await advance(180);
    assert.equal(await timedLoader.count(), 0, 'Returning requests do not restart the minimum interval');

    await action('startDialog');
    await advance(160);
    await timedLoader.waitFor();
    await rememberIndicator();
    await advance(500);
    await action('startTiles');
    await advance(160);
    await action('finishDialog');
    await timingPage.getByRole('status', { name:'Loading tiles', exact:true }).waitFor();
    await verifySameIndicator();
    await advance(1340);
    await action('finishAll');
    await advance(180);
    assert.equal(await timedLoader.count(), 0, 'Overlapping requests hand off without restarting the two-second minimum');

    await timingPage.emulateMedia({ reducedMotion:'reduce' });
    await action('startDialog');
    await advance(160);
    await timedLoader.waitFor();
    assert.ok(await timingPage.locator('.screen-loading-orbit').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).animationName === 'none')));
    assert.equal(await timedLoader.evaluate(node => getComputedStyle(node).transitionDuration), '0s', 'Reduced motion removes the opacity transition');
    await action('finishAll');
    await advance(1999);
    assert.equal(await timedLoader.count(), 1, 'Reduced motion still preserves the minimum visible interval');
    await advance(181);
    assert.equal(await timedLoader.count(), 0, 'Reduced motion completes the loader lifecycle');
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await Promise.allSettled([unlink(html), unlink(tsx)]);
  }
});
