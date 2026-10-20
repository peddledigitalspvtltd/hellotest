const test = require('node:test');
const assert = require('node:assert/strict');
const { completeAutomationBuild } = require('../../backend/lib/automationBuildCompletion');
const { compileRecordedProgram } = require('../../backend/lib/automationRecordedProgram');
const { createRecordedSectionContract, recordedContractMetadata } = require('../../backend/lib/automationRecordedContract');

function fixture(id = 'one', linked = false) {
  const step = { id, step_order: id === 'one' ? 1 : 2, step_type: 'web', action: 'Enter @t.name', expected_result: 'The name retains @t.name' };
  const manual = { id: 'manual-step', test_case_id: 'manual-case', step_order: 1, step_type: 'web', action: step.action, expected_result: step.expected_result };
  const obligations = [{ id, source: 'section', action: step.action, expected_result: step.expected_result }, ...(linked ? [{
    id: 'manual:manual-case:manual-step', source: 'manual_step', manual_test_case_id: manual.test_case_id, manual_step_id: manual.id,
    action: manual.action, expected_result: manual.expected_result
  }] : [])];
  const requests = [{ name: 'browser_fill', arguments: { locator: `#${id}`, value: '@t.name' } },
    { name: 'browser_assert', arguments: { assertion: 'value', locator: `#${id}`, value: '@t.name' } }];
  const source = compileRecordedProgram(requests).source;
  const seal = createRecordedSectionContract({ execution: { required: true, step_id: id, obligations }, requests, source,
    mappings: obligations.map(item => ({ id: item.id, action_operations: [1], assertion_operations: [2] })) });
  return { step, manual, source, seal, candidate: { step_id: id, automation_code: source } };
}

function validate(payload, steps) {
  assert.equal(payload.steps.length, steps.length);
  for (const step of steps) {
    const candidate = payload.steps.find(item => item.step_id === step.id);
    if (!candidate?.automation_code?.trim()) throw new Error('Executable section instructions are required.');
  }
  return { updates: payload.steps.map(item => ({ ...item })) };
}
const finalize = (seal, input, manualSpecification = []) => recordedContractMetadata(seal, {
  stepId: input.step.id, section: input.step, source: input.normalized.updates[0].automation_code, manualSpecification
});

test('mandatory finalization sees normalized instructions and validated coverage before save, acceptance and preview', async () => {
  const state = fixture('one', true), order = [], saved = [];
  const result = await completeAutomationBuild({ steps: [state.step], manualSteps: [state.manual], validate,
    generate: async () => ({ steps: [state.candidate] }),
    onBeforeSaveSection: async input => {
      await new Promise(setImmediate);
      order.push('finalize');
      assert.equal(input.normalized.updates[0].automation_code, state.source);
      assert.deepEqual(input.manualCoverage, [{ manual_step_id: state.manual.id, manual_test_case_id: state.manual.test_case_id, section_step_id: state.step.id }]);
      finalize(state.seal, input, [state.manual]);
    },
    onSaveSection: async input => { order.push('save'); saved.push(input.step.id); },
    onValidatedSection: async () => { order.push('preview'); assert.deepEqual(saved, ['one']); },
    onProgress: async event => { if (event.phase === 'automation.agent.section.ready') order.push('accepted'); }
  });
  assert.deepEqual(order, ['finalize', 'save', 'preview', 'accepted']);
  assert.equal(result.updates[0].automation_code, state.source);
});

test('a source changed by normalization cannot pass its host seal or reach any save callback', async () => {
  const state = fixture(); let saves = 0, previews = 0, generations = 0;
  await assert.rejects(completeAutomationBuild({ steps: [state.step],
    validate: (payload, steps) => {
      const normalized = validate(payload, steps);
      normalized.updates[0].automation_code = normalized.updates[0].automation_code.replaceAll('#one', '#other');
      return normalized;
    },
    generate: async () => { generations++; return { steps: [state.candidate] }; },
    onBeforeSaveSection: input => finalize(state.seal, input),
    onSaveSection: async () => { saves++; }, onValidatedSection: async () => { previews++; }
  }), error => {
    assert.equal(error.code, 'AUTOMATION_RECORDED_CONTRACT_INVALID');
    assert.equal(error.details.reason, 'sealed_source_changed');
    assert.equal(error.nonRetryable, true); assert.equal(error.saved_sections, 0); assert.deepEqual(error.saved_step_ids, []);
    return true;
  });
  assert.equal(generations, 1); assert.equal(saves, 0); assert.equal(previews, 0);
});

test('a changed authored section requirement stops before persistence or acceptance', async () => {
  const state = fixture(), events = []; let saves = 0;
  state.step.expected_result = 'Only field visibility is required';
  await assert.rejects(completeAutomationBuild({ steps: [state.step], validate, generate: async () => ({ steps: [state.candidate] }),
    onBeforeSaveSection: input => finalize(state.seal, input), onSaveSection: async () => { saves++; }, onProgress: async event => events.push(event)
  }), error => error.code === 'AUTOMATION_RECORDED_CONTRACT_INVALID' && error.details.reason === 'sealed_requirements_changed' && error.nonRetryable);
  assert.equal(saves, 0); assert.equal(events.some(event => event.phase === 'automation.agent.section.ready'), false);
});

test('a changed linked manual requirement cannot pass finalization through an otherwise valid coverage mapping', async () => {
  const state = fixture('one', true); let saves = 0;
  state.manual.expected_result = 'The field is visible';
  await assert.rejects(completeAutomationBuild({ steps: [state.step], manualSteps: [state.manual], validate,
    generate: async () => ({ steps: [state.candidate], manual_coverage: [{ manual_step_id: state.manual.id, manual_test_case_id: state.manual.test_case_id, section_step_id: state.step.id }] }),
    onBeforeSaveSection: input => finalize(state.seal, input, [state.manual]), onSaveSection: async () => { saves++; }
  }), error => error.code === 'AUTOMATION_RECORDED_CONTRACT_INVALID' && error.details.reason === 'sealed_manual_requirements_changed' && error.saved_sections === 0);
  assert.equal(saves, 0);
});

test('mandatory finalization still prevents acceptance when there is no persistence callback', async () => {
  const state = fixture(), events = []; let finalizations = 0, previews = 0;
  await assert.rejects(completeAutomationBuild({ steps: [state.step], validate, generate: async () => ({ steps: [state.candidate] }),
    onBeforeSaveSection: async () => { finalizations++; throw new Error('Finalization unavailable'); },
    onValidatedSection: async () => { previews++; }, onProgress: async event => events.push(event)
  }), error => {
    assert.equal(error.code, 'AUTOMATION_SECTION_FINALIZATION_FAILED'); assert.equal(error.nonRetryable, true);
    assert.equal(error.completed_sections, 0); assert.equal(error.saved_sections, 0); assert.deepEqual(error.pending_step_ids, ['one']);
    return true;
  });
  assert.equal(finalizations, 1); assert.equal(previews, 0);
  assert.equal(events.some(event => event.phase === 'automation.agent.section.ready'), false);
});

test('a finalization failure retains previously saved sections and never retries generation or saves the failing section', async () => {
  const first = fixture('one'), second = fixture('two'), saved = [], previews = []; let generations = 0;
  await assert.rejects(completeAutomationBuild({ steps: [first.step, second.step], sequential: true, validate,
    generate: async request => { generations++; return { steps: [request.activeStepId === 'one' ? first.candidate : second.candidate] }; },
    onBeforeSaveSection: async input => {
      if (input.step.id === 'two') throw new Error('Finalization unavailable');
      finalize(first.seal, input);
    },
    onSaveSection: async input => { saved.push(input.step.id); }, onValidatedSection: async input => { previews.push(input.step.id); }
  }), error => {
    assert.equal(error.code, 'AUTOMATION_SECTION_FINALIZATION_FAILED'); assert.equal(error.nonRetryable, true);
    assert.equal(error.active_step_id, 'two'); assert.equal(error.completed_sections, 1); assert.equal(error.saved_sections, 1);
    assert.deepEqual(error.saved_step_ids, ['one']); assert.deepEqual(error.pending_step_ids, ['two']);
    return true;
  });
  assert.equal(generations, 2); assert.deepEqual(saved, ['one']); assert.deepEqual(previews, ['one']);
});

test('a streamed finalization failure remains mandatory even when the generator catches its partial response rejection', async () => {
  const state = fixture(); let saves = 0, finalizations = 0;
  await assert.rejects(completeAutomationBuild({ steps: [state.step], validate,
    generate: async ({ onPartial }) => { await onPartial({ steps: [state.candidate] }).catch(() => undefined); return { steps: [] }; },
    onBeforeSaveSection: async () => { finalizations++; throw new Error('Finalization unavailable'); }, onSaveSection: async () => { saves++; }
  }), error => error.code === 'AUTOMATION_SECTION_FINALIZATION_FAILED' && error.nonRetryable && error.saved_sections === 0);
  assert.equal(finalizations, 1); assert.equal(saves, 0);
});

test('an optional preview outage remains optional after mandatory finalization and successful save', async () => {
  const state = fixture(), events = [], order = [];
  const result = await completeAutomationBuild({ steps: [state.step], validate, generate: async () => ({ steps: [state.candidate] }),
    onBeforeSaveSection: async input => { finalize(state.seal, input); order.push('finalize'); },
    onSaveSection: async () => { order.push('save'); }, onValidatedSection: async () => { order.push('preview'); throw new Error('Preview storage unavailable'); },
    onProgress: async event => events.push(event)
  });
  assert.deepEqual(order, ['finalize', 'save', 'preview']); assert.equal(result.updates[0].automation_code, state.source);
  assert.equal(events.filter(event => event.phase === 'automation.agent.preview.unavailable').length, 1);
  assert.equal(events.filter(event => event.phase === 'automation.agent.section.ready').length, 1);
});

test('invalid manual coverage is rejected before mandatory finalization and persistence', async () => {
  const state = fixture('one', true); let finalizations = 0, saves = 0;
  await assert.rejects(completeAutomationBuild({ steps: [state.step], manualSteps: [state.manual], validate, maxAttempts: 1,
    generate: async () => ({ steps: [state.candidate], manual_coverage: [{ manual_step_id: 'foreign', section_step_id: 'one' }] }),
    onBeforeSaveSection: async () => { finalizations++; }, onSaveSection: async () => { saves++; }
  }), error => error.code === 'AUTOMATION_BUILD_INCOMPLETE' && error.saved_sections === 0);
  assert.equal(finalizations, 0); assert.equal(saves, 0);
});
