const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAutomationParameterBindings, validateAutomationParameterBindings } = require('../../backend/lib/automationParameterBindings');
const { createBrowserParameterResolver } = require('../../backend/lib/automationBrowserParameters');
const { createAutomationActorContext } = require('../../backend/lib/automationActorContext');
const { buildAutomationGoalObligations } = require('../../backend/lib/automationGoalObligations');
const { runAutomationBrowserAgent } = require('../../backend/lib/automationBrowserAgent');

const source = [{ id: 'current', source: 'section', action: 'Enter @name', expected_result: 'The name input retains @name' }];
function fixture(caseValues = { 't.name': '' }) {
  const resolver = createBrowserParameterResolver({ caseValues, steps: source, defaultMissingInputs: true });
  const section = resolver.projectSteps([{ id: 'current', step_type: 'web', step_order: 1, action: source[0].action, expected_result: source[0].expected_result }])[0];
  const task = { case: { id: 'automation', title: 'Name input' }, current_section: section,
    build_context: { parameter_data: { values: resolver.promptValues }, generation_scope: { active_step_id: 'current', active_manual_step_ids: [] }, linked_manual_cases: [] } };
  const obligations = buildAutomationGoalObligations({ section });
  const parameterBindings = buildAutomationParameterBindings({ obligations: source, referencedParameterNames: resolver.referencedParameterNames });
  return { resolver, task, obligations, parameterBindings };
}

test('original authored action and expected-result fields retain exact scoped bindings after blank/public projection', () => {
  for (const value of ['', 'Inherited fixture name']) {
    const state = fixture({ 't.name': value });
    assert.deepEqual(state.parameterBindings, [{ obligation_id: 'current', action_parameters: ['t.name'], expected_result_parameters: ['t.name'] }]);
    const context = createAutomationActorContext({ task: state.task, obligations: state.obligations, parameterBindings: state.parameterBindings, canonicalGoals: true });
    const packet = JSON.parse(context.prompt);
    assert.equal(packet.required_obligations[0].action, `Enter ${value}`);assert.doesNotMatch(packet.required_obligations[0].action, /@name|@t\.name/);
    assert.deepEqual(packet.obligation_parameter_bindings, state.parameterBindings);
    assert.deepEqual(packet.parameter_data.values, { 't.name': '@t.name' });
    assert.equal(context.measurements.parameter_binding_count, 1);assert.equal(context.measurements.parameter_binding_reference_count, 2);
  }
});

test('legacy aliases use the fixed host resolver while explicit r references remain distinct and bound empty wins', () => {
  const obligations = [{ id: 'one', action: 'Enter @name and @r.name', expected_result: '@t.name remains' }];
  const inherited = createBrowserParameterResolver({ caseValues: { 't.name': 'Manual name' }, steps: obligations, defaultMissingInputs: true });
  assert.deepEqual(buildAutomationParameterBindings({ obligations, referencedParameterNames: inherited.referencedParameterNames }), [
    { obligation_id: 'one', action_parameters: ['r.name', 't.name'], expected_result_parameters: ['t.name'] }
  ]);
  const runBlank = createBrowserParameterResolver({ caseValues: { 't.name': 'Manual name', 'r.name': '' }, steps: obligations, defaultMissingInputs: true });
  assert.deepEqual(buildAutomationParameterBindings({ obligations, referencedParameterNames: runBlank.referencedParameterNames }), [
    { obligation_id: 'one', action_parameters: ['r.name'], expected_result_parameters: ['t.name'] }
  ]);
});

test('inserted token-looking data, private values, literals and automation source cannot create new binding hints', () => {
  const secret = 'private-value-not-for-model';
  const obligations = [{ id: 'current', action: 'Enter @t.literal then @t.password', expected_result: '@t.literal is retained', automation_code: 'await page.fill("#unrelated", "@t.unrelated")' }];
  const resolver = createBrowserParameterResolver({ caseValues: { 't.literal': 'Literal @r.unrelated text', 't.password': secret, 'r.unrelated': 'MUST_NOT_SCAN', 't.unrelated': 'UNUSED' } });
  const hints = buildAutomationParameterBindings({ obligations, referencedParameterNames: resolver.referencedParameterNames });
  assert.deepEqual(hints, [{ obligation_id: 'current', action_parameters: ['t.literal', 't.password'], expected_result_parameters: ['t.literal'] }]);
  assert.doesNotMatch(JSON.stringify(hints), /private-value|Literal|unrelated|MUST_NOT_SCAN|UNUSED/);
  assert.deepEqual(buildAutomationParameterBindings({ obligations: [{ id: 'no-refs', action: 'Open the name form', expected_result: 'Name is displayed' }], referencedParameterNames: resolver.referencedParameterNames }), []);
});

test('bracketed names, repeated references and multiple scopes remain canonical and sparse', () => {
  const obligations = [{ id: 'one', action: 'Enter @t.[Display Name] twice @t.[Display Name]', expected_result: '@s.locale and @r.[Result Name] match' },
    { id: 'two', action: 'Inspect the form', expected_result: 'It remains visible' }];
  const resolver = createBrowserParameterResolver({ caseValues: { 't.display name': '', 's.locale': 'en', 'r.result name': '' } });
  assert.deepEqual(buildAutomationParameterBindings({ obligations, referencedParameterNames: resolver.referencedParameterNames }), [
    { obligation_id: 'one', action_parameters: ['t.display name'], expected_result_parameters: ['r.result name', 's.locale'] }
  ]);
});

test('binding validation rejects foreign goals/names, ambiguous aliases, duplicate rows/keys and arbitrary extra content', () => {
  const state = fixture(), base = state.parameterBindings[0], validate = bindings => validateAutomationParameterBindings({ bindings, obligations: state.obligations, values: state.resolver.promptValues });
  for (const bindings of [[{ ...base, obligation_id: 'foreign' }], [{ ...base, action_parameters: ['t.unknown'] }], [{ ...base, action_parameters: ['name'] }],
    [{ ...base, action_parameters: ['@t.name'] }], [base, base], [{ ...base, action_parameters: ['t.name', 't.name'] }], [{ ...base, raw_action: 'PRIVATE' }],
    [{ ...base, action_parameters: [], expected_result_parameters: [] }], [{ ...base, action_parameters: [null] }]]) assert.throws(() => validate(bindings), { code: 'AUTOMATION_PARAMETER_BINDINGS_INVALID' });
  assert.deepEqual(validate([base]), [base]);
  assert.throws(() => createAutomationActorContext({ task: state.task, obligations: state.obligations, parameterBindings: [{ ...base, action_parameters: ['t.unknown'] }] }), { code: 'AUTOMATION_ACTOR_CONTEXT_INVALID' });
});

test('hints follow authorized obligation order and do not expand parameter values or change legacy task packing', () => {
  const state = fixture({ 't.name': 'Name', 't.other': 'Other' });
  const plain = JSON.parse(createAutomationActorContext({ task: state.task, obligations: state.obligations }).prompt);
  assert.equal('obligation_parameter_bindings' in plain, false);
  const context = createAutomationActorContext({ task: state.task, obligations: state.obligations, parameterBindings: state.parameterBindings });
  const hinted = JSON.parse(context.prompt);
  assert.deepEqual(hinted.parameter_data, plain.parameter_data, 'existing inline inventory remains unchanged');
  assert.deepEqual(hinted.available_context.parameter_names, plain.available_context.parameter_names);
  state.parameterBindings[0].action_parameters[0] = 't.other';
  assert.deepEqual(JSON.parse(context.prompt).obligation_parameter_bindings[0].action_parameters, ['t.name']);
});

test('the real agent can choose the original blank binding from sparse hints and preserve it in sealed source', async () => {
  const state = fixture(), context = createAutomationActorContext({ task: state.task, obligations: state.obligations, parameterBindings: state.parameterBindings, canonicalGoals: true });
  const calls = [], seals = [], saved = [];
  const receipt = value => ({ content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', url: 'https://fixture.example/form', ...value }) }] });
  const snapshot = () => receipt({ observation_id: 'name-page', elements: [{ tag: 'input', accessible_role: 'textbox', accessible_name: 'Name', attributes: { type: 'text' }, locators_validated: true, locator_candidates: ['#name'] }] });
  const result = await runAutomationBrowserAgent({ prompt: context.prompt, taskContext: context, actorMode: true, generationMode: 'sequential', parse: JSON.parse,
    execution: { required: true, semantic_review_required: true, step_id: 'current', action: state.task.current_section.action, expected_result: state.task.current_section.expected_result,
      obligations: state.obligations, source_obligations: source }, initialObservations: [{ tool: 'browser_snapshot', result: snapshot() }],
    browser: { tools: ['browser_fill', 'browser_assert', 'browser_snapshot'].map(name => ({ name, inputSchema: { type: 'object' } })),
      canonicalizeParameterArguments: state.resolver.canonicalArguments, projectPromptText: state.resolver.projectText, projectPrivateText: state.resolver.projectPrivateText,
      call: async (name, args) => {
        const resolved = state.resolver.resolve(name, args);calls.push({ name, args: resolved });
        if (name === 'browser_snapshot') return snapshot();
        assert.equal(resolved.value, '');return receipt(name === 'browser_assert' ? { assertion_outcome: 'satisfied' } : { action_outcome: 'completed' });
      } }, onRecordedContract: seal => seals.push(seal), onPartialBuild: payload => { saved.push(payload);return { generation_complete: true }; },
    complete: async prompt => {
      if (prompt.includes('"phase":"semantic_review"')) return JSON.stringify({ decision: 'accept', obligations: [{ id: 'current', action_operations: [1], assertion_operations: [2] }], issues: [] });
      const task = JSON.parse(prompt.split('\n').find(line => line.startsWith('{"kind":"automation_actor_task"')));
      const hint = task.obligation_parameter_bindings[0];assert.equal(task.required_obligations[0].action, 'Enter ');
      assert.deepEqual(hint.action_parameters, ['t.name']);
      return JSON.stringify({ stage: 'act', step_id: 'current', section_complete: true, tool_calls: [
        { name: 'browser_fill', arguments: { locator: '#name', value: '@' + hint.action_parameters[0] } },
        { name: 'browser_assert', arguments: { assertion: 'value', locator: '#name', value: '@' + hint.expected_result_parameters[0] } }
      ] });
    }
  });
  assert.equal(seals.length, 1);assert.equal(saved.length, 1);assert.match(result.steps[0].automation_code, /fill\("@t\.name"\)/);
  assert.equal(calls.filter(row => row.name === 'browser_fill').length, 1);
});
