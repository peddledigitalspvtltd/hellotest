const test = require('node:test'), assert = require('node:assert/strict');
const { runAutomationBrowserAgent } = require('../../backend/lib/automationBrowserAgent');
const { createRetainedAssertionContract } = require('../../backend/lib/automationRetainedAssertions');
const { compileRecordedProgram } = require('../../backend/lib/automationRecordedProgram');
const url = 'https://fixture.test/dashboard';
const click = { name: 'browser_click', arguments: { locator: '#login' } };
const checks = [{ name: 'browser_assert', arguments: { assertion: 'url', value: url } }, { name: 'browser_assert', arguments: { assertion: 'visible', locator: '#logout' } }];
const receipt = (value, isError = false) => ({ isError, content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', url, ...value }) }] });
const page = () => receipt({ scope: 'body', observation_id: 'dashboard', elements: ['Login', 'Log Out'].map(name => ({ tag: 'button', accessible_role: 'button', accessible_name: name,
  displayed: true, attributes: { type: 'button' }, locators_validated: true, locator_candidates: [name === 'Login' ? '#login' : '#logout'] })) });
function fixture({ sameBatch = false, fail = false, budget = 12 } = {}) {
  const calls = [], saves = [], source = compileRecordedProgram([click, ...checks]).source;
  const contract = createRetainedAssertionContract({ step: { id: 'current', step_type: 'web', automation_code: source } });
  const goal = { id: 'current', source: 'section', action: 'Click Login', expected_result: 'The dashboard URL and Log Out are visible.' };
  let actors = 0, reviews = 0;
  return { calls, saves, get actors() { return actors; }, get reviews() { return reviews; }, options: {
    browser: { tools: ['browser_click', 'browser_snapshot', 'browser_assert'].map(name => ({ name, inputSchema: { type: 'object' } })), projectPromptText: value => value,
      call: async (name, args) => { calls.push({ name, args }); if (name === 'browser_snapshot') return page(); if (name === 'browser_click') return receipt({ action_outcome: 'completed' });
        return fail && args.assertion === 'visible' ? receipt({ code: 'BROWSER_ASSERTION_NOT_SATISFIED', assertion_outcome: 'not_satisfied', action_outcome: 'not_attempted' }, true) : receipt({ assertion_outcome: 'satisfied' }); } },
    actorMode: true, parse: JSON.parse, maxTurns: 4, maxCalls: budget, prompt: 'Perform the current explicit Login and preserve its saved checks.',
    execution: { required: true, step_id: 'current', action: goal.action, expected_result: goal.expected_result, source_obligations: [goal], obligations: [goal], semantic_review_required: true, retained_assertion_contract: contract },
    initialObservations: [{ tool: 'browser_snapshot', execution_step_id: 'previous', result: page() }],
    onPartialBuild: async payload => { saves.push(payload); return { generation_complete: true }; },
    complete: async prompt => {
      if (prompt.includes('"kind":"automation_section_semantic_review"')) {
        reviews++; const packet = JSON.parse(prompt.split('\n').at(-1)); assert.equal(saves.length, 0);
        return JSON.stringify({ decision: 'accept', obligations: packet.obligations.map(row => ({ id: row.id, action_operations: [1], assertion_operations: [2, 3] })), issues: [] });
      }
      actors++;
      if (actors === 1) return JSON.stringify({ stage: 'act', step_id: 'current', section_complete: sameBatch, tool_calls: [click, ...(sameBatch ? checks : [])] });
      assert.equal(actors, 2); assert.equal(calls.filter(row => row.name === 'browser_assert').length, 2, 'saved native checks run before asking the actor to finish');
      assert.match(prompt, /post_terminal_verification_only/);
      return JSON.stringify({ stage: 'act', step_id: 'current', section_complete: true, tool_calls: [] });
    }
  } };
}

test('a confirmed terminal click runs its trusted saved suffix and requires review and save without another actor acknowledgement', async () => {
  const state = fixture(); const result = await runAutomationBrowserAgent(state.options);
  assert.equal(state.actors, 1); assert.equal(state.reviews, 1); assert.equal(state.saves.length, 1);
  assert.equal(state.calls.filter(row => row.name === 'browser_click').length, 1); assert.deepEqual(state.calls.filter(row => row.name === 'browser_assert').map(row => row.args), checks.map(row => row.arguments));
  assert.equal((result.steps[0].automation_code.match(/\.click\(/g) || []).length, 1);
});
test('checks already confirmed in the terminal batch are never duplicated by the early retained suffix or publish preflight', async () => {
  const state = fixture({ sameBatch: true }); await runAutomationBrowserAgent(state.options);
  assert.equal(state.actors, 1); assert.equal(state.reviews, 1); assert.equal(state.saves.length, 1); assert.equal(state.calls.filter(row => row.name === 'browser_assert').length, 2);
});
test('a failing retained terminal oracle stops before another actor/review/save and never repeats its click', async () => {
  const state = fixture({ fail: true }); await assert.rejects(runAutomationBrowserAgent(state.options), error => error.code === 'AUTOMATION_BROWSER_RETAINED_ASSERTION_FAILED' && error.nonRetryable);
  assert.equal(state.actors, 1); assert.equal(state.reviews, 0); assert.equal(state.saves.length, 0); assert.equal(state.calls.filter(row => row.name === 'browser_click').length, 1); assert.equal(state.calls.filter(row => row.name === 'browser_assert').length, 2);
});
test('early retained checks reserve their whole suffix within the unchanged remaining call budget', async () => {
  const state = fixture({ budget: 2 }); await assert.rejects(runAutomationBrowserAgent(state.options), error => error.code === 'AUTOMATION_BROWSER_TOOL_BUDGET_EXHAUSTED');
  assert.deepEqual(state.calls.map(row=>row.name), ['browser_click'], 'the complete oracle and context allowance is reserved before any post-action read'); assert.equal(state.calls.filter(row => row.name === 'browser_assert').length, 0); assert.equal(state.actors, 1); assert.equal(state.reviews, 0); assert.equal(state.saves.length, 0);
});
