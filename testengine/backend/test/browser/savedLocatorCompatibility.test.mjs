import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWebRunSession } from '../../dist/lib/webEngine.js';

const require = createRequire(new URL('../../../../services/automation/backend/services/automationReadiness.service.js', import.meta.url));
const { prepareExecutablePlan } = require('./automationReadiness.service');

test('saved locator compatibility executes native instructions with exact/index semantics and retains failing assertions', { timeout: 45000 }, async t => {
  const app = Fastify();
  app.get('/', async (_request, reply) => reply.type('text/html').send('<!doctype html><label>Email<input id="email"></label><label>Email backup<input id="backup"></label><button onclick="document.querySelector(\'output\').textContent=\'First\'">Save</button><button onclick="document.querySelector(\'output\').textContent=\'Second\'">Save</button><button>Save draft</button><output></output>'));
  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  const directory = await mkdtemp(join(tmpdir(), 'qaira-saved-locator-')), previous = process.env.ARTIFACT_ROOT;
  process.env.ARTIFACT_ROOT = directory;
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); if (previous === undefined) delete process.env.ARTIFACT_ROOT; else process.env.ARTIFACT_ROOT = previous; });
  const source = `await page.locator('getByLabel("Email")').fill('@r.email');\nawait page.locator('getByRole("button", {name:"Save"}).nth(1)').click();\nawait expect(page.locator('getByLabel("Email")')).toHaveValue('@r.email');\nawait expect(page.locator('getByText("Second")')).toBeVisible();`;
  const input = [{ id: 'login', order: 1, step_type: 'web', expected_result: 'Email is retained and the second record is selected', automation_code: source }];
  const plan = await prepareExecutablePlan(input);
  assert.deepEqual(plan.issues, []); assert.equal(plan.normalizedLocatorCount, 4); assert.equal(input[0].automation_code, source);
  const session = createWebRunSession({ engine_run_id: 'saved-locator', browser: 'chromium', headless: true, web_engine: { active: 'playwright' }, environment: { base_url: url }, run_timeout_seconds: 20, max_repair_attempts: 0,
    case_parameters: { 'r.email': 'changed@example.test' }, artifact_policy: { trace_mode: 'off', video_mode: 'off', screenshot_on_failure: false, capture_console: false, capture_network: false }, steps: plan.steps });
  t.after(() => session.stop('failed')); await session.start();
  const result = await session.runStep(plan.steps[0]);
  assert.equal(result.status, 'passed', result.note); assert.ok(result.line_results.every(line => line.status === 'passed'));
  const strict = await prepareExecutablePlan([{ ...input[0], expected_result: '', automation_code: `await page.locator('getByRole("button", {name:"Save"})').click();` }]);
  const ambiguous = await session.runStep({ ...strict.steps[0], id: 'ambiguous', order: 2 });
  assert.equal(ambiguous.status, 'failed'); assert.match(ambiguous.note, /strict mode|resolved to 2 elements/i);
  const failedPlan = await prepareExecutablePlan([{ ...input[0], automation_code: `await expect(page.locator('getByLabel("Email")')).toHaveValue('different@example.test', {timeout:50});` }]);
  const failed = await session.runStep({ ...failedPlan.steps[0], id: 'failed', order: 3 });
  assert.equal(failed.status, 'failed'); assert.ok(failed.line_results.some(line => line.status === 'failed'));
});
