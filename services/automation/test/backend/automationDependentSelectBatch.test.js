const test = require('node:test');
const assert = require('node:assert/strict');
const { runAutomationBrowserAgent } = require('../../backend/lib/automationBrowserAgent');

const receipt = value => ({ content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', url: 'https://app.test/address', ...value }) }] });
const select = (id, name, options) => ({ tag: 'select', accessible_role: 'combobox', accessible_name: name, label: name,
  attributes: { id }, displayed: true, disabled: false, locators_validated: true, locator_candidates: [`#${id}`],
  options_truncated: false, options: options.map(([label, value]) => ({ label, value, disabled: false, selected: false })) });

test('a dependent choice change pauses a legacy locator batch before its stale selection and retains the completed parent selection once', async () => {
  let country = 'A', turns = 0, saves = 0;
  const calls = [], observations = [];
  const snapshot = () => ({ observation_id: `address-${country}`, scope: 'body',
    accessibility: `- combobox "Country"\n- combobox "Region": ${country === 'A' ? 'North' : 'South'}`,
    elements: [select('country', 'Country', [['Country A', 'A'], ['Country B', 'B']]),
      select('region', 'Region', country === 'A' ? [['North', 'north']] : [['South', 'south']])] });
  const result = await runAutomationBrowserAgent({ actorMode: true, parse: JSON.parse,
    prompt: 'Choose Country B and its South region.', execution: { required: true, step_id: 'address',
      action: 'Select Country B, then select South in Region.', expected_result: 'South is selected in Region.' },
    initialObservations: [{ tool: 'browser_snapshot', result: receipt(snapshot()) }],
    browser: { tools: ['browser_select_option', 'browser_assert', 'browser_snapshot'].map(name => ({ name, inputSchema: { type: 'object' } })),
      call: async (name, args) => {
        calls.push({ name, args });
        if (name === 'browser_snapshot') return receipt(snapshot());
        if (name === 'browser_select_option') {
          if (args.locator === '#country') country = args.value;
          else assert.equal(args.value, 'south', 'the stale dependent value must never reach the browser');
          return receipt({ action_outcome: 'completed' });
        }
        return receipt({ assertion_outcome: 'satisfied' });
      } }, onObservation: observation => observations.push(observation),
    complete: async prompt => {
      if (++turns === 1) return JSON.stringify({ stage: 'act', step_id: 'address', section_complete: false, tool_calls: [
        { name: 'browser_select_option', arguments: { locator: '#country', value: 'B' } },
        { name: 'browser_select_option', arguments: { locator: '#region', value: 'north' } }
      ] });
      assert.match(prompt, /controls_changed/);
      return JSON.stringify({ stage: 'act', step_id: 'address', section_complete: true, tool_calls: [
        { name: 'browser_select_option', arguments: { locator: '#region', value: 'south' } },
        { name: 'browser_assert', arguments: { assertion: 'value', locator: '#region', value: 'south' } }
      ] });
    }, onPartialBuild: async () => { saves++; return { generation_complete: true }; }
  });
  assert.equal(turns, 2); assert.equal(saves, 1);
  assert.equal(calls.filter(call => call.name === 'browser_select_option' && call.args.locator === '#country').length, 1);
  assert.deepEqual(calls.filter(call => call.name === 'browser_select_option').map(call => call.args.value), ['B', 'south']);
  assert.ok(observations.some(row => row.tool === 'automation_browser_batch_feedback' && JSON.parse(row.result.content[0].text).reason === 'controls_changed'));
  assert.doesNotMatch(result.steps[0].automation_code, /north/);
  assert.equal((result.steps[0].automation_code.match(/\.selectOption\(/g) || []).length, 2);
});
