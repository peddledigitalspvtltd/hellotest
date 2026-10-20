const test = require('node:test');
const assert = require('node:assert/strict');
const { runAutomationBrowserAgent } = require('../../backend/lib/automationBrowserAgent');
const { browserCurrentSnapshotObservation, browserPromptContext } = require('../../backend/lib/automationBrowserContext');
const { canonicalReviewEvidence } = require('../../backend/lib/automationReviewEvidence');
const { recordedSectionRequests } = require('../../backend/lib/automationBrowserRecording');
const { createBrowserParameterResolver } = require('../../backend/lib/automationBrowserParameters');

const receipt = value => ({ content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', url: 'https://app.test/profile', ...value }) }] });
const actorState = prompt => JSON.parse(prompt.match(/^Current browser state and confirmed section progress .*?: (.+)$/m)[1]);
const assertionSchema = { type: 'object', additionalProperties: false, required: ['assertion'],
  properties: { assertion: { enum: ['text', 'value', 'text_content'] }, locator: { type: 'string' }, value: { type: 'string' } },
  oneOf: [{ properties: { assertion: { enum: ['text', 'value', 'text_content'] } }, required: ['locator', 'value'] }] };

test('a wrong text check is corrected before MCP while the completed fill and original data reference survive', async () => {
  const params = createBrowserParameterResolver({ caseValues: { 'r.name': 'Fixture Person' } });
  let entered = '', snapshots = 0, actors = 0, reviews = 0, saves = 0, beforeWrong, liveAfterFill;
  const calls = [], events = [], observations = [];
  const snapshot = () => receipt({ observation_id: `name-page-${snapshots}`, scope: 'body', accessibility: '- textbox "Full name"\n- status "Name accepted"', elements: [
    { tag: 'input', attributes: { type: 'text' }, accessible_role: 'textbox', accessible_name: 'Full name', text: '', displayed: true, locators_validated: true, locator_candidates: ['#name'] },
    { tag: 'p', accessible_role: 'status', text: entered ? 'Name accepted' : 'Enter a name', displayed: true, locators_validated: true, locator_candidates: ['#name-status'] }
  ] });
  observations.push({ tool: 'browser_snapshot', result: snapshot() });
  const browser = { tools: ['browser_fill', 'browser_assert', 'browser_snapshot'].map(name => ({ name, inputSchema: name === 'browser_assert' ? assertionSchema : { type: 'object' } })),
    projectPromptText: params.projectText, projectPrivateText: params.projectPrivateText,
    call: async (name, args) => {
      const resolved = params.resolve(name, args);calls.push({ name, args: resolved });
      if (name === 'browser_snapshot') { snapshots++;return snapshot(); }
      if (name === 'browser_fill') { entered = resolved.value;return receipt({ action_outcome: 'completed' }); }
      assert.notEqual(resolved.assertion, 'text', 'the incorrect property never reaches MCP');
      if (resolved.assertion === 'value') assert.equal(resolved.value, entered);
      else { assert.equal(resolved.assertion, 'text_content');assert.equal(resolved.value, 'Name accepted'); }
      return receipt({ assertion_outcome: 'satisfied' });
    }
  };
  const result = await runAutomationBrowserAgent({ browser, actorMode: true, generationMode: 'sequential', parse: JSON.parse, prompt: 'Use configured name data and its field validation feedback',
    execution: { required: true, semantic_review_required: true, step_id: 'name', action: 'Enter @r.name', expected_result: 'The configured name is entered and the field reports Name accepted' },
    initialObservations: observations, maxCalls: 8, onObservation: observation => observations.push(observation), onProgress: event => events.push(event),
    onPartialBuild: async () => { saves++;assert.equal(reviews, 1);return { generation_complete: true }; },
    complete: async prompt => {
      if (prompt.includes('"phase":"semantic_review"')) {
        reviews++;const packet = JSON.parse(prompt.split('\n').at(-1));
        assert.deepEqual(packet.confirmed_operations.map(operation => operation.name), ['browser_fill', 'browser_assert', 'browser_assert']);
        assert.equal(packet.confirmed_operations[1].arguments.assertion, 'value');assert.equal(packet.confirmed_operations[2].arguments.assertion, 'text_content');
        assert.deepEqual(packet.unsuccessful_checks, []);
        assert.equal(packet.latest_failure, null);
        return JSON.stringify({ decision: 'accept', obligations: [{ id: 'name', action_operations: [1], assertion_operations: [2, 3] }], issues: [] });
      }
      const current = actorState(prompt);actors++;
      const name = current.current_snapshot.targets.find(target => target.name === 'Full name');
      assert.equal(name.assertion_subject, 'input_value');assert.equal(name.preferred_value_assertion, 'value');
      if (actors === 1) return JSON.stringify({ stage: 'act', step_id: 'name', section_complete: false, tool_calls: [{ name: 'browser_fill', arguments: { locator: name.ref, value: '@r.name' } }] });
      if (actors === 2) {
        beforeWrong = { calls: calls.length, snapshots, evidence: canonicalReviewEvidence({ observations, stepId: 'name' }) };
        liveAfterFill = browserCurrentSnapshotObservation(observations);
        return JSON.stringify({ stage: 'act', step_id: 'name', section_complete: false, tool_calls: [{ name: 'browser_assert', arguments: { assertion: 'text', locator: name.ref, value: '@r.name' } }] });
      }
      assert.equal(calls.length, beforeWrong.calls);assert.equal(snapshots, beforeWrong.snapshots, 'host correction refreshes no browser snapshot');
      assert.equal(browserCurrentSnapshotObservation(observations), liveAfterFill);
      assert.deepEqual(canonicalReviewEvidence({ observations, stepId: 'name' }), beforeWrong.evidence);
      assert.equal(current.latest_failure.kind, 'assertion_subject');
      assert.equal(current.pending_contract.next_required, 'correct_assertion_subject_with_discovered_contract');
      assert.equal(current.pending_contract.expected_result_check, 'required');assert.equal(current.pending_contract.completion_available, false);
      assert.deepEqual(current.latest_failure.value_assertion_contract, { assertion: 'value', required_arguments: ['assertion', 'locator', 'value'] });
      const status = current.current_snapshot.targets.find(target => target.text === 'Name accepted');assert.ok(status);
      return JSON.stringify({ stage: 'act', step_id: 'name', section_complete: true, tool_calls: [
        { name: 'browser_assert', arguments: { assertion: 'value', locator: name.ref, value: '@r.name' } },
        { name: 'browser_assert', arguments: { assertion: 'text_content', locator: status.ref, value: 'Name accepted' } }
      ] });
    }
  });
  assert.equal(actors, 3);assert.equal(reviews, 1);assert.equal(saves, 1);
  assert.equal(calls.filter(call => call.name === 'browser_fill').length, 1);
  assert.equal(calls.filter(call => call.name === 'browser_assert').length, 2);
  assert.equal(observations.filter(observation => observation.tool === 'automation_assertion_feedback').length, 1);
  assert.ok(!observations.some(observation => observation.tool === 'browser_assert' && observation.result.isError));
  assert.ok(!events.some(event => event.phase === 'automation.agent.action.failed'));
  assert.equal(browserPromptContext(observations, 'name', { compactModel: true }).current.latest_failure, undefined);
  assert.deepEqual(recordedSectionRequests(observations, 'name').filter(operation => Object.hasOwn(operation.arguments, 'value')).map(operation => operation.arguments.value), ['@r.name', '@r.name', 'Name accepted']);
  assert.match(result.steps[0].automation_code, /\.fill\("@r\.name"\)/);assert.match(result.steps[0].automation_code, /\.toHaveValue\("@r\.name"\)/);
  assert.doesNotMatch(result.steps[0].automation_code, /innerText|Fixture Person/);
});
