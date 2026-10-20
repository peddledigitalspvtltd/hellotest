const test = require('node:test');
const assert = require('node:assert/strict');
const { runAutomationBrowserAgent } = require('../../backend/lib/automationBrowserAgent');

const locatorSchema = { type: 'object', properties: { locator: { type: 'string' } }, required: ['locator'], additionalProperties: false };
const tools = [
  { name: 'browser_snapshot', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'browser_click', inputSchema: locatorSchema },
  { name: 'browser_hover', description: 'Exact discovered hover contract', inputSchema: locatorSchema },
  { name: 'browser_assert', inputSchema: { type: 'object', properties: { assertion: { const: 'title' }, value: { type: 'string' } }, required: ['assertion', 'value'], additionalProperties: false } }
];
const receipt = value => ({ content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', url: 'https://app.test/record', ...value }) }] });
const snapshot = () => receipt({ observation_id: 'observed-record', title: 'Ready', elements: [{ tag: 'button', role: 'button', label: 'Prepare', locators_validated: true, locator_candidates: ['#prepare'] }] });
const request = name => ({ name, arguments: name === 'browser_assert' ? { assertion: 'title', value: 'Ready' } : { locator: '#prepare' } });
const actor = names => JSON.stringify({ stage: 'act', step_id: 'record', tool_calls: names.map(request), section_complete: true });
const catalogFrom = prompt => JSON.parse(prompt.match(/^Tool catalog: (.+)$/m)[1]);
function fixture(catalog = tools) {
  const calls = [], events = [], observations = [];
  return { calls, events, observations, options: {
    browser: { tools: catalog, call: async (name, args) => {
      calls.push({ name, args });
      return name === 'browser_snapshot' ? snapshot() : receipt(name === 'browser_assert' ? { assertion_outcome: 'satisfied' } : { action_outcome: 'completed' });
    } },
    prompt: 'Review this record', actorMode: true, execution: { required: true, step_id: 'record', action: 'Prepare the record', expected_result: 'Ready' },
    initialObservations: [{ tool: 'browser_snapshot', result: snapshot() }], parse: JSON.parse, maxTurns: 4,
    onObservation: async observation => observations.push(observation), onProgress: async event => events.push(event),
    onPartialBuild: async () => ({ generation_complete: true })
  } };
}

test('deferred schemas expand before the first action of a dependent batch, then compile confirmed operations', async () => {
  const state = fixture(); let turn = 0;
  const result = await runAutomationBrowserAgent({ ...state.options, complete: async prompt => {
    const catalog = catalogFrom(prompt);
    if (++turn === 1) {
      assert.ok(!catalog.some(tool => tool.name === 'browser_hover'));
      assert.match(prompt, /Deferred tool names.*browser_hover/);
    } else {
      assert.deepEqual(state.calls, [], 'no prefix mutation runs before the deferred schema is disclosed');
      assert.deepEqual(catalog.find(tool => tool.name === 'browser_hover'), tools.find(tool => tool.name === 'browser_hover'));
      assert.match(prompt, /AUTOMATION_BROWSER_TOOL_SCHEMAS_EXPANDED/);
    }
    return actor(['browser_click', 'browser_hover', 'browser_assert']);
  } });
  assert.equal(turn, 2);
  assert.deepEqual(state.calls.filter(call => call.name !== 'browser_snapshot').map(call => call.name), ['browser_click', 'browser_hover', 'browser_assert']);
  assert.match(result.steps[0].automation_code, /\.click\(\)/);
  assert.match(result.steps[0].automation_code, /\.hover\(\)/);
  assert.match(result.steps[0].automation_code, /title\(\)/);
  const packed = state.events.filter(event => event.phase === 'automation.agent.prompt.packed');
  assert.equal(packed[0].details.selected_tool_count, 3);
  assert.equal(packed[0].details.available_tool_count, 4);
  assert.ok(packed[0].details.tool_catalog_chars < packed[0].details.available_tool_catalog_chars);
  assert.equal(packed[1].details.selected_tool_count, 4);
  assert.equal(packed[0].details.token_measurement, 'not_estimated;provider_usage_is_authoritative');
});

test('explicit discovery never executes accompanying actions and keeps revealed schemas across later turns', async () => {
  const state = fixture(); let turn = 0;
  await runAutomationBrowserAgent({ ...state.options, complete: async prompt => {
    turn++;
    if (turn === 1) return JSON.stringify({ tool_catalog_request: ['browser_hover'], ...JSON.parse(actor(['browser_click'])) });
    assert.deepEqual(state.calls, []);
    assert.ok(catalogFrom(prompt).some(tool => tool.name === 'browser_hover'));
    if (turn === 2) return JSON.stringify({ stage: 'act', step_id: 'record', tool_calls: [], section_complete: false });
    return actor(['browser_hover', 'browser_assert']);
  } });
  assert.equal(turn, 3);
  assert.ok(!state.calls.some(call => call.name === 'browser_click'));
});

test('schema discovery cannot introduce undiscovered tools or echo arbitrary requested data', async () => {
  const state = fixture(); let turn = 0;
  await runAutomationBrowserAgent({ ...state.options, complete: async prompt => {
    if (++turn === 1) return JSON.stringify({ tool_catalog_request: ['PRIVATE_UNDISCOVERED_TOOL'], ...JSON.parse(actor(['browser_click'])) });
    assert.match(prompt, /AUTOMATION_BROWSER_TOOL_SCHEMA_REQUEST_INVALID/);
    assert.doesNotMatch(prompt, /PRIVATE_UNDISCOVERED_TOOL/);
    assert.ok(!catalogFrom(prompt).some(tool => tool.name === 'PRIVATE_UNDISCOVERED_TOOL'));
    assert.deepEqual(state.calls, []);
    return actor(['browser_assert']);
  } });
  assert.deepEqual(state.calls.map(call => call.name), ['browser_assert']);
});

test('revealing a deferred schema preserves argument validation and cannot dispatch malformed actions', async () => {
  const state = fixture(); let turn = 0;
  await runAutomationBrowserAgent({ ...state.options, complete: async prompt => {
    if (++turn === 1) return JSON.stringify({ tool_catalog_request: ['browser_hover'] });
    if (turn === 2) return JSON.stringify({ stage: 'act', step_id: 'record', tool_calls: [{ name: 'browser_hover', arguments: { locator: '#prepare', forbidden: 'PRIVATE_VALUE' } }] });
    assert.match(prompt, /AUTOMATION_BROWSER_ARGUMENT_SCHEMA_INVALID/);
    assert.doesNotMatch(prompt, /PRIVATE_VALUE/);
    assert.deepEqual(state.calls, []);
    return actor(['browser_hover', 'browser_assert']);
  } });
  assert.equal(state.calls.filter(call => call.name === 'browser_hover').length, 1);
});

test('read-only generation retains its complete discovered catalog and never gains interaction tools', async () => {
  const state = fixture([tools[0], tools[3]]);
  const result = await runAutomationBrowserAgent({ ...state.options, actorMode: false, execution: undefined, complete: async prompt => {
    assert.deepEqual(catalogFrom(prompt), [tools[0], tools[3]]);
    assert.doesNotMatch(prompt, /Deferred tool names/);
    return JSON.stringify({ steps: [{ step_id: 'record', automation_code: 'await expect(page).toHaveTitle("Ready");' }] });
  } });
  assert.equal(result.steps.length, 1);
  assert.deepEqual(state.calls, []);
});

test('schema expansion consumes bounded model turns and cannot spend an exhausted browser budget', async () => {
  const state = fixture(); let turns = 0;
  await assert.rejects(runAutomationBrowserAgent({ ...state.options, maxTurns: 1, maxCalls: 0, complete: async prompt => {
    turns++;
    assert.deepEqual(catalogFrom(prompt), []);
    assert.doesNotMatch(prompt, /Deferred tool names|automationBrowserAgent.capabilities/);
    return JSON.stringify({ tool_catalog_request: ['browser_hover'] });
  } }), { code: 'AUTOMATION_BROWSER_TOOL_BUDGET_EXHAUSTED' });
  assert.equal(turns, 1);
  assert.deepEqual(state.calls, []);
});

test('the last actionable turn includes all schemas so a rare capability needs no extra disclosure turn', async () => {
  const state = fixture();
  const result = await runAutomationBrowserAgent({ ...state.options, maxTurns: 1, complete: async prompt => {
    assert.deepEqual(catalogFrom(prompt), tools);
    assert.doesNotMatch(prompt, /Deferred tool names/);
    return actor(['browser_hover', 'browser_assert']);
  } });
  assert.match(result.steps[0].automation_code, /\.hover\(\)/);
  assert.equal(state.calls.filter(call => call.name === 'browser_hover').length, 1);
});
