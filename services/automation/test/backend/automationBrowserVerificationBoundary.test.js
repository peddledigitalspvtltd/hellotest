const test = require('node:test');
const assert = require('node:assert/strict');
const { runAutomationBrowserAgent } = require('../../backend/lib/automationBrowserAgent');
const { browserVerificationBoundary, recordBrowserCheck } = require('../../backend/lib/automationBrowserRecovery');

const receipt = value => ({ content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', url: 'https://app.test/profile', ...value }) }] });
const failed = (code = 'BROWSER_ASSERTION_NOT_SATISFIED') => ({ isError: true, content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', code, assertion_outcome: 'not_satisfied', action_outcome: 'not_attempted' }) }] });
const snapshot = () => receipt({ observation_id: 'profile-page', title: 'Profile', scope: 'body', elements: [
  { tag: 'input', role: 'textbox', locators_validated: true, locator_candidates: ['#other'] },
  { tag: 'button', role: 'button', text: 'Save', locators_validated: true, locator_candidates: ['#save'] },
  { tag: 'p', role: 'status', text: 'Saved', locators_validated: true, locator_candidates: ['#status'] }
], accessibility: '- button "Save"\n- status "Saved"' });
const save = { name: 'browser_click', arguments: { locator: '#save' } };
const check = { name: 'browser_assert', arguments: { assertion: 'visible', locator: '#status' } };
const actor = (tool_calls, section_complete = true) => JSON.stringify({ stage: 'act', step_id: 'profile', tool_calls, section_complete });
const current = prompt => JSON.parse(prompt.match(/^Current browser state and confirmed section progress .*?: (.+)$/m)[1]);
function setup() {
  const calls = [], observations = [], saved = [];let assertions = 0;
  const options = { browser: { tools: ['browser_click', 'browser_fill', 'browser_assert', 'browser_snapshot'].map(name => ({ name, inputSchema: { type: 'object' } })),
    call: async (name, args) => { calls.push({ name, args });return name === 'browser_snapshot' ? snapshot() : name === 'browser_assert' ? ++assertions === 1 ? failed() : receipt({ assertion_outcome: 'satisfied' }) : receipt({ action_outcome: 'completed' }); } },
    actorMode: true, prompt: 'Save the profile and check its confirmation', execution: { required: true, semantic_review_required: true, step_id: 'profile', action: 'Save the profile', expected_result: 'Saved status is visible' },
    initialObservations: [{ tool: 'browser_snapshot', result: snapshot() }], parse: JSON.parse, onObservation: value => observations.push(value), onPartialBuild: async value => { saved.push(value);return { generation_complete: true }; } };
  return { calls, observations, saved, options };
}
const review = () => JSON.stringify({ decision: 'accept', obligations: [{ id: 'profile', action_operations: [1], assertion_operations: [2] }], issues: [] });

test('failed final check blocks new data changes, preserves confirmed action reconciliation and permits a read-only check correction', async () => {
  const state = setup();let turns = 0;
  await runAutomationBrowserAgent({ ...state.options, complete: async prompt => {
    if (prompt.includes('"phase":"semantic_review"')) return review();
    if (++turns === 1) return actor([save, check]);
    assert.equal(current(prompt).verification_boundary.actions_allowed, false);
    if (turns === 2) return actor([save, { name: 'browser_fill', arguments: { locator: '#other', value: 'force-pass' } }]);
    assert.match(prompt, /AUTOMATION_BROWSER_VERIFICATION_ACTION_BLOCKED/);
    return actor([check]);
  } });
  assert.equal(turns, 3);assert.equal(state.saved.length, 1);
  assert.equal(state.calls.filter(item => item.name === 'browser_click').length, 1);
  assert.equal(state.calls.filter(item => item.name === 'browser_fill').length, 0);
  assert.equal(state.calls.filter(item => item.name === 'browser_assert').length, 2);
  assert.ok(state.observations.some(item => item.tool === 'automation_action_reconciliation'));
  assert.equal(state.observations.find(item => item.tool === 'automation_verification_feedback').mcp_call, false);
  assert.doesNotMatch(JSON.stringify(state.saved), /force-pass/);
});

test('a repeated new mutation after final check failure stops before browser calls, review or save', async () => {
  const state = setup();let turns = 0;
  await assert.rejects(runAutomationBrowserAgent({ ...state.options, complete: async () => ++turns === 1 ? actor([save, check]) : actor([{ name: 'browser_click', arguments: { locator: '#other' } }]) }), { code: 'AUTOMATION_BROWSER_VERIFICATION_ACTION_STALLED', nonRetryable: true });
  assert.equal(turns, 3);assert.equal(state.saved.length, 0);
  assert.deepEqual(state.calls.filter(item => item.name !== 'browser_snapshot').map(item => item.name), ['browser_click', 'browser_assert']);
});

test('exploratory checks before closing the action phase do not block remaining authored actions', async () => {
  const state = setup();let turns = 0;
  await runAutomationBrowserAgent({ ...state.options, complete: async prompt => {
    if (prompt.includes('"phase":"semantic_review"')) return review();
    if (++turns === 1) return actor([check], false);
    assert.equal(current(prompt).verification_boundary, undefined);
    return actor([save, check]);
  } });
  assert.equal(state.saved.length, 1);assert.equal(state.calls.filter(item => item.name === 'browser_click').length, 1);
});

test('the boundary requires an issued actual final check, not parsed history, another section, schema rejection or subject feedback', () => {
  for (const code of ['BROWSER_TOOL_INVALID_ARGUMENTS', 'BROWSER_READ_UNAVAILABLE', 'AUTOMATION_BROWSER_ASSERTION_SUBJECT_MISMATCH']) {
    const observation = { tool: check.name, result: failed(code), execution_step_id: 'profile' };
    recordBrowserCheck(observation, check, 'state', { verificationRequested: true });
    assert.equal(browserVerificationBoundary([observation], 'profile'), null);
  }
  const observation = { tool: check.name, result: failed(), execution_step_id: 'profile' };
  assert.equal(browserVerificationBoundary([observation], 'profile'), null);
  recordBrowserCheck(observation, check, 'state', { verificationRequested: true });
  assert.equal(browserVerificationBoundary([observation], 'profile').phase, 'verification_observation_only');
  assert.equal(browserVerificationBoundary([structuredClone(observation)], 'profile'), null);
  assert.equal(browserVerificationBoundary([observation], 'another-section'), null);
  const predispatch = { ...observation, mcp_call: false };
  recordBrowserCheck(predispatch, check, 'state', { verificationRequested: true });
  assert.equal(browserVerificationBoundary([predispatch], 'profile'), null);
});
