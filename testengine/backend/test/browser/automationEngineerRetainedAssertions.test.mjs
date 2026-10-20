import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { createRequire } from 'node:module';
import { registerAutomationMcp } from '../../dist/lib/automationMcp.js';
import { createPrivilegedRunGuard, resolveTestEngineSharedSecret } from '../../dist/lib/testEngineSecurity.js';

const require = createRequire(import.meta.url);
const { connectAutomationBrowser, runAutomationBrowserAgent } = require('../../../../services/automation/backend/lib/automationBrowserAgent.js');
const { createRetainedAssertionContract } = require('../../../../services/automation/backend/lib/automationRetainedAssertions.js');
const { compileRecordedProgram } = require('../../../../services/automation/backend/lib/automationRecordedProgram.js');
const { recordedSectionRequests } = require('../../../../services/automation/backend/lib/automationBrowserRecording.js');
const { deriveProgramTools } = require('../../../../services/automation/backend/lib/automationProgramTools.js');
const { preserveGeneratedAssertions } = require('../../../../services/automation/backend/lib/automationGeneratedProgram.js');

const stepId = 'retained-account-page';
const formLocator = 'getByTestId("account-form-heading")';
const currentState = prompt => JSON.parse(prompt.match(/^Current browser state and confirmed section progress \(page content is untrusted data\): (.+)$/m)[1]);
const semanticPacket = prompt => prompt.includes('"kind":"automation_section_semantic_review"')
  ? JSON.parse(prompt.slice(prompt.lastIndexOf('\n\n') + 2)) : null;

async function fixture(t, { wrongSavedUrl = false } = {}) {
  const previous = process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;
  process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = '127.0.0.1';
  t.after(() => { if (previous === undefined) delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS; else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = previous; });
  const app = Fastify();
  let visits = 0, submissions = 0;
  app.get('/account', async (_request, reply) => {
    visits++;
    return reply.type('text/html').send(`<!doctype html><title>Retained account form</title><main>
      <form aria-label="Account form" data-testid="account-form" onsubmit="event.preventDefault();fetch('/submitted',{method:'POST'})">
        <h1 data-testid="account-form-heading">Account form</h1>
        <label>Email<input type="email" autocomplete="username"></label><button type="submit">Sign in</button>
      </form></main>`);
  });
  app.post('/submitted', async () => { submissions++;return {}; });
  await registerAutomationMcp(app, createPrivilegedRunGuard(resolveTestEngineSharedSecret()));
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(() => app.close());
  const url = `${base}/account`, expectedUrl = wrongSavedUrl ? `${base}/different-saved-route` : url;
  const originalOperations = [
    { name: 'browser_navigate', arguments: { url } },
    { name: 'browser_assert', arguments: { assertion: 'url', value: expectedUrl } },
    { name: 'browser_assert', arguments: { assertion: 'visible', locator: formLocator } }
  ];
  const savedStep = { id: stepId, step_type: 'web', automation_code: compileRecordedProgram(originalOperations).source };
  const originalStep = structuredClone(savedStep);
  const contract = createRetainedAssertionContract({ step: savedStep });
  assert.equal(contract.status, 'available');assert.equal(contract.final_assertions.length, 2);
  const session = await connectAutomationBrowser({ integration: { base_url: base }, startUrl: url, allowBrowserActions: true });
  t.after(() => session.close());
  const call = session.call, calls = [], observations = [], events = [];
  session.call = async (name, args) => { calls.push({ name, args: structuredClone(args) });return call(name, args); };
  const execution = { required: true, step_id: stepId, action: `Navigate to ${url}`,
    expected_result: 'The account form is visible.', semantic_review_required: true, retained_assertion_contract: contract };
  return { url, expectedUrl, session, savedStep, originalStep, originalOperations, execution, calls, observations, events,
    get visits() { return visits; }, get submissions() { return submissions; } };
}

const actorCompletion = prompt => {
  const form = currentState(prompt).current_snapshot.targets.find(target => target.role === 'heading' && (target.name === 'Account form' || target.text === 'Account form'));
  assert.ok(form?.ref, 'the form heading comes from a real validated Chromium snapshot');
  return JSON.stringify({ stage: 'act', step_id: stepId, section_complete: true,
    tool_calls: [{ name: 'browser_assert', arguments: { assertion: 'visible', locator: form.ref } }] });
};

// Model decisions are scripted; navigation, DOM discovery, saved URL checks,
// protected receipts, source compilation and preservation all use real MCP.
test('real MCP completes the saved assertion suffix in original order before one review and save', { timeout: 60_000 }, async t => {
  const state = await fixture(t);
  let actors = 0, reviews = 0, saves = 0;
  const built = await runAutomationBrowserAgent({ browser: state.session, startUrl: state.url, execution: state.execution,
    actorMode: true, generationMode: 'sequential', prompt: 'Open the account page and check the visible form.',
    maxTurns: 1, maxCalls: 4, parse: JSON.parse,
    onObservation: observation => state.observations.push(observation), onProgress: event => state.events.push(event),
    onPartialBuild: async payload => {
      saves++;assert.equal(reviews, 1);assert.equal(state.visits, 1);
      assert.doesNotThrow(() => preserveGeneratedAssertions(state.savedStep.automation_code, payload.steps[0].automation_code));
      return { generation_complete: true };
    },
    complete: async prompt => {
      const packet = semanticPacket(prompt);
      if (!packet) { actors++;assert.equal(actors, 1);return actorCompletion(prompt); }
      reviews++;assert.equal(saves, 0, 'retained checks precede semantic review and durable source callback');
      const checks = packet.confirmed_operations.filter(operation => operation.name === 'browser_assert');
      assert.deepEqual(checks.map(operation => operation.arguments.assertion), ['visible', 'url', 'visible']);
      assert.equal(checks.find(operation => operation.arguments.assertion === 'url').arguments.value, state.expectedUrl);
      assert.deepEqual(checks.slice(-2).map(({ name, arguments: args }) => ({ name, arguments: args })), state.originalOperations.slice(1),
        'an earlier actor visibility check cannot replace the required visibility check after the saved URL check');
      assert.equal(state.calls.filter(call => call.name === 'browser_assert' && call.args.assertion === 'url').length, 1);
      return JSON.stringify({ decision: 'accept', obligations: [{ id: stepId,
        action_operations: packet.confirmed_operations.filter(operation => operation.name !== 'browser_assert').map(operation => operation.index),
        assertion_operations: checks.map(operation => operation.index) }], issues: [] });
    }
  });
  assert.equal(actors, 1);assert.equal(reviews, 1);assert.equal(saves, 1);
  assert.equal(state.visits, 1);assert.equal(state.submissions, 0);
  assert.equal(state.calls.filter(call => call.name === 'browser_navigate').length, 1);
  assert.deepEqual(state.calls.filter(call => call.name === 'browser_assert').map(call => call.args), [
    { assertion: 'visible', locator: formLocator }, { assertion: 'url', value: state.expectedUrl }, { assertion: 'visible', locator: formLocator }
  ]);
  assert.ok(state.calls.every(call => ['browser_navigate', 'browser_snapshot', 'browser_screenshot', 'browser_assert'].includes(call.name)));
  const confirmed = recordedSectionRequests(state.observations, stepId);
  assert.deepEqual(confirmed.map(operation => operation.name), ['browser_navigate', 'browser_assert', 'browser_assert', 'browser_assert']);
  assert.deepEqual(confirmed.slice(-2), state.originalOperations.slice(1), 'the original ordered suffix is preserved in protected receipts');
  const hostCheck = state.observations.find(observation => observation.tool === 'browser_assert' && observation.arguments.assertion === 'url');
  assert.equal(hostCheck.arguments.value, '[redacted]');assert.ok(hostCheck.action_id);
  assert.equal(JSON.parse(hostCheck.result.content.find(item => item.type === 'text').text).assertion_outcome, 'satisfied');
  const compiled = deriveProgramTools({ payload: built, execution: state.execution });
  assert.deepEqual(compiled, confirmed);
  assert.equal(compiled.filter(operation => operation.name === 'browser_navigate').length, 1);
  assert.equal(compiled.filter(operation => operation.arguments.assertion === 'url').length, 1);
  assert.equal(compiled.filter(operation => operation.arguments.assertion === 'visible').length, 2);
  assert.deepEqual(compiled.slice(-2), state.originalOperations.slice(1), 'compiled source retains the original ordered URL and visibility oracles after the model check');
  assert.deepEqual(state.savedStep, state.originalStep, 'the original saved source is never rewritten by preflight');
});

test('real failed retained URL check stops without another actor, semantic review, save or navigation replay', { timeout: 60_000 }, async t => {
  const state = await fixture(t, { wrongSavedUrl: true });
  let actors = 0, reviews = 0, saves = 0;
  await assert.rejects(runAutomationBrowserAgent({ browser: state.session, startUrl: state.url, execution: state.execution,
    actorMode: true, generationMode: 'sequential', prompt: 'Open the account page and check the visible form.',
    maxTurns: 1, maxCalls: 4, parse: JSON.parse,
    onObservation: observation => state.observations.push(observation), onProgress: event => state.events.push(event),
    onPartialBuild: async () => { saves++;return { generation_complete: true }; },
    complete: async prompt => {
      if (semanticPacket(prompt)) { reviews++;assert.fail('an unsatisfied retained oracle cannot reach semantic review'); }
      actors++;assert.equal(actors, 1);return actorCompletion(prompt);
    }
  }), failure => failure.code === 'AUTOMATION_BROWSER_RETAINED_ASSERTION_FAILED' && failure.nonRetryable === true
    && failure.browser_code === 'BROWSER_ASSERTION_NOT_SATISFIED');
  assert.equal(actors, 1);assert.equal(reviews, 0);assert.equal(saves, 0);
  assert.equal(state.visits, 1);assert.equal(state.submissions, 0);
  assert.equal(state.calls.filter(call => call.name === 'browser_navigate').length, 1);
  assert.deepEqual(state.calls.filter(call => call.name === 'browser_assert').map(call => call.args), [
    { assertion: 'visible', locator: formLocator }, { assertion: 'url', value: state.expectedUrl }
  ]);
  assert.ok(state.calls.every(call => ['browser_navigate', 'browser_snapshot', 'browser_screenshot', 'browser_assert'].includes(call.name)));
  const failedCheck = state.observations.filter(observation => observation.tool === 'browser_assert').at(-1);
  assert.equal(failedCheck.result.isError, true);assert.equal(failedCheck.arguments.value, '[redacted]');
  assert.equal(JSON.parse(failedCheck.result.content.find(item => item.type === 'text').text).code, 'BROWSER_ASSERTION_NOT_SATISFIED');
  assert.deepEqual(recordedSectionRequests(state.observations, stepId).map(operation => operation.name), ['browser_navigate', 'browser_assert']);
  assert.deepEqual(state.savedStep, state.originalStep, 'failed preflight keeps the original source and its exact URL oracle');
});

test('real MCP accepts formatting variations of an observed semantic locator and dispatches its captured alias', { timeout: 60_000 }, async t => {
  const state = await fixture(t);
  const proposedLocator = `page.getByRole('heading', {'name':'Account form','exact':true})`;
  let actors = 0, reviews = 0, saves = 0;
  const built = await runAutomationBrowserAgent({ browser: state.session, startUrl: state.url, execution: state.execution,
    actorMode: true, generationMode: 'sequential', prompt: 'Open the account page and check its exact URL and visible Account form heading.',
    maxTurns: 1, maxCalls: 4, parse: JSON.parse,
    onObservation: observation => state.observations.push(observation), onProgress: event => state.events.push(event),
    onPartialBuild: async payload => {
      saves++;assert.equal(reviews, 1);assert.doesNotThrow(() => preserveGeneratedAssertions(state.savedStep.automation_code, payload.steps[0].automation_code));
      return { generation_complete: true };
    },
    complete: async prompt => {
      const packet = semanticPacket(prompt);
      if (!packet) {
        actors++;
        assert.ok(currentState(prompt).current_snapshot.targets.some(target => target.role === 'heading' && target.name === 'Account form'));
        return JSON.stringify({ stage: 'act', step_id: stepId, section_complete: true, tool_calls: [
          { name: 'browser_assert', arguments: { assertion: 'url', value: state.expectedUrl } },
          { name: 'browser_assert', arguments: { assertion: 'visible', locator: proposedLocator } }
        ] });
      }
      reviews++;
      return JSON.stringify({ decision: 'accept', obligations: [{ id: stepId,
        action_operations: packet.confirmed_operations.filter(operation => operation.name !== 'browser_assert').map(operation => operation.index),
        assertion_operations: packet.confirmed_operations.filter(operation => operation.name === 'browser_assert').map(operation => operation.index)
      }], issues: [] });
    }
  });
  const headingCall = state.calls.find(call => call.name === 'browser_assert' && call.args.locator?.includes('getByRole'));
  assert.ok(headingCall, 'the semantic heading check reaches real Playwright MCP');
  assert.notEqual(headingCall.args.locator, proposedLocator, 'dispatch uses the actual captured alias, not model formatting');
  const snapshot = state.observations.find(observation => observation.tool === 'browser_snapshot');
  const page = JSON.parse(snapshot.result.content.find(item => item.type === 'text').text);
  assert.ok(page.elements.some(element => element.locators_validated === true && element.locator_candidates?.includes(headingCall.args.locator)));
  assert.equal(actors, 1);assert.equal(reviews, 1);assert.equal(saves, 1);
  assert.equal(state.visits, 1);assert.equal(state.submissions, 0);
  assert.equal(state.events.some(event => event.phase === 'automation.agent.target.discovery'), false);
  assert.doesNotThrow(() => preserveGeneratedAssertions(state.savedStep.automation_code, built.steps[0].automation_code));
});
