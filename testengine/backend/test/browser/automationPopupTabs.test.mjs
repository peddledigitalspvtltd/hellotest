import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createWebRunSession } from '../../dist/lib/webEngine.js';
import { registerAutomationPlaywrightMcp, PLAYWRIGHT_MCP_ENDPOINT } from '../../dist/lib/automationPlaywrightMcp.js';
import { buildPlaywrightArtifact } from '../../../../services/automation/shared/playwrightArtifact.mjs';
const require = createRequire(import.meta.url);
const { createUpstreamTabTracker, TAB_IDENTITY_SCHEMA } = require('../../../../services/automation/backend/lib/automationUpstreamTabs.js');
const invoke = (app, method, params, session, id = 1) => app.inject({ method: 'POST', url: PLAYWRIGHT_MCP_ENDPOINT,
  headers: session ? { 'mcp-session-id': session } : {}, payload: { jsonrpc: '2.0', id, method, params } });

async function fixture(t, setup = async () => {}) {
  const app = Fastify();
  let productRequests = 0;
  app.get('/search', (_req, reply) => reply.type('text/html').send('<!doctype html><title>Search results</title><h1>Search results</h1><a href="/product" target="_blank">Product</a><iframe id="original" src="/frame"></iframe>'));
  app.get('/product', async (_req, reply) => { productRequests++; await new Promise(resolve => setTimeout(resolve, 700)); return reply.type('text/html').send('<!doctype html><title>Product</title><h1>Product</h1><label>Quantity<input value="1"></label>'); });
  app.get('/frame', (_req, reply) => reply.type('text/html').send('<!doctype html><h2>Original frame</h2>'));
  await setup(app);
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(() => app.close());
  return { app, base, count: () => productRequests };
}

test('native MCP retains an opened popup and selects its actual page without replacing the click', { timeout: 45000 }, async t => {
  const prior = process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;
  process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = [prior, '127.0.0.1'].filter(Boolean).join(',');
  t.after(() => { if (prior === undefined) delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS; else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = prior; });
  const upstream = createRequire(require.resolve('@playwright/mcp/package.json'))('playwright');
  const f = await fixture(t, app => registerAutomationPlaywrightMcp(app, async () => {}, { validateTarget: async () => ({ address: '127.0.0.1', port: 80 }),
    launchBrowser: options => upstream.chromium.launch({ ...options, executablePath: require('playwright').chromium.executablePath() }) }));
  const init = await invoke(f.app, 'initialize', { protocolVersion: '2025-03-26', clientInfo: { name: 'popup-fixture', version: '1' }, capabilities: {}, _meta: { hellotest: { start_url: f.base + '/search' } } });
  const session = init.headers['mcp-session-id']; assert.ok(session);
  await invoke(f.app, 'notifications/initialized', {}, session, null);
  const opened = (await invoke(f.app, 'tools/call', { name: 'browser_navigate', arguments: { url: f.base + '/search' } }, session)).json().result;
  assert.notEqual(opened.isError, true, JSON.stringify(opened));
  const read = (await invoke(f.app, 'tools/call', { name: 'browser_snapshot', arguments: {} }, session)).json().result;
  const initial = read.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
  const ref = initial.match(/link "Product" \[ref=([^\]]+)\]/)?.[1]; assert.ok(ref, initial);
  const clicked = (await invoke(f.app, 'tools/call', { name: 'browser_click', arguments: { target: ref } }, session)).json().result;
  assert.notEqual(clicked.isError, true, JSON.stringify(clicked));
  let listed;
  const deadline = Date.now() + 5000;
  do {
    listed = (await invoke(f.app, 'tools/call', { name: 'browser_tabs', arguments: { action: 'list' } }, session)).json().result;
    if (/1:.*\/product/.test(listed.content[0].text)) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  assert.match(listed.content[0].text, /0: \(current\)/, 'opening a popup does not silently change the native selected tab');
  assert.match(listed.content[0].text, /1:.*\/product/);
  const selected = (await invoke(f.app, 'tools/call', { name: 'browser_tabs', arguments: { action: 'select', index: 1 } }, session)).json().result;
  assert.match(selected.content[0].text, /1: \(current\)/);
  const snapshot = (await invoke(f.app, 'tools/call', { name: 'browser_snapshot', arguments: {} }, session)).json().result;
  assert.match(snapshot.content[0].text, /heading "Product"/);
  assert.equal(f.count(), 1, 'the native product opening was not replayed as a direct navigation');
});

test('saved native sections and standalone export follow a delayed popup and reject mismatched tab identity', { timeout: 60000 }, async t => {
  const f = await fixture(t), directory = await mkdtemp(path.join(tmpdir(), 'qaira-popup-runtime-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = `await expect(page).toHaveURL(${JSON.stringify(f.base + '/search')});
await expect(page).toHaveURL(/search$/);
await expect(page).toHaveTitle("Search results");
expect(page.constructor.name).not.toMatch(/^bound /);
const originalFrame = page.frameLocator("#original").getByRole("heading",{name:"Original frame"});
await expect(originalFrame).toBeVisible();
await page.getByRole("link",{name:"Product",exact:true}).click();
await web.switchTab({index:1,url:${JSON.stringify(f.base + '/product')}});
expect(page.constructor.name).not.toMatch(/^bound /);
await expect(page).toHaveURL(${JSON.stringify(f.base + '/product')});
await expect(page).toHaveURL(/product$/);
await expect(page).toHaveTitle("Product");
await expect.soft(page).toHaveTitle("Product");
await expect(page.getByRole("heading",{name:"Product",exact:true})).toBeVisible();
await expect(originalFrame).toBeVisible();`;
  const guards = `for (const url of ${JSON.stringify([f.base + '/product-evil', 'https://foreign.test/?next=' + f.base + '/product'])}) {
let rejected=false;try{await web.switchTab({index:1,url});}catch{rejected=true;}
expect(rejected).toBe(true);
await expect(page.getByRole("heading",{name:"Product",exact:true})).toBeVisible();}`;
  const steps = [{ id: 'popup', order: 1, step_order: 1, step_type: 'web', action: 'Open product in its new tab', expected_result: 'Product is visible', automation_code: source },
    { id: 'following', order: 2, step_order: 2, step_type: 'web', action: 'Read current product', expected_result: 'Quantity is one', automation_code: 'await expect(page).toHaveTitle("Product"); await expect(page.getByLabel("Quantity")).toHaveValue("1");' },
    { id: 'identity', order: 3, step_order: 3, step_type: 'web', action: 'Retain selected tab identity', expected_result: 'Mismatches cannot select a different page', automation_code: guards }];
  const failingChecks = ['toHaveTitle("Wrong title", {timeout:100})', `toHaveURL(${JSON.stringify(f.base + '/wrong')}, {timeout:100})`, 'toHaveURL(/wrong$/, {timeout:100})'].map((matcher, index) => ({
    id: `failing-page-${index}`, order: 4 + index, step_order: 4 + index, step_type: 'web', action: 'Check an incorrect Page expectation',
    expected_result: 'The native Page assertion fails', automation_code: `await expect(page).${matcher};`
  }));
  const run = createWebRunSession({ engine_run_id: randomUUID(), browser: 'chromium', headless: true, web_engine: { active: 'playwright' },
    environment: { base_url: f.base + '/search' }, timeouts: { navigation_timeout_ms: 5000, assertion_timeout_ms: 2000 },
    run_timeout_seconds: 30, max_repair_attempts: 0, artifact_policy: { trace_mode: 'off', video_mode: 'off', screenshot_on_success: false, screenshot_on_failure: false, capture_console: false, capture_network: false }, steps: [...steps, ...failingChecks] });
  try {
    await run.start();
    for (const step of steps) { const result = await run.runStep(step); assert.equal(result.status, 'passed', result.note); }
    for (const step of failingChecks) {
      const result = await run.runStep(step);
      assert.equal(result.status, 'failed', step.automation_code);
      assert.match(result.note, /Error: expect\(page\)\.toHave(?:Title|URL)\(expected\) failed/);
      assert.match(result.note, /\nReceived(?: string)?:/);
      assert.doesNotMatch(result.note, /can be only used with Page/);
    }
  } finally { await run.stop('failed'); }
  assert.equal(f.count(), 1);
  const artifact = buildPlaywrightArtifact({ testCase: { id: 'popup', title: 'Popup execution' }, steps, rows: [{}], baseURL: f.base + '/search' });
  const code = typeof artifact === 'string' ? artifact : artifact.code;
  assert.ok(code && code.includes('switchTab'), JSON.stringify(Object.keys(artifact || {})));
  const spec = path.join(directory, 'popup.spec.ts');
  await writeFile(spec, code.replace("'@playwright/test'", JSON.stringify(fileURLToPath(new URL('../../node_modules/playwright/test.mjs', import.meta.url)))));
  await writeFile(path.join(directory, 'playwright.config.cjs'), 'module.exports=' + JSON.stringify({ testDir: directory, testMatch: '*.spec.ts', workers: 1, reporter: 'json', use: { headless: true } }));
  const output = await new Promise(resolve => { let text = ''; const child = spawn(process.execPath, [fileURLToPath(new URL('../../node_modules/playwright/cli.js', import.meta.url)), 'test', '--config', path.join(directory, 'playwright.config.cjs')]); child.stdout.on('data', data => text += data); child.stderr.on('data', data => text += data); child.on('close', code => resolve({ code, text })); });
  assert.equal(output.code, 0, output.text); assert.equal(f.count(), 2);
});

test('native popup guard blocks foreign first hops and redirect chains while permitting normal popup closure', { timeout: 45000 }, async t => {
  const prior = process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;
  process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = [prior, '127.0.0.1'].filter(Boolean).join(',');
  t.after(() => { if (prior === undefined) delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS; else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = prior; });
  let foreignHits = 0;
  const foreign = Fastify(); foreign.get('/*', () => { foreignHits++; return 'Foreign document'; });
  const destination = await foreign.listen({ host: '127.0.0.1', port: 0 }); t.after(() => foreign.close());
  const upstream = createRequire(require.resolve('@playwright/mcp/package.json'))('playwright');
  const f = await fixture(t, async app => {
    app.get('/launchers', (_req, reply) => reply.type('text/html').send(`<h1>Launcher</h1><a target="_blank" href="/close">Close popup</a><a target="_blank" href="${destination}/foreign">Foreign popup</a><a target="_blank" href="/redirect-chain">Redirect popup</a>`));
    app.get('/close', (_req, reply) => reply.type('text/html').send('<h1>Temporary owned popup</h1><script>setTimeout(()=>window.close(),200)</script>'));
    app.get('/redirect-chain', (_req, reply) => reply.redirect('/redirect-out'));
    app.get('/redirect-out', (_req, reply) => reply.redirect(destination + '/redirected'));
    await registerAutomationPlaywrightMcp(app, async () => {}, { validateTarget: async () => ({ address: '127.0.0.1', port: 80 }),
      launchBrowser: options => upstream.chromium.launch({ ...options, executablePath: require('playwright').chromium.executablePath() }) });
  });
  const initialized = await invoke(f.app, 'initialize', { protocolVersion: '2025-03-26', clientInfo: { name: 'popup-policy-fixture', version: '1' }, capabilities: {}, _meta: { hellotest: { start_url: f.base + '/launchers' } } });
  const session = initialized.headers['mcp-session-id']; assert.ok(session);
  await invoke(f.app, 'notifications/initialized', {}, session, null);
  await invoke(f.app, 'tools/call', { name: 'browser_navigate', arguments: { url: f.base + '/launchers' } }, session);
  for (const label of ['Close popup', 'Foreign popup', 'Redirect popup']) {
    const snapshot = (await invoke(f.app, 'tools/call', { name: 'browser_snapshot', arguments: {} }, session)).json().result;
    assert.notEqual(snapshot?.isError, true, JSON.stringify(snapshot));
    const ref = snapshot.content[0].text.match(new RegExp(`link "${label}" \\[ref=([^\\]]+)\\]`))?.[1]; assert.ok(ref, snapshot.content[0].text);
    const clicked = (await invoke(f.app, 'tools/call', { name: 'browser_click', arguments: { target: ref } }, session)).json().result;
    assert.notEqual(clicked?.isError, true, JSON.stringify(clicked));
    const opener = (await invoke(f.app, 'tools/call', { name: 'browser_snapshot', arguments: {} }, session)).json().result;
    assert.match(opener.content[0].text, /heading "Launcher"/, 'the owned opener remains usable after a popup closes or is denied');
    assert.equal(foreignHits, 0, 'neither a direct foreign popup nor any foreign redirect hop reaches the destination');
  }
});

test('versioned record and SPA popup identities survive reordered delayed tabs and volatile tracking in Run and standalone', { timeout: 60000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'qaira-semantic-popup-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const target = (mode, name, tracking) => mode === 'query' ? `/record?id=${name}&utm_source=${tracking}` : `/spa/#/record/${name}?utm_source=${tracking}`;
  const record = name => `<!doctype html><title>${name}</title><h1>${name}</h1><button onclick="window.open(location.href)">Duplicate</button>`;
  const f = await fixture(t, app => {
    app.get('/identities/:mode', (request, reply) => {
      const urls = ['Bob', 'Alice'].map(name => target(request.params.mode, name, 'replay'));
      return reply.type('text/html').send(`<title>Home</title><button onclick='window.open(${JSON.stringify(urls[0])});setTimeout(()=>window.open(${JSON.stringify(urls[1])}),150)'>Open records</button>`);
    });
    app.get('/record', (request, reply) => reply.type('text/html').send(record(request.query.id)));
    app.get('/spa/', (_request, reply) => reply.type('text/html').send(record('Loading') + '<script>const name=location.hash.split("/").at(-1).split("?")[0];document.title=name;document.querySelector("h1").textContent=name;</script>'));
  });
  for (const mode of ['query', 'hash']) {
    const baseURL = `${f.base}/identities/${mode}`, observed = f.base + target(mode, 'Alice', 'build');
    const tabs = createUpstreamTabTracker(baseURL);
    const listing = current => ({ content: [{ type: 'text', text: `### Result\n- 0: [Home](${baseURL})\n- 1:${current ? ' (current)' : ''} [Alice](${observed})` }] });
    tabs.observe(listing(false), 'browser_tabs');
    const selection = tabs.receipt({ index: 1 }, listing(true));
    assert.equal(selection.receipt.identity.schema, TAB_IDENTITY_SCHEMA);
    const source = `await page.getByRole("button",{name:"Open records",exact:true}).click();
${selection.code}
await expect(page).toHaveTitle("Alice");
await expect(page.getByRole("heading",{name:"Alice",exact:true})).toBeVisible();
let invalid=false;try{await web.switchTab({index:1,identity:{schema:"hellotest.tab-identity.v2",url:${JSON.stringify(observed)}}});}catch{invalid=true;}
expect(invalid).toBe(true);
await page.getByRole("button",{name:"Duplicate",exact:true}).click();
await expect.poll(async()=>(await web.tabs()).length).toBe(4);
let ambiguous=false;try{${selection.code}}catch{ambiguous=true;}
expect(ambiguous).toBe(true);
await expect(page).toHaveTitle("Alice");`;
    const steps = [{ id: mode, order: 1, step_order: 1, step_type: 'web', action: 'Select Alice among reordered popup records', expected_result: 'The exact Alice record is selected; unsupported and ambiguous identities cannot select another tab', automation_code: source }];
    const run = createWebRunSession({ engine_run_id: randomUUID(), browser: 'chromium', headless: true, web_engine: { active: 'playwright' }, environment: { base_url: baseURL },
      timeouts: { navigation_timeout_ms: 5000, assertion_timeout_ms: 2000 }, run_timeout_seconds: 20, max_repair_attempts: 0,
      artifact_policy: { trace_mode: 'off', video_mode: 'off', screenshot_on_success: false, screenshot_on_failure: false, capture_console: false, capture_network: false }, steps });
    try { await run.start(); const result = await run.runStep(steps[0]); assert.equal(result.status, 'passed', result.note); }
    finally { await run.stop('passed'); }
    const code = buildPlaywrightArtifact({ testCase: { id: mode, title: `${mode} identity` }, steps, rows: [{}], baseURL });
    await writeFile(path.join(directory, `${mode}.spec.ts`), code.replace("'@playwright/test'", JSON.stringify(fileURLToPath(new URL('../../node_modules/playwright/test.mjs', import.meta.url)))));
  }
  await writeFile(path.join(directory, 'playwright.config.cjs'), 'module.exports=' + JSON.stringify({ testDir: directory, testMatch: '*.spec.ts', workers: 1, reporter: 'json', outputDir: path.join(directory, 'results'), use: { headless: true } }));
  const output = await new Promise((resolve, reject) => { let text = ''; const child = spawn(process.execPath, [fileURLToPath(new URL('../../node_modules/playwright/cli.js', import.meta.url)), 'test', '--config', path.join(directory, 'playwright.config.cjs')], { cwd: directory }); child.on('error', reject); child.stdout.on('data', data => text += data); child.stderr.on('data', data => text += data); child.on('close', code => resolve({ code, text })); });
  assert.equal(output.code, 0, output.text);
});
