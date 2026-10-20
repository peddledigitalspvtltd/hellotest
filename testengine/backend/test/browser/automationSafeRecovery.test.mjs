import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('playback never replays mutations or captures after a failed check and retains read-only retry evidence', { timeout: 30_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'hellotest-safe-recovery-'));
  const previousRoot = process.env.ARTIFACT_ROOT;
  process.env.ARTIFACT_ROOT = root;
  const { createWebRunSession } = await import('../../dist/lib/webEngine.js');
  const app = Fastify();
  let submissions = 0;
  app.post('/submit', async () => { submissions++; return {}; });
  app.get('/', async (_request, reply) => reply.type('text/html').send(`<!doctype html><button onclick="fetch('/submit',{method:'POST'})">Submit</button><output>Waiting</output>`));
  app.get('/eventual', async (_request, reply) => reply.type('text/html').send(`<!doctype html><output>Waiting</output><script>setTimeout(()=>document.querySelector('output').textContent='Ready',600)</script>`));
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  const session = createWebRunSession({ engine_run_id: 'safe-recovery', browser: 'chromium', headless: true, web_engine: { active: 'playwright' }, environment: { base_url: base }, run_timeout_seconds: 20,
    max_repair_attempts: 20, timeouts: { action_timeout_ms: 300, assertion_timeout_ms: 100, recovery_wait_ms: 700 },
    artifact_policy: { trace_mode: 'on-first-retry', video_mode: 'off', screenshot_on_failure: false, screenshot_on_success: false, capture_console: false, capture_network: false }, steps: [] });
  t.after(async () => { await session.stop('failed'); await app.close(); await rm(root, { recursive: true, force: true }); if (previousRoot === undefined) delete process.env.ARTIFACT_ROOT; else process.env.ARTIFACT_ROOT = previousRoot; });
  await session.start();
  const step = (id, automation_code) => ({ id, order: 1, step_type: 'web', action: 'Verify outcome', expected_result: 'Ready', automation_code });

  const submitted = await session.runStep(step('submit', 'await page.getByRole("button", { name: "Submit" }).click();\nawait expect(page.locator("output")).toHaveText("Ready");'));
  assert.equal(submitted.status, 'failed');
  assert.equal(submissions, 1, submitted.note);
  assert.equal(submitted.recovery_attempted, false);
  assert.deepEqual(submitted.web_detail.recovery, { strategy: 'read_only_assertion_retry', status: 'blocked', attempts: 1, source_changed: false, reason: 'section_not_read_only', retry_limit: 2, first_failure_attempt: 1, first_failure_line: 2 });
  assert.ok(submitted.line_results.every(row => row.attempt === 1));
  assert.match(submitted.note, /Completed or uncertain actions were not replayed/);

  const captured = await session.runStep(step('capture', 'capture("t.before", "retained");\nawait expect(page.locator("output")).toHaveText("Ready");'));
  assert.equal(captured.status, 'failed');
  assert.equal(captured.recovery_attempted, false);
  assert.deepEqual(captured.captures, { 't.before': 'retained' });
  assert.ok(captured.line_results.every(row => row.attempt === 1));

  const permanent = await session.runStep(step('ambiguous', 'await expect(page.locator("output, button")).toHaveText("Ready");'));
  assert.equal(permanent.status, 'failed');
  assert.equal(permanent.recovery_attempted, false);
  assert.match(permanent.note, /strict mode violation/);
  const invalidSelector = await session.runStep(step('invalid-selector', 'await expect(page.locator("[")).toHaveText("Ready");'));
  assert.equal(invalidSelector.status, 'failed');
  assert.equal(invalidSelector.recovery_attempted, false, invalidSelector.note);
  assert.ok(invalidSelector.line_results.every(row => row.attempt === 1));

  const exhausted = await session.runStep(step('bounded-read', 'await expect(page.locator("output")).toHaveText("Ready");'));
  assert.equal(exhausted.status, 'failed');
  assert.equal(exhausted.web_detail.recovery.status, 'failed');
  assert.equal(exhausted.web_detail.recovery.attempts, 3, 'An excessive configured repair count is capped at two safe retries.');
  assert.equal(exhausted.web_detail.recovery.reason, 'retry_limit_reached');
  assert.deepEqual([...new Set(exhausted.line_results.map(row => row.attempt))], [1, 2, 3]);

  // Navigation is a separate, non-retried step. A later read-only assertion can
  // recover after its initial native timeout without rerunning that navigation.
  assert.equal((await session.runStep(step('eventual-page', `await page.goto(${JSON.stringify(base + '/eventual')});`))).status, 'passed');
  const draft = step('eventual-read', 'const status = page.locator("output");\nawait expect(status).toHaveText("Ready");');
  const changedDraft = setTimeout(() => { draft.automation_code = 'await page.goto("/"); await page.getByRole("button", { name: "Submit" }).click();'; }, 50);
  const delayed = await session.runStep(draft);
  clearTimeout(changedDraft);
  assert.equal(delayed.status, 'passed', delayed.note);
  assert.equal(delayed.recovery_attempted, true);
  assert.equal(delayed.recovery_succeeded, true);
  assert.match(delayed.note, /Flaky:/);
  assert.deepEqual(delayed.web_detail.recovery, { strategy: 'read_only_assertion_retry', status: 'recovered', attempts: 2, source_changed: false, reason: 'read_only_assertion_timeout', retry_limit: 2, first_failure_attempt: 1, first_failure_line: 2 });
  assert.ok(delayed.line_results.some(row => row.status === 'failed' && row.attempt === 1));
  assert.ok(delayed.line_results.some(row => row.status === 'passed' && row.attempt === 2));
  assert.equal(submissions, 1, 'A caller changing its draft cannot replace the pinned source between retry attempts.');
  const artifacts = await session.stop('passed');
  assert.ok(artifacts.trace_path, 'A recovered flaky step retains its on-first-retry trace.');
  await access(join(root, artifacts.trace_path));
  assert.ok(artifacts.artifact_refs.some(ref => ref.kind === 'trace'));
});

test('closing a run while a safe retry is waiting cannot start another assertion', { timeout: 15_000 }, async t => {
  const app = Fastify();
  app.get('/', async (_request, reply) => reply.type('text/html').send('<!doctype html><output>Waiting</output>'));
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  const { createWebRunSession } = await import('../../dist/lib/webEngine.js');
  const session = createWebRunSession({ engine_run_id: 'stopped-recovery', browser: 'chromium', headless: true, web_engine: { active: 'playwright' }, environment: { base_url: base }, run_timeout_seconds: 20,
    max_repair_attempts: 2, timeouts: { assertion_timeout_ms: 100, recovery_wait_ms: 5000 },
    artifact_policy: { trace_mode: 'off', video_mode: 'off', screenshot_on_failure: false, screenshot_on_success: false, capture_console: false, capture_network: false }, steps: [] });
  t.after(async () => { await session.stop('failed'); await app.close(); });
  await session.start();
  const resultPromise = session.runStep({ id: 'waiting', order: 1, step_type: 'web', action: 'Check status', automation_code: 'await expect(page.locator("output")).toHaveText("Ready");' });
  await new Promise(resolve => setTimeout(resolve, 300));
  await session.stop('failed');
  const result = await resultPromise;
  assert.equal(result.status, 'failed');
  assert.ok(result.line_results.every(row => row.attempt === 1));
  assert.equal(result.web_detail.recovery.attempts, 1);
  assert.equal(result.web_detail.recovery.reason, 'run_stopped');
  assert.match(result.note, /run ended|closed/);
});
