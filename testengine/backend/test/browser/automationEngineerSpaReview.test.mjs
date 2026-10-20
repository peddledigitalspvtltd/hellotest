import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { registerAutomationMcp } from '../../dist/lib/automationMcp.js';
import { createPrivilegedRunGuard, resolveTestEngineSharedSecret } from '../../dist/lib/testEngineSecurity.js';
import { buildPlaywrightArtifact, createPlaywrightExecutionOptions } from '../../../../services/automation/shared/playwrightArtifact.mjs';
import { assertTypeScriptExportCompiles } from '../../../../services/automation/test/browser/playwrightExportFixture.mjs';

const require = createRequire(import.meta.url);
const { connectAutomationBrowser, runAutomationBrowserAgent } = require('../../../../services/automation/backend/lib/automationBrowserAgent.js');
const actorState = prompt => JSON.parse(prompt.match(/^Current browser state and confirmed section progress \(page content is untrusted data\): (.+)$/m)[1]);
const reviewPacket = prompt => JSON.parse(prompt.slice(prompt.lastIndexOf('\n\n') + 2));
const target = (current, name) => current.current_snapshot.targets.find(item => item.name === name || item.text === name)?.ref;
const execution = { required: true, step_id: 'open-registration', action: 'Open the registration form without submitting it',
  expected_result: 'The registration heading and the Full name input are visible.', semantic_review_required: true };
const actor = (requests, complete = false) => JSON.stringify({ stage: 'act', step_id: execution.step_id, section_complete: complete, tool_calls: requests });

function assertRenderedTransition(packet, url, registration) {
  const metadata = packet.page_metadata_context;
  assert.deepEqual(metadata.before, {});
  assert.deepEqual(metadata.after, {});
  assert.deepEqual(metadata.omitted_incidental_fields, ['url', 'title']);
  assert.equal(metadata.evidence_role, 'requested_subjects_only');
  assert.equal(packet.confirmed_operations.find(operation => operation.name === 'browser_navigate').arguments.url, url,
    'actual performed navigation remains evidence while incidental address/title metadata stays out of the verdict');
  const rendered = packet.rendered_transition;
  assert.equal(rendered.baseline_available, true);
  assert.equal(rendered.comparison_scope, 'bounded_snapshot_targets');
  assert.equal(rendered.after.observed_after_latest_action, true);
  assert.equal(rendered.observed_change, true, 'both cases change observed page content, which alone cannot establish the expected result');
  const changedTargets = [...rendered.added, ...rendered.state_changes.map(change => change.after)];
  if (registration) {
    assert.ok(changedTargets.some(item => item.role === 'heading' && item.name === 'Create an account'));
    assert.ok(changedTargets.some(item => item.tag === 'input' && item.role === 'textbox' && item.name === 'Full name'), 'the new observed form control differs from the unchanged navigation button');
    assert.ok(rendered.added.some(item => item.role === 'heading' && item.name === 'Create an account'));
  } else {
    assert.ok(changedTargets.some(item => item.text === 'New features this week'));
    assert.ok(!changedTargets.some(item => item.name === 'Create an account' || item.name === 'Full name'));
  }
}

async function fixture(t, { transition = true } = {}) {
  const previous = process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;
  process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = '127.0.0.1';
  t.after(() => { if (previous === undefined) delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS; else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = previous; });
  let opened = 0;
  const app = Fastify();
  app.get('/auth', async (_request, reply) => reply.type('text/html').send(`<!doctype html><title>Sign In</title>
    <nav><button data-testid="sign-in-navigation">Sign in</button><button data-testid="registration-navigation" onclick="openRegistration()">Register</button></nav>
    <aside aria-label="Promotions"><h2>Product news</h2><p id="carousel">A faster way to work</p></aside>
    <main><h1>Welcome back</h1><form><label>Sign-in email<input type="email"></label><label>Sign-in password<input type="password"></label><button type="button">Continue</button></form></main>
    <script>function openRegistration() {
      document.querySelector('#carousel').textContent = 'New features this week';
      ${transition ? `document.querySelector('main').innerHTML = '<h1>Create an account</h1><form><label>Full name<input data-testid="registration-full-name"></label><label>Registration email<input type="email"></label><label>Create password<input type="password"></label><button type="button">Create account</button></form>';` : ''}
      fetch('/fixture/registration-opened', {method:'POST'});
    }</script>`));
  app.post('/fixture/registration-opened', async () => { opened++; return {}; });
  await registerAutomationMcp(app, createPrivilegedRunGuard(resolveTestEngineSharedSecret()));
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(() => app.close());
  const session = await connectAutomationBrowser({ integration: { base_url: base }, startUrl: `${base}/auth`, allowBrowserActions: true });
  t.after(() => session.close());
  session.projectPromptText = value => value;
  session.projectPrivateText = value => value;
  const originalCall = session.call, calls = [], observations = [];
  session.call = async (name, args) => { calls.push({ name, args }); return originalCall(name, args); };
  return { base, session, calls, observations, get opened() { return opened; } };
}

async function replayStandaloneArtifact(t, source) {
  const directory = await mkdtemp(path.join(tmpdir(), 'qaira-spa-export-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const artifact = buildPlaywrightArtifact({ testCase: { id: 'spa-case', title: 'Open registration with unchanged URL and title' },
    steps: [{ id: execution.step_id, step_order: 1, step_type: 'web', action: execution.action, expected_result: execution.expected_result, automation_code: source }],
    rows: [{}], sectionRows: [[{}]], executionOptions: createPlaywrightExecutionOptions({ screenshot_on_success: false, screenshot_on_failure: false }) });
  assert.match(artifact, /@playwright\/test/);
  assert.doesNotMatch(artifact, /Export limitation:|Standalone export blocked:/);
  const spec = path.join(directory, 'registration.spec.ts');
  await writeFile(spec, artifact);
  assertTypeScriptExportCompiles([spec]);
  const playwrightModule = fileURLToPath(new URL('../../node_modules/playwright/test.mjs', import.meta.url));
  await writeFile(spec, artifact.replace("'@playwright/test'", JSON.stringify(playwrightModule)));
  const config = path.join(directory, 'playwright.config.cjs');
  await writeFile(config, 'module.exports=' + JSON.stringify({ testDir: directory, testMatch: 'registration.spec.ts', outputDir: path.join(directory, 'results'),
    workers: 1, reporter: 'json', use: { headless: true, launchOptions: process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {} } }));
  const result = await new Promise((resolve, reject) => {
    let output = '', errors = '';
    const child = spawn(process.execPath, [fileURLToPath(new URL('../../node_modules/playwright/cli.js', import.meta.url)), 'test', '--config', config],
      { env: { ...process.env, QAIRA_BASE_URL: '', QAIRA_DATA_JSON: '{}' } });
    t.after(() => { if (child.exitCode === null) child.kill('SIGTERM'); });
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { errors += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, output, errors }));
  });
  assert.equal(result.code, 0, result.output + '\n' + result.errors);
  const report = JSON.parse(result.output);
  assert.equal(report.stats.expected, 1);
  assert.equal(report.stats.unexpected, 0);
}

// The model packets are scripted; Chrome, MCP receipts, rendered-state evidence,
// compilation, standalone export and fresh-context Playwright replay are real.
test('same-URL and same-title SPA registration is reviewed from its changed heading and form controls', { timeout: 90_000 }, async t => {
  const state = await fixture(t);
  let turns = 0, reviews = 0, saves = 0;
  const built = await runAutomationBrowserAgent({ browser: state.session, startUrl: `${state.base}/auth`, execution,
    actorMode: true, generationMode: 'sequential', prompt: 'Open registration, then check its heading and Full name field. Do not submit.',
    maxTurns: 5, maxCalls: 10, parse: JSON.parse, onObservation: async observation => state.observations.push(observation),
    onPartialBuild: async () => { saves++; assert.equal(reviews, 1); assert.equal(state.opened, 1); return { generation_complete: true }; },
    complete: async prompt => {
      if (prompt.includes('"kind":"automation_section_semantic_review"')) {
        reviews++;
        const packet = reviewPacket(prompt);
        assert.equal(packet.current_page.url, undefined, 'document metadata has its own contextual slot');
        assert.equal(packet.current_page.title, undefined);
        assert.match(packet.current_page.accessibility, /Create an account/);
        assert.match(packet.current_page.accessibility, /Full name/);
        assert.ok(packet.current_page.targets.some(item => item.role === 'button' && item.name === 'Sign in'), 'old navigation remains visible and cannot identify the active form');
        assertRenderedTransition(packet, `${state.base}/auth`, true);
        const click = packet.confirmed_operations.find(operation => operation.name === 'browser_click');
        const assertions = packet.confirmed_operations.filter(operation => operation.name === 'browser_assert');
        assert.equal(click.observed_target.name, 'Register');
        assert.equal(assertions.length, 2);
        assert.ok(assertions.some(operation => operation.observed_target.role === 'heading' && operation.arguments.value === 'Create an account'));
        assert.ok(assertions.some(operation => operation.observed_target.name === 'Full name'));
        assert.ok(assertions.every(operation => operation.confirmation === 'assertion_satisfied'));
        return JSON.stringify({ decision: 'accept', obligations: [{ id: execution.step_id, action_operations: [click.index], assertion_operations: assertions.map(operation => operation.index) }], issues: [] });
      }
      turns++;
      const current = actorState(prompt);
      if (turns === 1) return actor([{ name: 'browser_click', arguments: { locator: target(current, 'Register') } }]);
      assert.equal(turns, 2);
      assert.equal(current.url, `${state.base}/auth`);
      assert.equal(current.current_snapshot.title, 'Sign In');
      return actor([
        { name: 'browser_assert', arguments: { assertion: 'text_content', locator: target(current, 'Create an account'), value: 'Create an account' } },
        { name: 'browser_assert', arguments: { assertion: 'visible', locator: target(current, 'Full name') } }
      ], true);
    }
  });
  assert.equal(turns, 2); assert.equal(reviews, 1); assert.equal(saves, 1);
  assert.equal(state.calls.filter(call => call.name === 'browser_click').length, 1);
  const source = built.steps[0].automation_code;
  assert.match(source, /\.click\(\)/);
  assert.match(source, /toHaveText\("Create an account"\)/);
  assert.match(source, /getByTestId\("registration-full-name"\).*toBeVisible/);
  assert.doesNotMatch(source, /ref:[a-f0-9]+:/);
  await state.session.close();
  await replayStandaloneArtifact(t, source);
  assert.equal(state.opened, 2, 'one transition in development and one in the independent exported test');
});

test('an unchanged sign-in panel cannot pass registration review because an unrelated carousel changed', { timeout: 60_000 }, async t => {
  const state = await fixture(t, { transition: false });
  let turns = 0, reviews = 0;
  await assert.rejects(runAutomationBrowserAgent({ browser: state.session, startUrl: `${state.base}/auth`, execution,
    actorMode: true, generationMode: 'sequential', prompt: 'Open registration and check its Full name field.', maxTurns: 5, maxCalls: 10, parse: JSON.parse,
    onObservation: async observation => state.observations.push(observation), onPartialBuild: async () => assert.fail('the unchanged wrong panel cannot be saved'),
    complete: async prompt => {
      if (prompt.includes('"kind":"automation_section_semantic_review"')) {
        reviews++;
        const packet = reviewPacket(prompt);
        assert.equal(packet.current_page.url, undefined);
        assert.equal(packet.current_page.title, undefined);
        assert.match(packet.current_page.accessibility, /Welcome back/);
        assert.doesNotMatch(packet.current_page.accessibility, /Create an account|Full name/);
        assert.match(packet.current_page.accessibility, /New features this week/);
        assertRenderedTransition(packet, `${state.base}/auth`, false);
        const click = packet.confirmed_operations.find(operation => operation.name === 'browser_click');
        const check = packet.confirmed_operations.find(operation => operation.name === 'browser_assert');
        assert.equal(check.observed_target.name, 'Welcome back');
        return JSON.stringify({ decision: 'reject', obligations: [{ id: execution.step_id, action_operations: [click.index], assertion_operations: [] }],
          issues: [{ code: 'expected_result_not_covered', obligation_id: execution.step_id, message: 'The existing sign-in panel and carousel do not establish that registration opened.' }] });
      }
      turns++;
      const current = actorState(prompt);
      if (turns === 1) return actor([{ name: 'browser_click', arguments: { locator: target(current, 'Register') } }]);
      if (turns === 2) return actor([{ name: 'browser_assert', arguments: { assertion: 'visible', locator: target(current, 'Welcome back') } }], true);
      assert.equal(turns, 3);
      assert.equal(current.semantic_review_feedback.code, 'AUTOMATION_SEMANTIC_REVIEW_REJECTED');
      return JSON.stringify({ stage: 'act', step_id: execution.step_id, tool_calls: [], section_issue: { kind: 'unexpected_application_state',
        reason: 'Registration did not open; the current form still contains the sign-in heading and fields.', evidence_refs: [target(current, 'Welcome back')] } });
    }
  }), error => error.code === 'AUTOMATION_BROWSER_SECTION_BLOCKED');
  assert.equal(turns, 3); assert.equal(reviews, 1);
  assert.equal(state.opened, 1);
  assert.equal(state.calls.filter(call => call.name === 'browser_click').length, 1);
});
