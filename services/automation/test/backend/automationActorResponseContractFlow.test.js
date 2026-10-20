const test = require('node:test');
const assert = require('node:assert/strict');
const { runAutomationBrowserAgent } = require('../../backend/lib/automationBrowserAgent');
const { createAutomationActorContext } = require('../../backend/lib/automationActorContext');

const receipt = value => ({ content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', url: 'https://app.test/login', ...value }) }] });
const snapshot = () => receipt({ observation_id: 'current-page', scope: 'body', title: 'Sign in', accessibility: '- textbox "Email"', elements: [{ tag: 'input', role: 'textbox', accessible_name: 'Email', attributes: { id: 'email', type: 'email' }, displayed: true, disabled: false, locators_validated: true, locator_candidates: ['#email'] }] });
const fill = () => ({ name: 'browser_fill', arguments: { locator: '#email', value: '@t.email' } });
const check = () => ({ name: 'browser_assert', arguments: { assertion: 'value', locator: '#email', value: '@t.email' } });
const done = () => ({ stage: 'act', step_id: 'current', section_complete: true, tool_calls: [fill(), check()] });
const obligation = { id: 'current', source: 'section', action: 'Enter @t.email into the email input', expected_result: 'The email input retains @t.email' };
const packet = prompt => prompt.includes('"phase":"semantic_review"') ? JSON.parse(prompt.split('\n').at(-1)) : null;
const current = prompt => JSON.parse(prompt.match(/^Current browser state and confirmed section progress .*?: (.+)$/m)[1]);
const accept = review => JSON.stringify({ decision: 'accept', obligations: review.obligations.map(goal => ({ id: goal.id, action_operations: [1], assertion_operations: [2] })), issues: [] });
function fixture(extra = {}) {
  const calls = [], observations = [], saves = [];
  return { calls, observations, saves, options: {
    browser: { tools: ['browser_fill', 'browser_assert', 'browser_snapshot', 'browser_hover'].map(name => ({ name, inputSchema: { type: 'object' } })), projectPromptText: value => value,
      call: async (name, args) => { calls.push({ name, args }); return name === 'browser_snapshot' ? snapshot() : receipt(name === 'browser_assert' ? { assertion_outcome: 'satisfied' } : { action_outcome: 'completed' }); } },
    prompt: 'Use the configured input reference for the pinned email goal.', execution: { required: true, step_id: 'current', action: obligation.action, expected_result: obligation.expected_result,
      semantic_review_required: true, obligations: [obligation] }, actorMode: true, parse: JSON.parse,
    initialObservations: [{ tool: 'browser_snapshot', result: snapshot() }],
    onObservation: item => observations.push(item), onPartialBuild: async value => { saves.push(value); return { generation_complete: true }; }, ...extra
  } };
}

test('a cheap-model typed response may omit stage and step ID, while completion still requires an explicit request and one semantic review', async () => {
  const state = fixture(); let actors = 0, reviews = 0;
  const result = await runAutomationBrowserAgent({ ...state.options, complete: async prompt => {
    const review = packet(prompt);
    if (review) { reviews++; assert.equal(state.saves.length, 0); return accept(review); }
    actors++;
    const line = prompt.split('\n').find(value => value.startsWith('Current decision contract: '));
    assert.ok(line, 'the current protocol is supplied on the first and final actor turn');
    const decision = JSON.parse(line.slice('Current decision contract: '.length));
    assert.ok(decision.choices.some(choice => choice.step_id === 'current'));
    assert.equal(decision.output_schema, undefined);
    if (actors === 1) return JSON.stringify({ tool_calls: [fill(), check()] });
    assert.equal(reviews, 0, 'missing completion metadata cannot infer a completion decision');
    assert.equal(state.saves.length, 0);
    assert.equal(current(prompt).recorded_section.completion_available, true);
    return JSON.stringify({ stage: 'act', step_id: 'current', section_complete: true, tool_calls: [] });
  } });
  assert.equal(actors, 2); assert.equal(reviews, 1); assert.equal(state.saves.length, 1);
  assert.equal(state.calls.filter(call => call.name === 'browser_fill').length, 1);
  assert.equal(state.calls.filter(call => call.name === 'browser_assert').length, 1);
  assert.match(result.steps[0].automation_code, /\.fill\(/);
  assert.match(result.steps[0].automation_code, /toHaveValue/);
  assert.deepEqual(state.calls.filter(call => ['browser_fill', 'browser_assert'].includes(call.name)).map(call => call.args.value), ['@t.email', '@t.email']);
});

test('malformed or conflicting actor envelopes dispatch nothing before corrective feedback and a valid proposal', async t => {
  const invalid = [
    { label: 'string completion', response: { ...done(), section_complete: 'true' } },
    { label: 'object tool_calls', response: { tool_calls: fill() } },
    { label: 'wrong explicit phase', response: { ...done(), stage: 'plan' } },
    { label: 'wrong explicit step', response: { ...done(), step_id: 'other' } },
    { label: 'multiple controls', response: { actor_context_request: {}, tool_catalog_request: ['browser_hover'], tool_calls: [fill()] } }
  ];
  for (const scenario of invalid) await t.test(scenario.label, async () => {
    const state = fixture(); let actors = 0, reviews = 0;
    await runAutomationBrowserAgent({ ...state.options, complete: async prompt => {
      const review = packet(prompt);
      if (review) { reviews++; return accept(review); }
      if (++actors === 1) return JSON.stringify(scenario.response);
      assert.equal(state.calls.length, 0, 'no proposed action precedes format correction');
      assert.match(prompt, /AUTOMATION_ACTOR_RESPONSE_INVALID/);
      assert.equal(current(prompt).latest_failure.action_outcome, 'not_attempted');
      assert.ok(current(prompt).latest_failure.issues.length);
      return JSON.stringify(done());
    } });
    assert.equal(actors, 2); assert.equal(reviews, 1); assert.equal(state.saves.length, 1);
    assert.equal(state.calls.filter(call => call.name === 'browser_fill').length, 1);
  });
});

test('a repeated malformed response stops after one feedback without any MCP action, semantic review or source save', async () => {
  const state = fixture(); let actors = 0;
  await assert.rejects(runAutomationBrowserAgent({ ...state.options, complete: async prompt => {
    assert.equal(packet(prompt), null);
    if (++actors > 1) assert.match(prompt, /AUTOMATION_ACTOR_RESPONSE_INVALID/);
    return JSON.stringify({ tool_calls: [fill()], section_complete: 'yes' });
  } }), error => error.code === 'AUTOMATION_ACTOR_RESPONSE_STALLED' && error.nonRetryable === true && error.statusCode === 422);
  assert.equal(actors, 2); assert.equal(state.calls.length, 0); assert.equal(state.saves.length, 0);
  assert.equal(state.observations.filter(row => row.tool === 'automation_actor_response_feedback').length, 1);
});

test('format-only correction retains the goal, tools and completed work without adding browser recovery guidance or unrelated schemas', async () => {
  const state = fixture(); let actors = 0, before;
  const defaults = require('../../../platform/shared/aiFeatureCatalog.json').find(item => item.id === 'ai.automation.keyword_generation').defaults.instruction_blocks;
  const expand = prompt => prompt.replace(/⟦HELLOTEST_AI:[^:]+:([^⟧]+)⟧/g, (_, key) => defaults[key] || '');
  const line = (prompt, prefix) => prompt.split('\n').find(value => value.startsWith(prefix));
  await runAutomationBrowserAgent({ ...state.options, complete: async prompt => {
    const review = packet(prompt); if (review) return accept(review);
    actors++;
    if (actors === 1) return JSON.stringify({ tool_calls: [fill()] });
    if (actors === 2) {
      before = prompt;
      return JSON.stringify({ tool_calls: [check()], section_complete: 'true' });
    }
    assert.equal(actors, 3);
    const previous = current(before), corrected = current(prompt);
    assert.equal(state.calls.filter(call => call.name === 'browser_fill').length, 1);
    assert.deepEqual(corrected.completed_actions, previous.completed_actions);
    assert.deepEqual(corrected.current_snapshot, previous.current_snapshot);
    assert.deepEqual(corrected.pending_contract, previous.pending_contract);
    assert.equal(line(prompt, 'Current decision contract:'), line(before, 'Current decision contract:'));
    assert.equal(line(prompt, 'Interactive execution contract:'), line(before, 'Interactive execution contract:'));
    assert.equal(line(prompt, 'Tool catalog:'), line(before, 'Tool catalog:'));
    assert.equal(corrected.latest_failure.kind, 'actor_response');
    assert.equal(corrected.latest_failure.action_outcome, 'not_attempted');
    assert.deepEqual(corrected.latest_failure.issues, [{ field: 'section_complete', expected: 'boolean true or false' }]);
    assert.match(prompt, /Deferred tool names[^\n]*browser_hover/);
    assert.doesNotMatch(prompt, /HELLOTEST_AI:[^\n]*automationBrowserAgent\.recovery/);
    assert.ok(expand(prompt).length - expand(before).length < 800, 'a format correction adds only its retained field feedback');
    return JSON.stringify({ section_complete: true, tool_calls: [check()] });
  } });
  assert.equal(actors, 3);
  assert.equal(state.calls.filter(call => call.name === 'browser_fill').length, 1);
  assert.equal(state.calls.filter(call => call.name === 'browser_assert').length, 1);
  assert.equal(state.calls.filter(call => call.name === 'browser_hover').length, 0);
  assert.equal(state.saves.length, 1);
});

test('single context-control precedence discloses the authorized data while suppressing accompanying actions', async () => {
  const task = { case: { id: 'case' }, current_section: { id: 'current', action: obligation.action, expected_result: obligation.expected_result },
    build_context: { parameter_data: { values: { 't.email': 'synthetic@example.test' } }, linked_manual_cases: [] } };
  const context = createAutomationActorContext({ task, obligations: [obligation], canonicalGoals: true });
  const state = fixture({ prompt: context.prompt, taskContext: context }); let actors = 0;
  await runAutomationBrowserAgent({ ...state.options, complete: async prompt => {
    const review = packet(prompt); if (review) return accept(review);
    if (++actors === 1) return JSON.stringify({ actor_context_request: { parameter_names: ['t.email'] }, tool_calls: [fill()] });
    assert.equal(state.calls.length, 0);
    assert.match(prompt, /AUTOMATION_ACTOR_CONTEXT_DISCLOSED/);
    assert.doesNotMatch(prompt, /AUTOMATION_ACTOR_RESPONSE_INVALID/);
    return JSON.stringify(done());
  } });
  assert.equal(actors, 2); assert.equal(state.saves.length, 1);
  assert.equal(state.calls.filter(call => call.name === 'browser_fill').length, 1);
});

test('single capability-control precedence expands discovered schemas without performing accompanying actions', async () => {
  const state = fixture(); let actors = 0;
  await runAutomationBrowserAgent({ ...state.options, complete: async prompt => {
    const review = packet(prompt); if (review) return accept(review);
    const catalog = JSON.parse(prompt.match(/^Tool catalog: (.+)$/m)[1]);
    if (++actors === 1) {
      assert.ok(!catalog.some(tool => tool.name === 'browser_hover'));
      return JSON.stringify({ tool_catalog_request: ['browser_hover'], tool_calls: [fill()] });
    }
    assert.equal(state.calls.length, 0);
    assert.match(prompt, /AUTOMATION_BROWSER_TOOL_SCHEMAS_EXPANDED/);
    assert.doesNotMatch(prompt, /AUTOMATION_ACTOR_RESPONSE_INVALID/);
    assert.ok(catalog.some(tool => tool.name === 'browser_hover'));
    return JSON.stringify(done());
  } });
  assert.equal(actors, 2); assert.equal(state.calls.filter(call => call.name === 'browser_hover').length, 0);
  assert.equal(state.calls.filter(call => call.name === 'browser_fill').length, 1);
});

test('a grounded issue report preempts both nonempty actions and the documented empty tool array', async () => {
  for (const tool_calls of [[fill()], []]) {
    const state = fixture(); let actors = 0;
    await assert.rejects(runAutomationBrowserAgent({ ...state.options, complete: async () => {
      actors++; return JSON.stringify({ stage: 'act', step_id: 'current', tool_calls, section_issue: {
        kind: 'unmet_prerequisite', reason: 'The required configured account is unavailable.', evidence_refs: ['current-page']
      } });
    } }), error => error.code === 'AUTOMATION_BROWSER_SECTION_BLOCKED' && error.nonRetryable === true);
    assert.equal(actors, 1); assert.equal(state.calls.length, 0); assert.equal(state.saves.length, 0);
  }
});

test('legacy source proposals are lowered to the same actual checks, compiled and reviewed once before saving', async () => {
  const source = 'await page.locator("#email").fill(params["t.email"]); await expect(page.locator("#email")).toHaveValue(params["t.email"]);';
  for (const envelope of [{ stage: 'source' }, { tool_calls: [] }]) {
    const state = fixture(); let actors = 0, reviews = 0;
    const result = await runAutomationBrowserAgent({ ...state.options, complete: async prompt => {
      const review = packet(prompt); if (review) { reviews++; return accept(review); }
      actors++; return JSON.stringify({ ...envelope, steps: [{ step_id: 'current', automation_code: source }] });
    } });
    assert.equal(actors, 1); assert.equal(reviews, 1); assert.equal(state.saves.length, 1);
    assert.equal(state.calls.filter(call => call.name === 'browser_fill').length, 1);
    assert.equal(state.calls.filter(call => call.name === 'browser_assert').length, 1);
    assert.match(result.steps[0].automation_code, /toHaveValue/);
  }
});
