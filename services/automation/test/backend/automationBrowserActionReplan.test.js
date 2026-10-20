const test = require('node:test');
const assert = require('node:assert/strict');
const { runAutomationBrowserAgent } = require('../../backend/lib/automationBrowserAgent');

const receipt = value => ({ content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', url: 'https://app.test/auth', ...value }) }] });
const snapshot = () => receipt({ observation_id: 'signup-page', accessibility: '- button "Sign up"\n- form "Create account"\n- heading "Account details"', elements: [
  ['button', 'Sign up', '#signup'], ['form', 'Create account', '#form'], ['heading', 'Account details', '#details']
].map(([role, name, locator]) => ({ tag: role === 'button' ? 'button' : 'div', role, accessible_name: name, text: name, displayed: true, locators_validated: true, locator_candidates: [locator] })) });
const click = { name: 'browser_click', occurrence: 1, arguments: { locator: '#signup' } };
const check = locator => ({ name: 'browser_assert', arguments: { assertion: 'visible', locator } });
const actor = (tool_calls = [], section_complete = false) => JSON.stringify({ stage: 'act', step_id: 'signup', section_complete, tool_calls });
const reviewPacket = prompt => prompt.includes('"phase":"semantic_review"') ? JSON.parse(prompt.split('\n').at(-1)) : null;
const verdict = packet => JSON.stringify({ decision: 'accept', issues: [], obligations: packet.obligations.map(item => ({ id: item.id,
  action_operations: packet.confirmed_operations.filter(item => item.name === 'browser_click').map(item => item.index),
  assertion_operations: packet.confirmed_operations.filter(item => item.name === 'browser_assert').slice(-1).map(item => item.index) })) });

function fixture() {
  const calls = [], saves = [], events = [];
  return { calls, saves, events, options: {
    browser: { tools: ['browser_click', 'browser_assert', 'browser_snapshot'].map(name => ({ name, inputSchema: { type: 'object' } })),
      projectPromptText: value => value, call: async (name, args) => {
        calls.push({ name, args });
        return name === 'browser_snapshot' ? snapshot() : receipt(name === 'browser_assert' ? { assertion_outcome: 'satisfied' } : { action_outcome: 'completed' });
      } }, actorMode: true, parse: JSON.parse, maxCalls: 20, initialObservations: [{ tool: 'browser_snapshot', result: snapshot() }],
    prompt: 'Open the sign up form', execution: { required: true, semantic_review_required: true, step_id: 'signup', action: 'Click Sign up', expected_result: 'The Create account form is displayed' },
    onPartialBuild: async payload => { saves.push(payload); return { generation_complete: true }; }, onProgress: async event => events.push(event)
  } };
}

test('two consecutive reconciled-only actor responses stop without dispatching another action or model call', async () => {
  const state = fixture(); let actors = 0, reviews = 0;
  await assert.rejects(runAutomationBrowserAgent({ ...state.options, complete: async prompt => {
    const packet = reviewPacket(prompt);
    if (packet) { reviews++; return verdict(packet); }
    actors++;
    if (actors === 1) return actor([click, check('#form')]);
    if (actors === 3) assert.match(prompt, /BROWSER_ACTION_ALREADY_COMPLETED/);
    return actor([click, click]);
  } }), error => {
    assert.equal(error.code, 'AUTOMATION_BROWSER_ACTION_REPLAN_STALLED');
    assert.equal(error.nonRetryable, true);
    assert.equal(error.details.consecutive_reconciled_only_responses, 2);
    assert.equal(error.details.action_outcome, 'not_attempted');
    assert.doesNotMatch(JSON.stringify(error.details), /#signup|Sign up/);
    return true;
  });
  assert.equal(actors, 3); assert.equal(reviews, 0); assert.equal(state.saves.length, 0);
  assert.equal(state.calls.filter(item => item.name === 'browser_click').length, 1);
  assert.equal(state.calls.filter(item => item.name === 'browser_assert').length, 1);
});

test('a completion request containing only reconciled actions still receives normal review and save', async () => {
  const state = fixture(); let actors = 0, reviews = 0;
  await runAutomationBrowserAgent({ ...state.options, complete: async prompt => {
    const packet = reviewPacket(prompt);
    if (packet) { reviews++; return verdict(packet); }
    actors++;
    return actors === 1 ? actor([click, check('#form')]) : actor([click], actors === 3);
  } });
  assert.equal(actors, 3); assert.equal(reviews, 1); assert.equal(state.saves.length, 1);
  assert.equal(state.calls.filter(item => item.name === 'browser_click').length, 1);
  assert.equal((state.saves[0].steps[0].automation_code.match(/\.click\(/g) || []).length, 1);
});

test('a mixed reconciled action and new expected-result check resets consecutive no-progress responses', async () => {
  const state = fixture(); let actors = 0;
  await runAutomationBrowserAgent({ ...state.options, complete: async prompt => {
    const packet = reviewPacket(prompt);
    if (packet) return verdict(packet);
    actors++;
    if (actors === 1) return actor([click, check('#form')]);
    if (actors === 3) return actor([click, check('#details')]);
    if (actors === 5) return actor([], true);
    return actor([click]);
  } });
  assert.equal(actors, 5); assert.equal(state.saves.length, 1);
  assert.equal(state.calls.filter(item => item.name === 'browser_click').length, 1);
  assert.equal(state.calls.filter(item => item.name === 'browser_assert').length, 2);
});

test('an explicitly requested next operation occurrence executes and resets the no-progress allowance', async () => {
  const state = fixture(); let actors = 0;
  await runAutomationBrowserAgent({ ...state.options, complete: async prompt => {
    const packet = reviewPacket(prompt);
    if (packet) return verdict(packet);
    actors++;
    if (actors === 1) return actor([click, check('#form')]);
    if (actors === 3) return actor([{ ...click, occurrence: 2 }, check('#details')]);
    if (actors === 5) return actor([], true);
    return actor([{ ...click, occurrence: actors === 2 ? 1 : 2 }]);
  } });
  assert.equal(actors, 5); assert.equal(state.saves.length, 1);
  assert.equal(state.calls.filter(item => item.name === 'browser_click').length, 2);
  assert.equal((state.saves[0].steps[0].automation_code.match(/\.click\(/g) || []).length, 2);
});

test('authorized context disclosure between reconciled-only responses resets their consecutive allowance', async () => {
  const state = fixture(); let actors = 0, disclosures = 0;
  await runAutomationBrowserAgent({ ...state.options,
    taskContext: { additionalContext: () => ({}), request: () => ({ request_number: ++disclosures }) },
    complete: async prompt => {
      const packet = reviewPacket(prompt);
      if (packet) return verdict(packet);
      actors++;
      if (actors === 1) return actor([click, check('#form')]);
      if (actors === 3) return JSON.stringify({ actor_context_request: { source: 'linked_manual_case' } });
      if (actors === 5) return actor([], true);
      return actor([click]);
    }
  });
  assert.equal(actors, 5); assert.equal(disclosures, 1); assert.equal(state.saves.length, 1);
  assert.equal(state.calls.filter(item => item.name === 'browser_click').length, 1);
});
