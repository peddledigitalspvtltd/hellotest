const test = require('node:test');
const assert = require('node:assert/strict');
const { projectBrowserCapabilities } = require('../../backend/lib/automationBrowserCapabilities');

const names = [
  'browser_navigate', 'browser_snapshot', 'browser_screenshot', 'browser_hover',
  'browser_check', 'browser_uncheck', 'browser_wait_for', 'browser_validate_locator',
  'browser_assert', 'browser_click', 'browser_fill', 'browser_press_key',
  'browser_select_option', 'browser_future_capability'
];
const catalog = () => names.map(name => ({ name, description: `Discovered ${name}`, inputSchema: {
  type: 'object', properties: { locator: { type: 'string', maxLength: 2000 } }, additionalProperties: false
} }));
const current = targets => ({ current_snapshot: { observation_id: 'observed-page', targets } });
const selected = projection => projection.tools.map(tool => tool.name);

test('ordinary page projects core capabilities and explicit omissions in discovery order', () => {
  const tools = catalog(), before = JSON.stringify(tools);
  const projection = projectBrowserCapabilities({ tools, current: current([{ role: 'button', name: 'Submit' }]) });
  assert.deepEqual(selected(projection), ['browser_navigate', 'browser_snapshot', 'browser_validate_locator', 'browser_assert', 'browser_click', 'browser_press_key']);
  assert.deepEqual(projection.deferred_tool_names, names.filter(name => !selected(projection).includes(name)));
  assert.equal(JSON.stringify(tools), before);
  assert.ok(JSON.stringify(projection).length < JSON.stringify({ tools, deferred_tool_names: [] }).length);
});

test('current compact controls reveal native input, selection and check capabilities', () => {
  const tools = catalog();
  const text = projectBrowserCapabilities({ tools, current: current([{ role: 'textbox', tag: 'input', input_type: 'email' }]) });
  assert.ok(selected(text).includes('browser_fill'));
  assert.ok(text.deferred_tool_names.includes('browser_select_option'));
  const select = projectBrowserCapabilities({ tools, current: current([{ tag: 'select', role: 'combobox' }]) });
  assert.ok(selected(select).includes('browser_select_option'));
  assert.ok(selected(select).includes('browser_fill'));
  for (const role of ['checkbox', 'radio', 'switch']) {
    const projection = projectBrowserCapabilities({ tools, current: current([{ role }]) });
    assert.ok(selected(projection).includes('browser_check'));
    assert.ok(selected(projection).includes('browser_uncheck'));
  }
});

test('raw MCP element evidence and menu controls reveal their capabilities without cached selectors', () => {
  const tools = catalog();
  const projection = projectBrowserCapabilities({ tools, current: { current_snapshot: { elements: [
    { accessible_role: 'searchbox', tag: 'input' }, { tag: 'select' },
    { tag: 'input', attributes: { type: 'checkbox' } }, { accessible_role: 'menuitem' }
  ] } } });
  for (const name of ['browser_fill', 'browser_select_option', 'browser_check', 'browser_uncheck', 'browser_hover']) assert.ok(selected(projection).includes(name));
  assert.ok(projection.deferred_tool_names.includes('browser_screenshot'));
});

test('explicit goals disclose capabilities before their controls appear without expanding unrelated failure schemas', () => {
  const tools = catalog();
  const cases = [
    ['Enter the email', '', ['browser_fill']],
    ['Choose the region', 'The selected option is retained', ['browser_select_option']],
    ['Opt in to updates', '', ['browser_check', 'browser_uncheck']],
    ['Open the menu', 'Tooltip appears', ['browser_hover']],
    ['Capture a screenshot', '', ['browser_screenshot']],
    ['Wait for the dialog', '', ['browser_wait_for']]
  ];
  for (const [action, expectedResult, required] of cases) {
    const projection = projectBrowserCapabilities({ tools, current: current([]), action, expectedResult });
    for (const name of required) assert.ok(selected(projection).includes(name), `${action}: ${name}`);
  }
  const recovery = projectBrowserCapabilities({ tools, current: { ...current([]), latest_failure: { tool: 'browser_click' } } });
  assert.ok(!selected(recovery).includes('browser_hover'));
  assert.ok(recovery.deferred_tool_names.includes('browser_hover'));
  const expanded = projectBrowserCapabilities({ tools, current: { ...current([]), latest_failure: { kind: 'actor_response' } }, expandedNames: ['browser_hover'] });
  assert.ok(selected(expanded).includes('browser_hover'));
  assert.equal(expanded.tools.find(tool => tool.name === 'browser_hover'), tools.find(tool => tool.name === 'browser_hover'));
});

test('selected schemas retain exact discovered conditional rules, annotations and identity', () => {
  const tools = catalog(), assertion = tools.find(tool => tool.name === 'browser_assert');
  assertion.inputSchema = { type: 'object', properties: { assertion: { enum: ['visible', 'text'] }, locator: { type: 'string' }, value: { type: 'string' } }, required: ['assertion'], additionalProperties: false, oneOf: [
    { properties: { assertion: { const: 'visible' } }, required: ['locator'], not: { required: ['value'] } },
    { properties: { assertion: { const: 'text' } }, required: ['locator', 'value'] }
  ] };
  assertion.annotations = { readOnlyHint: true, idempotentHint: true };
  for (const tool of tools) Object.freeze(tool);
  Object.freeze(tools);
  const projection = projectBrowserCapabilities({ tools, current: current([{ role: 'textbox' }]) });
  for (const tool of projection.tools) assert.equal(tool, tools.find(discovered => discovered.name === tool.name));
  assert.equal(projection.tools.find(tool => tool.name === 'browser_assert'), assertion);
  assert.equal(projection.tools.find(tool => tool.name === 'browser_assert').inputSchema, assertion.inputSchema);
  assert.deepEqual(assertion.inputSchema.oneOf[0].not, { required: ['value'] });
  assert.deepEqual(assertion.annotations, { readOnlyHint: true, idempotentHint: true });
});

test('explicit schema expansion reveals deferred and future capabilities without manufacturing undiscovered tools', () => {
  const tools = catalog();
  const projection = projectBrowserCapabilities({ tools, current: current([]), expandedNames: ['browser_screenshot', 'browser_future_capability', 'browser_not_discovered', 'browser_screenshot'] });
  assert.ok(selected(projection).includes('browser_screenshot'));
  assert.ok(selected(projection).includes('browser_future_capability'));
  assert.equal(selected(projection).includes('browser_not_discovered'), false);
  assert.equal(projection.deferred_tool_names.includes('browser_screenshot'), false);
  assert.equal(projection.tools.find(tool => tool.name === 'browser_future_capability'), tools.at(-1));
  const iterable = projectBrowserCapabilities({ tools, current: current([]), expandedNames: new Set(['browser_screenshot']) });
  assert.ok(selected(iterable).includes('browser_screenshot'));
});

test('missing page evidence keeps the full discovered catalog available while partial evidence remains expandable', () => {
  const tools = catalog();
  for (const state of [undefined, {}, { current_snapshot: null }, { current_snapshot: [] }]) {
    const projection = projectBrowserCapabilities({ tools, current: state });
    assert.deepEqual(selected(projection), names);
    assert.deepEqual(projection.deferred_tool_names, []);
    assert.notEqual(projection.tools, tools);
    assert.equal(projection.tools.at(-1), tools.at(-1));
  }
  const partial = projectBrowserCapabilities({ tools, current: { current_snapshot: { targets: [], partial: true, targets_unavailable: true } } });
  assert.ok(partial.deferred_tool_names.includes('browser_select_option'));
  assert.ok(partial.deferred_tool_names.includes('browser_future_capability'));
});

test('read-only or restricted discovery cannot acquire interaction tools from goals, targets or expansion', () => {
  const tools = catalog().filter(tool => ['browser_navigate', 'browser_snapshot', 'browser_assert'].includes(tool.name));
  const projection = projectBrowserCapabilities({ tools, current: current([{ role: 'checkbox' }, { role: 'textbox' }, { tag: 'select' }]), action: 'Fill, choose, check and hover', expandedNames: names });
  assert.deepEqual(projection.tools, tools);
  assert.deepEqual(projection.deferred_tool_names, []);
  assert.deepEqual(projectBrowserCapabilities(), { tools: [], deferred_tool_names: [] });
});
