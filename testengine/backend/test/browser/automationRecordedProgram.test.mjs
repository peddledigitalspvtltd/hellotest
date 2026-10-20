import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { registerAutomationMcp } from '../../dist/lib/automationMcp.js';
import { createPlaywrightCodeBindings } from '../../dist/lib/playwrightBindings.js';
import { resolveRepositoryLocator } from '../../dist/lib/repositoryLocator.js';
import { createPrivilegedRunGuard, resolveTestEngineSharedSecret } from '../../dist/lib/testEngineSecurity.js';

const require = createRequire(import.meta.url);
const { compileRecordedProgram, recordedLocatorSource } = require('../../../../services/automation/backend/lib/automationRecordedProgram.js');
const { connectAutomationBrowser } = require('../../../../services/automation/backend/lib/automationBrowserAgent.js');
const { createBrowserParameterResolver } = require('../../../../services/automation/backend/lib/automationBrowserParameters.js');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

test('compiler locator rendering has the same method, arguments and explicit index as the actual TestEngine resolver', () => {
  const fixture = () => {
    const calls = [], locator = {};
    for (const method of ['nth', 'first', 'last']) locator[method] = (...args) => { calls.push([method, args]); return locator; };
    const page = new Proxy({}, { get: (_target, method) => (...args) => { if (args.at(-1) === undefined) args.pop(); calls.push([method, args]); return locator; } });
    return { calls, page };
  };
  const cases = ['#email', 'XPATH=//input', 'locator("#email")', 'locator("#email",{})', 'getByLabel("Email")',
    'getByRole("button",{name:"Sign up"})', 'getByRole("button",{name:"Sign up",exact:false})', 'getByRole("button")',
    'PAGE.GETBYROLE("button",{name:"Sign up"})', 'getByText(`Ready`)', 'getByTestId("submit")', 'getByTestId("submit",{})',
    'getByPlaceholder("Your email")', 'getByTitle("Help")', 'getByAltText("Logo")', 'role=button', 'role=button[name="Save"]',
    'role=button[name="Save exact:false"]', 'text="Ready"', 'label="Email"', 'label=Email exact:false', 'placeholder="Email"',
    'title="Help"', 'alt="Logo"', 'alttext="Logo"', 'testid=submit', 'data-testid=submit', 'getByLabel("Email").last()',
    'getByRole("button").first()', '#items > button.nth(2)'];
  for (const input of cases) {
    const actual = fixture(), compiled = fixture(), source = recordedLocatorSource(input);
    assert.ok(source, input);
    resolveRepositoryLocator(actual.page, input);
    new Function('page', `return ${source};`)(compiled.page);
    assert.deepEqual(compiled.calls, actual.calls, input);
  }
});

test('confirmed MCP actions compile to unchanged portable source that replays with native Playwright, scoped parameters and exact assertion semantics', { timeout: 60_000 }, async t => {
  const previous = process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;
  process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = '127.0.0.1';
  t.after(() => { if (previous === undefined) delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS; else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = previous; });
  const app = Fastify();
  app.get('/entry', async (_req, reply) => reply.type('text/html').send(`<!doctype html><meta charset="utf-8"><title>  Sign\u200b   up  </title>
    <button onclick="document.querySelector('#signup').hidden=false;this.hidden=true">Sign up</button><button>Sign up later</button>
    <main id="signup" hidden><label>Full name<input id="name"></label><label>Email<input id="email"></label>
    <label>Newsletter<input id="newsletter" type="checkbox"></label><label>Country<select id="country"><option value="IN">India</option></select></label>
    <p id="visible-result">Account <span hidden>private hidden detail</span> created</p><p class="row">One</p><p class="row">Two</p>
    <button id="create">Create account</button></main>`));
  await registerAutomationMcp(app, createPrivilegedRunGuard(resolveTestEngineSharedSecret()));
  const base = await app.listen({ host: '127.0.0.1', port: 0 }); t.after(() => app.close());
  const original = [
    { name: 'browser_navigate', arguments: { url: `${base}/entry` } },
    { name: 'browser_click', arguments: { locator: 'getByRole("button",{name:"Sign up"})' } },
    { name: 'browser_fill', arguments: { locator: 'getByLabel("Full name")', value: '@t.name' } },
    { name: 'browser_fill', arguments: { locator: '#email', value: '@t.email' } },
    { name: 'browser_select_option', arguments: { locator: '#country', value: 'IN' } },
    { name: 'browser_assert', arguments: { assertion: 'value', locator: '#name', value: '@t.name' } },
    { name: 'browser_assert', arguments: { assertion: 'visible', locator: '#signup' } },
    { name: 'browser_assert', arguments: { assertion: 'unchecked', locator: '#newsletter' } },
    { name: 'browser_assert', arguments: { assertion: 'enabled', locator: '#create' } },
    { name: 'browser_assert', arguments: { assertion: 'count', locator: '.row', value: '2' } },
    { name: 'browser_assert', arguments: { assertion: 'text', locator: '#visible-result', value: ' Account\ncreated ' } },
    { name: 'browser_assert', arguments: { assertion: 'text_content_contains', locator: '#visible-result', value: 'private hidden detail' } },
    { name: 'browser_assert', arguments: { assertion: 'title', value: 'Sign\u200b up' } },
    { name: 'browser_assert', arguments: { assertion: 'title_normalized', value: ' Sign up ' } },
    { name: 'browser_assert', arguments: { assertion: 'url_contains', value: '/entry' } }
  ];
  const data = createBrowserParameterResolver({ caseValues: { 't.name': 'Owned test name', 't.email': 'owned-private@example.test' } });
  const session = await connectAutomationBrowser({ integration: { base_url: base }, startUrl: `${base}/entry`, allowBrowserActions: true });
  t.after(() => session.close());
  const confirmed = [];
  for (const request of original) {
    const result = await session.call(request.name, data.resolve(request.name, request.arguments));
    assert.ok(!result.isError, JSON.stringify({ request, result }));
    confirmed.push(request);
  }
  await session.close();
  const compiled = compileRecordedProgram(confirmed);
  assert.ok(compiled); assert.equal(compiled.operation_count, original.length); assert.equal(compiled.assertion_count, 10);
  assert.doesNotMatch(compiled.source, /Owned test name|owned-private@example/);
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const params = { 't.name': 'Owned test name', 't.email': 'owned-private@example.test' };
  const bindings = createPlaywrightCodeBindings(page, { interpolate: value => value.replace(/@[tsr]\.[A-Za-z][A-Za-z0-9_-]*/g, key => params[key.slice(1)] ?? key), resolveLocator: value => value, resolveUrl: value => value, assertionTimeout: 500 });
  await new AsyncFunction('page', 'expect', 'params', compiled.source)(bindings.page, bindings.expect, params);
  assert.equal(await page.locator('#name').inputValue(), params['t.name']);
  assert.equal(await page.locator('#email').inputValue(), params['t.email']);
  assert.equal(await page.locator('#signup').isVisible(), true);
  const invalidRawTitle = compileRecordedProgram([{ name: 'browser_assert', arguments: { assertion: 'title', value: 'Sign up' } }]);
  await assert.rejects(new AsyncFunction('page', 'expect', 'params', invalidRawTitle.source)(bindings.page, bindings.expect, params), /toBe/);
  const nativeTextMismatch = compileRecordedProgram([{ name: 'browser_assert', arguments: { assertion: 'text_content', locator: '#visible-result', value: 'Account created' } }]);
  await assert.rejects(new AsyncFunction('page', 'expect', 'params', nativeTextMismatch.source)(bindings.page, bindings.expect, params), /toHaveText/);
});
