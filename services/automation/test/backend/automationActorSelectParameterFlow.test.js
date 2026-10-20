const test = require('node:test');
const assert = require('node:assert/strict');
const { runAutomationBrowserAgent } = require('../../backend/lib/automationBrowserAgent');
const { createAutomationInputParameterBinding } = require('../../backend/lib/automationInputParameterBinding');

const result = value => ({ content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', url: 'https://app.test/profile', ...value }) }] });

test('a literal native select and its explicit value oracle compile into the original reusable parameter with one actor decision', async () => {
  const value = 'gb', goal = { id: 'country', source: 'section', action: 'Select @r.country in Country.', expected_result: 'Country retains @r.country.' };
  const snapshot = () => result({ observation_id: 'profile-country', scope: 'body', accessibility: '- combobox "Country"', elements: [
    { tag: 'select', accessible_role: 'combobox', accessible_name: 'Country', attributes: { id: 'country' }, displayed: true,
      locators_validated: true, locator_candidates: ['#country'], options_truncated: false,
      options: [{ label: 'United Kingdom', value, selected: false, disabled: false }] }
  ] });
  const policy = createAutomationInputParameterBinding({ stepId: 'country', obligations: [goal],
    bindings: [{ obligation_id: 'country', action_parameters: ['r.country'], expected_result_parameters: ['r.country'] }],
    parameterValues: { 'r.country': value, 'r.unrelated': value } });
  const calls = []; let actors = 0, reviews = 0, source;
  await runAutomationBrowserAgent({ prompt: 'Choose the reviewed country.', actorMode: true, parse: JSON.parse, inputParameterBinding: policy,
    execution: { required: true, step_id: 'country', action: goal.action, expected_result: goal.expected_result,
      obligations: [goal], source_obligations: [goal], semantic_review_required: true },
    initialObservations: [{ tool: 'browser_snapshot', result: snapshot() }],
    browser: { tools: ['browser_select_option', 'browser_assert', 'browser_snapshot'].map(name => ({ name, inputSchema: { type: 'object' } })),
      call: async (name, args) => {
        calls.push({ name, args });
        return name === 'browser_snapshot' ? snapshot() : result(name === 'browser_assert' ? { assertion_outcome: 'satisfied' } : { action_outcome: 'completed' });
      } },
    complete: async (_prompt, _remaining, trace) => {
      if (trace?.generationScope === 'section_semantic_review') {
        reviews++;
        return JSON.stringify({ decision: 'accept', obligations: [{ id: 'country', action_operations: [1], assertion_operations: [2] }], issues: [] });
      }
      actors++;
      return JSON.stringify({ stage: 'act', step_id: 'country', section_complete: true, tool_calls: [
        { name: 'browser_select_option', arguments: { locator: '#country', value } },
        { name: 'browser_assert', arguments: { assertion: 'value', locator: '#country', value } }
      ] });
    }, onPartialBuild: async payload => { source = payload.steps[0].automation_code; return { generation_complete: true }; }
  });
  assert.equal(actors, 1); assert.equal(reviews, 1);
  assert.equal(calls.filter(call => call.name === 'browser_select_option').length, 1);
  assert.equal(calls.find(call => call.name === 'browser_select_option').args.value, '@r.country');
  assert.equal(calls.find(call => call.name === 'browser_assert').args.value, '@r.country');
  assert.match(source, /selectOption\("@r\.country"\)/);
  assert.match(source, /toHaveValue\("@r\.country"\)/);
  assert.doesNotMatch(source, /"gb"/);
});
