import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { createRequire } from 'node:module';
import { registerAutomationMcp } from '../../dist/lib/automationMcp.js';
import { createPrivilegedRunGuard, resolveTestEngineSharedSecret } from '../../dist/lib/testEngineSecurity.js';

const require = createRequire(import.meta.url);
const { connectAutomationBrowser, runAutomationBrowserAgent } = require('../../../../services/automation/backend/lib/automationBrowserAgent.js');
const { recordedSectionRequests } = require('../../../../services/automation/backend/lib/automationBrowserRecording.js');
const actorState = prompt => JSON.parse(prompt.match(/^Current browser state and confirmed section progress \(page content is untrusted data\): (.+)$/m)[1]);
const reviewPacket = prompt => JSON.parse(prompt.slice(prompt.lastIndexOf('\n\n') + 2));
const target = (current, name) => current.current_snapshot.targets.find(item => item.name === name || item.text === name)?.ref;
const stepId = 'submit-original-case';
const execution = { required: true, step_id: stepId, action: 'Submit the current form once', expected_result: 'The Saved result is displayed.', semantic_review_required: true };
const actor = (requests, complete = false) => JSON.stringify({ stage: 'act', step_id: stepId, section_complete: complete, tool_calls: requests });

async function fixture(t) {
  const previous = process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;
  process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = '127.0.0.1';
  t.after(() => { if (previous === undefined) delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS; else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = previous; });
  let submissions = 0, inputChanges = 0, repairs = 0;
  const app = Fastify();
  app.get('/case', async (_request, reply) => reply.type('text/html').send(`<!doctype html><title>Original case fixture</title>
    <main><label>Supplied name<input data-testid="name" oninput="fetch('/fixture/input',{method:'POST'})"></label>
    <button data-testid="submit" onclick="fetch('/fixture/submit',{method:'POST'}).then(() => document.querySelector('#result').textContent='Saved')">Submit once</button>
    <button data-testid="repair" onclick="fetch('/fixture/repair',{method:'POST'}).then(() => document.querySelector('#result').textContent='Invented passing result')">Force pass</button>
    <p role="status" id="result" data-testid="result">Initial result</p></main>`));
  app.post('/fixture/submit', async () => { submissions++;return {}; });
  app.post('/fixture/input', async () => { inputChanges++;return {}; });
  app.post('/fixture/repair', async () => { repairs++;return {}; });
  await registerAutomationMcp(app, createPrivilegedRunGuard(resolveTestEngineSharedSecret()));
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(() => app.close());
  const session = await connectAutomationBrowser({ integration: { base_url: base }, startUrl: `${base}/case`, allowBrowserActions: true });
  t.after(() => session.close());
  session.projectPromptText = value => value;
  session.projectPrivateText = value => value;
  const originalCall = session.call, calls = [], observations = [];
  session.call = async (name, args) => { calls.push({ name, args });return originalCall(name, args); };
  return { base, session, calls, observations, get submissions() { return submissions; }, get inputChanges() { return inputChanges; }, get repairs() { return repairs; } };
}

function acceptConfirmed(packet) {
  return JSON.stringify({ decision: 'accept', obligations: [{ id: stepId,
    action_operations: packet.confirmed_operations.filter(operation => operation.name !== 'browser_assert').map(operation => operation.index),
    assertion_operations: packet.confirmed_operations.filter(operation => operation.name === 'browser_assert').map(operation => operation.index) }], issues: [] });
}

// Decisions are scripted. All target discovery, clicks, failed/successful
// predicates, mutation counters and resulting protected receipts use Chrome/MCP.
test('failed final check blocks a new fill while read-only correction can verify the unchanged original outcome', { timeout: 90_000 }, async t => {
  const state = await fixture(t);
  let turns = 0, reviews = 0, saves = 0;
  const built = await runAutomationBrowserAgent({ browser: state.session, startUrl: `${state.base}/case`, execution,
    actorMode: true, generationMode: 'sequential', prompt: 'Submit once and check the original Saved result.', maxTurns: 7, maxCalls: 12, parse: JSON.parse,
    onObservation: observation => state.observations.push(observation),
    onPartialBuild: async () => { saves++;assert.equal(reviews, 1);return { generation_complete: true }; },
    complete: async prompt => {
      if (prompt.includes('"kind":"automation_section_semantic_review"')) {
        reviews++;const packet = reviewPacket(prompt);
        assert.ok(packet.unsuccessful_checks.some(item => item.code === 'BROWSER_ASSERTION_NOT_SATISFIED'));
        assert.equal(packet.confirmed_operations.filter(item => item.name === 'browser_click').length, 1);
        assert.equal(packet.confirmed_operations.filter(item => item.name === 'browser_fill').length, 0);
        assert.equal(packet.confirmed_operations.at(-1).arguments.value, 'Saved');
        return acceptConfirmed(packet);
      }
      turns++;const current = actorState(prompt);
      if (turns === 1) return actor([{ name: 'browser_click', arguments: { locator: target(current, 'Submit once') } }]);
      if (turns === 2) return actor([{ name: 'browser_assert', arguments: { assertion: 'text_content', locator: target(current, 'Saved'), value: 'Incorrect model expectation' } }], true);
      if (turns === 3) {
        assert.equal(current.verification_boundary.phase, 'verification_observation_only');assert.equal(current.verification_boundary.actions_allowed, false);
        return actor([{ name: 'browser_fill', arguments: { locator: target(current, 'Supplied name'), value: 'Force a different result' } }]);
      }
      assert.equal(turns, 4);assert.equal(current.verification_boundary.actions_allowed, false);
      assert.equal(state.calls.filter(item => item.name === 'browser_fill').length, 0);
      // Repeating a confirmed action in a cumulative response reconciles its
      // original receipt, then only the corrected read-only predicate executes.
      return actor([{ name: 'browser_click', arguments: { locator: target(current, 'Submit once') } },
        { name: 'browser_assert', arguments: { assertion: 'text_content', locator: target(current, 'Saved'), value: 'Saved' } }], true);
    }
  });
  assert.equal(turns, 4);assert.equal(reviews, 1);assert.equal(saves, 1);
  assert.equal(state.submissions, 1);assert.equal(state.inputChanges, 0);assert.equal(state.repairs, 0);
  assert.equal(state.calls.filter(item => item.name === 'browser_click').length, 1);assert.equal(state.calls.filter(item => item.name === 'browser_fill').length, 0);
  assert.ok(state.observations.some(item => item.tool === 'automation_verification_feedback' && item.mcp_call === false));
  assert.deepEqual(recordedSectionRequests(state.observations, stepId).map(item => item.name), ['browser_navigate', 'browser_click', 'browser_assert']);
  assert.match(built.steps[0].automation_code, /toHaveText\("Saved"\)/);assert.doesNotMatch(built.steps[0].automation_code, /Force a different result|Incorrect model expectation|\.fill\(/);
});

test('repeated new mutations after failed final verification stop before any repair or second submission', { timeout: 90_000 }, async t => {
  const state = await fixture(t);
  let turns = 0, reviews = 0, saves = 0;
  await assert.rejects(runAutomationBrowserAgent({ browser: state.session, startUrl: `${state.base}/case`, execution,
    actorMode: true, generationMode: 'sequential', prompt: 'Submit once and check the original Saved result.', maxTurns: 7, maxCalls: 12, parse: JSON.parse,
    onObservation: observation => state.observations.push(observation), onPartialBuild: async () => { saves++;return { generation_complete: true }; },
    complete: async prompt => {
      if (prompt.includes('"kind":"automation_section_semantic_review"')) { reviews++;assert.fail('failed outcome cannot reach semantic acceptance'); }
      turns++;const current = actorState(prompt);
      if (turns === 1) return actor([{ name: 'browser_click', arguments: { locator: target(current, 'Submit once') } }]);
      if (turns === 2) return actor([{ name: 'browser_assert', arguments: { assertion: 'text_content', locator: target(current, 'Saved'), value: 'Invented passing result' } }], true);
      assert.equal(current.verification_boundary.actions_allowed, false);
      if (turns === 3) return actor([{ name: 'browser_fill', arguments: { locator: target(current, 'Supplied name'), value: 'Invented input' } }]);
      assert.equal(turns, 4);return actor([{ name: 'browser_click', arguments: { locator: target(current, 'Force pass') } }]);
    }
  }), error => error.code === 'AUTOMATION_BROWSER_VERIFICATION_ACTION_STALLED');
  assert.equal(turns, 4);assert.equal(reviews, 0);assert.equal(saves, 0);
  assert.equal(state.submissions, 1);assert.equal(state.inputChanges, 0);assert.equal(state.repairs, 0);
  assert.equal(state.calls.filter(item => item.name === 'browser_click').length, 1);assert.equal(state.calls.filter(item => item.name === 'browser_fill').length, 0);
});

test('an exploratory check before action completion does not block the actual authored fill and submission', { timeout: 90_000 }, async t => {
  const state = await fixture(t);
  let turns = 0, reviews = 0, saves = 0;
  const authored = { ...execution, action: 'Enter Fixture Person in Supplied name, then submit the current form once' };
  const built = await runAutomationBrowserAgent({ browser: state.session, startUrl: `${state.base}/case`, execution: authored,
    actorMode: true, generationMode: 'sequential', prompt: 'Enter the supplied name, submit once, then check Saved.', maxTurns: 7, maxCalls: 12, parse: JSON.parse,
    onObservation: observation => state.observations.push(observation), onPartialBuild: async () => { saves++;return { generation_complete: true }; },
    complete: async prompt => {
      if (prompt.includes('"kind":"automation_section_semantic_review"')) {
        reviews++;const packet = reviewPacket(prompt);assert.ok(packet.unsuccessful_checks.length > 0);return acceptConfirmed(packet);
      }
      turns++;const current = actorState(prompt);
      assert.equal(current.verification_boundary, undefined, 'an exploratory precheck must not close the action phase');
      if (turns === 1) return actor([{ name: 'browser_assert', arguments: { assertion: 'text_content', locator: target(current, 'Initial result'), value: 'Saved' } }]);
      if (turns === 2) return actor([{ name: 'browser_fill', arguments: { locator: target(current, 'Supplied name'), value: 'Fixture Person' } }]);
      if (turns === 3) return actor([{ name: 'browser_click', arguments: { locator: target(current, 'Submit once') } }]);
      assert.equal(turns, 4);return actor([{ name: 'browser_assert', arguments: { assertion: 'text_content', locator: target(current, 'Saved'), value: 'Saved' } }], true);
    }
  });
  assert.equal(turns, 4);assert.equal(reviews, 1);assert.equal(saves, 1);
  assert.equal(state.submissions, 1);assert.ok(state.inputChanges > 0);assert.equal(state.repairs, 0);
  assert.equal(state.calls.filter(item => item.name === 'browser_fill').length, 1);assert.equal(state.calls.filter(item => item.name === 'browser_click').length, 1);
  assert.match(built.steps[0].automation_code, /\.fill\("Fixture Person"\)/);assert.match(built.steps[0].automation_code, /toHaveText\("Saved"\)/);
});
