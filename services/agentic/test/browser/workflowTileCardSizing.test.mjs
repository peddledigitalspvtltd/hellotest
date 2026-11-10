import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const sharedCss = new URL('../../../platform/frontend/src/styles.css', import.meta.url);

test('a single workflow tile keeps the same compact track width as a populated grid', { timeout: 30000 }, async () => {
  const css = await readFile(sharedCss, 'utf8');
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.setContent(`<!doctype html><html><head><style>${css}</style><style>#fixture{width:1120px;margin:20px}</style></head><body><div id="fixture"><div class="tile-browser-grid agentic-workflow-grid"><button class="record-card tile-card agentic-workflow-card">One workflow</button></div></div></body></html>`);
    const singleWidth = await page.locator('.agentic-workflow-card').evaluate((element) => element.getBoundingClientRect().width);
    const gridWidth = await page.locator('#fixture').evaluate((element) => element.getBoundingClientRect().width);
    await page.locator('.agentic-workflow-grid').evaluate((element) => {
      element.insertAdjacentHTML('beforeend', '<button class="record-card tile-card agentic-workflow-card">Second workflow</button>');
    });
    const multipleWidths = await page.locator('.agentic-workflow-card').evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width));
    assert.ok(singleWidth < gridWidth * 0.6, `single tile width ${singleWidth}px should not fill the ${gridWidth}px grid`);
    assert.ok(Math.abs(singleWidth - multipleWidths[0]) < 1);
    assert.ok(Math.abs(multipleWidths[0] - multipleWidths[1]) < 1);
  } finally {
    await browser.close();
  }
});
