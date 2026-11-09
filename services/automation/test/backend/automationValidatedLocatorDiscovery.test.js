const test = require('node:test'), assert = require('node:assert/strict');
const { runAutomationBrowserAgent } = require('../../backend/lib/automationBrowserAgent');
const receipt = (value, isError = false) => ({ isError, content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', url: 'https://fixture.test/app', ...value }) }] });
const element = (id, visible = true) => ({ tag: 'a', attributes: { id }, text: id, displayed: visible, locators_validated: true, locator_candidates: ['#' + id] });
const state = prompt => JSON.parse(prompt.match(/^Current browser state and confirmed section progress .*?: (.+)$/m)[1]);
const actor = tools => JSON.stringify({ stage: 'act', step_id: 'current', section_complete: true, tool_calls: tools });
const validation = (frame, locator = '#add') => ({ name: 'browser_validate_locator', arguments: { locator, ...(frame ? { frame } : {}) } });
function fixture({ failure, frame = false, registered = false, maxCalls = 12, count = 1 } = {}) {
  const calls = [], observations = [], source = { required: true, step_id: 'current', action: 'Verify the Add control is visible.', expected_result: 'Add is visible.' };
  const initial = { tool: 'browser_snapshot', result: receipt({ observation_id: 'body', scope: 'body', partial: true, elements: [element(registered ? 'add' : 'background')],
    ...(frame ? { frame_path:['#child'],frame_url:'https://fixture.test/child',frame_document_id:'child-document' } : {}) }) };
  return { calls, observations, options: { browser: { tools: ['browser_snapshot', 'browser_validate_locator', 'browser_assert'].map(name => ({ name, inputSchema: { type: 'object' } })), call: async (name, args) => {
    calls.push({ name, args });
    if (name === 'browser_validate_locator') return receipt({ match_count: count, unique: count === 1 });
    if (name === 'browser_assert') return receipt({ assertion_outcome: 'satisfied',...(args.frame?{frame_path:args.frame,frame_url:'https://fixture.test/child',frame_document_id:'child-document'}:{}) });
    if (!args.locator) return initial.result;
    if (failure === 'throw') throw Error('PRIVATE read detail');
    if (failure) return receipt({ code: 'BROWSER_SNAPSHOT_SCOPE_STALE', tool_phase: 'snapshot', action_outcome: 'not_attempted', retry_safe: true }, true);
    return receipt({ observation_id: 'scoped', scope: args.locator, elements: [element('add')], ...(args.frame ? { frame_path: args.frame, frame_url: 'https://fixture.test/child', frame_document_id: 'child-document' } : {}) });
  } }, prompt: 'Verify Add', execution: source, actorMode: true, parse: JSON.parse, maxCalls, maxTurns: 4, initialObservations: [initial], onObservation: row => observations.push(row), onPartialBuild: async () => ({ generation_complete: true }) } };
}
for (const frame of [false, true]) test(`count-only validation obtains one exact ${frame ? 'framed' : 'main'} scoped snapshot before the actor selects a target`, async () => {
  const f = fixture({ frame }); let turns = 0;
  const result = await runAutomationBrowserAgent({ ...f.options, complete: async prompt => {
    if (++turns === 1) return actor([validation(frame ? ['#child'] : undefined), { name: 'browser_assert', arguments: { assertion: 'visible', locator: '#add' } }]);
    assert.equal(turns, 2); assert.equal(f.calls.filter(row => row.name === 'browser_assert').length, 0, 'remaining old-batch assertion did not run');
    const page = state(prompt).current_snapshot; assert.equal(page.scope, '#add', JSON.stringify({ calls:f.calls, failure:state(prompt).latest_failure })); if (frame) assert.deepEqual(page.frame_path, ['#child']);
    return actor([{ name: 'browser_assert', arguments: { assertion: 'visible', locator: page.targets[0].ref } }]);
  } });
  assert.deepEqual(f.calls.map(row => row.name), ['browser_validate_locator', 'browser_snapshot', 'browser_assert']);
  assert.deepEqual(f.calls[1].args, frame ? { locator: '#add', frame: ['#child'] } : { locator: '#add' });
  if (frame) assert.deepEqual(f.calls[2].args.frame, ['#child']);
  assert.match(result.steps[0].automation_code, /toBeVisible/); assert.doesNotMatch(result.steps[0].automation_code, /\.click\(/);
});
for (const failure of ['native', 'throw']) test(`a ${failure} scoped-read failure grants no target and automatic discovery remains once per selector`, async () => {
  const f = fixture({ failure }); let turns = 0;
  await assert.rejects(runAutomationBrowserAgent({ ...f.options, complete: async prompt => {
    turns++; if (turns < 3) return actor([validation()]);
    assert.equal(state(prompt).current_snapshot.targets[0].text, 'background');
    throw Object.assign(Error('fixture stop after inspecting failure'), { code: 'FIXTURE_STOP' });
  } }), { code: 'FIXTURE_STOP' });
  assert.equal(f.calls.filter(row => row.name === 'browser_snapshot').length, 1); assert.equal(f.calls.filter(row => row.name === 'browser_assert').length, 0);
  assert.ok(f.observations.some(row => row.mcp_call === false && row.result.content.some(part => /count only|count-only|count.*no observed target/i.test(part.text))));
  if (failure === 'native') assert.ok(f.observations.some(row => row.tool === 'browser_snapshot' && row.result.isError));
  else { assert.ok(f.observations.some(row => row.tool === 'automation_target_feedback' && row.mcp_call === false)); assert.equal(f.observations.some(row => row.tool === 'browser_snapshot'), false); }
});
test('already observed targets skip discovery and the normal assertion still executes', async () => {
  const f = fixture({ registered: true }); await runAutomationBrowserAgent({ ...f.options, complete: async () => actor([validation(), { name: 'browser_assert', arguments: { assertion: 'visible', locator: '#add' } }]) });
  assert.deepEqual(f.calls.map(row => row.name), ['browser_validate_locator', 'browser_assert']);
});
test('formatting variants share one canonical selector discovery allowance',async()=>{
  const f=fixture({failure:'native'});let turns=0;
  await assert.rejects(runAutomationBrowserAgent({...f.options,complete:async()=>{
    turns++;if(turns===1)return actor([validation(undefined,'getByText("Add", {exact:true})')]);
    if(turns===2)return actor([validation(undefined,"page.getByText('Add', { exact: true });")]);
    throw Object.assign(Error('fixture stop'),{code:'FIXTURE_STOP'});
  }}),{code:'FIXTURE_STOP'});
  assert.equal(f.calls.filter(row=>row.name==='browser_validate_locator').length,2);
  assert.equal(f.calls.filter(row=>row.name==='browser_snapshot').length,1);
});
test('discovery cannot exceed the existing call allowance', async () => {
  const f = fixture({ maxCalls: 1 }); await assert.rejects(runAutomationBrowserAgent({ ...f.options, complete: async () => actor([validation()]) }), error => ['AUTOMATION_BROWSER_TOOL_BUDGET_EXHAUSTED', 'AUTOMATION_BROWSER_EXECUTION_INCOMPLETE'].includes(error.code));
  assert.deepEqual(f.calls.map(row => row.name), ['browser_validate_locator']);
});
for (const count of [0, 2]) test(`a validation match count of${count} never triggers exact scoped discovery`, async () => {
  const f = fixture({ count }); let turns = 0; await assert.rejects(runAutomationBrowserAgent({ ...f.options, complete: async () => {
    if (++turns === 1) return actor([validation()]); throw Object.assign(Error('fixture stop'), { code: 'FIXTURE_STOP' });
  } }), { code: 'FIXTURE_STOP' });
  assert.equal(f.calls.some(row => row.name === 'browser_snapshot' && row.args.locator), false); assert.equal(f.calls.some(row => row.name === 'browser_assert'), false);
});
