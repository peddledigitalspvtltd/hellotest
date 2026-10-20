import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { registerAutomationMcp } from '../../dist/lib/automationMcp.js';
import { createPrivilegedRunGuard, resolveTestEngineSharedSecret } from '../../dist/lib/testEngineSecurity.js';

const require = createRequire(import.meta.url);
const { connectAutomationBrowser, runAutomationBrowserAgent } = require('../../../../services/automation/backend/lib/automationBrowserAgent.js');
const { recordedSectionRequests } = require('../../../../services/automation/backend/lib/automationBrowserRecording.js');
const { buildAutomationGoalObligations, goalSourceObligations } = require('../../../../services/automation/backend/lib/automationGoalObligations.js');
const stepId = 'enter-email';
const email = 'fixture@example.test';
const actorState = prompt => JSON.parse(prompt.match(/^Current browser state and confirmed section progress \(page content is untrusted data\): (.+)$/m)[1]);
const reviewPacket = prompt => JSON.parse(prompt.slice(prompt.lastIndexOf('\n\n') + 2));
const target = (current, name) => current.current_snapshot.targets.find(item => item.name === name || item.text === name)?.ref;
const actor = (id, requests, complete = false) => JSON.stringify({ stage: 'act', step_id: id, section_complete: complete, tool_calls: requests });
const entryGoal = { id: stepId, source: 'section', action: 'Enter a valid email address in Email field.', expected_result: 'The email is accepted and the user can proceed to the next step.' };
const entryExecution = () => ({ required: true, step_id: stepId, action: entryGoal.action, expected_result: entryGoal.expected_result,
  obligations: [{ ...entryGoal }], source_obligations: [{ ...entryGoal }], semantic_review_required: true,
  future_actions: [{ step_id: 'submit-signup', action: 'Submit signup form.' }] });

async function fixture(t) {
  const previous = process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;
  process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = '127.0.0.1';
  t.after(() => { if (previous === undefined) delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS; else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS = previous; });
  let submissions = 0, nameInputs = 0, session;
  const app = Fastify();
  app.get('/signup', async (_request, reply) => reply.type('text/html').send(`<!doctype html><title>Signup fixture</title><main>
    <form novalidate onsubmit="event.preventDefault();fetch('/fixture/submit',{method:'POST'}).then(r=>r.json()).then(r=>document.querySelector('[role=alert]').textContent=r.message)">
    <label>Full name<input data-testid="full-name" required oninput="fetch('/fixture/name-input',{method:'POST'})"></label>
    <label>Email<input data-testid="email" type="email" required></label>
    <label>Password<input data-testid="password" type="password" required></label>
    <button type="submit" data-testid="signup">Sign Up</button><p role="alert"></p></form></main>`));
  app.post('/fixture/submit', async () => { submissions++;return { message: 'Password is required.' }; });
  app.post('/fixture/name-input', async () => { nameInputs++;return {}; });
  await registerAutomationMcp(app, createPrivilegedRunGuard(resolveTestEngineSharedSecret()));
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(async () => { await session?.close();await app.close(); });
  session = await connectAutomationBrowser({ integration: { base_url: base }, startUrl: `${base}/signup`, allowBrowserActions: true });
  session.projectPromptText = value => value;
  session.projectPrivateText = value => value;
  const originalCall = session.call, calls = [], observations = [], events = [];
  session.call = async (name, args) => { calls.push({ name, args });return originalCall(name, args); };
  return { base, session, calls, observations, events, get submissions() { return submissions; }, get nameInputs() { return nameInputs; } };
}

function rejectUnprovedProgress(packet) {
  const fill = packet.confirmed_operations.find(item => item.name === 'browser_fill');
  assert.ok(fill?.index);
  assert.ok(packet.confirmed_operations.some(item => item.name === 'browser_assert' && item.arguments.assertion === 'valid'));
  assert.deepEqual(packet.obligations, [entryGoal], 'future actions cannot become current requirements');
  return JSON.stringify({ decision: 'reject', obligations: [{ id: stepId, action_operations: [fill.index], assertion_operations: [] }],
    issues: [{ code: 'expected_result_not_covered', obligation_id: stepId,
      message: 'Native email validity does not establish that the user can proceed while the later password and submission steps are unfinished.' }] });
}

// Model decisions are deterministic. The form, native validity, current target
// discovery, MCP receipts, review packets and submission counts use real Chrome.
test('semantic rejection cannot borrow a later submission to satisfy an email-only section', { timeout: 90_000 }, async t => {
  const state = await fixture(t);
  let turns = 0, reviews = 0, saves = 0;
  await assert.rejects(runAutomationBrowserAgent({ browser: state.session, startUrl: `${state.base}/signup`, execution: entryExecution(),
    actorMode: true, generationMode: 'sequential', prompt: 'Enter the configured email. Keep the later password and submission steps in their authored order.',
    maxTurns: 7, maxCalls: 12, parse: JSON.parse,
    onObservation: observation => state.observations.push(observation), onProgress: event => state.events.push(event),
    onPartialBuild: async () => { saves++;assert.fail('the incomplete expected result cannot be saved'); },
    complete: async prompt => {
      if (prompt.includes('"kind":"automation_section_semantic_review"')) { reviews++;return rejectUnprovedProgress(reviewPacket(prompt)); }
      turns++;const current = actorState(prompt);
      if (turns === 1) return actor(stepId, [
        { name: 'browser_fill', arguments: { locator: target(current, 'Email'), value: email } },
        { name: 'browser_assert', arguments: { assertion: 'valid', locator: target(current, 'Email') } }
      ], true);
      if (turns === 2) {
        assert.equal(reviews, 1);assert.equal(current.semantic_review_feedback.code, 'AUTOMATION_SEMANTIC_REVIEW_REJECTED');
        return actor(stepId, [{ name: 'browser_click', arguments: { locator: target(current, 'Sign Up') } }]);
      }
      assert.equal(turns, 3);assert.equal(state.submissions, 0);
      assert.equal(state.calls.filter(item => item.name === 'browser_click').length, 0);
      assert.equal(current.latest_failure.kind, 'action_order');
      assert.equal(current.latest_failure.code, 'AUTOMATION_BROWSER_ACTION_OUT_OF_ORDER');
      assert.equal(current.pending_contract.next_required, 'report_current_step_ordering_conflict_or_supported_readiness_check');
      assert.ok(current.current_snapshot.observation_id);
      return JSON.stringify({ stage: 'act', step_id: stepId, tool_calls: [], section_issue: {
        kind: 'expectation_mismatch', reason: 'The email is natively valid, but proceeding requires password entry and the later authored submission. This entry-only step cannot prove that outcome.',
        evidence_refs: [current.current_snapshot.observation_id]
      } });
    }
  }), error => error.code === 'AUTOMATION_BROWSER_SECTION_BLOCKED' && error.details.issue_kind === 'expectation_mismatch');
  assert.equal(turns, 3);assert.equal(reviews, 1);assert.equal(saves, 0);assert.equal(state.submissions, 0);
  assert.equal(state.calls.filter(item => item.name === 'browser_fill').length, 1);
  assert.equal(state.calls.filter(item => item.name === 'browser_click').length, 0);
  assert.ok(state.observations.some(item => item.mcp_call === false && JSON.stringify(item.result).includes('AUTOMATION_BROWSER_ACTION_OUT_OF_ORDER')));
  assert.deepEqual(recordedSectionRequests(state.observations, stepId).map(item => item.name), ['browser_navigate', 'browser_fill', 'browser_assert']);
});

test('a current authored submission remains executable when another submission is also scheduled later', { timeout: 90_000 }, async t => {
  const state = await fixture(t);
  const goal = { id: 'submit-current', source: 'section', action: 'Submit signup form.', expected_result: 'Password is required.' };
  const execution = { required: true, step_id: goal.id, action: goal.action, expected_result: goal.expected_result,
    obligations: [{ ...goal }], source_obligations: [{ ...goal }], semantic_review_required: true,
    future_actions: [{ step_id: 'submit-again', action: 'Submit signup form.' }] };
  let turns = 0, reviews = 0, saves = 0;
  const built = await runAutomationBrowserAgent({ browser: state.session, startUrl: `${state.base}/signup`, execution,
    actorMode: true, generationMode: 'sequential', prompt: 'Submit the current fixture and check the authored password validation.',
    maxTurns: 5, maxCalls: 12, parse: JSON.parse,
    onObservation: observation => state.observations.push(observation),
    onPartialBuild: async () => { saves++;return { generation_complete: true }; },
    complete: async prompt => {
      if (prompt.includes('"kind":"automation_section_semantic_review"')) {
        reviews++;const packet = reviewPacket(prompt);
        const click = packet.confirmed_operations.find(item => item.name === 'browser_click');
        const assertion = packet.confirmed_operations.find(item => item.name === 'browser_assert');
        assert.ok(click?.index && assertion?.index);assert.equal(state.submissions, 1);
        return JSON.stringify({ decision: 'accept', obligations: [{ id: goal.id, action_operations: [click.index], assertion_operations: [assertion.index] }], issues: [] });
      }
      turns++;const current = actorState(prompt);
      if (turns === 1) return actor(goal.id, [{ name: 'browser_click', arguments: { locator: target(current, 'Sign Up') } }]);
      assert.equal(turns, 2);
      return actor(goal.id, [{ name: 'browser_assert', arguments: { assertion: 'text_content', locator: target(current, 'Password is required.'), value: 'Password is required.' } }], true);
    }
  });
  assert.equal(turns, 2);assert.equal(reviews, 1);assert.equal(saves, 1);assert.equal(state.submissions, 1);
  assert.equal(state.calls.filter(item => item.name === 'browser_click').length, 1);
  assert.match(built.steps[0].automation_code, /\.click\(\)/);assert.match(built.steps[0].automation_code, /toHaveText\("Password is required\."\)/);
});

test('a second rejected evidence set ends with its semantic diagnosis before another actor or generic model-budget failure', { timeout: 90_000 }, async t => {
  const state = await fixture(t);
  let turns = 0, reviews = 0, saves = 0;
  await assert.rejects(runAutomationBrowserAgent({ browser: state.session, startUrl: `${state.base}/signup`, execution: entryExecution(),
    actorMode: true, generationMode: 'sequential', prompt: 'Enter the configured email and preserve the exact expected result.',
    maxTurns: 5, maxCalls: 12, parse: JSON.parse,
    onObservation: observation => state.observations.push(observation),
    onPartialBuild: async () => { saves++;assert.fail('rejected evidence cannot be saved'); },
    complete: async prompt => {
      if (prompt.includes('"kind":"automation_section_semantic_review"')) {
        reviews++;const packet = reviewPacket(prompt);
        assert.equal(packet.confirmed_operations.filter(item => item.name === 'browser_assert').length, reviews);
        return rejectUnprovedProgress(packet);
      }
      turns++;const current = actorState(prompt);
      if (turns === 1) return actor(stepId, [
        { name: 'browser_fill', arguments: { locator: target(current, 'Email'), value: email } },
        { name: 'browser_assert', arguments: { assertion: 'valid', locator: target(current, 'Email') } }
      ], true);
      assert.equal(turns, 2, 'two rejections must not dispatch a third actor call');
      assert.equal(current.semantic_review_feedback.code, 'AUTOMATION_SEMANTIC_REVIEW_REJECTED');
      return actor(stepId, [{ name: 'browser_assert', arguments: { assertion: 'value', locator: target(current, 'Email'), value: email } }], true);
    }
  }), error => {
    assert.equal(error.code, 'AUTOMATION_SEMANTIC_REVIEW_EXHAUSTED');assert.equal(error.nonRetryable, true);
    assert.equal(error.details.review_count, 2);assert.equal(error.details.latest_semantic_review.code, 'AUTOMATION_SEMANTIC_REVIEW_REJECTED');
    assert.equal(error.details.latest_semantic_review.issues[0].code, 'expected_result_not_covered');return true;
  });
  assert.equal(turns, 2);assert.equal(reviews, 2);assert.equal(saves, 0);assert.equal(state.submissions, 0);
  assert.equal(state.calls.filter(item => item.name === 'browser_fill').length, 1);
  assert.equal(state.calls.filter(item => item.name === 'browser_click').length, 0);
  assert.equal(state.calls.filter(item => item.name === 'browser_assert').length, 2);
});

test('full name entered without errors maps value and selected-field validation to the section and linked manual step without replay or submission', { timeout: 90_000 }, async t => {
  const state = await fixture(t), fullName = 'Fixture Full Name';
  const section = { id: 'enter-full-name', action: 'Enter a valid full name in the Full name field.', expected_result: 'Full name entered without errors.' };
  const manualCases = [{ id: 'linked-manual-case', steps: [{ id: 'manual-full-name', action: section.action, expected_result: section.expected_result }] }];
  const obligations = buildAutomationGoalObligations({ section, manualCases, activeManualStepIds: ['manual-full-name'] });
  const execution = { required: true, step_id: section.id, action: section.action, expected_result: section.expected_result,
    obligations, source_obligations: goalSourceObligations({ section, manualCases, obligations }), semantic_review_required: true,
    future_actions: [{ step_id: 'enter-email', action: 'Enter email.' }, { step_id: 'enter-password', action: 'Enter password.' }, { step_id: 'submit-signup', action: 'Submit signup form.' }] };
  let actors = 0, reviews = 0, saves = 0;
  const built = await runAutomationBrowserAgent({ browser: state.session, startUrl: `${state.base}/signup`, execution,
    actorMode: true, generationMode: 'sequential', prompt: 'Enter the full name and check this selected field has no validation errors. Later email, password and submission steps are unfinished.',
    maxTurns: 4, maxCalls: 10, parse: JSON.parse,
    onObservation: observation => state.observations.push(observation),
    onPartialBuild: async () => { saves++;assert.equal(reviews,1);return { generation_complete: true }; },
    complete: async prompt => {
      if (prompt.includes('"kind":"automation_section_semantic_review"')) {
        reviews++;const packet = reviewPacket(prompt);
        if (process.env.QAIRA_FIELD_VALID_REVIEW_PACKET) await writeFile(process.env.QAIRA_FIELD_VALID_REVIEW_PACKET,JSON.stringify(packet,null,2));
        assert.deepEqual(packet.obligations,obligations.map(({id,source,action,expected_result})=>({id,source,action,expected_result})));
        const fill = packet.confirmed_operations.find(item => item.name === 'browser_fill');
        const checks = packet.confirmed_operations.filter(item => item.name === 'browser_assert');
        assert.deepEqual(checks.map(item=>item.arguments.assertion),['value','field_valid']);
        assert.equal(checks[0].arguments.locator,checks[1].arguments.locator);
        assert.equal(state.nameInputs,1);assert.equal(state.submissions,0);
        return JSON.stringify({decision:'accept',obligations:obligations.map(goal=>({id:goal.id,action_operations:[fill.index],assertion_operations:checks.map(item=>item.index)})),issues:[]});
      }
      actors++;const current = actorState(prompt), locator = target(current,'Full name');assert.ok(locator);
      if (actors === 1) return actor(section.id,[{name:'browser_fill',arguments:{locator,value:fullName}}]);
      assert.equal(actors,2);
      return actor(section.id,[{name:'browser_assert',arguments:{assertion:'value',locator,value:fullName}},{name:'browser_assert',arguments:{assertion:'field_valid',locator}}],true);
    }
  });
  assert.equal(actors,2);assert.equal(reviews,1);assert.equal(saves,1);assert.equal(state.nameInputs,1);assert.equal(state.submissions,0);
  assert.equal(state.calls.filter(item=>item.name==='browser_fill').length,1);assert.equal(state.calls.filter(item=>item.name==='browser_click').length,0);
  assert.match(built.steps[0].automation_code,/readFieldValidationState/);
  assert.deepEqual(recordedSectionRequests(state.observations,section.id).map(item=>item.name),['browser_navigate','browser_fill','browser_assert','browser_assert']);
});

test('field-validation correction performed before completion acknowledgement reopens review without another fill or submission', { timeout: 90_000 }, async t => {
  const state = await fixture(t), fullName = 'Fixture Corrected Name';
  const goal = { id: 'correct-name-evidence', source: 'section', action: 'Enter a valid full name in the Full name field.', expected_result: 'Full name entered without errors.' };
  const execution = { required: true, step_id: goal.id, action: goal.action, expected_result: goal.expected_result,
    obligations: [goal], source_obligations: [goal], semantic_review_required: true,
    future_actions: [{ step_id: 'enter-email', action: 'Enter email.' }, { step_id: 'submit-signup', action: 'Submit signup form.' }] };
  let actors = 0, reviews = 0, saves = 0;
  const built = await runAutomationBrowserAgent({ browser: state.session, startUrl: `${state.base}/signup`, execution,
    actorMode: true, generationMode: 'sequential', prompt: 'Preserve the scoped input and validate its entered-without-errors outcome.',
    maxTurns: 6, maxCalls: 12, parse: JSON.parse, onObservation: item => state.observations.push(item),
    onPartialBuild: async () => { saves++;assert.equal(reviews, 1);return { generation_complete: true }; },
    complete: async prompt => {
      if (prompt.includes('"kind":"automation_section_semantic_review"')) {
        reviews++;assert.equal(reviews, 1);assert.equal(saves, 0);
        const packet = reviewPacket(prompt), fill = packet.confirmed_operations.find(item => item.name === 'browser_fill');
        const checks = packet.confirmed_operations.filter(item => item.name === 'browser_assert');
        assert.deepEqual(checks.map(item => item.arguments.assertion), ['value', 'field_valid']);
        return JSON.stringify({ decision: 'accept', obligations: [{ id: goal.id, action_operations: [fill.index], assertion_operations: checks.map(item => item.index) }], issues: [] });
      }
      actors++;const current = actorState(prompt), locator = target(current, 'Full name');
      if (actors === 1) return actor(goal.id, [{ name: 'browser_fill', arguments: { locator, value: fullName } }]);
      if (actors === 2) return actor(goal.id, [{ name: 'browser_assert', arguments: { assertion: 'value', locator, value: fullName } }], true);
      if (actors === 3) {
        assert.equal(current.semantic_review_feedback.code, 'AUTOMATION_SEMANTIC_REVIEW_REJECTED');
        assert.equal(current.recorded_section.completion_available, false);
        return actor(goal.id, [{ name: 'browser_assert', arguments: { assertion: 'field_valid', locator } }]);
      }
      assert.equal(actors, 4);assert.equal(reviews, 0);assert.equal(saves, 0);
      assert.equal(current.semantic_review_feedback.applies_to, 'previous_candidate');
      assert.equal(current.recorded_section.completion_available, true);
      assert.equal(current.recorded_section.semantic_review_status, 'pending');
      assert.equal(current.pending_contract.next_required, 'model_goal_acknowledgement');
      return actor(goal.id, [], true);
    }
  });
  assert.equal(actors, 4);assert.equal(reviews, 1);assert.equal(saves, 1);
  assert.equal(state.nameInputs, 1);assert.equal(state.submissions, 0);
  assert.equal(state.calls.filter(item => item.name === 'browser_fill').length, 1);
  assert.equal(state.calls.filter(item => item.name === 'browser_click').length, 0);
  assert.match(built.steps[0].automation_code, /readFieldValidationState/);
});
