import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const runtimeUrl = process.env.HELLOTEST_RUNTIME_TEST_BUILD
  ? pathToFileURL(path.resolve(process.env.HELLOTEST_RUNTIME_TEST_BUILD, 'lib/playwrightBindings.js'))
  : new URL('../../dist/lib/playwrightBindings.js', import.meta.url);
const { createPlaywrightCodeBindings } = await import(runtimeUrl.href);

test('generated literal parameter references replay unchanged in native Playwright actions and assertions', {timeout:30000}, async t => {
  const browser = await chromium.launch({headless:true});
  t.after(() => browser.close());
  const nativePage = await browser.newPage();
  await nativePage.setContent('<!doctype html><label>Email<input id="email"></label><output>Ready</output>');
  const values = {'t.email':'reader@example.test','t.other':'another@example.test'};
  const {page,expect} = createPlaywrightCodeBindings(nativePage, {
    interpolate: value => value.replace(/@t\.(email|other)/g, reference => values[reference.slice(1)]),
    resolveLocator: value => value, resolveUrl: value => value, assertionTimeout: 500
  });
  // This exact syntax was accepted from the Automation Engineer. No source
  // rewrite or automatic repair should be needed to execute its parameters.
  await page.locator('input#email').fill('@t.email');
  await expect(page.locator('input#email')).toHaveValue('@t.email');
  await expect(page.locator('input#email')).not.toHaveValue('@t.other');
  await expect.soft(page.locator('input#email')).toHaveValue('@t.email');
  await expect.poll(() => page.locator('input#email').inputValue()).toBe('@t.email');
  await expect(page.locator('output')).toHaveText(/Ready/);
  values['t.email']='updated@example.test';
  await page.locator('input#email').fill('@t.email');
  await expect.configure({timeout:500})(page.locator('input#email')).toHaveValue('@t.email');
  assert.equal(await nativePage.locator('#email').inputValue(),values['t.email']);
});
