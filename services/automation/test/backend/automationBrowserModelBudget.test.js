const test = require('node:test');
const assert = require('node:assert/strict');
const { runAutomationBrowserAgent } = require('../../backend/lib/automationBrowserAgent');

const receipt = value => ({ content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', url: 'https://app.test/address', ...value }) }] });
const snapshot = () => receipt({ observation_id: 'address-page', accessibility: '- button "Save address"\n- heading "Account"\n- status "Address saved"\n- row "Updated address"', elements: [
  ['button', 'Save address', '#save'], ['heading', 'Account', '#heading'], ['status', 'Address saved', '#status'], ['row', 'Updated address', '#row']
].map(([role, name, locator]) => ({ tag: role === 'button' ? 'button' : 'div', role, accessible_name: name, text: name, displayed: true, locators_validated: true, locator_candidates: [locator] })) });
const click = { name: 'browser_click', arguments: { locator: '#save' } };
const check = locator => ({ name: 'browser_assert', arguments: { assertion: 'visible', locator } });
const actor = (tool_calls, section_complete = true) => JSON.stringify({ stage: 'act', step_id: 'address', section_complete, tool_calls });
const obligation = { id: 'address', source: 'section', action: 'Save the edited address', expected_result: 'Address saved confirmation and updated address row are displayed' };
const reviewPacket = prompt => prompt.includes('"phase":"semantic_review"') ? JSON.parse(prompt.split('\n').at(-1)) : null;
const rejectionIssue = { code: 'expected_result_not_covered', obligation_id: 'address', message: 'Check the saved confirmation and the updated address row.' };
const verdict = (packet, accepted) => JSON.stringify({ decision: accepted ? 'accept' : 'reject',
  obligations: packet.obligations.map(item => ({ id: item.id, action_operations: [1], assertion_operations: accepted
    ? packet.confirmed_operations.filter(item => item.name === 'browser_assert' && ['#status', '#row'].includes(item.arguments.locator)).map(item => item.index) : [] })),
  issues: accepted ? [] : [rejectionIssue] });

function fixture() {
  const calls = [], saves = [], events = [], observations = [];
  return { calls, saves, events, observations, options: {
    browser: { tools: ['browser_click', 'browser_assert', 'browser_snapshot'].map(name => ({ name, inputSchema: { type: 'object' } })),
      projectPromptText: value => value, call: async (name, args) => {
        calls.push({ name, args });
        return name === 'browser_snapshot' ? snapshot() : receipt(name === 'browser_assert' ? { assertion_outcome: 'satisfied' } : { action_outcome: 'completed' });
      } },
    prompt: 'Automate the saved address behavior', execution: { required: true, step_id: 'address', action: obligation.action,
      expected_result: obligation.expected_result, semantic_review_required: true, obligations: [obligation] },
    actorMode: true, parse: JSON.parse, maxCalls: 20, initialObservations: [{ tool: 'browser_snapshot', result: snapshot() }],
    onPartialBuild: async payload => { saves.push(payload); return { generation_complete: true }; },
    onProgress: async event => events.push(event), onObservation: item => observations.push(item)
  } };
}

test('a late rejected candidate stops before an actor correction that cannot receive mandatory review', async () => {
  const state = fixture(); let actors = 0, reviews = 0;
  await assert.rejects(runAutomationBrowserAgent({ ...state.options, maxTurns: 3, complete: async prompt => {
    const packet = reviewPacket(prompt);
    if (packet) { reviews++; return verdict(packet, false); }
    actors++;
    if (actors === 1) return actor([{ name: 'browser_snapshot', arguments: {} }], false);
    if (actors === 2) return actor([click, check('#heading')]);
    return actor([check('#status'), check('#row')]);
  } }), error => {
    assert.equal(error.code, 'AUTOMATION_BROWSER_MODEL_BUDGET_EXHAUSTED');
    assert.equal(error.details.model_call_count, 3);
    assert.equal(error.details.max_model_calls, 4);
    assert.equal(error.details.reserved_semantic_review_calls, 1);
    assert.equal(error.details.latest_semantic_review.issues[0].code, rejectionIssue.code);
    assert.doesNotMatch(JSON.stringify(error.details), /Check the saved confirmation/);
    return true;
  });
  assert.equal(actors, 2); assert.equal(reviews, 1); assert.equal(state.saves.length, 0);
  assert.equal(state.calls.filter(item => item.name === 'browser_click').length, 1);
  assert.equal(state.calls.filter(item => item.args?.locator === '#status').length, 0);
});

test('the final admissible actor correction retains one review call within the unchanged combined cap', async () => {
  const state = fixture(); let actors = 0, reviews = 0;
  await runAutomationBrowserAgent({ ...state.options, maxTurns: 4, complete: async prompt => {
    const packet = reviewPacket(prompt);
    if (packet) { reviews++; return verdict(packet, reviews === 2); }
    actors++;
    if (actors === 1) return actor([{ name: 'browser_snapshot', arguments: {} }], false);
    if (actors === 2) return actor([click, check('#heading')]);
    const budget = JSON.parse(prompt.match(/^Browser tool budget: (.+)$/m)[1]);
    assert.equal(budget.remaining_model_calls, 2);
    assert.equal(budget.remaining_actor_model_calls, 1);
    assert.equal(budget.reserved_semantic_review_calls, 1);
    assert.match(prompt, /HELLOTEST_AI:ai\.automation\.keyword_generation:automationBrowserAgent\.finalTurn/);
    return actor([check('#status'), check('#row')]);
  } });
  assert.equal(actors, 3); assert.equal(reviews, 2); assert.equal(actors + reviews, 5);
  assert.equal(state.saves.length, 1); assert.equal(state.calls.filter(item => item.name === 'browser_click').length, 1);
});

test('a second rejected review immediately preserves its unsatisfied requirements without spending another actor call', async () => {
  const state = fixture(); let actors = 0, reviews = 0;
  await assert.rejects(runAutomationBrowserAgent({ ...state.options, maxTurns: 8, complete: async prompt => {
    const packet = reviewPacket(prompt);
    if (packet) { reviews++; return verdict(packet, false); }
    actors++;
    return actors === 1 ? actor([click, check('#heading')]) : actor([check('#status'), check('#row')]);
  } }), error => {
    assert.equal(error.code, 'AUTOMATION_SEMANTIC_REVIEW_EXHAUSTED');
    assert.equal(error.nonRetryable, true);
    assert.equal(error.details.review_count, 2);
    assert.equal(error.details.latest_semantic_review.code, 'AUTOMATION_SEMANTIC_REVIEW_REJECTED');
    assert.equal(error.details.latest_semantic_review.issues[0].code, rejectionIssue.code);
    assert.doesNotMatch(JSON.stringify(error.details), /Check the saved confirmation/);
    return true;
  });
  assert.equal(actors, 2); assert.equal(reviews, 2); assert.equal(state.saves.length, 0);
  assert.equal(state.calls.filter(item => item.name === 'browser_click').length, 1);
  assert.equal(state.observations.filter(item => item.tool === 'automation_semantic_review_feedback').length, 2);
});

test('a one-actor configuration still fits its mandatory review and never increases the shared provider cap', async () => {
  const state = fixture(); let actors = 0, reviews = 0;
  await runAutomationBrowserAgent({ ...state.options, maxTurns: 1, complete: async prompt => {
    const packet = reviewPacket(prompt);
    if (packet) { reviews++; return verdict(packet, true); }
    actors++; return actor([click, check('#status'), check('#row')]);
  } });
  assert.equal(actors, 1); assert.equal(reviews, 1); assert.equal(state.saves.length, 1);
});
