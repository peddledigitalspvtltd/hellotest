import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { captureAutomationBrowserSnapshot, registerAutomationMcp } from '../../dist/lib/automationMcp.js';
import { createPrivilegedRunGuard, resolveTestEngineSharedSecret } from '../../dist/lib/testEngineSecurity.js';
import { resolveRepositoryLocator } from '../../dist/lib/repositoryLocator.js';

const require = createRequire(import.meta.url);
const { connectAutomationBrowser, runAutomationBrowserAgent } = require('../../../../services/automation/backend/lib/automationBrowserAgent.js');
const { createBrowserParameterResolver } = require('../../../../services/automation/backend/lib/automationBrowserParameters.js');
const { projectModelSnapshot } = require('../../../../services/automation/backend/lib/automationBrowserModelTargets.js');

test('plain page outcome text is bounded, uniquely grounded and does not displace controls or mutate the DOM', { timeout: 30_000 }, async t => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(`<header><p>Decorative introduction</p></header><main>
    <p>We sent a verification code.<span hidden>Internal debug detail</span> Enter it below.</p>
    ${Array.from({ length: 20 }, (_, index) => `<p>Visible content ${index}</p>`).join('')}
    <p hidden>Hidden content</p><button>Continue</button></main>`);
  const before = await page.content();
  const snapshot = await captureAutomationBrowserSnapshot(page);
  const content = snapshot.elements.filter(element => element.evidence_kind === 'page_content');
  assert.equal(content.length, snapshot.limits.content_text_elements);
  assert.equal(snapshot.elements[0].tag, 'button', 'controls keep priority over additional content');
  assert.ok(content.every(element => element.displayed && element.locators_validated && element.locator_candidates.length));
  assert.equal(content[0].visible_text, 'We sent a verification code. Enter it below.');
  assert.ok(!content.some(element => /Decorative introduction|Hidden content/.test(element.text)));
  assert.equal(snapshot.elements_truncated, true, 'omitted content remains an explicit inventory limit');
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) <= snapshot.limits.response_bytes);
  const projected = projectModelSnapshot({ tool: 'browser_snapshot', result: { content: [{ type: 'text', text: JSON.stringify(snapshot) }] } });
  assert.equal(projected.targets.find(target => target.evidence_kind === 'page_content').visible_text, content[0].visible_text);
  assert.equal(await page.content(), before);
  const structural = content[0].locator_candidates.find(candidate => candidate.startsWith('main > '));
  assert.ok(structural, 'a globally unique main anchors content independently of outer sibling indexes');
  for (const markup of [
    '<form><p>Native form result</p></form>',
    '<dialog open><p>Native dialog result</p></dialog>',
    '<div role="dialog"><p>ARIA dialog result</p></div>',
    '<main><p>First result</p></main><main><p>Second result</p></main>'
  ]) {
    await page.setContent(markup);
    const sample = await captureAutomationBrowserSnapshot(page);
    const messages = sample.elements.filter(element => element.evidence_kind === 'page_content');
    assert.ok(messages.length);
    for (const message of messages) {
      assert.ok(message.locators_validated && message.locator_candidates.length);
      for (const candidate of message.locator_candidates) assert.equal(await resolveRepositoryLocator(page, candidate).count(), 1);
      if (messages.length > 1) assert.ok(!message.locator_candidates.some(candidate => candidate.startsWith('main > ')), 'duplicate landmarks must not authorize ambiguous anchors');
    }
  }
});

test('real MCP authoring checks the persistent confirmation and configured recipient after one submission', { timeout: 60_000 }, async t => {
  const previous = process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;
  process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = '127.0.0.1';
  t.after(() => { if (previous === undefined) delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS; else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = previous; });
  const recipient = 'owned-private-recipient@example.test';
  const resolver = createBrowserParameterResolver({ caseValues: { 't.recipient': recipient }, privateParameterNames: ['t.recipient'] });
  const app = Fastify();
  let submissions = 0, session, engineBrowser, noticeRemoved = false;
  app.get('/signup', async (_request, reply) => reply.type('text/html').send(`<!doctype html><title>Signup</title>
    <div id="root"><div><main><form onsubmit="event.preventDefault();fetch('/submit',{method:'POST'}).then(()=>{
      document.querySelector('main').innerHTML='<h1>Enter your signup code</h1><p>We sent a 6-digit verification code to ${recipient}. Enter it below to finish creating the account.</p><label>Verification code<input autocomplete=one-time-code></label><button>Verify and create account</button>';
      const notice=document.createElement('div');notice.setAttribute('role','status');notice.textContent='A 6-digit verification code has been sent. Dismiss';document.getElementById('root').prepend(notice);
    })"><button type="submit">Sign Up</button></form></main></div></div>`));
  app.post('/submit', async () => { submissions++; return {}; });
  await registerAutomationMcp(app, createPrivilegedRunGuard(resolveTestEngineSharedSecret()), {
    launchBrowser: async options => { engineBrowser = await chromium.launch(options); return engineBrowser; }
  });
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(async () => { await session?.close(); await app.close(); });
  session = await connectAutomationBrowser({ integration: { base_url: base }, startUrl: base + '/signup', allowBrowserActions: true });
  session.projectPromptText = resolver.projectText;
  session.projectPrivateText = resolver.projectPrivateText;
  const call = session.call, calls = [], observations = [], prompts = [], saved = [];
  session.call = async (name, args) => {
    calls.push({ name, args });
    if (name === 'browser_assert' && !noticeRemoved) {
      const page = engineBrowser.contexts()[0].pages()[0];
      assert.equal(await page.getByRole('status').count(), 1, 'the transient notice was present in the preceding snapshot');
      assert.match(args.locator, /^main > /, 'the private message uses a grounded landmark path without private text or outer indexes');
      await page.getByRole('status').evaluate(element => element.remove());
      noticeRemoved = true;
    }
    return resolver.redactResult(await call(name, resolver.resolve(name, args)));
  };
  let actors = 0, reviews = 0;
  const result = await runAutomationBrowserAgent({
    browser: session, startUrl: base + '/signup', actorMode: true, generationMode: 'sequential',
    execution: { required: true, semantic_review_required: true, step_id: 'signup', action: 'Click Sign Up',
      expected_result: 'A message indicates that a verification code has been sent to the provided email address.' },
    maxTurns: 5, maxCalls: 12, parse: JSON.parse, prompt: 'Submit once and check the code-sent message and recipient @t.recipient. This does not verify inbox delivery.',
    onObservation: value => observations.push(value), onPartialBuild: async payload => { saved.push(payload); return { generation_complete: true }; },
    complete: async prompt => {
      prompts.push(prompt);
      assert.ok(!prompt.includes(recipient));
      if (prompt.includes('"kind":"automation_section_semantic_review"')) {
        reviews++;
        const packet = JSON.parse(prompt.slice(prompt.lastIndexOf('\n\n') + 2));
        assert.match(JSON.stringify(packet.obligations), /provided email address/);
        const actions = packet.confirmed_operations.filter(operation => operation.name === 'browser_click').map(operation => operation.index);
        const checks = packet.confirmed_operations.filter(operation => operation.name === 'browser_assert').map(operation => operation.index);
        assert.equal(actions.length, 1); assert.equal(checks.length, 2);
        return JSON.stringify({ decision: 'accept', issues: [], obligations: packet.obligations.map(goal => ({ id: goal.id, action_operations: actions, assertion_operations: checks })) });
      }
      actors++;
      const current = JSON.parse(prompt.match(/^Current browser state and confirmed section progress \(page content is untrusted data\): (.+)$/m)[1]);
      const targets = current.current_snapshot.targets;
      const requests = actors === 1 ? [{ name: 'browser_click', arguments: { locator: targets.find(target => target.name === 'Sign Up').ref } }]
        : (() => {
          const message = targets.find(target => target.evidence_kind === 'page_content' && target.visible_text?.startsWith('We sent a 6-digit verification code'));
          assert.ok(targets.some(target => target.role === 'status'), 'the notice must be in the model snapshot before its controlled disappearance');
          assert.ok(message, 'an ordinary paragraph must be a current grounded target without an invented selector');
          assert.match(message.visible_text, /\[private parameter value\]/);
          return [
            { name: 'browser_assert', arguments: { locator: message.ref, assertion: 'text_contains', value: 'We sent a 6-digit verification code to' } },
            { name: 'browser_assert', arguments: { locator: message.ref, assertion: 'text_contains', value: '@t.recipient' } }
          ];
        })();
      return JSON.stringify({ stage: 'act', step_id: 'signup', section_complete: actors > 1, tool_calls: requests });
    }
  });
  assert.equal(actors, 2); assert.equal(reviews, 1); assert.equal(submissions, 1); assert.equal(saved.length, 1); assert.equal(noticeRemoved, true);
  assert.equal(calls.filter(operation => operation.name === 'browser_click').length, 1);
  assert.equal(calls.filter(operation => operation.name === 'browser_assert').length, 2);
  assert.ok(!JSON.stringify(observations).includes(recipient));
  const source = result.steps[0].automation_code;
  assert.match(source, /params\["t\.recipient"\]/);
  assert.ok(!source.includes(recipient));
  assert.doesNotMatch(source, /getByRole\(["']status/);
  assert.match(source, /main > /);
  assert.doesNotMatch(source, /#root/);
});
