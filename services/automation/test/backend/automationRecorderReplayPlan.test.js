const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { prepareRecorderReplayActions } = require("../../backend/lib/recording/automationRecorderReplayPlan");
const { validatePairedRecording } = require("../../backend/lib/build/automationPairedRecorder");
const file = require.resolve('../../backend/services/aiAutomationBuilder.service');
const database = { prepare: () => ({ all: async () => [], get: async () => null, run: async () => ({ changes: 1 }) }) };
const sandbox = { module: { exports: {} }, exports: {}, process, URL, Buffer, setTimeout, clearTimeout, console, require: id => {
 if (typeof id === 'string' && id.startsWith('./builder/')) return require('node:module').createRequire(require.resolve('@hellotest/automation/build'))(id);
 if (id.endsWith('/automationAuthoringAdmission.service') || id === '@hellotest/automation/authoring-admission') return {withBuild:async(_scope,reserve)=>reserve(),withRecorder:async(_scope,reserve)=>reserve(),assertNoRecorder:async()=>({state:'idle'})};

  if (id.endsWith('/db') || id.endsWith('/obsDb')) return database;
  if (id === 'crypto') return require('node:crypto');
  if (id.endsWith('/testStepAutomation')) return require('../../../platform/backend/src/utils/testStepAutomation');
  if (id.endsWith('/automationRecorderReplayPlan')) return require("../../backend/lib/recording/automationRecorderReplayPlan");
  if (id.endsWith('/automationRecorderActions')) return require("../../backend/lib/recording/automationRecorderActions");
  return {};
} };
vm.runInNewContext(fs.readFileSync(file, 'utf8') + '\nmodule.exports={buildRecorderStepCandidate,buildRecorderStepCandidates,normalizeCapturedActions};', sandbox, { filename: file });
const host = sandbox.module.exports;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const event = (index, type, fields = {}) => ({ index, type, page_id: 'main', ...fields });
const unsupported = error => error.code === 'AUTOMATION_RECORDER_REPLAY_UNSUPPORTED' && error.statusCode === 422 && /Existing instructions were retained/.test(error.message);

test('browser lifecycle events never become keyboard Tab, while a real Tab remains executable', () => {
  const candidates = host.buildRecorderStepCandidates([
    event(1, 'tab', { locator: 'browser.tab', text: 'Tab opened', source: 'browser' }),
    event(2, 'navigation', { url: 'https://fixture.test/form', source: 'remote-control' }),
    event(3, 'tab', { locator: '#name', text: 'Tab', value: 'Tab', source: 'page-recorder' }),
    event(4, 'tab', { locator: 'browser.tab', text: 'Tab closed', source: 'browser' })
  ]);
  assert.deepEqual(Array.from(candidates, candidate => candidate.source_action_index), [2, 3]);
  assert.equal(candidates.filter(candidate => /keyboard\.press\("Tab"\)/.test(candidate.automation_code)).length, 1);
});

test('a clicked submit and redirect are saved once and only their final route is awaited', async () => {
  const candidates = host.buildRecorderStepCandidates([
    event(1, 'navigation', { url: 'https://fixture.test/form', source: 'remote-control' }),
    event(2, 'click', { locator: '#save', source: 'page-recorder' }),
    event(3, 'submit', { locator: '#form', source: 'page-recorder' }),
    event(4, 'navigation', { url: 'https://fixture.test/redirect', source: 'browser' }),
    event(5, 'navigation', { url: 'https://fixture.test/saved', source: 'browser' })
  ]);
  const calls = [];
  await new AsyncFunction('page', candidates.map(candidate => candidate.automation_code).join('\n'))({
    goto: async url => calls.push(['goto', url]), locator: target => ({ click: async () => calls.push(['click', target]) }),
    waitForURL: async (...args) => calls.push(['wait', ...args])
  });
  assert.deepEqual(calls, [['goto', 'https://fixture.test/form'], ['click', '#save'], ['wait', 'https://fixture.test/saved', { waitUntil: 'commit' }]]);
  assert.equal(candidates.some(candidate => /#form/.test(candidate.automation_code)), false);
});

test('explicit recorder navigation remains an action after an earlier click', () => {
  const plan = prepareRecorderReplayActions([event(1, 'click', { locator: '#button' }), event(2, 'navigation', { source: 'remote-control', url: 'https://fixture.test/another' }), event(3, 'navigation', { source: 'browser', url: 'https://fixture.test/another' })]);
  assert.equal(plan[1].replay_navigation, 'action');
  assert.equal(plan.length, 2);
});

test('absolute viewport and element scrolling retains zero coordinates and replaces duplicate wheel input', async () => {
  const candidates = host.buildRecorderStepCandidates([
    event(1, 'scroll', { source: 'remote-control', value: '{"delta_x":100,"delta_y":200}' }),
    event(2, 'scroll', { source: 'page-recorder', locator: 'viewport', value: '{"x":0,"y":240,"target":"viewport"}' }),
    event(3, 'click', { locator: '#next' }),
    event(4, 'scroll', { source: 'page-recorder', locator: '#panel', value: '{"x":10,"y":0,"target":"element"}' })
  ]);
  assert.deepEqual(Array.from(candidates, candidate => candidate.source_action_index), [2, 3, 4]);
  const calls = [];
  await new AsyncFunction('page', candidates.map(candidate => candidate.automation_code).join('\n'))({
    evaluate: async (_fn, position) => calls.push(['viewport', position]),
    locator: target => ({ click: async () => calls.push(['click', target]), evaluate: async (_fn, position) => calls.push(['element', target, position]) }),
    mouse: { wheel: async () => { throw new Error('A physical scroll was duplicated'); } }
  });
  assert.deepEqual(calls, [['viewport', { x: 0, y: 240 }], ['click', '#next'], ['element', '#panel', { x: 10, y: 0 }]]);
  for (const candidate of candidates) assert.doesNotThrow(() => require("../../backend/lib/build/automationGeneratedProgram").normalizeGeneratedProgram(candidate.automation_code));
});

test('valid coordinate clicks keep their exact viewport point and human labels never become selectors', async () => {
  const candidate = host.buildRecorderStepCandidate(event(1, 'click', { x: 0, y: 25, text: 'Click at 0,25' }), 1);
  const calls = [];
  await new AsyncFunction('page', candidate.automation_code)({ mouse: { click: async (...args) => calls.push(args) } });
  assert.deepEqual(calls, [[0, 25]]);
  for (const type of ['click', 'fill', 'upload', 'select', 'check']) {
    assert.throws(() => host.buildRecorderStepCandidate(event(1, type, { text: 'Human label', value: 'value' }), 1), unsupported);
    assert.throws(() => prepareRecorderReplayActions([event(1, type, { text: 'Human label', value: 'value' })]), unsupported);
  }
});

test('popup, embedded-frame, unsupported drag and malformed scroll recordings fail before compilation', () => {
  for (const actions of [
    [event(1, 'click', { locator: '#open' }), event(2, 'tab', { locator: 'browser.tab', text: 'Tab opened', page_id: 'popup' })],
    [event(1, 'fill', { locator: '#name', frame_scope: 'child', frame_url: 'https://fixture.test/frame' })],
    [event(1, 'drag', { locator: '#source' }), event(2, 'drop', { locator: '#target' })],
    [event(1, 'scroll', { locator: 'viewport', value: '{"x":"12","y":20}' })],
    [event(1, 'submit', { locator: '#form' })]
  ]) assert.throws(() => host.buildRecorderStepCandidates(actions), unsupported);
});

test('paired capture and normalization retain frame context so unsupported frames cannot silently become page locators', () => {
  const actions = [event(1, 'fill', { locator: '#name', value: 'data', frame_scope: 'child', frame_url: 'https://fixture.test/frame' })];
  const metadata = { local_transport: 'paired-agent', test_case_id: 'case', recorder_session_id: 'recording', recorder_case_revision: 1 };
  const capture = validatePairedRecording({ transaction: { created_by: 'user', project_id: 'project' }, metadata,
    testCase: { id: 'case', project_id: 'project', revision: 1 }, sessionId: 'session', recordingId: 'recording', userId: 'user',
    capture: { id: 'session', purpose: 'automation-recording', status: 'stopped', actions } });
  const normalized = host.normalizeCapturedActions(capture.actions);
  assert.equal(normalized[0].frame_scope, 'child');
  assert.equal(normalized[0].frame_url, 'https://fixture.test/frame');
  assert.throws(() => host.buildRecorderStepCandidates(normalized), unsupported);
});

test('the physical click pair of a double-click is represented by one native double-click', () => {
  const actions = [event(1, 'click', { locator: '#item', click_count: 1 }), event(2, 'click', { locator: '#item', click_count: 2 }), event(3, 'dblclick', { locator: '#item', click_count: 2 })];
  const candidates = host.buildRecorderStepCandidates(actions);
  assert.equal(candidates.length, 1);
  assert.match(candidates[0].automation_code, /target\.dblclick\(\)/);
});

test('matching host and DOM key provenance emits one Enter or Tab and suppresses only its derived activation', () => {
  for (const key of ['Enter', 'Tab', 'Space']) {
    const plan = prepareRecorderReplayActions([
      event(1, key === 'Tab' ? 'tab' : 'press', { text: key, value: key, source: 'page-recorder', remote_input_id: 'owned-key', keyboard_activation_id: 'activation' }),
      ...(key === 'Tab' ? [] : [event(2, 'click', { locator: '#submit', source: 'page-recorder', click_count: 0, keyboard_activation_id: 'activation' })]),
      event(3, 'press', { text: key, source: 'remote-control', remote_input_id: 'owned-key' }),
      event(4, 'click', { locator: '#separate', source: 'page-recorder', click_count: 0 })
    ]);
    assert.deepEqual(plan.map(action => action.index), [1, 4], key);
  }
});

test('a remote modified key keeps the actual host chord in the original DOM-event slot', () => {
  const candidates = host.buildRecorderStepCandidates([
    event(1, 'tab', { text: 'Tab', source: 'page-recorder', remote_input_id: 'key' }),
    event(2, 'press', { text: 'Shift+Tab', source: 'remote-control', remote_input_id: 'key' })
  ]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].source_action_index, 1);
  assert.match(candidates[0].automation_code, /keyboard\.press\("Shift\+Tab"\)/);
});
