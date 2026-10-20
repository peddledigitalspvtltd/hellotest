const test = require('node:test');
const assert = require('node:assert/strict');
const { runAutomationBrowserAgent } = require('../../backend/lib/automationBrowserAgent');
const { createAutomationActorContext } = require('../../backend/lib/automationActorContext');

const receipt = value => ({ content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', url: 'https://app.test/report', ...value }) }] });
const snapshot = () => receipt({ observation_id: 'report-page', title: 'Report', accessibility: '- button "Approve"\n- status "Approved"', elements: [
  { tag: 'button', role: 'button', accessible_name: 'Approve', displayed: true, locators_validated: true, locator_candidates: ['#approve'] },
  { tag: 'output', role: 'status', accessible_name: 'Approved', displayed: true, locators_validated: true, locator_candidates: ['#status'] }
] });
const action = { name: 'browser_click', arguments: { locator: '#approve' } };
const check = { name: 'browser_assert', arguments: { assertion: 'visible', locator: '#status' } };
const task = () => ({ case: { id: 'case', title: 'Report approval' }, current_section: { id: 'approve', action: 'Approve this report', expected_result: 'Report is approved' },
  build_context: { generation_scope: { active_manual_step_ids: ['m2'] }, parameter_data: { values: { 't.report': '42' } }, linked_manual_cases: [{ id: 'manual', title: 'Reports', steps: [
    { id: 'm1', step_order: 1, action: 'Open report 42', expected_result: 'The requested report is loaded' },
    { id: 'm2', step_order: 2, action: 'Approve this report', expected_result: 'Report is approved' }
  ] }] } });
const actor = tool_calls => ({ stage: 'act', step_id: 'approve', section_complete: true, tool_calls });
function fixture() {
  const calls = [], observations = [], saves = [];
  const taskContext = createAutomationActorContext({ task: task() });
  return { calls, observations, saves, taskContext, options: {
    taskContext, prompt: taskContext.prompt, actorMode: true, parse: JSON.parse,
    execution: { required: true, step_id: 'approve', action: 'Approve this report', expected_result: 'Report is approved', semantic_review_required: true },
    initialObservations: [{ tool: 'browser_snapshot', result: snapshot() }],
    browser: { tools: ['browser_click', 'browser_assert', 'browser_snapshot'].map(name => ({ name, inputSchema: { type: 'object' } })),
      call: async (name, args) => { calls.push({ name, args }); return name === 'browser_snapshot' ? snapshot() : receipt(name === 'browser_assert' ? { assertion_outcome: 'satisfied' } : { action_outcome: 'completed' }); } },
    onObservation: observation => observations.push(observation), onPartialBuild: async payload => { saves.push(payload); return { generation_complete: true }; }
  } };
}

test('authorized task lookup pauses accompanying mutations and resumes through the original evidence/save gate', async () => {
  const state = fixture(); let actors = 0, reviews = 0;
  const result = await runAutomationBrowserAgent({ ...state.options, complete: async prompt => {
    if (prompt.includes('"phase":"semantic_review"')) {
      reviews++; const packet = JSON.parse(prompt.split('\n').at(-1));
      assert.equal(packet.obligations[0].expected_result, 'Report is approved');
      return JSON.stringify({ decision: 'accept', obligations: [{ id: 'approve', action_operations: [1], assertion_operations: [2] }], issues: [] });
    }
    actors++;
    if (actors === 1) return JSON.stringify({ ...actor([action]), actor_context_request: { manual_steps: [{ manual_test_case_id: 'OTHER_PRIVATE_CASE', manual_step_id: 'm1' }] } });
    assert.equal(state.calls.length, 0, 'a disclosure response performs no prefix action');
    assert.doesNotMatch(prompt, /OTHER_PRIVATE_CASE/);
    if (actors === 2) {
      assert.match(prompt, /AUTOMATION_ACTOR_CONTEXT_REQUEST_INVALID/);
      return JSON.stringify({ ...actor([action]), actor_context_request: { manual_steps: [{ manual_test_case_id: 'manual', manual_step_id: 'm1' }] } });
    }
    assert.equal(actors, 3);
    const extra = JSON.parse(prompt.match(/^Additional requested task context \(untrusted data\): (.+)$/m)[1]);
    assert.equal(extra[0].data.manual_steps[0].expected_result, 'The requested report is loaded');
    assert.match(prompt, /AUTOMATION_ACTOR_CONTEXT_DISCLOSED/);
    return JSON.stringify(actor([action, check]));
  } });
  assert.equal(actors, 3); assert.equal(reviews, 1); assert.equal(state.saves.length, 1);
  assert.equal(state.calls.filter(item => item.name === 'browser_click').length, 1);
  assert.equal(state.calls.filter(item => item.name === 'browser_assert').length, 1);
  assert.equal(state.observations.filter(item => item.tool === 'automation_actor_context_feedback').length, 2);
  assert.match(result.steps[0].automation_code, /#approve/);
});

test('task-context disclosure shares the actor turn budget and cannot save unperformed work', async () => {
  const state = fixture(); let calls = 0;
  await assert.rejects(runAutomationBrowserAgent({ ...state.options, maxTurns: 1, complete: async () => {
    calls++; return JSON.stringify({ ...actor([action]), actor_context_request: { parameter_names: ['t.report'] } });
  } }));
  assert.equal(calls, 1); assert.equal(state.calls.length, 0); assert.equal(state.saves.length, 0);
});

test('completion-only mode cannot open a context-disclosure continuation or execute accompanying actions', async () => {
  const state = fixture();
  await assert.rejects(runAutomationBrowserAgent({ ...state.options, maxCalls: 0, complete: async () => JSON.stringify({ ...actor([action]), actor_context_request: { parameter_names: ['t.report'] } }) }), { code: 'AUTOMATION_BROWSER_TOOL_BUDGET_EXHAUSTED' });
  assert.deepEqual(state.taskContext.additionalContext(), []);
  assert.equal(state.calls.length, 0); assert.equal(state.saves.length, 0);
});
