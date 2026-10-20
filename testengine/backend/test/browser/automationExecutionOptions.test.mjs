import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = await mkdtemp(join(tmpdir(), 'hellotest-step-options-'));
process.env.ARTIFACT_ROOT = root;
process.env.TESTENGINE_SHARED_SECRET = 'hellotest-testengine-dev-secret';
const app = Fastify();
let sideEffects = 0;
let callback = null;
let completion = null;
const reports = [];
app.get('/fixture', async (_req, reply) => reply.type('text/html').send('<!doctype html><h1>Ready</h1>'));
app.get('/connection-lost', async (_req, reply) => { reply.hijack(); reply.raw.destroy(); });
app.get('/ready-api', async () => ({ ready: true }));
app.get('/side-effect', async () => { sideEffects += 1; return { changed: true }; });
app.post('/callback', async req => { callback = req.body; return {}; });
app.post('/testengine/internal/jobs/:id/start', async () => ({ status: 'running' }));
app.post('/testengine/internal/jobs/:id/steps/:step/report', async req => { reports.push({ step: req.params.step, ...req.body }); return { captures: req.body.captures || {} }; });
app.post('/testengine/internal/jobs/:id/complete', async req => { completion = req.body; return {}; });
const base = await app.listen({ host: '127.0.0.1', port: 0 });
process.env.HELLOTEST_API_BASE_URL = base;
const { queueRunExecution, saveAcceptedRun } = await import('../../dist/lib/executor.js');
const { executeQueuedJob } = await import('../../dist/lib/queueWorker.js');
const { buildAcceptedRun } = await import('../../dist/lib/pipeline.js');
const { automationStepOptions } = await import('../../dist/lib/automationStepOptions.js');
const logger = { info() {}, error() {} };
test.after(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });

const envelope = id => ({
  engine_run_id: id, hellotest_run_id: id, hellotest_test_case_id: 'case', hellotest_test_case_title: 'Saved section options',
  browser: 'chromium', headless: true, web_engine: { active: 'playwright' }, environment: { base_url: `${base}/fixture` },
  max_repair_attempts: 0, run_timeout_seconds: 20,
  artifact_policy: { trace_mode: 'off', video_mode: 'off', screenshot_on_failure: false, screenshot_on_success: false, capture_console: false, capture_network: false },
  callback: { url: `${base}/callback`, signing_secret: 'fixture-secret' },
  steps: [
    { id: 'skip', order: 1, step_type: 'api', action: 'Do not mutate', automation_code: '// @hellotest-options skip', api_request: { url: `${base}/side-effect` } },
    { id: 'optional', order: 2, step_type: 'web', action: 'Optional check', automation_code: '// @hellotest-options optional screenshotOnFailure\nthrow new Error("known optional failure");' },
    { id: 'required', order: 3, step_type: 'web', action: 'Confirm readiness', automation_code: 'await expect(page.locator("h1")).toHaveText("Ready");' }
  ]
});

test('execution options require a leading editor-owned comment', () => {
  assert.equal(automationStepOptions({ automation_code: 'const text = "@hellotest-options skip"; throw new Error(text);' }).skip, false);
  assert.equal(automationStepOptions({ automation_code: '// Notes\n// @hellotest-options skip\nthrow new Error("required");' }).skip, false);
  assert.deepEqual(automationStepOptions({ automation_code: '\n// @hellotest-options skip optional screenshotOnFailure\n' }), { skip: true, optional: true, screenshotOnFailure: true });
});

test('direct execution skips side effects and retains optional failure plus explicitly requested screenshot', { timeout: 45000 }, async () => {
  const input = envelope('direct-options');
  await queueRunExecution(input, saveAcceptedRun(input, buildAcceptedRun(input)), logger);
  assert.equal(sideEffects, 0);
  assert.equal(callback.case_result.status, 'passed');
  const logs = callback.case_result.logs;
  assert.deepEqual(logs.stepStatuses, { skip: 'skipped', optional: 'skipped', required: 'passed' });
  assert.match(logs.stepNotes.optional, /Optional section failed; execution continued/);
  assert.equal(logs.stepAutomationDetails.optional.status, 'failed');
  assert.match(logs.stepEvidence.optional.dataUrl, /^data:image\//);
});

test('queued execution preserves the same options and warnings through step reports', { timeout: 45000 }, async () => {
  reports.length = 0;
  completion = null;
  const input = envelope('queued-options');
  await executeQueuedJob({ id: 'queue-options', test_case_title: 'Saved section options', payload: input, runtime_state: {} }, 'worker', logger);
  assert.equal(sideEffects, 0);
  assert.equal(completion.status, 'passed');
  assert.deepEqual(reports.map(({ step, status }) => [step, status]), [['skip', 'skipped'], ['optional', 'skipped'], ['required', 'passed']]);
  assert.match(reports[1].note, /Optional section failed; execution continued/);
  assert.match(reports[1].evidence.dataUrl, /^data:image\//);
  assert.equal(reports[1].automation_detail.status, 'failed');
});

for (const mode of ['direct', 'queued']) test(`${mode} execution cannot claim pass when every section was skipped`, { timeout: 15000 }, async () => {
  const input = envelope(`${mode}-only-skipped`);
  input.steps = [input.steps[0], { ...input.steps[1], automation_code: '// @hellotest-options skip\nthrow new Error("must not run");' }];
  if (mode === 'direct') {
    callback = null;
    await queueRunExecution(input, saveAcceptedRun(input, buildAcceptedRun(input)), logger);
    assert.equal(callback.case_result.status, 'blocked');
  } else {
    completion = null;
    await executeQueuedJob({ id: 'queue-only-skipped', test_case_title: 'Only skips', payload: input, runtime_state: {} }, 'worker', logger);
    assert.equal(completion.status, 'blocked');
  }
  assert.equal(sideEffects, 0);
});

for (const mode of ['direct', 'queued']) test(`${mode} optional API transport failure is recorded without stopping the required section`, { timeout: 15000 }, async () => {
  const input = envelope(`${mode}-optional-api`);
  input.steps = [
    { id: 'optional-api', order: 1, step_type: 'api', automation_code: '// @hellotest-options optional', api_request: { url: `${base}/connection-lost`, timeout_ms: 1000 } },
    { id: 'required-api', order: 2, step_type: 'api', api_request: { url: `${base}/ready-api`, validations: [{ kind: 'status', expected: '200' }] } }
  ];
  if (mode === 'direct') {
    await queueRunExecution(input, saveAcceptedRun(input, buildAcceptedRun(input)), logger);
    assert.equal(callback.case_result.status, 'passed');
    assert.equal(callback.case_result.logs.stepStatuses['optional-api'], 'skipped');
    assert.match(callback.case_result.logs.stepNotes['optional-api'], /Optional section failed/);
  } else {
    reports.length = 0;
    await executeQueuedJob({ id: 'queue-optional-api', test_case_title: 'Optional API', payload: input, runtime_state: {} }, 'worker', logger);
    assert.equal(completion.status, 'passed');
    assert.equal(reports[0].status, 'skipped');
    assert.equal(reports[1].status, 'passed');
    assert.match(reports[0].note, /Optional section failed/);
  }
});
