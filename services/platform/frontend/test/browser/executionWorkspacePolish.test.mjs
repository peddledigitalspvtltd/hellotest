import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
const require = createRequire(new URL('../../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require('playwright');
const root = new URL('../../', import.meta.url);

test('Run workspace keeps case titles horizontal, result segments discoverable and analysis consolidated', { timeout:90_000 }, async () => {
  const source = await readFile(new URL('../../../../testing/test/browser/runCatalogDetails.test.mjs', import.meta.url), 'utf8');
  let fixture = source.match(/const fixtureSource = `([\s\S]*?)`;\n/)[1];
  const longTitle = 'Checkout confirms the selected payment method and delivery address across returning customer sessions without losing the saved order details';
  fixture = fixture.replace('title: "Checkout scenario " + (i + 1)', `title: ${JSON.stringify(longTitle)} + ' ' + (i + 1)`);
  const name = `execution-polish-${randomUUID()}`;
  const files = [];
  let browser;
  try {
    for (const [extension, content] of [['tsx',fixture],['html',`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`]]) {
      const path = new URL(`${name}.${extension}`, root); files.push(path); await writeFile(path,content);
    }
    browser = await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    const page = await browser.newPage({viewport:{width:1600,height:1100}});
    const errors = []; page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5189'}/${name}.html?route=${encodeURIComponent('/executions?view=suite-runs&execution=aborted')}`);
    const workspace = page.locator('.execution-run-command-center');
    await workspace.locator('.execution-command-case-row').first().waitFor();
    assert.equal(await workspace.getByText('Run references',{exact:true}).count(),0);
    assert.equal(await workspace.locator('.execution-command-failure-analysis .ai-feature-composer').count(),1);
    assert.equal(await workspace.locator('.execution-command-analysis .ai-feature-composer').count(),0);
    const sidebarOrder = await workspace.locator('.execution-command-analysis').evaluate(element => [...element.children].map(child=>child.className));
    assert.ok(sidebarOrder.indexOf('execution-command-feed') < sidebarOrder.indexOf('execution-command-inspector'));
    assert.equal(await workspace.locator('.execution-command-case-row .display-id-badge').count(),0);
    const chart = workspace.getByRole('group',{name:'Run result distribution',exact:true});
    await chart.locator('[data-outcome="skipped"]').waitFor();
    for (const [key,label] of [['passed','Passed'],['failed','Failed'],['blocked','Blocked'],['paused','Paused'],['skipped','Skipped / N/A'],['aborted','Aborted']]) {
      await chart.locator(`[data-outcome="${key}"]`).focus();
      await page.getByRole('tooltip').waitFor();
      assert.equal(await page.getByRole('tooltip').innerText(),`${label}: 1 (17%)`);
      await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('tooltip').count(),0);
    }
    await chart.locator('[data-outcome="aborted"]').evaluate(element=>element.blur());
    const bounds = await chart.locator('svg').boundingBox();
    await page.mouse.move(bounds.x+bounds.width*.715,bounds.y+bounds.height*.128);
    await page.getByRole('tooltip').waitFor();
    assert.equal(await page.getByRole('tooltip').innerText(),'Passed: 1 (17%)','Pointer hover identifies the actual result segment');
    await page.mouse.move(0,0);
    const analyze = workspace.locator('.execution-command-failure-analysis').getByRole('button',{name:'Analyze run',exact:true});
    await analyze.scrollIntoViewIfNeeded();
    const analyzeBounds = await analyze.boundingBox();
    assert.ok(analyzeBounds.y >= 0 && analyzeBounds.y + analyzeBounds.height <= 1101,
      'The relocated Failure Analyst submit action remains reachable through the workspace scroll');
    await mkdir('/tmp/qaira-execution-polish',{recursive:true});
    for (const mode of ['List view','Tile view']) {
      await page.setViewportSize({width:1600,height:1100});
      await workspace.locator('.execution-command-case-toolbar').getByRole('button',{name:mode,exact:true}).click();
      for (const width of [1600,390]) {
        const viewportHeight = width < 600 ? 844 : 1100;
        await page.setViewportSize({width,height:viewportHeight});
        const title = workspace.locator('.execution-command-case-copy strong').first();
        await title.scrollIntoViewIfNeeded();
        const titleBounds = await title.boundingBox();
        assert.ok(titleBounds.y >= 0 && titleBounds.y + titleBounds.height <= viewportHeight,
          `The ${mode} case title is reachable in the ${width}px viewport`);
        const geometry = await title.evaluate(element=>({title:element.title,whiteSpace:getComputedStyle(element).whiteSpace,overflow:getComputedStyle(element).textOverflow,height:element.clientHeight,lineHeight:parseFloat(getComputedStyle(element).lineHeight),clientWidth:element.clientWidth,scrollWidth:element.scrollWidth}));
        assert.equal(geometry.title,`${longTitle} 1`);
        assert.equal(geometry.whiteSpace,'nowrap'); assert.equal(geometry.overflow,'ellipsis');
        assert.ok(geometry.scrollWidth > geometry.clientWidth,'Long title truncates with its full value in the tooltip');
        assert.equal(await workspace.locator('.execution-command-case-row').getByText('case-1',{exact:true}).count(),0);
        assert.equal(await workspace.evaluate(element=>element.scrollWidth<=element.clientWidth+1),true,`Run workspace fits ${width}px viewport`);
        await page.screenshot({path:`/tmp/qaira-execution-polish/run-workspace-${width}-${mode.split(' ')[0].toLowerCase()}.png`,animations:'disabled'});
      }
    }
    assert.deepEqual(errors,[]);
  } finally { await browser?.close(); await Promise.all(files.map(file=>rm(file,{force:true}))); }
});
