import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { createRequire } from 'node:module';
import { registerAutomationPlaywrightMcp, PLAYWRIGHT_MCP_ENDPOINT } from '../../dist/lib/automationPlaywrightMcp.js';

const require = createRequire(import.meta.url);
const upstream = createRequire(require.resolve('@playwright/mcp/package.json'))('playwright');
const { preActionSelectorError } = require('../../../../services/automation/backend/lib/automationUpstreamEngineer.js');
const invoke = (app, method, params, session, id = 1) => app.inject({ method: 'POST', url: PLAYWRIGHT_MCP_ENDPOINT,
  headers: session ? { 'mcp-session-id': session } : {}, payload: { jsonrpc: '2.0', id, method, params } });
const text = result => result.content.filter(block => block.type === 'text').map(block => block.text).join('\n');

test('pinned native stale-ref resolution performs no product click; fresh observation permits exactly one popup-opening click', { timeout: 45000 }, async t => {
  const prior = process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;
  process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = [prior, '127.0.0.1'].filter(Boolean).join(',');
  const app = Fastify(); let productRequests = 0;
  app.get('/', (_request, reply) => reply.type('text/html').send('<!doctype html><h1>Products</h1><section><div><a id="product" href="/product" target="_blank">Open product</a></div></section><button onclick="document.querySelector(\'#product\').replaceWith(document.querySelector(\'#product\').cloneNode(true))">Refresh controls</button>'));
  app.get('/product', (_request, reply) => { productRequests++; return reply.type('text/html').send('<h1>Product details</h1>'); });
  await registerAutomationPlaywrightMcp(app, async () => {}, { validateTarget: async () => ({ address: '127.0.0.1', port: 80 }),
    launchBrowser: options => upstream.chromium.launch({ ...options, executablePath: require('playwright').chromium.executablePath() }) });
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(async () => { await app.close(); if (prior === undefined) delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS; else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = prior; });
  const init = await invoke(app, 'initialize', { protocolVersion: '2025-03-26', clientInfo: { name: 'stale-ref-fixture', version: '1' }, capabilities: {}, _meta: { hellotest: { start_url: base + '/' } } });
  const session = init.headers['mcp-session-id']; assert.ok(session);
  const call = async (name, args = {}) => (await invoke(app, 'tools/call', { name, arguments: args }, session)).json().result;
  await invoke(app, 'notifications/initialized', {}, session, null);
  assert.notEqual((await call('browser_navigate', { url: base + '/' })).isError, true);
  const found = text(await call('browser_find', { text: 'Open product' }));
  const oldRef = found.match(/link "Open product" \[ref=([^\]]+)\]/)?.[1]; assert.ok(oldRef, found);
  // A depth-limited render does not itself change native DOM identities.
  await call('browser_snapshot', { depth: 1 });
  assert.notEqual((await call('browser_generate_locator', { target: oldRef })).isError, true);
  const refreshed = text(await call('browser_snapshot'));
  const refreshRef = refreshed.match(/button "Refresh controls" \[ref=([^\]]+)\]/)?.[1]; assert.ok(refreshRef, refreshed);
  await call('browser_snapshot', { target: refreshRef });
  const outsideScope = await call('browser_generate_locator', { target: oldRef });
  assert.equal(outsideScope.isError, true, 'A targeted native snapshot replaces the queried frame ref inventory outside its subtree');
  assert.match(text(outsideScope), /not found in the current page snapshot/);
  assert.equal(productRequests, 0);
  await call('browser_find', { text: 'Open product' });
  assert.notEqual((await call('browser_generate_locator', { target: oldRef })).isError, true, 'A fresh full-page find restores the still-connected element reference');
  assert.notEqual((await call('browser_click', { target: refreshRef })).isError, true);
  const stale = await call('browser_click', { target: oldRef });
  assert.equal(stale.isError, true);
  assert.match(text(stale), new RegExp(`(?:^|\\n)### Error\\s*\\nError: Ref ${oldRef} not found in the current page snapshot\\. Try capturing new snapshot\\.`));
  assert.doesNotMatch(text(stale), /### Ran Playwright code/);
  assert.equal(preActionSelectorError('browser_click', stale), true, 'The host recognizes only the proven pre-action native error');
  assert.equal(productRequests, 0, 'The stale reference failed before a click or product request');
  const fresh = text(await call('browser_find', { text: 'Open product' }));
  const newRef = fresh.match(/link "Open product" \[ref=([^\]]+)\]/)?.[1]; assert.ok(newRef, fresh); assert.notEqual(newRef, oldRef);
  const clicked = await call('browser_click', { target: newRef });
  assert.notEqual(clicked.isError, true, text(clicked));
  const deadline = Date.now() + 5000;
  while (productRequests === 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(productRequests, 1, 'Only the fresh native click opens the product popup');
});
