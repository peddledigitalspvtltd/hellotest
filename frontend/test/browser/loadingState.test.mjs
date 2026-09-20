// Real shared loaders and production CSS; isolated fixture with no backend writes.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('../../', import.meta.url);

const screenshotDir = process.env.BROWSER_SCREENSHOT_DIR || '/tmp/qaira-loading-state';

function colorChannels(color) {
  const channels = color.match(/[\d.]+/g)?.map(Number);
  assert.ok(channels?.length >= 3, `Expected a resolved RGB color, received ${color}`);
  return channels;
}

function contrastRatio(first, second) {
  const luminance = channels => channels.slice(0, 3).map(channel => {
    const value = channel / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
}

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

test('12-bar shared loader stays centered, respects motion preferences, and preserves the overlapping-request lifecycle', { timeout: 90000 }, async () => {
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
    const segments = ring.locator('.loading-spinner-segment');
    await loader.waitFor();
    const verifySegments = async ({ reducedMotion = false } = {}) => {
      assert.equal(await ring.locator('.screen-loading-orbit').count(), 0, 'The former orbit artwork is removed');
      assert.equal(await segments.count(), 12, 'The shared indicator has exactly twelve bars');
      assert.equal(await ring.getAttribute('aria-hidden'), 'true', 'Decorative bars do not duplicate the live status announcement');
      assert.equal(await page.locator('.screen-loading-label').textContent(), 'Loading.....', 'The global visible label matches the reference');
      const styles = await segments.evaluateAll(nodes => nodes.map(node => {
        const style = getComputedStyle(node);
        return { tag:node.tagName, width:node.getAttribute('width'), height:node.getAttribute('height'), transform:node.getAttribute('transform') || style.transform, fill:style.fill, opacity:style.opacity };
      }));
      assert.ok(styles.every(style => style.tag.toLowerCase() === 'rect' && Number(style.height) > Number(style.width)), 'Each segment is a rectangular radial bar');
      assert.equal(new Set(styles.map(style => style.transform)).size, 12, 'The twelve bars occupy distinct radial positions');
      const angles = styles.map(style => Number(style.transform.match(/rotate\(([-\d.]+)/)?.[1]));
      assert.ok(angles.every((angle, index) => index === 0 || angle - angles[index - 1] === 30), 'Bars are evenly spaced thirty degrees apart');
      assert.equal(new Set(styles.map(style => style.opacity)).size, 12, 'The bars form a twelve-step grayscale trail');
      assert.ok(styles.every(style => {
        const [red, green, blue] = colorChannels(style.fill);
        return red === green && green === blue;
      }), 'All segments use grayscale paint');
      const fan = await ring.locator('.loading-spinner-fan').evaluate(node => {
        const style = getComputedStyle(node);
        return { animationName:style.animationName, animationDuration:style.animationDuration, animationIterationCount:style.animationIterationCount, animationTimingFunction:style.animationTimingFunction };
      });
      if (reducedMotion) assert.equal(fan.animationName, 'none', 'Reduced motion leaves a static twelve-bar indicator');
      else {
        assert.ok(fan.animationName !== 'none' && parseFloat(fan.animationDuration) > 0 && fan.animationIterationCount === 'infinite', 'The radial bars have one repeating rotation animation');
        assert.match(fan.animationTimingFunction, /^steps\(12(?:, end)?\)$/, 'Each animation step advances the trail by one bar');
      }
    };
    await verifySegments();
    const initialTransform = await ring.locator('.loading-spinner-fan').evaluate(node => getComputedStyle(node).transform);
    await page.waitForFunction(initial => getComputedStyle(document.querySelector('.loading-spinner-fan')).transform !== initial, initialTransform);
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
    await verifySegments({ reducedMotion:true });
    await mkdir(screenshotDir, { recursive:true });
    for (const surface of ['main', 'admin']) {
      await page.goto(`${baseUrl}/${name}.html${surface === 'admin' ? '?admin' : ''}`);
      await loader.waitFor();
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
        for (const [size, viewport] of [['desktop', { width:1440,height:1000 }], ['mobile', { width:390,height:844 }]]) {
          await page.setViewportSize(viewport);
          await verifyCenter();
          await verifySegments({ reducedMotion:true });
          const screenshot = await page.screenshot({ path:`${screenshotDir}/${surface}-${theme}-${size}.png`, animations:'disabled' });
          // The production dark background is a gradient whose backgroundColor
          // is transparent. Sample its rendered pixels instead of assuming white.
          const colors = await page.evaluate(async screenshotData => {
            const image = new Image();
            image.src = screenshotData;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = image.width;
            canvas.height = image.height;
            const context = canvas.getContext('2d');
            context.drawImage(image, 0, 0);
            const bounds = document.querySelector('.screen-loading-ring').getBoundingClientRect();
            const background = Array.from(context.getImageData(Math.floor(bounds.left - 12), Math.floor(bounds.top + bounds.height / 2), 1, 1).data).slice(0, 3);
            return {
              background,
              segment: getComputedStyle(document.querySelector('.screen-loading-ring .loading-spinner-segment')).fill,
              label: getComputedStyle(document.querySelector('.screen-loading-label')).color
            };
          }, `data:image/png;base64,${screenshot.toString('base64')}`);
          assert.ok(contrastRatio(colorChannels(colors.segment), colors.background) >= 3, `${surface} ${theme} bars contrast with the page at their opaque animation phase`);
          assert.ok(contrastRatio(colorChannels(colors.label), colors.background) >= 4.5, `${surface} ${theme} loading text stays readable`);
        }
      }
    }
    await page.getByRole('button', { name:'Finish dialog', exact:true }).click();
    await page.getByRole('status', { name:'Loading tiles', exact:true }).waitFor();
    // Some production dialogs intentionally keep a light canvas in dark mode.
    // The body-level loader must remain visible over those mixed surfaces too.
    await page.goto(`${baseUrl}/${name}.html`);
    await loader.waitFor();
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark';
      const dialog = document.createElement('section');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-label', 'Light dialog in dark workspace');
      Object.assign(dialog.style, { position:'fixed', inset:'10%', zIndex:'1000', background:'#fff', color:'#172b4d', padding:'24px', borderRadius:'16px', boxShadow:'0 20px 70px #0006' });
      dialog.innerHTML = '<h2 style="color:#172b4d!important">Story workbench</h2><p style="color:#44546f!important">The story dialog keeps its light canvas in dark mode.</p>';
      document.body.append(dialog);
    });
    assert.notEqual(await ring.evaluate(node => getComputedStyle(node).filter), 'none', 'The light bars keep a contrasting edge over light dialogs in dark mode');
    assert.notEqual(await page.locator('.screen-loading-label').evaluate(node => getComputedStyle(node).textShadow), 'none', 'The light caption keeps its contrast outline over a light dialog');
    for (const [size, viewport] of [['desktop', { width:1440,height:1000 }], ['mobile', { width:390,height:844 }]]) {
      await page.setViewportSize(viewport);
      await verifyCenter();
      await page.screenshot({ path:`${screenshotDir}/main-dark-light-dialog-${size}.png`, animations:'disabled' });
    }
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
    const timedSegments = timingPage.locator('.screen-loading-ring .loading-spinner-segment');
    assert.equal(await timedSegments.count(), 12, 'The reduced-motion lifecycle still renders all twelve bars');
    assert.equal(await timedLoader.locator('.loading-spinner-fan').evaluate(node => getComputedStyle(node).animationName), 'none');
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
