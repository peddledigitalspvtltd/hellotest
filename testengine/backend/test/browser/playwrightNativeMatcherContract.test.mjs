import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { createPlaywrightCodeBindings } from '../../dist/lib/playwrightBindings.js';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createWebRunSession } from '../../dist/lib/webEngine.js';
import { buildPlaywrightArtifact } from '../../../../services/automation/shared/playwrightArtifact.mjs';

const require = createRequire(import.meta.url);
const { inspectExecutablePlan } = require('../../../../services/automation/backend/services/automationReadiness.service');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

test('focus, viewport, empty, class and accessibility checks execute through native bindings and preserve failing outcomes', { timeout: 30_000 }, async t => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const nativePage = await browser.newPage();
  await nativePage.setContent('<!doctype html><label for="query">Search catalog</label><input id="query" type="search" class="active searchable" aria-describedby="help" aria-invalid="true" aria-errormessage="error"><p id="help">Type a product code</p><p id="error">Enter a product code</p><input id="other">');
  const { page, expect } = createPlaywrightCodeBindings(nativePage, { interpolate: value => value, resolveLocator: value => value, resolveUrl: value => value, assertionTimeout: 100 });
  await page.locator('#query').click();
  const matchers = { toBeFocused: '', toBeEmpty: '', toBeInViewport: '{ratio:0.5}', toContainClass: '"searchable"',
    toHaveAccessibleDescription: '"Type a product code"', toHaveAccessibleErrorMessage: '"Enter a product code"', toHaveAccessibleName: '"Search catalog"', toHaveId: '"query"', toHaveRole: '"searchbox"' };
  for (const [matcher, args] of Object.entries(matchers)) {
    const code = `await expect(page.locator("#query")).${matcher}(${args});`;
    assert.deepEqual(inspectExecutablePlan([{ id: 'section', step_order: 1, step_type: 'web', expected_result: 'The documented field state holds.', automation_code: code }]), []);
    await new AsyncFunction('page', 'expect', code)(page, expect);
    await assert.rejects(new AsyncFunction('page', 'expect', code.replace(`.${matcher}(`, `.not.${matcher}(`))(page, expect), undefined, `The inverse ${matcher} outcome must fail.`);
  }
  await page.locator('#other').focus();
  await assert.rejects(new AsyncFunction('page', 'expect', 'await expect(page.getByRole("searchbox", {name:"Search catalog"})).toBeFocused();')(page, expect), /toBeFocused/);
});

test('deterministic display metadata roundtrips while engine and standalone export execute the authoritative action exactly once', { timeout: 45_000 }, async t => {
  const { mapGeneratedSectionInstructions } = require('../../../../services/automation/backend/lib/automationUpstreamSectionSource');
  const { validSavedInstructionMapping } = require('../../../../services/automation/backend/lib/automationInstructionMapping');
  const app = Fastify();
  app.get('/', (_request, reply) => reply.type('text/html').send('<!doctype html><button onclick="window.applied=(window.applied||0)+1;document.querySelector(\'output\').textContent=window.applied;location.hash=\'done\'">Apply</button><output>0</output>'));
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(() => app.close());
  const source = `await page.getByRole("button",{name:"Apply",exact:true}).click({timeout:1200});\nawait page.waitForURL(${JSON.stringify(base + '/#done')},{waitUntil:"commit",timeout:1500});\nawait expect(page.locator("output")).not.toHaveText("0",{timeout:1100});\nawait expect(page.locator("output")).toHaveText("1",{timeout:1100});`;
  const step = { id: 'once', order: 1, step_order: 1, step_type: 'web', action: 'Apply once', expected_result: 'The applied count is exactly one.', automation_code: source };
  const mapped = await mapGeneratedSectionInstructions({ step, source, complete: async () => assert.fail('Complete native display mapping cannot require a model.') });
  const saved = JSON.parse(JSON.stringify({ ...step, ...mapped }));
  assert.ok(validSavedInstructionMapping(saved.automation_instructions, { source, stepId: step.id }));
  assert.equal(saved.automation_code, source);
  assert.ok(saved.automation_instructions.instructions.some(row => row.label === 'Wait for URL' && row.args.includes('{waitUntil:"commit",timeout:1500}')));
  const run = createWebRunSession({ engine_run_id: randomUUID(), browser: 'chromium', headless: true, web_engine: { active: 'playwright' },
    environment: { base_url: base + '/' }, timeouts: { navigation_timeout_ms: 3000, assertion_timeout_ms: 2000 }, run_timeout_seconds: 20, max_repair_attempts: 0,
    artifact_policy: { trace_mode: 'off', video_mode: 'off', screenshot_on_success: false, screenshot_on_failure: false, capture_console: false, capture_network: false }, steps: [saved] });
  try { await run.start(); const result = await run.runStep(saved); assert.equal(result.status, 'passed', result.note); }
  finally { await run.stop('passed'); }
  const artifact = buildPlaywrightArtifact({ testCase: { id: 'once', title: 'Apply once' }, steps: [saved], rows: [{}], baseURL: base + '/' });
  const code = typeof artifact === 'string' ? artifact : artifact.code;
  const directory = await mkdtemp(path.join(tmpdir(), 'qaira-display-roundtrip-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, 'once.spec.ts'), code.replace("'@playwright/test'", JSON.stringify(fileURLToPath(new URL('../../node_modules/playwright/test.mjs', import.meta.url)))));
  const config = path.join(directory, 'playwright.config.cjs');
  await writeFile(config, 'module.exports=' + JSON.stringify({ testDir: directory, testMatch: '*.spec.ts', workers: 1, reporter: 'json', use: { headless: true } }));
  const output = await new Promise((resolve, reject) => {
    let text = '';
    const child = spawn(process.execPath, [fileURLToPath(new URL('../../node_modules/playwright/cli.js', import.meta.url)), 'test', '--config', config]);
    child.on('error', reject); child.stdout.on('data', data => text += data); child.stderr.on('data', data => text += data); child.on('close', code => resolve({ code, text }));
  });
  assert.equal(output.code, 0, output.text);
});
