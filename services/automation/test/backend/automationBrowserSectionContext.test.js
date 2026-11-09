const test = require('node:test');
const assert = require('node:assert/strict');
const { runAutomationBrowserAgent } = require('../../backend/lib/automationBrowserAgent');
const receipt = (value, isError = false) => ({ isError, content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', ...value }) }] });
const element = name => ({ tag: 'button', accessible_role: 'button', accessible_name: name, attributes: { type: 'button' }, displayed: true, locators_validated: true, locator_candidates: [`#${name.replaceAll(' ', '-')}`] });
const page = (scope = 'body', name = 'Employee Management', frame = false) => ({ url: 'https://fixture.test/app', observation_id: `observed-${scope}-${name}`, scope, elements: [element(name)],
  ...(frame ? { frame_path: ['#workspace'], frame_url: 'https://fixture.test/embedded', frame_document_id: 'native-document' } : {}) });
const current = prompt => JSON.parse(prompt.match(/^Current browser state and confirmed section progress .*?: (.+)$/m)[1]).current_snapshot;

for (const frame of [false, true]) test(`a new section clears an inherited element filter once while retaining ${frame ? 'its observed frame document' : 'the main document'}`, async () => {
  const calls = [], events = [], observations = [], old = { tool: 'browser_snapshot', arguments: { locator: '#Log-Out', ...(frame ? { frame: ['#workspace'] } : {}) }, execution_step_id: 'login', result: receipt(page('#Log-Out', 'Log Out', frame)) };
  const browser = { tools: ['browser_snapshot', 'browser_assert'].map(name => ({ name, inputSchema: { type: 'object' } })), call: async (name, args) => {
    calls.push({ name, args }); return name === 'browser_snapshot' ? receipt(page('body', 'Employee Management', frame)) : receipt({ url: 'https://fixture.test/app', assertion_outcome: 'satisfied',
      ...(frame ? { frame_path: ['#workspace'], frame_url: 'https://fixture.test/embedded', frame_document_id: 'native-document' } : {}) });
  } };
  let turns = 0, saved = 0;
  await runAutomationBrowserAgent({ browser, prompt: 'Verify Employee Management is visible.', execution: { required: true, step_id: 'navigation', action: 'Verify Employee Management is visible.', expected_result: 'Employee Management is visible.' },
    actorMode: true, parse: JSON.parse, initialObservations: [old], onObservation: row => observations.push(row), onProgress: row => events.push(row), maxTurns: 2, maxCalls: 12,
    onPartialBuild: async () => { saved++; return { generation_complete: true }; }, complete: async prompt => {
      turns++; assert.equal(calls.length, 1, 'refresh occurs before the first actor request'); const snapshot = current(prompt);
      assert.equal(snapshot.scope, 'body'); assert.equal(snapshot.targets[0].name, 'Employee Management');
      if (frame) { assert.deepEqual(snapshot.frame_path, ['#workspace']); assert.equal(snapshot.frame_document_id, 'native-document'); }
      return JSON.stringify({ stage: 'act', step_id: 'navigation', section_complete: true, tool_calls: [{ name: 'browser_assert', arguments: { assertion: 'visible', locator: snapshot.targets[0].ref } }] });
    } });
  assert.deepEqual(calls[0], { name: 'browser_snapshot', args: frame ? { frame: ['#workspace'] } : {} });
  assert.equal(calls.filter(row => row.name === 'browser_snapshot').length, 1); assert.equal(turns, 1); assert.equal(saved, 1);
  assert.equal(observations[0].execution_step_id, 'navigation'); assert.ok(events.some(row => row.phase === 'automation.agent.section.context'));
});

for (const kind of ['prior-body', 'same-section-element', 'legacy-element']) test(`${kind} retains its existing observation without an extra boundary read`, async () => {
  const calls = [], old = { tool: 'browser_snapshot', result: receipt(page(kind === 'prior-body' ? 'body' : '#Log-Out', 'Log Out', kind === 'prior-body')),
    ...(kind !== 'legacy-element' ? { execution_step_id: kind === 'prior-body' ? 'prior' : 'current' } : {}) };
  const browser = { tools: ['browser_snapshot', 'browser_assert'].map(name => ({ name, inputSchema: { type: 'object' } })), call: async (name, args) => { calls.push({ name, args }); return receipt({ assertion_outcome: 'satisfied',
    ...(kind === 'prior-body' ? { url: 'https://fixture.test/app', frame_path: ['#workspace'], frame_url: 'https://fixture.test/embedded', frame_document_id: 'native-document' } : {}) }); } };
  await runAutomationBrowserAgent({ browser, prompt: 'Verify Log Out is visible.', actorMode: true, parse: JSON.parse, execution: { required: true, step_id: 'current', action: 'Verify Log Out is visible.', expected_result: 'Log Out is visible.' },
    initialObservations: [old], maxTurns: 1, onPartialBuild: async () => ({ generation_complete: true }), complete: async prompt => {
      assert.equal(calls.length, 0); return JSON.stringify({ stage: 'act', step_id: 'current', section_complete: true, tool_calls: [{ name: 'browser_assert', arguments: { assertion: 'visible', locator: current(prompt).targets[0].ref } }] });
    } });
  assert.deepEqual(calls.map(row => row.name), ['browser_assert']);
});

test('failed boundary evidence stops before model/action work and preserves its safe native cause', async () => {
  let calls = 0, models = 0;
  const browser = { tools: [{ name: 'browser_snapshot' }], call: async () => { calls++; return receipt({ code: 'BROWSER_LOCATOR_NOT_UNIQUE', action_outcome: 'not_attempted', message: 'PRIVATE observed details' }, true); } };
  await assert.rejects(runAutomationBrowserAgent({ browser, prompt: 'Next section', actorMode: true, parse: JSON.parse, execution: { required: true, step_id: 'new' },
    initialObservations: [{ tool: 'browser_snapshot', execution_step_id: 'old', result: receipt(page('#Log-Out', 'Log Out')) }], complete: async () => { models++; return '{}'; } }),
  error => error.code === 'AUTOMATION_BROWSER_SECTION_CONTEXT_UNAVAILABLE' && error.browser_code === 'BROWSER_LOCATOR_NOT_UNIQUE' && !/PRIVATE/.test(error.message));
  assert.equal(calls, 1); assert.equal(models, 0);
});

test('boundary refresh uses the current section budget and never invents another allowance', async () => {
  let calls = 0;
  const browser = { tools: [{ name: 'browser_snapshot' }], call: async () => { calls++; return receipt(page()); } };
  await assert.rejects(runAutomationBrowserAgent({ browser, prompt: 'Next section', actorMode: true, parse: JSON.parse, maxCalls: 0, execution: { required: true, step_id: 'new' },
    initialObservations: [{ tool: 'browser_snapshot', execution_step_id: 'old', result: receipt(page('#Log-Out', 'Log Out')) }], complete: async () => assert.fail('No model request after exhausted boundary budget') }),
  error => error.code === 'AUTOMATION_BROWSER_TOOL_BUDGET_EXHAUSTED');
  assert.equal(calls, 0);
});
