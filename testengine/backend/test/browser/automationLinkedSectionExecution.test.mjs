import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';

const require = createRequire(import.meta.url);
const { inspectExecutablePlan, prepareExecutablePlan } = require('../../../../services/automation/backend/services/automationReadiness.service.js');

test('linked action sections execute in direct and queued runs; only the saved final assertion determines its result', { timeout: 45_000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'hellotest-linked-sections-'));
  const previousEnvironment = Object.fromEntries(['ARTIFACT_ROOT', 'TESTENGINE_SHARED_SECRET', 'HELLOTEST_API_BASE_URL'].map(key => [key, process.env[key]]));
  const app = Fastify();
  const visits = new Map();
  const submissions = new Map();
  let callback;
  let completion;
  const reports = [];

  app.get('/blank', async (_request, reply) => reply.type('text/html').send('<!doctype html><title>New browser session</title>'));
  app.get('/form/:scenario', async (request, reply) => {
    const { scenario } = request.params;
    visits.set(scenario, (visits.get(scenario) || 0) + 1);
    return reply.type('text/html').send(`<!doctype html><title>Linked sections fixture</title>
      <label>First name<input id="first" oninput="events.push('first:' + this.value)"></label>
      <label>Last name<input id="last" oninput="events.push('last:' + this.value)"></label>
      <button id="save">Save</button><p role="status">Ready</p>
      <script>
        const events = ['navigate'];
        document.querySelector('#save').onclick = async () => {
          events.push('save');
          const first = document.querySelector('#first').value;
          const last = document.querySelector('#last').value;
          const result = await fetch('/effect/${scenario}', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ events, first, last })
          });
          if (result.ok) document.querySelector('[role="status"]').textContent = 'Saved ' + first + ' ' + last;
        };
      </script>`);
  });
  app.post('/effect/:scenario', async request => {
    const rows = submissions.get(request.params.scenario) || [];
    rows.push(request.body);
    submissions.set(request.params.scenario, rows);
    return { ok: true };
  });
  app.post('/callback', async request => { callback = request.body; return {}; });
  app.post('/testengine/internal/jobs/:id/start', async () => ({ status: 'running' }));
  app.post('/testengine/internal/jobs/:id/heartbeat', async request => ({ job_id: request.params.id, status: 'running', authorized: true }));
  app.post('/testengine/internal/jobs/:id/steps/:step/report', async request => {
    reports.push({ step: request.params.step, ...request.body });
    return { captures: request.body.captures || {} };
  });
  app.post('/testengine/internal/jobs/:id/complete', async request => { completion = request.body; return {}; });

  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  process.env.ARTIFACT_ROOT = directory;
  process.env.TESTENGINE_SHARED_SECRET = 'linked-sections-fixture-secret';
  process.env.HELLOTEST_API_BASE_URL = base;

  // Import after configuring the private fixture, so queued reports and all
  // browser artifacts stay within this test rather than a running application.
  const { queueRunExecution, saveAcceptedRun } = await import('../../dist/lib/executor.js');
  const { executeQueuedJob } = await import('../../dist/lib/queueWorker.js');
  const { buildAcceptedRun } = await import('../../dist/lib/pipeline.js');
  const logger = { info() {}, error() {} };
  const savedSteps = [
    { id: 'navigate', order: 1, action: 'Open the form', expected_result: 'The application is ready for a new employee.', automation_code: 'await page.goto(params["r.fixture_url"], { waitUntil: "domcontentloaded" });' },
    { id: 'first', order: 2, action: 'Enter the first name', expected_result: 'The entered first name remains available for saving.', automation_code: 'await page.getByLabel("First name", { exact: true }).fill(params["t.first_name"]);' },
    { id: 'last', order: 3, action: 'Enter the last name', expected_result: 'The entered last name remains available for saving.', automation_code: 'await page.getByLabel("Last name", { exact: true }).fill(params["t.last_name"]);' },
    { id: 'save', order: 4, action: 'Save the form once', expected_result: 'The completed form is accepted by the application.', automation_code: 'await page.getByRole("button", { name: "Save", exact: true }).click();' },
    { id: 'assertion', order: 5, action: 'Verify the saved result', expected_result: 'The saved result contains the supplied full name.', automation_code: 'await expect(page.getByRole("status")).toHaveText(params["r.expected_summary"]);' }
  ].map(step => ({ ...step, step_type: 'web' }));
  const durableSnapshot = JSON.stringify(savedSteps);

  assert.equal(inspectExecutablePlan(savedSteps).length, 4, 'Build quality still requires assertions for each authored expectation');
  const prepared = await prepareExecutablePlan(JSON.parse(durableSnapshot));
  assert.deepEqual(prepared.issues, [], 'Run accepts every linked executable section without manufacturing assertions from prose');
  assert.deepEqual(prepared.steps, savedSteps, 'Run admission preserves the complete saved source');

  for (const mode of ['direct', 'queued']) {
    for (const shouldPass of [true, false]) {
      const scenario = `${mode}-${shouldPass ? 'pass' : 'fail'}`;
      await t.test(scenario, async () => {
        callback = undefined;
        completion = undefined;
        reports.length = 0;
        const envelope = {
          engine_run_id: scenario, hellotest_run_id: scenario,
          hellotest_test_case_id: `linked-${scenario}`, hellotest_test_case_title: 'Linked action sections',
          browser: 'chromium', headless: true, web_engine: { active: 'playwright' },
          environment: { base_url: `${base}/blank` }, run_timeout_seconds: 20, max_repair_attempts: 0,
          parameters_frozen: true, case_parameters: { 't.first_name': 'Ada', 't.last_name': 'Lovelace' },
          run_parameters: { fixture_url: `${base}/form/${scenario}`, expected_summary: shouldPass ? 'Saved Ada Lovelace' : 'Incorrect saved result' },
          timeouts: { assertion_timeout_ms: 400 },
          artifact_policy: { trace_mode: 'off', video_mode: 'off', screenshot_on_failure: false, screenshot_on_success: false, capture_console: false, capture_network: false },
          callback: { url: `${base}/callback`, signing_secret: 'linked-sections-callback-secret' },
          steps: JSON.parse(JSON.stringify(prepared.steps))
        };
        const expectedStatuses = { navigate: 'passed', first: 'passed', last: 'passed', save: 'passed', assertion: shouldPass ? 'passed' : 'failed' };
        let automationDetails;

        if (mode === 'direct') {
          await queueRunExecution(envelope, saveAcceptedRun(envelope, buildAcceptedRun(envelope)), logger);
          assert.ok(callback, 'The direct executor emits its final case result');
          assert.equal(callback.case_result.status, shouldPass ? 'passed' : 'failed', callback.summary);
          assert.deepEqual(callback.case_result.logs.stepStatuses, expectedStatuses);
          automationDetails = callback.case_result.logs.stepAutomationDetails;
          if (!shouldPass) assert.match(callback.case_result.error, /toHaveText|Incorrect saved result/);
        } else {
          await executeQueuedJob({ id: scenario, test_case_title: envelope.hellotest_test_case_title, payload: envelope, runtime_state: {} }, 'linked-sections-worker', logger);
          assert.ok(completion, 'The queue worker reports its final case result');
          assert.equal(completion.status, shouldPass ? 'passed' : 'failed', completion.summary);
          assert.deepEqual(Object.fromEntries(reports.map(row => [row.step, row.status])), expectedStatuses);
          automationDetails = Object.fromEntries(reports.map(row => [row.step, row.automation_detail]));
          if (!shouldPass) assert.match(completion.error, /toHaveText|Incorrect saved result/);
        }

        assert.equal(visits.get(scenario), 1, 'Navigation is not replayed');
        assert.deepEqual(submissions.get(scenario), [{
          events: ['navigate', 'first:Ada', 'last:Lovelace', 'save'], first: 'Ada', last: 'Lovelace'
        }], 'The four authorized actions execute in order and submit exactly once, including on assertion failure');
        assert.equal(automationDetails.assertion.status, shouldPass ? 'passed' : 'failed');
        assert.ok(automationDetails.assertion.line_results.some(row => row.status === (shouldPass ? 'passed' : 'failed')),
          'The original executable assertion, including a real failure, remains in the line results');
        assert.equal(JSON.stringify(envelope.steps), durableSnapshot, 'Neither execution nor an assertion failure rewrites the saved instructions');
      });
    }
  }
  assert.equal(JSON.stringify(savedSteps), durableSnapshot);
});
