const test = require('node:test');
const assert = require('node:assert/strict');
const { createAutomationActorContext } = require('../../backend/lib/automationActorContext');
const { buildAutomationGoalObligations } = require('../../backend/lib/automationGoalObligations');
const { runAutomationBrowserAgent } = require('../../backend/lib/automationBrowserAgent');
const { createBrowserParameterResolver } = require('../../backend/lib/automationBrowserParameters');

function fixture() {
  const task = { case: { id: 'case', title: 'Canonical requirements' },
    current_section: { id: 'current', step_order: 1, step_type: 'web', action: '  保存する\nApprove once.  ', expected_result: 'Approval is retained; the balance must not change.\nيجب الاحتفاظ بسجل التدقيق.' },
    build_context: { generation_scope: { mode: 'sequential', active_step_id: 'current', active_manual_step_ids: ['active'] },
      parameter_data: { values: { 'r.name': 'Fixture Person' } },
      linked_manual_cases: [{ id: 'manual', title: 'Manual source', steps: [
        { id: 'active', step_order: 1, action: 'Check the recorded approval', expected_result: 'The audit entry exists, and a second approval does not exist.' },
        { id: 'later', step_order: 2, action: 'Do the next authored action', expected_result: 'The next result is retained.' }
      ] }] } };
  return task;
}
function executionFor(task) {
  return { required: true, step_id: task.current_section.id, action: task.current_section.action, expected_result: task.current_section.expected_result,
    semantic_review_required: true, obligations: buildAutomationGoalObligations({ section: task.current_section,
      manualCases: task.build_context.linked_manual_cases, activeManualStepIds: task.build_context.generation_scope.active_manual_step_ids }) };
}
const embeddedContract = execution => ({ manual_action: execution.action, expected_result: execution.expected_result, required_obligations: execution.obligations });

test('canonical goals retain every exact active clause once per obligation and reference it from metadata and discovery', () => {
  const task = fixture(), execution = executionFor(task);
  const manager = createAutomationActorContext({ task, obligations: execution.obligations, canonicalGoals: true });
  const selected = JSON.parse(manager.prompt);
  assert.deepEqual(selected.required_obligations, execution.obligations);
  assert.equal(selected.current_section.obligation_id, 'current');
  assert.equal(Object.hasOwn(selected.current_section, 'action'), false);
  assert.equal(Object.hasOwn(selected.current_section, 'expected_result'), false);
  const active = selected.build_context.linked_manual_cases[0].steps[0];
  assert.equal(active.obligation_id, 'manual:manual:active');
  assert.equal(Object.hasOwn(active, 'action'), false);
  assert.equal(Object.hasOwn(active, 'expected_result'), false);
  const [hint, later] = selected.available_context.manual_steps[0].steps;
  assert.equal(hint.obligation_id, active.obligation_id);assert.equal(Object.hasOwn(hint, 'action_excerpt'), false);
  assert.equal(later.action_excerpt, task.build_context.linked_manual_cases[0].steps[1].action);
  assert.deepEqual(selected.parameter_data.values, { 'r.name': '@r.name' });
  const disclosed = manager.request({ manual_steps: [{ manual_test_case_id: 'manual', manual_step_id: 'active' }] });
  assert.equal(disclosed.data.manual_steps[0].expected_result, execution.obligations[1].expected_result, 'lookup keeps the complete authorized source');
  assert.equal(manager.measurements.goal_packing, 'canonical_obligations');
  assert.equal(manager.measurements.active_obligation_count, 2);
});

test('compact execution contracts require exact pinned identities, clauses and qualified manual sources', () => {
  const task = fixture(), execution = executionFor(task);
  const manager = createAutomationActorContext({ task, obligations: execution.obligations, canonicalGoals: true });
  const expected = { requirements_source: 'automation_actor_task.required_obligations', required_obligation_ids: execution.obligations.map(goal => goal.id) };
  assert.deepEqual(manager.compactGoalContract(execution), expected);
  assert.deepEqual(manager.compactGoalContract(execution, manager.prompt+'\nfeedback'), expected);
  assert.equal(manager.compactGoalContract(execution, 'An unrelated prompt without the canonical goals'), null);
  assert.equal(manager.compactGoalContract(execution, { content: manager.prompt }), null);
  assert.deepEqual(manager.compactGoalContract({ ...execution, obligations: [...execution.obligations].reverse() }), expected);
  const mismatches = [
    { ...execution, required: false }, { ...execution, step_id: 'another' }, { ...execution, action: 'Different action' },
    { ...execution, expected_result: 'A weaker expected result' }, { ...execution, obligations: undefined },
    { ...execution, obligations: execution.obligations.slice(0, 1) },
    { ...execution, obligations: [execution.obligations[0], execution.obligations[0]] },
    { ...execution, obligations: execution.obligations.map((goal, index) => index ? { ...goal, manual_test_case_id: 'unlinked' } : goal) },
    { ...execution, obligations: execution.obligations.map((goal, index) => index ? { ...goal, action: 'Changed source' } : goal) },
    { ...execution, obligations: execution.obligations.map((goal, index) => index ? { ...goal, source: 'model_claim' } : goal) }
  ];
  for (const changed of mismatches) assert.equal(manager.compactGoalContract(changed), null);
  const mutable = manager.compactGoalContract(execution);mutable.required_obligation_ids.length = 0;
  assert.deepEqual(manager.compactGoalContract(execution), expected);
  assert.equal(createAutomationActorContext({ task }).compactGoalContract(execution), null, 'legacy callers retain the full execution contract');
});

test('canonical goal projection preserves privacy and does not resolve inserted token-like values again', () => {
  const secret = 'owned-private-value-789';
  const resolver = createBrowserParameterResolver({ caseValues: { 'r.name': 'literal @r.second value', 'r.second': 'MUST_NOT_RESOLVE_TWICE', 't.password': secret } });
  const task = fixture();task.current_section.action = resolver.projectText('Enter @r.name then @t.password');
  task.current_section.expected_result = resolver.projectText('The value is @r.name.');
  task.build_context.parameter_data.values = resolver.promptValues;
  task.case.description = `Retain privacy for ${secret}`;
  const execution = executionFor(task), manager = createAutomationActorContext({ task, obligations: execution.obligations, canonicalGoals: true, projectText: resolver.projectPrivateText });
  const selected = JSON.parse(manager.prompt);
  assert.match(selected.required_obligations[0].action, /literal @r\.second value/);
  assert.match(selected.required_obligations[0].action, /@t\.password/);
  assert.doesNotMatch(manager.prompt, new RegExp(`${secret}|MUST_NOT_RESOLVE_TWICE`));
  assert.deepEqual(manager.compactGoalContract(execution)?.required_obligation_ids, execution.obligations.map(goal => goal.id));
});

test('canonical packing reduces measured UTF8 prompt bytes while preserving full long multilingual goals', t => {
  const task = fixture();
  task.current_section.action = 'ACTIVE_ACTION_SENTINEL '+ 'Perform every authored clause. '.repeat(80);
  task.current_section.expected_result = 'ACTIVE_EXPECTED_SENTINEL '+ 'Result remains correct; unrelated state must not change. '.repeat(80);
  Object.assign(task.build_context.linked_manual_cases[0].steps[0], { action: task.current_section.action, expected_result: task.current_section.expected_result });
  const execution = executionFor(task);
  const embedded = createAutomationActorContext({ task, obligations: execution.obligations });
  const canonical = createAutomationActorContext({ task, obligations: execution.obligations, canonicalGoals: true });
  const before = Buffer.byteLength(embedded.prompt+'\n'+JSON.stringify(embeddedContract(execution)), 'utf8');
  const after = Buffer.byteLength(canonical.prompt+'\n'+JSON.stringify(canonical.compactGoalContract(execution)), 'utf8');
  assert.deepEqual(JSON.parse(canonical.prompt).required_obligations, execution.obligations);
  assert.ok(after < before * .5, `${after} should be less than half of ${before}`);
  assert.equal(canonical.measurements.token_measurement, 'provider_usage_is_authoritative');
  t.diagnostic(JSON.stringify({ measurement: 'UTF8_bytes_not_provider_tokens', before_bytes: before, after_bytes: after, reduction_percent: Math.round((1-after/before)*1000)/10 }));
});

test('an oversized complete UTF8 goal fails before any actor model or browser dispatch and is never truncated', async () => {
  const task = fixture();task.current_section.action = '保留'.repeat(8_100);
  const execution = executionFor(task);
  let modelCalls = 0, browserCalls = 0;
  await assert.rejects(async () => {
    const manager = createAutomationActorContext({ task, obligations: execution.obligations, canonicalGoals: true });
    await runAutomationBrowserAgent({ prompt: manager.prompt, taskContext: manager, actorMode: true, execution,
      browser: { tools: [], call: async () => { browserCalls++; } }, complete: async () => { modelCalls++;return '{}'; }, parse: JSON.parse });
  }, error => error.code === 'AUTOMATION_ACTOR_GOAL_INPUT_TOO_LARGE' && error.nonRetryable && error.details.active_goal_utf8_bytes > 48_000);
  assert.equal(modelCalls, 0);assert.equal(browserCalls, 0);
  assert.equal(task.current_section.action.length, 16_200, 'byte limits must not truncate Unicode clauses');
  assert.doesNotThrow(() => createAutomationActorContext({ task }), 'legacy callers preserve their previous context contract');
});

test('the real actor prompt uses canonical goal IDs only on an exact match and otherwise retains the complete legacy contract', async () => {
  for (const scenario of ['matches', 'changed_execution', 'missing_canonical_task']) {
    const matches = scenario === 'matches';
    const task = fixture(), execution = executionFor(task);
    const manager = createAutomationActorContext({ task, obligations: execution.obligations, canonicalGoals: true });
    const dispatched = scenario === 'changed_execution' ? { ...execution, expected_result: 'Different expected result must remain explicit' } : execution;
    let prompt, browserCalls = 0;
    await assert.rejects(runAutomationBrowserAgent({ prompt: scenario === 'missing_canonical_task' ? 'A legacy prompt without the canonical task payload' : manager.prompt, taskContext: manager, actorMode: true, execution: dispatched,
      browser: { tools: [], call: async () => { browserCalls++; } }, startUrl: undefined, maxTurns: 1, maxCalls: 0,
      complete: async input => { prompt = input;return JSON.stringify({ error: 'stop after prompt capture' }); }, parse: JSON.parse }), /stop after prompt capture/);
    const prefix = 'Interactive execution contract: ';
    const contract = JSON.parse(prompt.split('\n').find(line => line.startsWith(prefix)).slice(prefix.length));
    if (matches) {
      assert.deepEqual(contract.required_obligation_ids, execution.obligations.map(goal => goal.id));
      assert.equal(contract.requirements_source, 'automation_actor_task.required_obligations');
      assert.equal(Object.hasOwn(contract, 'manual_action'), false);assert.equal(Object.hasOwn(contract, 'required_obligations'), false);
    } else {
      assert.equal(contract.manual_action, dispatched.action);assert.equal(contract.expected_result, dispatched.expected_result);
      assert.deepEqual(contract.required_obligations, dispatched.obligations);
    }
    assert.equal(browserCalls, 0);
  }
});
