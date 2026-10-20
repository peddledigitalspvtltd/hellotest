const test = require('node:test');
const assert = require('node:assert/strict');
const { runAutomationBrowserAgent } = require('../../backend/lib/automationBrowserAgent');
const { createBrowserParameterResolver } = require('../../backend/lib/automationBrowserParameters');
const { recordedSectionRequests } = require('../../backend/lib/automationBrowserRecording');
const { compileRecordedProgram } = require('../../backend/lib/automationRecordedProgram');
const { recordedContractMetadata, readRecordedSectionArtifacts } = require('../../backend/lib/automationRecordedContract');
const { sectionPreview } = require('../../backend/lib/automationWorkspacePreview');

// These are in-process MCP/provider fixtures. They exercise the real agent,
// protected recording, reviewer validation, host seal and preview integration;
// they do not claim an independently replayed browser run.
const response = value => ({ content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', url: 'https://fixture.example/form', ...value }) }] });
const reviewPacket = prompt => prompt.includes('"phase":"semantic_review"') ? JSON.parse(prompt.split('\n').at(-1)) : null;
function fixture(value = 'Inherited fixture name') {
  const params = createBrowserParameterResolver({ caseValues: { 't.name': value } });
  const section = { id: 'section', step_order: 1, step_type: 'web', action: 'Enter @t.name', expected_result: 'The name input retains @t.name' };
  const raw = [{ id: 'section', source: 'section', action: section.action, expected_result: section.expected_result },
    { id: 'manual:case:step', source: 'manual_step', manual_test_case_id: 'manual-case', manual_step_id: 'manual-step', action: section.action, expected_result: section.expected_result }];
  const projected = raw.map(row => ({ ...row, action: params.projectText(row.action), expected_result: params.projectText(row.expected_result) }));
  const snapshot = () => response({ observation_id: 'name-page', title: 'Name form', accessibility: '- textbox "Name"', elements: [
    { tag: 'input', attributes: { id: 'name', type: 'text' }, accessible_role: 'textbox', accessible_name: 'Name', displayed: true, locators_validated: true, locator_candidates: ['#name'] }
  ] });
  const state = { calls: [], observations: [], seals: [], saves: [], events: [], modelCalls: [], order: [], section, raw,
    manualSpecification: [{ ...raw[1], id: 'manual-step' }] };
  state.options = { prompt: 'Build the configured name input', actorMode: true, generationMode: 'sequential', parse: JSON.parse,
    execution: { required: true, step_id: section.id, semantic_review_required: true, action: projected[0].action, expected_result: projected[0].expected_result,
      obligations: projected, source_obligations: raw }, initialObservations: [{ tool: 'browser_snapshot', result: snapshot() }],
    browser: { tools: ['browser_fill', 'browser_assert', 'browser_snapshot'].map(name => ({ name, inputSchema: { type: 'object' } })),
      canonicalizeParameterArguments: params.canonicalArguments, projectPromptText: params.projectText, projectPrivateText: params.projectPrivateText,
      call: async (name, args) => {
        const resolved = params.resolve(name, args);state.calls.push({ name, args: resolved });
        if (name === 'browser_snapshot') return snapshot();
        assert.equal(resolved.value, value);
        return response(name === 'browser_assert' ? { assertion_outcome: 'satisfied' } : { action_outcome: 'completed' });
      } }, onObservation: observation => state.observations.push(observation), onProgress: event => state.events.push(event),
    onRecordedContract: async seal => { state.order.push('seal');state.seals.push(seal); },
    onPartialBuild: async payload => {
      state.order.push('preview');assert.equal(state.seals.length, 1, 'host seal callback must precede the source/save callback');
      const preview = sectionPreview({ testCaseId: 'automation', step: section, update: payload.steps[0], attempt: 1,
        recordedContract: state.seals[0], manualSpecification: state.manualSpecification,
        manualCoverage: [{ section_step_id: 'section', manual_test_case_id: 'manual-case', manual_step_id: 'manual-step' }],
        generationProvenance: { source_origin: 'confirmed_browser_operations', compiler: 'recorded_playwright_v1', review_status: 'accepted' } });
      state.saves.push(preview);return { generation_complete: true };
    }
  };
  state.actor = () => JSON.stringify({ stage: 'act', step_id: 'section', section_complete: true,
    steps: [{ step_id: 'section', automation_code: 'MODEL SOURCE MUST NOT BE USED' }],
    tool_calls: [{ name: 'browser_fill', arguments: { locator: '#name', value: '@t.name' } },
      { name: 'browser_assert', arguments: { assertion: 'value', locator: '#name', value: '@t.name' } }] });
  state.verdict = (packet, accept = true) => JSON.stringify({ decision: accept ? 'accept' : 'reject',
    obligations: packet.obligations.map(row => ({ id: row.id, action_operations: [1], assertion_operations: [2] })),
    issues: accept ? [] : [{ code: 'expected_result_not_covered', obligation_id: 'section', message: 'The check does not establish the manual outcome.' }] });
  state.complete = async prompt => {
    const packet = reviewPacket(prompt);state.modelCalls.push(packet ? 'review' : 'actor');
    return packet ? state.verdict(packet) : state.actor();
  };
  return state;
}

for (const value of ['Inherited fixture name', '']) test(`real agent callback seals accepted browser operations before preview generation with ${value ? 'inherited' : 'empty'} data`, async () => {
  const state = fixture(value), result = await runAutomationBrowserAgent({ ...state.options, complete: state.complete });
  assert.deepEqual(state.order, ['seal', 'preview']);assert.deepEqual(state.modelCalls, ['actor', 'review']);
  assert.equal(state.calls.filter(row => row.name === 'browser_fill').length, 1);assert.equal(state.calls.filter(row => row.name === 'browser_assert').length, 1);
  assert.equal(state.saves.length, 1);assert.equal(state.seals.length, 1);
  const requests = recordedSectionRequests(state.observations, 'section'), source = compileRecordedProgram(requests).source;
  const preview = state.saves[0], metadata = preview.generation_manifest.recorded_contract;
  assert.deepEqual(metadata, recordedContractMetadata(state.seals[0]));assert.equal(metadata.obligation_count, 2);assert.equal(metadata.mapped_assertion_count, 1);
  assert.equal(preview.automation_code, source);assert.equal(result.steps[0].automation_code, source);
  assert.equal(preview.verification_status, 'unverified');assert.equal(preview.generation_manifest.verification_status, 'unverified');
  assert.doesNotMatch(JSON.stringify(metadata), /Inherited|#name|@t\.name|retains|MODEL SOURCE|manual-case/);
  const artifacts = readRecordedSectionArtifacts(state.seals[0]), contractCase = JSON.parse(artifacts.case_json), plan = JSON.parse(artifacts.plan_json);
  assert.deepEqual(contractCase.obligations, state.raw);assert.equal(plan.automation_code, source);
  assert.deepEqual(plan.coverage.map(row => row.id), state.raw.map(row => row.id));
  assert.deepEqual(plan.operations.map(row => row.arguments.value), ['@t.name', '@t.name']);
  assert.doesNotMatch(source, /Inherited fixture name|MODEL SOURCE/);
});

test('rejected outcome review cannot issue a seal or reach the save callback', async () => {
  const state = fixture();let actors = 0, reviews = 0;
  await assert.rejects(runAutomationBrowserAgent({ ...state.options, complete: async prompt => {
    const packet = reviewPacket(prompt);
    if (packet) { reviews++;return state.verdict(packet, false); }
    return ++actors === 1 ? state.actor() : JSON.stringify({ stage: 'act', step_id: 'section', section_complete: true, tool_calls: [] });
  } }), { code: 'AUTOMATION_SEMANTIC_REVIEW_STALLED' });
  assert.equal(reviews, 1);assert.equal(actors, 2);assert.equal(state.seals.length, 0);assert.equal(state.saves.length, 0);
  assert.equal(state.calls.filter(row => row.name === 'browser_fill').length, 1);
});

test('an acceptance with omitted, duplicated or wrong-kind assertion mappings cannot seal or save', async () => {
  for (const mode of ['omitted', 'duplicate', 'wrong-kind']) {
    const state = fixture();
    await assert.rejects(runAutomationBrowserAgent({ ...state.options, complete: async prompt => {
      const packet = reviewPacket(prompt);
      if (!packet) return state.actor();
      const verdict = JSON.parse(state.verdict(packet));
      if (mode === 'omitted') verdict.obligations[0].assertion_operations = [];
      if (mode === 'duplicate') verdict.obligations[1] = { ...verdict.obligations[0] };
      if (mode === 'wrong-kind') verdict.obligations[0].assertion_operations = [1];
      return JSON.stringify(verdict);
    } }), { code: 'AUTOMATION_SEMANTIC_REVIEW_INVALID' });
    assert.equal(state.seals.length, 0);assert.equal(state.saves.length, 0);
  }
});

test('a serialized seal passed into a protected section preview is rejected before any save', async () => {
  const state = fixture();let previews = 0;
  await assert.rejects(runAutomationBrowserAgent({ ...state.options, complete: state.complete,
    onRecordedContract: async seal => { state.seals.push(JSON.parse(JSON.stringify(seal))); },
    onPartialBuild: async payload => {
      previews++;
      const preview = sectionPreview({ testCaseId: 'automation', step: state.section, update: payload.steps[0], attempt: 1,
        recordedContract: state.seals[0], manualSpecification: state.manualSpecification });
      state.saves.push(preview);return { generation_complete: true };
    }
  }), error => error.code === 'AUTOMATION_RECORDED_CONTRACT_INVALID' && error.details.reason === 'host_seal_required');
  assert.equal(previews, 1);assert.equal(state.saves.length, 0);
});

test('failure retaining the host contract stops before the save callback and does not repeat browser input', async () => {
  const state = fixture(), failure = Object.assign(new Error('Host evidence store unavailable'), { code: 'HOST_EVIDENCE_UNAVAILABLE' });
  await assert.rejects(runAutomationBrowserAgent({ ...state.options, complete: state.complete, onRecordedContract: async () => { throw failure; } }), error => error === failure);
  assert.equal(state.saves.length, 0);assert.equal(state.calls.filter(row => row.name === 'browser_fill').length, 1);
});
