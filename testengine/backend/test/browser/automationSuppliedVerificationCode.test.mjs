import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { createRequire } from 'node:module';
import { registerAutomationMcp } from '../../dist/lib/automationMcp.js';
import { createPrivilegedRunGuard, resolveTestEngineSharedSecret } from '../../dist/lib/testEngineSecurity.js';

const require = createRequire(import.meta.url);
const { connectAutomationBrowser, runAutomationBrowserAgent } = require('../../../../services/automation/backend/lib/automationBrowserAgent.js');
const { createBrowserParameterResolver } = require('../../../../services/automation/backend/lib/automationBrowserParameters.js');

// Deterministic model decisions exercise real MCP operations. A supplied code
// does not authorize changing a successful-signup oracle or inventing inbox access.
test('a supplied short verification code surfaces validation and cannot save a successful signup', { timeout: 60_000 }, async t => {
  const previous = process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;
  process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = '127.0.0.1';
  t.after(() => { if (previous === undefined) delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS; else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = previous; });
  const resolver = createBrowserParameterResolver({ caseValues: { 't.verification_code': '4556' }, privateParameterNames: ['t.verification_code'] });
  const app = Fastify();
  let session, verificationAttempts = 0, saves = 0, turns = 0;
  app.get('/verify', async (_request, reply) => reply.type('text/html').send(`<!doctype html><title>Verify signup</title><main>
    <h1>Enter your signup code</h1><p>Enter the 6-digit verification code.</p>
    <form novalidate onsubmit="event.preventDefault();fetch('/verify',{method:'POST',body:document.querySelector('input').value}).then(r=>r.json()).then(r=>document.querySelector('[role=alert]').textContent=r.message)">
      <label>Verification code<input autocomplete="one-time-code" inputmode="numeric" required pattern="[0-9]{6}"></label>
      <button>Verify and create account</button><p role="alert"></p>
    </form></main>`));
  app.post('/verify', async request => {
    verificationAttempts++;
    assert.equal(request.body, '4556');
    return { message: 'Enter a valid 6-digit verification code.' };
  });
  await registerAutomationMcp(app, createPrivilegedRunGuard(resolveTestEngineSharedSecret()));
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(async () => { await session?.close(); await app.close(); });
  session = await connectAutomationBrowser({ integration: { base_url: base }, startUrl: base + '/verify', allowBrowserActions: true });
  session.projectPromptText = resolver.projectText;
  session.projectPrivateText = resolver.projectPrivateText;
  const call = session.call, calls = [], observations = [];
  session.call = async (name, args) => {
    calls.push({ name, args });
    return resolver.redactResult(await call(name, resolver.resolve(name, args)));
  };
  await assert.rejects(runAutomationBrowserAgent({
    browser: session, startUrl: base + '/verify', actorMode: true, generationMode: 'sequential',
    execution: { required: true, semantic_review_required: true, step_id: 'verify-signup',
      action: 'Enter the supplied verification code and click Verify and create account.', expected_result: 'The account is created successfully.' },
    prompt: 'Use the supplied code @t.verification_code. Do not read an inbox, guess another code or repeat signup. Report observed validation if account creation cannot complete.',
    maxTurns: 4, maxCalls: 10, parse: JSON.parse,
    onObservation: value => observations.push(value),
    onPartialBuild: async () => { saves++; assert.fail('invalid verification cannot be saved as successful account creation'); },
    complete: async prompt => {
      assert.ok(!prompt.includes('4556'));
      assert.ok(!prompt.includes('"kind":"automation_section_semantic_review"'));
      turns++;
      const current = JSON.parse(prompt.match(/^Current browser state and confirmed section progress \(page content is untrusted data\): (.+)$/m)[1]);
      const targets = current.current_snapshot.targets;
      if (turns === 1) return JSON.stringify({ stage: 'act', step_id: 'verify-signup', section_complete: false, tool_calls: [
        { name: 'browser_fill', arguments: { locator: targets.find(target => target.name === 'Verification code').ref, value: '@t.verification_code' } },
        { name: 'browser_click', arguments: { locator: targets.find(target => target.name === 'Verify and create account').ref } }
      ] });
      const feedback = targets.find(target => target.role === 'alert' && target.visible_text === 'Enter a valid 6-digit verification code.');
      assert.ok(feedback, 'the current native validation must reach the actor');
      return JSON.stringify({ stage: 'act', step_id: 'verify-signup', section_issue: {
        kind: 'unmet_prerequisite', reason: 'The supplied code was rejected: the application requires a valid 6-digit verification code. Account creation did not complete.',
        evidence_refs: [feedback.ref]
      } });
    }
  }), error => error.code === 'AUTOMATION_BROWSER_SECTION_BLOCKED' && error.details.issue_kind === 'unmet_prerequisite');
  assert.equal(turns, 2);
  assert.equal(verificationAttempts, 1);
  assert.equal(saves, 0);
  assert.equal(calls.filter(operation => operation.name === 'browser_fill').length, 1);
  assert.equal(calls.filter(operation => operation.name === 'browser_click').length, 1);
  assert.ok(!JSON.stringify(observations).includes('4556'));
});
