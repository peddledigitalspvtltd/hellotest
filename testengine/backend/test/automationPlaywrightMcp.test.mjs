import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { existsSync } from 'node:fs';
import http from 'node:http';
import { chromium as runChromium } from 'playwright';
import { createRequire } from 'node:module';
import { registerAutomationPlaywrightMcp, PLAYWRIGHT_MCP_ENDPOINT } from '../dist/lib/automationPlaywrightMcp.js';
import { createPrivilegedRunGuard, resolveTestEngineSharedSecret } from '../dist/lib/testEngineSecurity.js';

const headers = { 'x-hellotest-testengine-secret': 'upstream-fixture-secret' };
const initialize = (start_url = 'https://example.com', extra = {}) => ({
  protocolVersion: '2025-03-26', clientInfo: { name: 'upstream-runtime-fixture', version: '1' },
  capabilities: {}, _meta: { hellotest: { start_url, ...extra } }
});
const guard = () => createPrivilegedRunGuard(resolveTestEngineSharedSecret({ TESTENGINE_SHARED_SECRET: headers['x-hellotest-testengine-secret'] }));
const invoke = (app, method, params = {}, session, id = 1) => app.inject({
  method: 'POST', url: PLAYWRIGHT_MCP_ENDPOINT,
  headers: { ...headers, ...(session ? { 'mcp-session-id': session } : {}) },
  payload: { jsonrpc: '2.0', ...(id === null ? {} : { id }), method, params }
});
const allowFixture = async () => ({ address: '127.0.0.1', port: 80 });
const fixtureBrowser = process.env.PLAYWRIGHT_EXECUTABLE_PATH || runChromium.executablePath();

test('official MCP negotiation, schemas and errors pass through behind engine authentication', async t => {
  const app = Fastify();
  await registerAutomationPlaywrightMcp(app, guard(), { validateTarget: allowFixture });
  t.after(() => app.close());
  assert.equal((await app.inject({ method: 'POST', url: PLAYWRIGHT_MCP_ENDPOINT, payload: {} })).statusCode, 401);
  assert.equal((await app.inject({ method: 'GET', url: PLAYWRIGHT_MCP_ENDPOINT, headers })).statusCode, 405);
  const initialized = await invoke(app, 'initialize', initialize());
  const session = initialized.headers['mcp-session-id'];
  assert.ok(session);
  assert.equal(initialized.json().result.protocolVersion, '2025-03-26');
  assert.equal(initialized.json().result.serverInfo.name, 'api');
  assert.equal(initialized.json().result.serverInfo.version, '1.65.0-alpha-2026-10-30');
  assert.deepEqual(initialized.json().result._meta.hellotest, { provider: 'playwright_mcp_upstream', upstream_package: '@playwright/mcp', upstream_version: '0.0.84', assertion_timeout_ms: 10000, navigation_timeout_ms: 30000 });
  assert.equal((await invoke(app, 'notifications/initialized', {}, session, null)).statusCode, 202);
  const listed = (await invoke(app, 'tools/list', {}, session)).json().result.tools;
  for (const name of ['browser_snapshot', 'browser_click', 'browser_type', 'browser_fill_form', 'browser_tabs', 'browser_handle_dialog',
    'browser_verify_text_visible', 'browser_verify_value', 'browser_generate_locator', 'browser_run_code_unsafe']) assert.ok(listed.some(tool => tool.name === name), name);
  const click = listed.find(tool => tool.name === 'browser_click');
  assert.ok(click.inputSchema.properties.target);
  assert.equal(click.inputSchema.properties.locator, undefined);
  assert.equal(listed.some(tool => tool.name === 'browser_assert'), false);
  assert.equal((await invoke(app, 'resources/list', {}, session)).json().error.code, -32601);
  assert.equal((await invoke(app, 'ping', {}, session)).json().result.constructor, Object);
  assert.equal((await app.inject({ method: 'DELETE', url: PLAYWRIGHT_MCP_ENDPOINT, headers: { ...headers, 'mcp-session-id': session } })).statusCode, 204);
  assert.equal((await invoke(app, 'tools/list', {}, session)).statusCode, 404);
});

test('private destinations and malformed native secret configuration fail before a browser launches', async t => {
  const app = Fastify();
  let launches = 0;
  await registerAutomationPlaywrightMcp(app, guard(), { launchBrowser: async () => { launches++; throw Error('Unexpected browser'); } });
  t.after(() => app.close());
  const denied = await invoke(app, 'initialize', initialize('http://169.254.169.254/'));
  assert.equal(denied.json().error.code, -32602);
  assert.equal(denied.headers['mcp-session-id'], undefined);
  const malformed = await invoke(app, 'initialize', initialize('https://example.com', { secrets: { TOKEN: 1234 } }));
  assert.equal(malformed.json().error.message, 'Invalid native secret configuration');
  const invalidPreview = await invoke(app, 'initialize', initialize('https://example.com', { capture_preview: 'true' }));
  assert.equal(invalidPreview.json().error.message, 'Invalid browser preview configuration');
  assert.equal(launches, 0);
});

test('case preview captures only the actual upstream browser and masks private pixels across frames without changing native tool content', { skip: !existsSync(fixtureBrowser), timeout: 90_000 }, async t => {
  const previous = process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;
  process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = [previous, '127.0.0.1'].filter(Boolean).join(',');
  const secret = 'private-preview-fixture-value';
  const box = 'position:absolute;left:20px;width:200px;height:40px;background:rgb(255,0,0);margin:0;padding:0;border:0';
  const server = http.createServer((request, reply) => {
    reply.writeHead(200, { 'content-type': 'text/html' });
    reply.end(request.url === '/frame' ? `<div style="${box};top:0px">${secret}</div>` : `<!doctype html><title>Preview fixture</title>
      <input type="password" value="${secret}" style="${box};top:20px">
      <textarea style="${box};top:80px">private text</textarea>
      <div contenteditable style="${box};top:140px">private editor</div>
      <div data-sensitive style="${box};top:200px">private panel</div>
      <div style="${box};top:260px">${secret}</div>
      <iframe src="/frame" style="position:absolute;left:0;top:320px;width:300px;height:100px;border:0"></iframe>
      <div id="public" style="${box};top:440px">Public page</div>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const require = createRequire(import.meta.url);
  const upstream = createRequire(require.resolve('@playwright/mcp/package.json'))('playwright');
  const app = Fastify();
  let browser, launches = 0;
  await registerAutomationPlaywrightMcp(app, guard(), { launchBrowser: async options => { launches++; return browser = await upstream.chromium.launch({ ...options, executablePath: fixtureBrowser }); } });
  t.after(async () => {
    await app.close();await new Promise(resolve => server.close(resolve));
    if (previous === undefined) delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = previous;
  });
  const sid = (await invoke(app, 'initialize', initialize(url, { capture_preview: true, secrets: { PREVIEW_PRIVATE: secret } }))).headers['mcp-session-id'];
  const response = (await invoke(app, 'tools/call', { name: 'browser_navigate', arguments: { url } }, sid)).json();
  assert.notEqual(response.result.isError, true);
  const preview = response._meta?.hellotest?.browser_preview;
  assert.ok(preview?.content?.[0]?.data, 'case UI receives a bounded masked image');
  assert.equal(preview.url, url);
  assert.equal(preview.tool, 'browser_navigate');
  assert.equal(response.result.content.some(part => part.type === 'image'), false, 'native model content remains unchanged');
  assert.match(response.result.content[0].text, /### Ran Playwright code/);
  assert.equal(launches, 1, 'preview reuses the actual native session');
  const page = browser.contexts()[0].pages()[0];
  const pixels = await page.evaluate(async ({ data }) => {
    const image = new Image();image.src = `data:image/jpeg;base64,${data}`;await image.decode();
    const canvas = document.createElement('canvas');canvas.width = image.width;canvas.height = image.height;
    const context = canvas.getContext('2d');context.drawImage(image, 0, 0);
    return [40,100,160,220,280,340,460].map(y => [...context.getImageData(60, y, 1, 1).data].slice(0,3));
  }, { data: preview.content[0].data });
  for (const pixel of pixels.slice(0,6)) assert.ok(pixel.every(channel => channel >= 10 && channel <= 25), `private pixel masked: ${pixel}`);
  assert.ok(pixels[6][0] > 200 && pixels[6][1] < 40, 'public page remains visible');
  const newTab = (await invoke(app, 'tools/call', { name: 'browser_tabs', arguments: { action: 'new', url } }, sid)).json();
  assert.notEqual(newTab.result.isError, true);
  const secondPage = browser.contexts()[0].pages()[1];
  await secondPage.evaluate(() => { document.querySelector('#public').style.background = 'rgb(0,255,0)'; });
  const selectedTab = (await invoke(app, 'tools/call', { name: 'browser_tabs', arguments: { action: 'select', index: 0 } }, sid)).json();
  assert.notEqual(selectedTab.result.isError, true);
  assert.match(selectedTab.result.content[0].text, /0: \(current\)/);
  const selectedImage = selectedTab._meta?.hellotest?.browser_preview?.content[0]?.data;
  assert.ok(selectedImage, 'selected native tab has a new capture');
  const selectedPixel = await page.evaluate(async data => {
    const image = new Image();image.src = `data:image/jpeg;base64,${data}`;await image.decode();
    const canvas = document.createElement('canvas');canvas.width = image.width;canvas.height = image.height;
    const context = canvas.getContext('2d');context.drawImage(image, 0, 0);
    return [...context.getImageData(60, 460, 1, 1).data].slice(0,3);
  }, selectedImage);
  assert.ok(selectedPixel[0] > 200 && selectedPixel[1] < 40, 'preview follows the selected native tab even when two tabs have the same URL');
  t.mock.method(page, 'screenshot', async () => { throw Error('Preview capture unavailable'); });
  const withoutImage = (await invoke(app, 'tools/call', { name: 'browser_snapshot', arguments: {} }, sid)).json();
  assert.notEqual(withoutImage.result.isError, true, 'optional display failure cannot fail a confirmed native read');
  assert.equal(withoutImage._meta, undefined, 'failed capture never emits unmasked or stale pixels');
  assert.equal(launches, 1, 'capture failure never creates a replacement browser or replays navigation');
});

test('session capacity, ownership and idle expiry remain isolated', async t => {
  const app = Fastify();
  let proxies = 0;
  let closed = 0;
  await registerAutomationPlaywrightMcp(app, guard(), { validateTarget: allowFixture, sessionTtlMs: 60, maxSessions: 1,
    createProxy: async () => { proxies++; return { server: 'http://127.0.0.1:1234', close: async () => { closed++; } }; } });
  t.after(() => app.close());
  const first = await invoke(app, 'initialize', initialize());
  const sid = first.headers['mcp-session-id'];
  assert.equal((await invoke(app, 'initialize', initialize())).statusCode, 429);
  await new Promise(resolve => setTimeout(resolve, 85));
  assert.equal((await invoke(app, 'tools/list', {}, sid)).statusCode, 404);
  const second = await invoke(app, 'initialize', initialize());
  assert.ok(second.headers['mcp-session-id']);
  assert.notEqual(second.headers['mcp-session-id'], sid);
  assert.equal(proxies, 2);
  await app.close();
  assert.equal(closed, 2);
});

test('deadline invalidates the owned browser context and closes late launch without replay', async t => {
  const app = Fastify();
  let launches = 0, browserCloses = 0, proxyCloses = 0, release;
  const started = new Promise(resolve => { release = resolve; });
  await registerAutomationPlaywrightMcp(app, guard(), { validateTarget: allowFixture, toolTimeoutMs: 40,
    createProxy: async () => ({ server: 'http://127.0.0.1:1234', close: async () => { proxyCloses++; } }),
    launchBrowser: async () => { launches++; await started; return { close: async () => { browserCloses++; }, newContext: async () => { throw Error('Late launch must close before creating context'); } }; }
  });
  t.after(() => app.close());
  const sid = (await invoke(app, 'initialize', initialize())).headers['mcp-session-id'];
  const response = await invoke(app, 'tools/call', { name: 'browser_navigate', arguments: { url: 'https://example.com' } }, sid);
  assert.equal(response.json().error.code, -32000);
  assert.equal((await invoke(app, 'tools/list', {}, sid)).statusCode, 404);
  release();
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(launches, 1);
  assert.equal(browserCloses, 1);
  assert.equal(proxyCloses, 1);
});

test('real upstream browser performs native snapshot, type, click, assertions and emits original code', { skip: !existsSync(fixtureBrowser), timeout: 90_000 }, async t => {
  const previous = process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;
  process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = [previous, '127.0.0.1'].filter(Boolean).join(',');
  const foreignHits = [];
  const foreign = http.createServer((request, reply) => { foreignHits.push({ path: request.url, destination: request.headers['sec-fetch-dest'] }); reply.end('Outside the application'); });
  await new Promise(resolve => foreign.listen(0, '127.0.0.1', resolve));
  const foreignUrl = `http://127.0.0.1:${foreign.address().port}/`;
  const server = http.createServer((request, reply) => {
    if (request.url === '/redirect-chain') { reply.writeHead(302, { location: '/redirect-out' }); reply.end(); return; }
    if (request.url === '/redirect-out') { reply.writeHead(302, { location: foreignUrl }); reply.end(); return; }
    if (request.url === '/unauthorized') { reply.writeHead(401, { 'content-type': 'text/html' }); reply.end('<title>Login required</title><h1>Sign in</h1>'); return; }
    reply.writeHead(200, { 'content-type': 'text/html' });
    reply.end('<!doctype html><title>Upstream Fixture</title><label>Name<input aria-label="Name"></label><button onclick="document.querySelector(\'output\').textContent=\'Saved \'+document.querySelector(\'input\').value">Save</button><button onclick="window.open(\'/redirect-chain\')">Popup</button><output aria-live="polite"></output>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const require = createRequire(import.meta.url);
  const upstream = createRequire(require.resolve('@playwright/mcp/package.json'))('playwright');
  const app = Fastify();
  let browser;
  await registerAutomationPlaywrightMcp(app, guard(), { launchBrowser: async options => (browser = await upstream.chromium.launch({ ...options, executablePath: fixtureBrowser })) });
  t.after(async () => {
    await app.close();
    await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => foreign.close(resolve));
    if (previous === undefined) delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;
    else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = previous;
  });
  const sid = (await invoke(app, 'initialize', initialize(url, { secrets: { HELLOTEST_R_NAME: 'super-private-native-fixture' } }))).headers['mcp-session-id'];
  const call = async (name, args = {}) => {
    const result = (await invoke(app, 'tools/call', { name, arguments: args }, sid)).json().result;
    assert.notEqual(result?.isError, true, JSON.stringify(result));
    return result.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
  };
  const navigation = await call('browser_navigate', { url });
  assert.match(navigation, /### Ran Playwright code/);
  assert.match(navigation, /await page.goto/);
  const snapshot = await call('browser_snapshot');
  const input = snapshot.match(/textbox "Name" \[ref=([^\]]+)\]/)?.[1];
  const button = snapshot.match(/button "Save" \[ref=([^\]]+)\]/)?.[1];
  const popupButton = snapshot.match(/button "Popup" \[ref=([^\]]+)\]/)?.[1];
  assert.ok(input, snapshot);
  assert.ok(button, snapshot);
  const typed = await call('browser_type', { target: input, text: 'Ada' });
  assert.match(typed, /getByRole\('textbox', \{ name: 'Name' \}\)\.fill\('Ada'\)/);
  const clicked = await call('browser_click', { target: button });
  assert.match(clicked, /getByRole\('button', \{ name: 'Save' \}\)\.click/);
  const verified = await call('browser_verify_text_visible', { text: 'Saved Ada' });
  assert.match(verified, /await expect/);
  assert.match(verified, /toBeVisible/);
  const generated = await call('browser_generate_locator', { target: button });
  assert.match(generated, /getByRole\('button', \{ name: 'Save' \}\)/);
  const secretInput = await call('browser_type', { target: input, text: 'HELLOTEST_R_NAME' });
  assert.match(secretInput, /fill\(process\.env\['HELLOTEST_R_NAME'\]\)/);
  assert.doesNotMatch(secretInput, /super-private-native-fixture/);
  const secretSnapshot = await call('browser_snapshot');
  assert.doesNotMatch(secretSnapshot, /super-private-native-fixture/);
  assert.match(secretSnapshot, /<secret>HELLOTEST_R_NAME<\/secret>/);
  await call('browser_click', { target: popupButton });
  const login = await call('browser_navigate', { url: `${url}unauthorized` });
  assert.match(login, /Login required|Sign in/);
  const direct = (await invoke(app, 'tools/call', { name: 'browser_navigate', arguments: { url: foreignUrl } }, sid)).json().result;
  assert.equal(direct.isError, true);
  const redirected = (await invoke(app, 'tools/call', { name: 'browser_navigate', arguments: { url: `${url}redirect-chain` } }, sid)).json().result;
  assert.equal(redirected.isError, true);
  const newTab = (await invoke(app, 'tools/call', { name: 'browser_tabs', arguments: { action: 'new', url: `${url}redirect-chain` } }, sid)).json().result;
  assert.equal(newTab.isError, true);
  assert.deepEqual(foreignHits, [], 'cross-origin direct and chained redirect navigation never reach their destination');
  await app.inject({ method: 'DELETE', url: PLAYWRIGHT_MCP_ENDPOINT, headers: { ...headers, 'mcp-session-id': sid } });
  assert.equal(browser.isConnected(), false, 'DELETE owns and closes the actual upstream browser');
});
