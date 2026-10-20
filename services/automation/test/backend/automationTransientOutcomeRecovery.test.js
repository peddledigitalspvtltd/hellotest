const test = require('node:test');
const assert = require('node:assert/strict');
const { runAutomationBrowserAgent } = require('../../backend/lib/automationBrowserAgent');

const receipt = value => ({ content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', url: 'https://app.test/auth', ...value }) }] });
const element = (tag, role, text, locator) => ({ tag, accessible_role: role, accessible_name: text, text,
  displayed: true, locators_validated: true, locator_candidates: [locator], ...(tag === 'button' ? { attributes: { type: 'submit' } } : {}) });
const snapshot = (id, elements) => receipt({ observation_id: id, scope: 'body', elements,
  accessibility: elements.map(row => `- ${row.accessible_role}: ${row.text}`).join('\n') });
const current = prompt => JSON.parse(prompt.match(/^Current browser state and confirmed section progress .*?: (.+)$/m)[1]);
const actor = (tool_calls, section_complete = false) => JSON.stringify({ stage: 'act', step_id: 'signup', section_complete, tool_calls });

function fixture() {
  const calls = [], saved = [], observations = [], events = [];
  const initial = snapshot('signup-form', [element('button', 'button', 'Sign Up', '#signup')]);
  const persistent = element('p', 'paragraph', 'We sent a verification code. Enter it below to finish creating the account.', '#confirmation');
  const toast = element('div', 'status', 'A verification code has been sent. Dismiss', '#toast');
  const destination = element('h1', 'heading', 'Enter your signup code', '#code-heading');
  let reads = 0, assertions = 0;
  return { calls, saved, observations, events, options: {
    browser: { tools: ['browser_click', 'browser_assert', 'browser_snapshot'].map(name => ({ name, inputSchema: { type: 'object' } })),
      projectPromptText: value => value, call: async (name, args) => {
        calls.push({ name, args });
        if (name === 'browser_snapshot') return ++reads === 1 ? snapshot('signup-toast', [toast, persistent, destination]) : snapshot('signup-code-form', [persistent, destination]);
        if (name === 'browser_assert') return ++assertions === 1 ? { isError: true, ...receipt({ code: 'BROWSER_ASSERTION_NOT_SATISFIED',
          action_outcome: 'not_attempted', assertion_outcome: 'not_satisfied' }) } : receipt({ assertion_outcome: 'satisfied' });
        return receipt({ action_outcome: 'completed' });
      } }, actorMode: true, parse: JSON.parse, maxTurns: 8, maxCalls: 12,
    execution: { required: true, semantic_review_required: true, step_id: 'signup', action: 'Click Sign Up', expected_result: 'A verification code is sent and the account can be verified.' },
    prompt: 'Click Sign Up and confirm that the verification code was sent.', initialObservations: [{ tool: 'browser_snapshot', result: initial }],
    onObservation: value => observations.push(value), onProgress: value => events.push(value),
    onPartialBuild: async payload => { saved.push(payload); return { generation_complete: true }; }
  } };
}

test('a disappearing toast receives one bounded outcome reassessment and the persistent confirmation is compiled without resubmitting', async () => {
  const state = fixture(); let actors = 0, reviews = 0;
  const result = await runAutomationBrowserAgent({ ...state.options, complete: async prompt => {
    if (prompt.includes('"phase":"semantic_review"')) {
      reviews++;
      const packet = JSON.parse(prompt.split('\n').at(-1));
      assert.match(JSON.stringify(packet), /A verification code is sent and the account can be verified/);
      return JSON.stringify({ decision: 'accept', issues: [], obligations: packet.obligations.map(goal => ({ id: goal.id,
        action_operations: [1], assertion_operations: [2] })) });
    }
    const page = current(prompt), targets = page.current_snapshot.targets;
    if (++actors === 1) return actor([{ name: 'browser_click', arguments: { locator: targets[0].ref } }]);
    if (actors === 2) return actor([{ name: 'browser_assert', arguments: { locator: targets.find(target => target.role === 'status').ref,
      assertion: 'text_contains', value: 'A verification code has been sent.' } }], true);
    assert.equal(page.verification_boundary.actions_allowed, false);
    if (actors === 3) return JSON.stringify({ stage: 'act', step_id: 'signup', section_issue: { kind: 'expectation_mismatch',
      reason: 'The expected verification-code-sent message was not observed.', evidence_refs: [page.current_snapshot.observation_id] } });
    assert.equal(actors, 4, 'the correction uses the original actor budget');
    assert.match(prompt, /AUTOMATION_BROWSER_OUTCOME_TARGET_REVIEW_REQUIRED/);
    assert.match(prompt, /do not.*submit again/);
    return actor([{ name: 'browser_assert', arguments: { locator: targets.find(target => target.tag === 'p').ref,
      assertion: 'text_contains', value: 'We sent a verification code.' } }], true);
  } });
  assert.equal(actors, 4); assert.equal(reviews, 1); assert.equal(state.saved.length, 1);
  assert.equal(state.calls.filter(call => call.name === 'browser_click').length, 1);
  assert.deepEqual(state.calls.filter(call => call.name === 'browser_assert').map(call => call.args.locator), ['#toast', '#confirmation']);
  assert.ok(state.observations.some(item => item.tool === 'automation_section_issue_feedback' && item.mcp_call === false));
  assert.match(result.steps[0].automation_code, /#confirmation/);
  assert.doesNotMatch(result.steps[0].automation_code, /#toast/);
  assert.equal((result.steps[0].automation_code.match(/\.click\(/g) || []).length, 1);
});

test('repeating the same absence-only report stops after one correction without another assertion, action or save', async () => {
  const state = fixture(); let actors = 0;
  await assert.rejects(runAutomationBrowserAgent({ ...state.options, complete: async prompt => {
    const page = current(prompt), targets = page.current_snapshot.targets;
    if (++actors === 1) return actor([{ name: 'browser_click', arguments: { locator: targets[0].ref } }]);
    if (actors === 2) return actor([{ name: 'browser_assert', arguments: { locator: targets.find(target => target.role === 'status').ref,
      assertion: 'text_contains', value: 'A verification code has been sent.' } }], true);
    return JSON.stringify({ stage: 'act', step_id: 'signup', section_issue: { kind: 'expectation_mismatch',
      reason: 'The required confirmation was not established.', evidence_refs: [page.current_snapshot.observation_id] } });
  } }), { code: 'AUTOMATION_BROWSER_SECTION_BLOCKED', nonRetryable: true });
  assert.equal(actors, 4);
  assert.equal(state.calls.filter(call => call.name === 'browser_click').length, 1);
  assert.equal(state.calls.filter(call => call.name === 'browser_assert').length, 1);
  assert.equal(state.saved.length, 0);
  assert.equal(state.observations.filter(item => item.tool === 'automation_section_issue_feedback').length, 1);
});

test('outcome recovery can discover a missing persistent paragraph through an observed main landmark without another business action', async () => {
  const state = fixture(); let actors = 0, reads = 0, assertions = 0;
  const main = element('main', 'main', 'Account verification', '#main');
  const heading = element('h1', 'heading', 'Enter your signup code', '#code-heading');
  const paragraph = element('p', 'paragraph', 'We sent a verification code. Enter it below to finish creating the account.', '#confirmation');
  const complete = async prompt => {
    if (prompt.includes('"phase":"semantic_review"')) {
      const packet = JSON.parse(prompt.split('\n').at(-1));
      return JSON.stringify({ decision: 'accept', issues: [], obligations: packet.obligations.map(goal => ({ id: goal.id,
        action_operations: [1], assertion_operations: [2] })) });
    }
    const page = current(prompt), targets = page.current_snapshot.targets;
    if (++actors === 1) return actor([{ name: 'browser_click', arguments: { locator: targets[0].ref } }]);
    if (actors === 2) return actor([{ name: 'browser_assert', arguments: { locator: targets.find(target => target.role === 'status').ref,
      assertion: 'text_contains', value: 'A verification code has been sent.' } }], true);
    assert.equal(page.verification_boundary.actions_allowed, false);
    if (actors === 3) return JSON.stringify({ stage: 'act', step_id: 'signup', section_issue: { kind: 'expectation_mismatch',
      reason: 'The verification-code-sent notification was not observed.', evidence_refs: [page.current_snapshot.observation_id] } });
    if (actors === 4) {
      assert.match(prompt, /AUTOMATION_BROWSER_OUTCOME_TARGET_REVIEW_REQUIRED/);
      return actor([{ name: 'browser_snapshot', arguments: { locator: targets.find(target => target.role === 'main').ref } }]);
    }
    assert.equal(actors, 5);
    return actor([{ name: 'browser_assert', arguments: { locator: targets.find(target => target.tag === 'p').ref,
      assertion: 'text_contains', value: 'We sent a verification code.' } }], true);
  };
  await runAutomationBrowserAgent({ ...state.options, browser: { ...state.options.browser,
    call: async (name, args) => {
      state.calls.push({ name, args });
      if (name === 'browser_snapshot') {
        reads++;
        if (args.locator) {
          assert.equal(args.locator, '#main');
          return receipt({ observation_id: 'scoped-account-verification', scope: '#main', elements: [paragraph, heading],
            accessibility: '- paragraph: We sent a verification code. Enter it below to finish creating the account.' });
        }
        return receipt({ observation_id: `account-verification-${reads}`, scope: 'body', elements: [main, heading,
          ...(reads === 1 ? [element('div', 'status', 'A verification code has been sent. Dismiss', '#toast')] : [])],
        accessibility: '- main:\n  - paragraph: We sent a verification code. Enter it below to finish creating the account.' });
      }
      if (name === 'browser_assert') return ++assertions === 1 ? { isError: true, ...receipt({ code: 'BROWSER_ASSERTION_NOT_SATISFIED',
        action_outcome: 'not_attempted', assertion_outcome: 'not_satisfied' }) } : receipt({ assertion_outcome: 'satisfied' });
      return receipt({ action_outcome: 'completed' });
    }
  }, complete });
  assert.equal(actors, 5); assert.equal(reads, 3); assert.equal(state.saved.length, 1);
  assert.equal(state.calls.filter(call => call.name === 'browser_click').length, 1);
  assert.equal(state.calls.filter(call => call.name === 'browser_snapshot' && call.args.locator === '#main').length, 1);
  assert.match(state.saved[0].steps[0].automation_code, /#confirmation/);
  assert.doesNotMatch(state.saved[0].steps[0].automation_code, /#toast/);
});
