import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import Fastify from 'fastify';
import { createConnection } from '@playwright/mcp';
import { registerAutomationPlaywrightMcp, PLAYWRIGHT_MCP_ENDPOINT } from '../dist/lib/automationPlaywrightMcp.js';

const require = createRequire(import.meta.url);
const upstream = createRequire(require.resolve('@playwright/mcp/package.json'))('playwright');
const invoke = (app, method, params = {}, session, id = 1) => app.inject({ method: 'POST', url: PLAYWRIGHT_MCP_ENDPOINT,
  headers: session ? { 'mcp-session-id': session } : {}, payload: { jsonrpc: '2.0', ...(id === null ? {} : { id }), method, params } });

async function fixture(t, mode = 'fresh') {
  const prior = process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;
  process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = [prior, '127.0.0.1'].filter(Boolean).join(',');
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'site_session=created-by-navigation; HttpOnly; SameSite=Lax' });
    response.end('<!doctype html><h1>Guest application</h1><a href="/login">Sign in</a>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`, app = Fastify(), events = [], nativeResults = new Map();
  let browser, launches = 0;
  await registerAutomationPlaywrightMcp(app, async () => {}, {
    validateTarget: async () => ({ address: '127.0.0.1', port: server.address().port }),
    launchBrowser: async options => {
      launches++;
      browser = await upstream.chromium.launch({ ...options, executablePath: require('playwright').chromium.executablePath() });
      const newContext = browser.newContext.bind(browser);
      browser.newContext = async contextOptions => {
        const context = await newContext(contextOptions);
        if (mode === 'prepopulated') await context.addCookies([{ name: 'existing_session', value: 'private-initial-cookie', url }]);
        const storageState = context.storageState.bind(context);
        context.storageState = async options => {
          events.push({ kind: 'initial_storage', options, pageCount: context.pages().length });
          if (mode === 'unknown') throw Error('Private storage measurement failure');
          return storageState(options);
        };
        context.on('page', () => events.push({ kind: 'page' }));
        return context;
      };
      return browser;
    },
    createConnection: async (config, contextGetter) => {
      if (mode === 'imported') config.browser.contextOptions.storageState = { cookies: [{ name: 'imported_session', value: 'private-imported-cookie', domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }], origins: [] };
      if (mode === 'httpauth') config.browser.contextOptions.httpCredentials = { username: 'private-user', password: 'private-password' };
      const native = await createConnection(config, contextGetter), connect = native.connect.bind(native);
      native.connect = async transport => {
        const send = transport.send.bind(transport);
        transport.send = async message => { if (message.id !== undefined && message.result) nativeResults.set(message.id, JSON.stringify(message.result)); return send(message); };
        return connect(transport);
      };
      return native;
    }
  });
  t.after(async () => {
    await app.close(); await new Promise(resolve => server.close(resolve));
    if (prior === undefined) delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS; else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = prior;
  });
  const initialized = await invoke(app, 'initialize', { protocolVersion: '2025-03-26', clientInfo: { name: 'lifecycle-fixture', version: '1' }, capabilities: {}, _meta: { hellotest: { start_url: url } } });
  const session = initialized.headers['mcp-session-id']; assert.ok(session);
  await invoke(app, 'notifications/initialized', {}, session, null);
  return { app, url, session, initialized: initialized.json(), events, nativeResults, browser: () => browser, launches: () => launches };
}

test('actual lazy native context factory proves only its initial storage before navigation, retaining native results unchanged', { timeout: 45000 }, async t => {
  const f = await fixture(t);
  assert.equal(f.launches(), 0, 'MCP initialize does not create or claim a browser context');
  assert.equal(f.initialized._meta?.hellotest?.browser_context, undefined);
  assert.equal(f.initialized.result._meta?.hellotest?.browser_context, undefined);
  const list = (await invoke(f.app, 'tools/list', {}, f.session, 2)).json();
  assert.equal(f.launches(), 0); assert.equal(list._meta?.hellotest?.browser_context, undefined);
  const opened = (await invoke(f.app, 'tools/call', { name: 'browser_navigate', arguments: { url: f.url } }, f.session, 3)).json();
  assert.notEqual(opened.result.isError, true);
  assert.deepEqual(opened._meta.hellotest.browser_context, { schema: 'hellotest.browser-context.v1', owned: true, context_mode: 'fresh_isolated',
    initial_storage_empty: true, storage_state_loaded: false, created_before_navigation: true });
  assert.equal(JSON.stringify(opened.result), f.nativeResults.get(3), 'Host lifecycle metadata never rewrites the upstream native result');
  assert.deepEqual(f.events[0], { kind: 'initial_storage', options: { indexedDB: true }, pageCount: 0 });
  assert.ok(f.events.findIndex(event => event.kind === 'page') > 0);
  assert.ok((await f.browser().contexts()[0].cookies()).some(cookie => cookie.name === 'site_session'), 'The application genuinely creates a cookie after the initial measurement');
  const snapshot = (await invoke(f.app, 'tools/call', { name: 'browser_snapshot', arguments: {} }, f.session, 4)).json();
  assert.equal(snapshot._meta.hellotest.browser_context.initial_storage_empty, true, 'Initial lifecycle evidence remains historical when site cookies exist');
  assert.equal(f.events.filter(event => event.kind === 'initial_storage').length, 1, 'Never infer initial cleanliness by remeasuring post-navigation storage');
  assert.equal(JSON.stringify(snapshot.result), f.nativeResults.get(4));
  assert.doesNotMatch(JSON.stringify(snapshot._meta), /site_session|created-by-navigation|cookies|origins|private-/);
});

test('nonempty or unknown initial storage cannot claim emptiness, and imported or preauthenticated options cannot issue the fresh-context receipt', { timeout: 90000 }, async t => {
  for (const mode of ['prepopulated', 'unknown', 'imported', 'httpauth']) await t.test(mode, async t => {
    const f = await fixture(t, mode);
    const response = (await invoke(f.app, 'tools/call', { name: 'browser_navigate', arguments: { url: f.url } }, f.session, 3)).json();
    assert.notEqual(response.result.isError, true, 'Unavailable optional lifecycle evidence does not fail native navigation');
    assert.equal(JSON.stringify(response.result), f.nativeResults.get(3));
    const receipt = response._meta?.hellotest?.browser_context;
    if (['imported', 'httpauth'].includes(mode)) { assert.equal(receipt, undefined); assert.equal(f.events.some(event => event.kind === 'initial_storage'), false); }
    else { assert.equal(receipt.initial_storage_empty, false); assert.equal(receipt.storage_state_loaded, false); }
    assert.doesNotMatch(JSON.stringify(response._meta || {}), /private-|existing_session|imported_session|password|cookies|origins/);
  });
});
