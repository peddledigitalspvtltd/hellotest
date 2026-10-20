import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { registerAutomationMcp } from '../../dist/lib/automationMcp.js';
import { createPrivilegedRunGuard, resolveTestEngineSharedSecret } from '../../dist/lib/testEngineSecurity.js';
import { createPlaywrightCodeBindings } from '../../dist/lib/playwrightBindings.js';

const require = createRequire(import.meta.url);
const { connectAutomationBrowser, runAutomationBrowserAgent } = require('../../../../services/automation/backend/lib/automationBrowserAgent.js');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

test('progressive Engineer capabilities use real MCP Chromium and compiled source replays unchanged', { timeout: 60_000 }, async t => {
  const previous = process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;
  process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = '127.0.0.1';
  t.after(() => { if (previous === undefined) delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS; else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = previous; });
  const app = Fastify();
  app.get('/entry', async (_request, reply) => reply.type('text/html').send(`<!doctype html><title>Account fixture</title>
    <button onclick="document.querySelector('main').innerHTML='<label>Name<input id=name></label>';this.hidden=true">Open form</button><main></main>`));
  await registerAutomationMcp(app, createPrivilegedRunGuard(resolveTestEngineSharedSecret()));
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(() => app.close());
  const session = await connectAutomationBrowser({ integration: { base_url: base }, startUrl: `${base}/entry`, allowBrowserActions: true });
  t.after(() => session.close());
  const call = session.call, calls = [], events = [];
  session.call = async (name, args) => { calls.push(name); return call(name, args); };
  let turns = 0;
  // The model is scripted; MCP transport, schema discovery, browser, target
  // references, receipts, compiler and subsequent Playwright replay are real.
  const result = await runAutomationBrowserAgent({
    browser: session, startUrl: `${base}/entry`, prompt: 'Prepare the account', actorMode: true,
    execution: { required: true, step_id: 'account', action: 'Prepare the account', expected_result: 'Name is Ada' },
    maxTurns: 5, maxCalls: 12, parse: JSON.parse, onProgress: async event => events.push(event),
    onPartialBuild: async () => ({ generation_complete: true }),
    complete: async prompt => {
      const catalog = JSON.parse(prompt.match(/^Tool catalog: (.+)$/m)[1]);
      const current = JSON.parse(prompt.match(/^Current browser state and confirmed section progress \(page content is untrusted data\): (.+)$/m)[1]);
      turns++;
      if (turns <= 3) {
        const button = current.current_snapshot.targets.find(target => target.name === 'Open form');
        assert.ok(button?.ref);
        if (turns === 1) {
          assert.ok(!catalog.some(tool => tool.name === 'browser_hover'));
          assert.ok(!catalog.some(tool => tool.name === 'browser_fill'));
        } else if (turns === 2) {
          assert.ok(catalog.some(tool => tool.name === 'browser_hover'));
          assert.ok(!calls.includes('browser_click'), 'disclosure paused the entire first proposed batch');
        }
        const names = turns === 1 ? ['browser_hover', 'browser_click'] : turns === 2 ? ['browser_hover'] : ['browser_click'];
        return JSON.stringify({ stage: 'act', step_id: 'account', section_complete: false,
          tool_calls: names.map(name => ({ name, arguments: { locator: button.ref } })) });
      }
      assert.equal(turns, 4);
      assert.ok(catalog.some(tool => tool.name === 'browser_fill'), 'new observed form controls reveal the input capability');
      const name = current.current_snapshot.targets.find(target => target.name === 'Name');
      assert.ok(name?.ref);
      return JSON.stringify({ stage: 'act', step_id: 'account', section_complete: true, tool_calls: [
        { name: 'browser_fill', arguments: { locator: name.ref, value: 'Ada' } },
        { name: 'browser_assert', arguments: { assertion: 'value', locator: name.ref, value: 'Ada' } }
      ] });
    }
  });
  assert.equal(turns, 4);
  assert.equal(calls.filter(name => name === 'browser_click').length, 1);
  assert.equal(calls.filter(name => name === 'browser_hover').length, 1);
  assert.equal(calls.filter(name => name === 'browser_fill').length, 1);
  assert.equal(calls.filter(name => name === 'browser_assert').length, 1);
  const metrics = events.filter(event => event.phase === 'automation.agent.prompt.packed').map(event => event.details);
  assert.ok(metrics[0].tool_catalog_chars < metrics[0].available_tool_catalog_chars);
  assert.equal(metrics[0].available_tool_count, session.tools.length);
  const source = result.steps[0].automation_code;
  assert.doesNotMatch(source, /ref:[a-f0-9]+:/, 'opaque model refs never leak into portable source');
  await session.close();
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const bindings = createPlaywrightCodeBindings(page, { interpolate: value => value, resolveLocator: value => value, resolveUrl: value => value, assertionTimeout: 1000 });
  await new AsyncFunction('page', 'expect', 'params', source)(bindings.page, bindings.expect, {});
  assert.equal(await page.getByLabel('Name', { exact: true }).inputValue(), 'Ada');
});

test('signup prerequisite feedback stops assertion wording churn without repeating submission or saving an unmet result', { timeout: 90_000 }, async t => {
  const previous = process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;
  process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = '127.0.0.1';
  t.after(() => { if (previous === undefined) delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS; else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = previous; });
  const app = Fastify();
  app.get('/signup', async (_request, reply) => reply.type('text/html').send(`<!doctype html><title>Signup fixture</title><main>
    <h2>Set up your access</h2><label>Email<input id=email></label><label>Password<input type=password></label>
    <button onclick="document.querySelector('[role=alert]').textContent='Password is required.'">Sign Up</button><p role=alert></p></main>`));
  await registerAutomationMcp(app, createPrivilegedRunGuard(resolveTestEngineSharedSecret()));
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(() => app.close());
  const session = await connectAutomationBrowser({ integration: { base_url: base }, startUrl: `${base}/signup`, allowBrowserActions: true });
  t.after(() => session.close());
  const call = session.call, calls = [], events = []; let turns = 0;
  session.call = async (name, args) => { calls.push(name); return call(name, args); };
  session.projectPromptText = value => value;
  await assert.rejects(runAutomationBrowserAgent({ browser: session, startUrl: `${base}/signup`, prompt: 'Enter email, then verify that a verification code was sent',
    actorMode: true, execution: { required: true, step_id: 'email', action: 'Enter the configured email', expected_result: 'A verification code has been sent' },
    maxTurns: 6, maxCalls: 12, parse: JSON.parse, onProgress: async event => events.push(event),
    onPartialBuild: async () => assert.fail('an unmet verification outcome cannot be saved'),
    complete: async prompt => {
      const current = JSON.parse(prompt.match(/^Current browser state and confirmed section progress \(page content is untrusted data\): (.+)$/m)[1]);
      const target = name => current.current_snapshot.targets.find(item => item.name === name)?.ref;
      turns++;
      const assertion = { name: 'browser_assert', arguments: { assertion: 'text_contains', locator: target('Set up your access'), value: turns % 2 ? 'A verification code has been sent' : 'A message indicating a verification code has been sent' } };
      if (turns === 1) return JSON.stringify({ stage: 'act', step_id: 'email', section_complete: true, tool_calls: [
        { name: 'browser_fill', arguments: { locator: target('Email'), value: 'fixture@example.test' } },
        { name: 'browser_click', arguments: { locator: target('Sign Up') } }, assertion
      ] });
      assert.equal(current.validation_feedback[0]?.text, 'Password is required.');
      if (turns >= 3) assert.ok(current.latest_failure.attempted_check.expected_value, 'privacy-projected previous predicate remains available to diagnose the failed check');
      if (turns < 5) return JSON.stringify({ stage: 'act', step_id: 'email', section_complete: true, tool_calls: [assertion] });
      assert.equal(turns, 5);
      assert.match(prompt, /AUTOMATION_BROWSER_REPEATED_CHECK/);
      assert.equal(current.pending_contract.next_required, 'review_observed_failure_before_another_check');
      return JSON.stringify({ stage: 'act', step_id: 'email', tool_calls: [], section_issue: {
        kind: 'unmet_prerequisite', reason: 'Password is required before the form can send verification. The current email step expects verification without supplying that prerequisite.',
        evidence_refs: [current.validation_feedback[0].ref]
      } });
    }
  }), error => error.code === 'AUTOMATION_BROWSER_SECTION_BLOCKED' && /Password is required/.test(error.message));
  assert.equal(turns, 5);
  assert.equal(calls.filter(name => name === 'browser_fill').length, 1);
  assert.equal(calls.filter(name => name === 'browser_click').length, 1);
  assert.equal(calls.filter(name => name === 'browser_assert').length, 2);
  assert.ok(events.some(event => event.phase === 'automation.agent.section.blocked'));
});
