import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { captureAutomationBrowserSnapshot, assertAutomationBrowserCondition, automationBrowserTools } from '../../dist/lib/automationMcp.js';

const require = createRequire(import.meta.url);
const { createAutomationNavigationGrounding } = require('../../../../services/automation/backend/lib/automationNavigationGrounding.js');
const { projectModelSnapshot } = require('../../../../services/automation/backend/lib/automationBrowserModelTargets.js');
const { createBrowserParameterResolver } = require('../../../../services/automation/backend/lib/automationBrowserParameters.js');

test('real observed link destinations ground navigation with DOM-base semantics, bounded evidence and privacy intact', { timeout: 45_000 }, async t => {
  const domSecret = 'owned private+token', parameterSecret = 'source-private-query@token';
  const longPath = '/long?state=' + 'bounded'.repeat(60);
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', 'text/html');
    response.end(request.url === '/fixture' ? `<!doctype html><title>Observed link fixture</title><base href="/nested/"><main>
      <a id="relative" href="destination?mode=read#details">Destination</a>
      <a id="absolute" href="/absolute">Absolute destination</a>
      <span id="custom" role="link" tabindex="0" href="/custom">Custom destination</span>
      <button id="nonlink" href="/forged">Other action</button>
      <a id="long" href="${longPath}">Long destination</a>
      <a id="credentials" href="http://user:fixture-private@127.0.0.1/credential-route">Credentials</a>
      <a id="script" href="javascript:void(0)">Script</a><a id="mail" href="mailto:synthetic@example.test">Mail</a>
      <a id="hidden" hidden href="/hidden-route">Hidden destination</a>
      <input type="password" value="${domSecret}">
      <a id="private" href="/sensitive?source=${encodeURIComponent(domSecret)}">Private destination</a>
      <a id="form-private" href="/form-sensitive?${new URLSearchParams({ source: domSecret })}">Form-encoded private destination</a>
      <a id="parameter-private" href="/parameter-sensitive?source=${encodeURIComponent(parameterSecret)}">Configured private destination</a>
      ${['access_token', 'id_token', 'refresh_token', 'password', 'secret', 'api_key', 'authorization', 'otp', 'code'].map((key, index) => `<a id="credential-query-${index}" href="/credential-query?${key}=unmodeled-private-query-${index}">Protected destination ${index}</a>`).join('')}
      <a id="credential-fragment" href="/callback#access_token=unmodeled-private-fragment">Protected callback</a>
      <map name="fixture-map"><area id="map-area" alt="Mapped destination" href="/map-route" shape="rect" coords="0,0,10,10"></map>
      </main>` : '<!doctype html><title>Destination reached</title><h1>Destination reached</h1>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  t.after(async () => { await browser?.close(); await new Promise(resolve => server.close(resolve)); });
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
  const page = await browser.newPage(); await page.goto(origin + '/fixture');
  const before = await page.content(), raw = await captureAutomationBrowserSnapshot(page);
  const resolver = createBrowserParameterResolver({ caseValues: { 'r.query': parameterSecret }, privateParameterNames: ['r.query'] });
  const result = resolver.redactResult({ content: [{ type: 'text', text: JSON.stringify(raw) }] });
  const snapshot = JSON.parse(result.content[0].text);
  const row = id => snapshot.elements.find(element => element.attributes?.id === id);
  assert.equal(row('relative').attributes.href, origin + '/nested/destination?mode=read#details');
  assert.equal(row('absolute').attributes.href, origin + '/absolute');
  assert.equal(row('custom').attributes.href, origin + '/custom');
  assert.equal(row('map-area').attributes.href, origin + '/map-route');
  assert.equal(row('nonlink').attributes.href, undefined);
  for (const id of ['credentials', 'script', 'mail']) assert.equal(row(id).attributes.href, undefined);
  assert.equal(row('long').attributes.href, undefined, 'private snapshot omits an unusable URL excerpt that could clip a secret');
  assert.ok(row('long').truncated_attributes.includes('href'));
  for (let index = 0; index < 9; index++) assert.equal(row(`credential-query-${index}`).attributes.href, undefined);
  assert.equal(row('credential-fragment').attributes.href, undefined);
  assert.doesNotMatch(JSON.stringify(raw), /fixture-private|unmodeled-private-query-|unmodeled-private-fragment/);
  assert.doesNotMatch(JSON.stringify(raw), new RegExp(domSecret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.ok(!JSON.stringify(raw).includes(encodeURIComponent(domSecret)), 'URL encoding cannot expose a password through a new href field');
  assert.ok(!JSON.stringify(raw).includes(new URLSearchParams({ access_token: domSecret }).toString().slice('access_token='.length)), 'form encoding cannot expose a password through href');
  assert.ok(!JSON.stringify(snapshot).includes(parameterSecret)); assert.ok(!JSON.stringify(snapshot).includes(encodeURIComponent(parameterSecret)));

  const observation = { tool: 'browser_snapshot', execution_step_id: 'current', result };
  const guard = createAutomationNavigationGrounding({ startUrl: origin + '/fixture', execution: { step_id: 'current', action: 'Open the observed destination', expected_result: 'Destination content is displayed' } });
  for (const url of [origin + '/nested/destination?mode=read#details', origin + '/absolute', origin + '/custom']) {
    assert.equal(guard.inspect({ url, observations: [observation] }).allowed, true, url);
  }
  for (const url of [origin + '/destination?mode=read#details', origin + '/forged', origin + '/hidden-route', origin + longPath,
    (origin + longPath).slice(0, snapshot.limits.attribute_chars), row('private').attributes.href, row('form-private').attributes.href, row('parameter-private').attributes.href,
    'http://user:fixture-private@127.0.0.1/credential-route', 'javascript:void(0)', 'mailto:synthetic@example.test']) {
    assert.equal(guard.inspect({ url, observations: [observation] }).allowed, false, 'unsupported href cannot grant navigation');
  }
  const compact = projectModelSnapshot(observation);
  assert.ok(compact.targets.some(target => target.role === 'link'));
  assert.doesNotMatch(JSON.stringify(compact.targets), /"href"|access_token|credential-route|nested\/destination/);
  assert.doesNotMatch(JSON.stringify(guard.context([observation])), /unmodeled-private|credential-query|credential-fragment/);
  assert.equal(await page.content(), before, 'observation does not mutate page attributes');
  const permitted = guard.inspect({ url: origin + '/nested/destination?mode=read#details', observations: [observation] });
  await page.goto(permitted.url); assert.equal(await page.title(), 'Destination reached');
});

test('visible text assertions distinguish authored message fragments, descendant button text and hidden snapshot text', { timeout: 30_000 }, async t => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<!doctype html><div id="notice" role="alert"><p id="message">Invalid credentials<span hidden>hidden detail</span></p><button aria-label="Dismiss error">Dismiss</button></div>');
  const observed = await captureAutomationBrowserSnapshot(page);
  const notice = observed.elements.find(element => element.attributes?.id === 'notice');
  assert.match(notice.text, /hidden detail/);
  assert.equal(notice.visible_text, 'Invalid credentials Dismiss');
  assert.equal(notice.visible_text_truncated, false);
  const message = observed.elements.find(element => element.attributes?.id === 'message');
  assert.equal(message.evidence_kind, 'page_content');
  assert.equal(message.visible_text, 'Invalid credentials', 'ordinary outcome paragraphs retain visible text separately from hidden descendants');
  const check = (assertion, locator, value) => assertAutomationBrowserCondition(page, { assertion, locator, value }, { deadline: Date.now() + 150, origin: new URL(page.url()).origin });
  await assert.rejects(check('text', '#notice', 'Invalid credentials'), error => error.code === 'BROWSER_ASSERTION_NOT_SATISFIED');
  assert.equal((await check('text', '#notice', 'Invalid credentials Dismiss')).assertion_outcome, 'satisfied');
  assert.equal((await check('text', '#message', 'Invalid credentials')).assertion_outcome, 'satisfied');
  assert.equal((await check('text_contains', '#notice', 'Invalid credentials')).assertion_outcome, 'satisfied');
  assert.equal((await check('text_content_contains', '#message', 'hidden detail')).assertion_outcome, 'satisfied');
  const guidance = automationBrowserTools.find(tool => tool.name === 'browser_assert').description;
  assert.match(guidance, /descendant text such as a Dismiss button/);
  assert.match(guidance, /retain explicit whole-container equality/);
  assert.match(guidance, /Do not copy volatile support references or IDs/);

  await page.setContent(`<div id="long-alert" role="alert">${'Visible '.repeat(100)}</div><div id="status" role="status">Ready</div><div id="hidden-alert" role="alert" hidden>Hidden notice</div>`);
  const bounded = await captureAutomationBrowserSnapshot(page);
  const longAlert = bounded.elements.find(element => element.attributes?.id === 'long-alert');
  assert.equal(longAlert.visible_text.length, bounded.limits.text_chars);
  assert.equal(longAlert.visible_text_truncated, true);
  assert.equal(bounded.fields_truncated, true);
  assert.equal(bounded.elements.find(element => element.attributes?.id === 'status').visible_text, undefined);
  assert.equal(bounded.elements.find(element => element.attributes?.id === 'hidden-alert'), undefined, 'hidden alerts do not gain new evidence');
});
