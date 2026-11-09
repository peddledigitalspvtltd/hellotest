import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
import {expect} from 'playwright/test';

const full = 'Mira Regression 20261106';

async function fixture(t, browserType = chromium) {
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', 'text/html');
    response.end(request.url === '/events'
      ? `<!doctype html><title>Events</title><table><thead><tr><th>Event</th><th>Type</th><th>Status</th></tr></thead><tbody>
          <tr><td><a href="#target">${full}</a></td><td>Onboarding</td><td>Activated</td></tr>
          <tr><td><a href="#other">Mira Regression 20261105</a></td><td>Offboarding</td><td>Activated</td></tr>
          <tr><td><a href="#draft">Other Regression 20261106</a></td><td>Onboarding</td><td>Draft</td></tr>
        </tbody></table>`
      : '<!doctype html><title>Outer shell</title><iframe id="noncoreIframe" src="/events" style="width:900px;height:400px"></iframe>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await browserType.launch({headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || chromium.executablePath()});
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.frameLocator('iframe#noncoreIframe').getByRole('link', {name: full, exact: true}).waitFor({state: 'visible'});
  return page;
}

test('native Playwright accepts an aliased inner locator with the identical same-frame prefix', {timeout: 15000}, async t => {
  const page = await fixture(t);
  const frame = page.frameLocator('iframe#noncoreIframe');
  const eventLink = frame.getByRole('link', {name: full});
  const eventRow = frame.getByRole('row').filter({has: eventLink});
  await expect(eventRow.getByRole('cell', {name: 'Activated'})).toBeVisible({timeout: 500});
  await expect(frame.getByRole('row').filter({hasNot: eventLink})).toHaveCount(3);
});

test('native Playwright rejects composite inner frame locators with a different prefix even for the same iframe', {timeout: 15000}, async t => {
  const page = await fixture(t);
  const frame = page.frameLocator('iframe#noncoreIframe');
  // Both selectors resolve to the same iframe, but native prefix normalization
  // only removes an identical frame prefix from the nested locator.
  const eventLink = page.frameLocator('#noncoreIframe').getByRole('link', {name: full});
  for (const key of ['has', 'hasNot']) {
    await assert.rejects(
      frame.getByRole('row').filter({[key]: eventLink}).count(),
      /Frame locators are not allowed inside composite locators/
    );
  }
});

test('same-frame row text filtering passes exact identity, type, and status assertions in native Playwright', {timeout: 15000}, async t => {
  const page = await fixture(t);
  const frame = page.frameLocator('iframe#noncoreIframe');
  const eventRow = frame.getByRole('row').filter({hasText: full});
  await expect(eventRow).toHaveCount(1);
  await expect(eventRow.getByRole('link', {name: full, exact: true})).toBeVisible();
  await expect(eventRow.getByRole('cell', {name: 'Onboarding', exact: true})).toBeVisible();
  await expect(eventRow.getByRole('cell', {name: 'Activated', exact: true})).toBeVisible();
  await expect(eventRow.getByRole('cell', {name: 'Offboarding', exact: true})).toHaveCount(0);
  await expect(eventRow.getByRole('cell', {name: 'Draft', exact: true})).toHaveCount(0);
});

test('pinned upstream Playwright also accepts an identical aliased same-frame locator', {timeout: 15000}, async t => {
  const require = createRequire(import.meta.url);
  const upstream = createRequire(require.resolve('@playwright/mcp/package.json'))('playwright');
  const page = await fixture(t, upstream.chromium);
  const frame = page.frameLocator('iframe#noncoreIframe');
  const eventLink = frame.getByRole('link', {name: full});
  const eventRow = frame.getByRole('row').filter({has: eventLink});
  assert.equal(await eventRow.count(), 1);
  assert.equal(await eventRow.getByRole('cell', {name: 'Activated', exact: true}).isVisible(), true);
});

test('native Playwright ignores hasText passed to getByRole while filter scopes the exact record', {timeout: 30000}, async t => {
  const require = createRequire(import.meta.url);
  const upstream = createRequire(require.resolve('@playwright/mcp/package.json'));
  for (const [version, browserType] of [
    [require('playwright/package.json').version, chromium],
    [upstream('playwright/package.json').version, upstream('playwright').chromium],
  ]) {
    await t.test(`Playwright ${version}`, async t => {
      const page = await fixture(t, browserType);
      const frame = page.frameLocator('iframe#noncoreIframe');
      const resultRow = frame.getByRole('row', {hasText: full});
      assert.equal(await frame.getByRole('row').count(), 4);
      assert.equal(await resultRow.count(), 4, 'getByRole silently ignores the unsupported hasText option, retaining the header and all decoy rows');
      assert.equal(await resultRow.getByRole('cell', {name: 'Activated', exact: true}).count(), 2);
      const filteredRow = frame.getByRole('row').filter({hasText: full});
      assert.equal(await filteredRow.count(), 1);
      assert.equal(await filteredRow.getByRole('link', {name: full, exact: true}).count(), 1);
      assert.equal(await filteredRow.getByRole('cell', {name: 'Onboarding', exact: true}).count(), 1);
      assert.equal(await filteredRow.getByRole('cell', {name: 'Activated', exact: true}).count(), 1);
    });
  }
});
