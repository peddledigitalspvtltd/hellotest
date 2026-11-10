import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { chromium } from 'playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('accepted clicks finish slow navigation once within the navigation budget, preserving authored failures', { timeout: 45000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'hellotest-action-navigation-'));
  process.env.ARTIFACT_ROOT = root;
  const { createWebRunSession } = await import('../../dist/lib/webEngine.js');
  const { runPlaywrightClick } = await import('../../dist/lib/playwrightBindings.js');
  const app = Fastify(), submissions = new Map(), openResponses = new Set();
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => done(null, body));
  app.get('/', async (_req, reply) => reply.type('text/html').send('<h1>Fixture</h1>'));
  app.get('/connection-lost', async (_req, reply) => { reply.hijack(); reply.raw.destroy(); });
  app.get('/form/:key/:mode', async (req, reply) => reply.type('text/html').send(`<!doctype html><h1>Form</h1>
    <form method="post" action="/submitted/${req.params.key}/${req.params.mode}"><button id="save">Save</button></form>`));
  app.get('/spa/:key', async (req, reply) => reply.type('text/html').send(`<!doctype html><h1>Wizard</h1>
    <button id="save" onclick="this.disabled=true;fetch('/spa-save/${req.params.key}',{method:'POST'}).then(()=>{
      history.pushState({},'',location.pathname+'#/profile/${req.params.key}');document.querySelector('h1').textContent='Profile ${req.params.key}';
    })">Save</button>`));
  app.post('/spa-save/:key', async req => {
    submissions.set(req.params.key, (submissions.get(req.params.key) || 0) + 1);
    await new Promise(resolve => setTimeout(resolve, 950));
    return { saved: true };
  });
  app.post('/submitted/:key/:mode', async (req, reply) => {
    submissions.set(req.params.key, (submissions.get(req.params.key) || 0) + 1);
    if (req.params.mode === 'never') {
      reply.hijack(); openResponses.add(reply.raw);
      reply.raw.on('close', () => openResponses.delete(reply.raw));
      return;
    }
    if (req.params.mode === 'stream') {
      await new Promise(resolve => setTimeout(resolve, 650));
      reply.hijack(); openResponses.add(reply.raw);
      reply.raw.on('close', () => openResponses.delete(reply.raw));
      reply.raw.writeHead(200, { 'Content-Type': 'text/html' });
      reply.raw.write('<!doctype html><html><body>' + ' '.repeat(1024));
      await new Promise(resolve => setTimeout(resolve, 700));
      reply.raw.end(`<h1>Saved ${req.params.key}</h1></body></html>`);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 950));
    return reply.type('text/html').send(`<h1>Saved ${req.params.key}</h1>`);
  });
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  const browser = await chromium.launch({ headless: true });
  const native = await browser.newPage();
  native.setDefaultTimeout(500); native.setDefaultNavigationTimeout(2000);
  const session = createWebRunSession({ engine_run_id: 'action-navigation', browser: 'chromium', headless: true,
    web_engine: { active: 'playwright' }, environment: { base_url: base }, run_timeout_seconds: 30, max_repair_attempts: 0,
    timeouts: { action_timeout_ms: 500, assertion_timeout_ms: 1500, navigation_timeout_ms: 2000, domcontentloaded_wait_ms: 0, network_idle_wait_ms: 0 },
    artifact_policy: { trace_mode: 'off', video_mode: 'off', screenshot_on_failure: false, screenshot_on_success: false, capture_console: false, capture_network: false }, steps: [] });
  t.after(async () => {
    await session.stop('failed'); await browser.close();
    for (const response of openResponses) response.destroy();
    await app.close(); await rm(root, { recursive: true, force: true });
  });

  // The pinned native behavior reproduces the production failure before the fix.
  await native.goto(`${base}/form/baseline/slow`);
  await assert.rejects(native.getByRole('button', { name: 'Save' }).click(), error =>
    /Timeout 500ms/.test(error.message) && /click action done/.test(error.message) && /waiting for scheduled navigations/.test(error.message));
  await native.waitForURL('**/submitted/baseline/slow', { waitUntil: 'commit' });
  assert.equal(submissions.get('baseline'), 1);

  await session.start();
  let index = 0;
  const run = input => session.runStep({ id: `navigation-${++index}`, order: index, step_type: 'web', action: 'Fixture section', expected_result: null, ...input });
  const code = (key, mode = 'slow', clickOptions = '') => `await page.goto("${base}/form/${key}/${mode}");
    await page.getByRole('button', { name: 'Save' }).click(${clickOptions});
    await expect(page.locator('h1')).toHaveText('Saved ${key}');`;

  const slow = await run({ automation_code: code('native') });
  assert.equal(slow.status, 'passed', slow.note);
  assert.equal(submissions.get('native'), 1, 'An accepted form submission is never replayed.');
  const wait = slow.web_detail.readiness_waits.find(row => row.state === 'navigation');
  assert.equal(wait.status, 'ready'); assert.equal(wait.timeout_ms, 2000);
  assert.ok(wait.duration_ms >= 500 && wait.duration_ms < 2000);

  await run({ automation_code: `await page.goto("${base}/form/instruction/slow");` });
  const instruction = await run({ action: 'Click #save' });
  assert.equal(instruction.status, 'passed', instruction.note);
  assert.equal(submissions.get('instruction'), 1);
  assert.ok(instruction.web_detail.readiness_waits.some(row => row.state === 'navigation' && row.status === 'ready'));
  assert.equal((await run({ automation_code: "await expect(page.locator('h1')).toHaveText('Saved instruction');" })).status, 'passed');

  for (const [key, settings] of [['explicit-timeout', '{ timeout: 400 }'], ['explicit-wait', '{ noWaitAfter: false }']]) {
    const explicit = await run({ automation_code: code(key, 'slow', settings) });
    assert.equal(explicit.status, 'failed', explicit.note);
    assert.match(explicit.note, key === 'explicit-timeout' ? /Timeout 400ms/ : /Timeout 500ms/);
    assert.equal(submissions.get(key), 1);
    assert.ok(!explicit.web_detail.readiness_waits.some(row => row.state === 'navigation'), 'Authored click settings keep native semantics.');
  }
  const noWait = await run({ automation_code: code('no-wait', 'slow', '{ noWaitAfter: true }') });
  assert.equal(noWait.status, 'passed', noWait.note);
  assert.equal(submissions.get('no-wait'), 1);
  assert.ok(!noWait.web_detail.readiness_waits.some(row => row.state === 'navigation'));

  const trial = await run({ automation_code: `await page.goto("${base}/form/trial/slow"); await page.locator('#save').click({ trial: true }); await expect(page.locator('h1')).toHaveText('Form');` });
  assert.equal(trial.status, 'passed', trial.note); assert.equal(submissions.get('trial'), undefined);
  const missing = await run({ automation_code: "await page.locator('#missing').click();" });
  assert.equal(missing.status, 'failed'); assert.match(missing.note, /Timeout 500ms/);
  assert.ok(!missing.web_detail.readiness_waits.some(row => row.state === 'navigation'));

  const never = await run({ automation_code: code('never', 'never') });
  assert.equal(never.status, 'failed');
  assert.match(never.note, /Main-document navigation: Timeout 2000ms exceeded/);
  assert.equal(submissions.get('never'), 1);
  const timeout = never.web_detail.readiness_waits.find(row => row.state === 'navigation');
  assert.equal(timeout.status, 'timed_out'); assert.ok(timeout.duration_ms < 2800, 'Elapsed action time does not restart the navigation budget.');

  const falseAssertion = await run({ automation_code: code('wrong').replace("'Saved wrong'", "'An outcome that did not happen'") });
  assert.equal(falseAssertion.status, 'failed'); assert.match(falseAssertion.note, /An outcome that did not happen/);
  assert.equal(submissions.get('wrong'), 1, 'Navigation recovery never weakens the saved expected result.');

  const spaCode = (key, wait) => `await page.goto("${base}/spa/${key}");
    await page.locator('#save').click();
    ${wait || ''}
    await expect(page).toHaveURL("${base}/spa/${key}#/profile/${key}", { timeout: 200 });
    await expect(page.locator('h1')).toHaveText('Profile ${key}', { timeout: 200 });`;
  const spaBefore = await run({ automation_code: spaCode('spa-before') });
  assert.equal(spaBefore.status, 'failed'); assert.match(spaBefore.note, /Timeout:\s+200ms/);
  assert.equal(submissions.get('spa-before'), 1, 'The SPA submission completed even though its URL postcondition was premature.');
  const spa = await run({ automation_code: spaCode('spa-ready', `await page.waitForURL("${base}/spa/spa-ready#/profile/spa-ready", { waitUntil: 'commit' });`) });
  assert.equal(spa.status, 'passed', spa.note); assert.equal(submissions.get('spa-ready'), 1);
  const shortWait = await run({ automation_code: spaCode('spa-short', `await page.waitForURL("${base}/spa/spa-short#/profile/spa-short", { waitUntil: 'commit', timeout: 200 });`) });
  assert.equal(shortWait.status, 'failed'); assert.match(shortWait.note, /page.waitForURL: Timeout 200ms/);
  assert.equal(submissions.get('spa-short'), 1, 'An explicit route-wait timeout is preserved without resubmission.');

  const nativeTimeoutAfterCommit = async (key, afterCommit, targetPage = native) => {
    try { await targetPage.getByRole('button', { name: 'Save' }).click(); }
    catch (error) {
      assert.match(error.message, /Timeout 500ms/); assert.match(error.message, /click action done/);
      // Deterministically queue the real native timeout behind a real commit,
      // matching delayed protocol error delivery without synthesizing an error.
      await targetPage.waitForURL(`**/submitted/${key}/stream`, { waitUntil: 'commit' });
      assert.equal(await targetPage.evaluate(() => document.readyState), 'loading');
      await afterCommit?.();
      throw error;
    }
    assert.fail('The streamed response must first exceed the native action timeout.');
  };
  await native.goto(`${base}/form/stream-baseline/stream`);
  await assert.rejects(nativeTimeoutAfterCommit('stream-baseline'), /Timeout 500ms/);
  assert.equal(submissions.get('stream-baseline'), 1);
  await native.waitForLoadState('domcontentloaded');

  await native.goto(`${base}/form/stream-ready/stream`);
  const streamWaits = []; let streamedReadiness = 0;
  await runPlaywrightClick(native, () => nativeTimeoutAfterCommit('stream-ready'), {
    navigationTimeout: 2000, onNavigationWait: wait => streamWaits.push(wait),
    afterNavigation: async () => { streamedReadiness++; await native.waitForLoadState('domcontentloaded'); }
  });
  assert.equal(await native.locator('h1').innerText(), 'Saved stream-ready');
  assert.equal(submissions.get('stream-ready'), 1); assert.equal(streamedReadiness, 1);
  assert.equal(streamWaits[0].status, 'ready');
  assert.ok(streamWaits[0].duration_ms >= 600 && streamWaits[0].duration_ms < 1300, 'Trace uses actual commit time before the streamed body finishes.');

  await native.goto(`${base}/form/stream-late/stream`);
  await assert.rejects(runPlaywrightClick(native, () => nativeTimeoutAfterCommit('stream-late'), { navigationTimeout: 550 }), /Main-document navigation: Timeout 550ms/);
  assert.equal(submissions.get('stream-late'), 1, 'A late commit still exceeds its configured navigation budget.');

  const failedPage = await browser.newPage(); failedPage.setDefaultTimeout(500); failedPage.setDefaultNavigationTimeout(2000);
  await failedPage.goto(`${base}/form/stream-failed-next/stream`);
  let staleReadiness = 0;
  await assert.rejects(runPlaywrightClick(failedPage, () => nativeTimeoutAfterCommit('stream-failed-next', async () => {
    await assert.rejects(failedPage.goto(`${base}/connection-lost`, { waitUntil: 'commit' }), /net::ERR_/);
  }, failedPage), { navigationTimeout: 2000, afterNavigation: async () => { staleReadiness++; } }), /Timeout 500ms/);
  assert.equal(submissions.get('stream-failed-next'), 1); assert.equal(staleReadiness, 0, 'A failed subsequent request cannot reuse the previous commit.');
  await failedPage.close();

  await native.goto(`${base}/form/cancelled/never`);
  const cancellationStarted = Date.now();
  const closeTimer = setTimeout(() => native.close(), 700);
  try {
    await assert.rejects(runPlaywrightClick(native, () => native.locator('#save').click(), { navigationTimeout: 5000 }), /Timeout 500ms/);
  } finally { clearTimeout(closeTimer); }
  assert.ok(Date.now() - cancellationStarted < 1800, 'Closing the run interrupts the pending navigation wait.');
  assert.equal(submissions.get('cancelled'), 1);
});
