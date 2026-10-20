const test = require('node:test');
const assert = require('node:assert/strict');
const { runAutomationBrowserAgent } = require('../../backend/lib/automationBrowserAgent');

const receipt = value => ({ content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', url: 'https://app.test/address', ...value }) }] });
const snapshot = () => receipt({ observation_id: 'address-page', title: 'Address', accessibility: '- button "Save address"\n- heading "Account"\n- status "Address saved"\n- row "Updated address"', elements: [
  ['button', 'Save address', '#save'], ['heading', 'Account', '#heading'], ['status', 'Address saved', '#status'], ['row', 'Updated address', '#row']
].map(([role, name, locator]) => ({ tag: role === 'button' ? 'button' : 'div', role, accessible_name: name, text: name, displayed: true, locators_validated: true, locator_candidates: [locator] })) });
const click = { name: 'browser_click', arguments: { locator: '#save' } };
const check = locator => ({ name: 'browser_assert', arguments: { assertion: 'visible', locator } });
const actor = (tool_calls = []) => JSON.stringify({ stage: 'act', step_id: 'address', section_complete: true, tool_calls });
const obligation = { id: 'address', source: 'section', action: 'Save the edited address', expected_result: 'Address saved confirmation and updated address row are displayed' };
const verdict = (packet, accept, assertions) => JSON.stringify({ decision: accept ? 'accept' : 'reject', obligations: packet.obligations.map(item => ({ id: item.id, action_operations: [1], assertion_operations: assertions })),
  issues: accept ? [] : [{ code: 'unrelated_assertion', obligation_id: 'address', message: 'Account heading visibility does not establish address saving.' }] });
function fixture() {
  const calls = [], saves = [], events = [], modelCalls = [];
  return { calls, saves, events, modelCalls, options: {
    browser: { tools: ['browser_click', 'browser_assert', 'browser_snapshot'].map(name => ({ name, inputSchema: { type: 'object' } })), projectPromptText: value => value,
      call: async (name, args) => { calls.push({ name, args }); return name === 'browser_snapshot' ? snapshot() : receipt(name === 'browser_assert' ? { assertion_outcome: 'satisfied' } : { action_outcome: 'completed' }); } },
    prompt: 'Automate the saved address behavior', execution: { required: true, step_id: 'address', action: obligation.action, expected_result: obligation.expected_result, semantic_review_required: true, obligations: [obligation] },
    actorMode: true, parse: JSON.parse, initialObservations: [{ tool: 'browser_snapshot', result: snapshot() }],
    onPartialBuild: async payload => { saves.push(payload); return { generation_complete: true }; }, onProgress: async event => events.push(event)
  } };
}
const reviewPacket = prompt => prompt.includes('"phase":"semantic_review"') ? JSON.parse(prompt.split('\n').at(-1)) : null;

test('production review gate rejects unrelated success, then saves corrected compound outcomes without replaying the completed mutation', async () => {
  const state = fixture(); let actors = 0, reviews = 0;
  const result = await runAutomationBrowserAgent({ ...state.options, complete: async (prompt, _remaining, trace) => {
    state.modelCalls.push(trace?.generationScope || 'actor');
    const packet = reviewPacket(prompt);
    if (packet) {
      reviews++; assert.equal(trace.generationScope, 'section_semantic_review');
      assert.equal(state.saves.length, 0, 'review precedes every durable source callback');
      assert.equal(packet.obligations[0].expected_result, obligation.expected_result);
      return verdict(packet, reviews === 2, reviews === 1 ? [2] : [3, 4]);
    }
    if (++actors === 1) return actor([click, check('#heading')]);
    const current = JSON.parse(prompt.match(/^Current browser state and confirmed section progress .*?: (.+)$/m)[1]);
    assert.equal(current.pending_contract.next_required, 'correct_manual_obligation_evidence');
    assert.equal(current.semantic_review_feedback.code, 'AUTOMATION_SEMANTIC_REVIEW_REJECTED');
    assert.equal(current.recorded_section.receipts_ready, true, 'confirmed work remains available for correction');
    assert.equal(current.recorded_section.semantic_review_status, 'correction_required');
    assert.equal(current.recorded_section.completion_available, false, 'rejected coverage cannot invite unchanged completion');
    assert.equal(current.pending_contract.receipts_ready, true);
    assert.equal(current.pending_contract.expected_result_check, 'coverage_rejected');
    assert.equal(current.pending_contract.completion_available, false);
    return actor([click, check('#status'), check('#row')]);
  } });
  assert.equal(actors, 2); assert.equal(reviews, 2); assert.equal(state.saves.length, 1);
  assert.equal(state.calls.filter(item => item.name === 'browser_click').length, 1);
  assert.deepEqual(state.modelCalls, ['actor', 'section_semantic_review', 'actor', 'section_semantic_review']);
  assert.match(result.steps[0].automation_code, /#status/); assert.match(result.steps[0].automation_code, /#row/);
});

test('an unchanged rejected completion stops without another reviewer call or source save', async () => {
  const state = fixture(); let actors = 0, reviews = 0;
  await assert.rejects(runAutomationBrowserAgent({ ...state.options, complete: async prompt => {
    const packet = reviewPacket(prompt);
    if (packet) { reviews++; return verdict(packet, false, [2]); }
    actors++; return actors === 1 ? actor([click, check('#heading')]) : actor();
  } }), error => {
    assert.equal(error.code, 'AUTOMATION_SEMANTIC_REVIEW_STALLED');
    assert.equal(error.details.review_count, 1);
    assert.equal(error.details.latest_semantic_review.code, 'AUTOMATION_SEMANTIC_REVIEW_REJECTED');
    assert.equal(error.details.latest_semantic_review.issues[0].code, 'unrelated_assertion');
    assert.equal(error.details.latest_semantic_review.issues[0].obligation_id, 'address');
    assert.deepEqual(error.details.semantic_issues, error.details.latest_semantic_review.issues);
    assert.doesNotMatch(JSON.stringify(error.details), /Account heading visibility/,
      'stalled diagnostics retain safe issue facts without exposing private reviewer rationale');
    return true;
  });
  assert.equal(actors, 2); assert.equal(reviews, 1); assert.equal(state.saves.length, 0);
  assert.equal(state.calls.filter(item => item.name === 'browser_click').length, 1);
});

test('unchanged source rejected after semantic acceptance stops before another review or validation attempt', async () => {
  const state=fixture();let actors=0,reviews=0,validations=0;
  await assert.rejects(runAutomationBrowserAgent({...state.options,onPartialBuild:async()=>{
    validations++;return {generation_complete:false,validation_errors:[{code:'AUTOMATION_GENERATED_ASSERTION_NOT_PRESERVED',message:'PRIVATE_VALIDATION_CONTEXT'}]};
  },complete:async prompt=>{
    const packet=reviewPacket(prompt);
    if(packet){reviews++;return verdict(packet,true,[2]);}
    actors++;return actor(actors===1?[click,check('#status')]:[]);
  }}),error=>{
    assert.equal(error.code,'AUTOMATION_RECORDED_SECTION_VALIDATION_STALLED');
    assert.equal(error.details.validation_error_count,1);
    assert.deepEqual(error.details.validation_error_codes,['AUTOMATION_GENERATED_ASSERTION_NOT_PRESERVED']);
    assert.doesNotMatch(JSON.stringify(error.details),/PRIVATE_VALIDATION_CONTEXT/);return true;
  });
  assert.equal(actors,2);assert.equal(reviews,1);assert.equal(validations,1);
  assert.equal(state.calls.filter(item=>item.name==='browser_click').length,1);
});

test('a changed recorded program can satisfy saved source requirements with a fresh outcome review', async () => {
  const state=fixture();let actors=0,reviews=0,validations=0;
  const result=await runAutomationBrowserAgent({...state.options,onPartialBuild:async()=>{
    validations++;return validations===1?{generation_complete:false,validation_errors:[{code:'AUTOMATION_GENERATED_ASSERTION_NOT_PRESERVED'}]}:{generation_complete:true};
  },complete:async prompt=>{
    const packet=reviewPacket(prompt);
    if(packet){reviews++;return verdict(packet,true,reviews===1?[2]:[2,3]);}
    actors++;return actor(actors===1?[click,check('#status')]:[check('#row')]);
  }});
  assert.equal(actors,2);assert.equal(reviews,2);assert.equal(validations,2);
  assert.equal(state.calls.filter(item=>item.name==='browser_click').length,1);
  assert.match(result.steps[0].automation_code,/#row/);
});

test('an allowance exhausted after source rejection retains the Plan validation cause', async()=>{
  const state=fixture();let reviews=0;
  await assert.rejects(runAutomationBrowserAgent({...state.options,maxTurns:1,onPartialBuild:async()=>({generation_complete:false,validation_errors:[{code:'AUTOMATION_GENERATED_ASSERTION_NOT_PRESERVED'}]}),complete:async prompt=>{
    const packet=reviewPacket(prompt);
    if(packet){reviews++;return verdict(packet,true,[2]);}
    return actor([click,check('#status')]);
  }}),{code:'AUTOMATION_RECORDED_SECTION_VALIDATION_REJECTED'});
  assert.equal(reviews,1);assert.equal(state.calls.filter(item=>item.name==='browser_click').length,1);
});

test('reviewer outage and invalid evidence indexes fail closed after confirmed work without replay or save', async () => {
  for (const mode of ['outage', 'invalid']) {
    const state = fixture(); let actors = 0;
    await assert.rejects(runAutomationBrowserAgent({ ...state.options, complete: async prompt => {
      const packet = reviewPacket(prompt);
      if (!packet) { actors++; return actor([click, check('#status')]); }
      if (mode === 'outage') throw new Error('PRIVATE_PROVIDER_FAILURE');
      return verdict(packet, true, [1]); // a click cannot be assertion evidence
    } }), { code: mode === 'outage' ? 'AUTOMATION_SEMANTIC_REVIEW_UNAVAILABLE' : 'AUTOMATION_SEMANTIC_REVIEW_INVALID' });
    assert.equal(actors, 1); assert.equal(state.saves.length, 0);
    assert.equal(state.calls.filter(item => item.name === 'browser_click').length, 1);
  }
});

test('legacy interactive source proposals cannot bypass recorded-operation review', async () => {
  const state = fixture(); let actors = 0, reviews = 0;
  await assert.rejects(runAutomationBrowserAgent({ ...state.options, complete: async prompt => {
    const packet = reviewPacket(prompt);
    if (packet) { reviews++; return verdict(packet, false, [2]); }
    if (++actors === 1) return JSON.stringify({ stage: 'source', steps: [{ step_id: 'address', automation_code: 'await page.locator("#save").click(); await expect(page.locator("#heading")).toBeVisible();' }] });
    return actor();
  } }), { code: 'AUTOMATION_SEMANTIC_REVIEW_STALLED' });
  assert.equal(state.saves.length, 0); assert.equal(reviews, 1);
  assert.equal(state.calls.filter(item => item.name === 'browser_click').length, 1);
});

test('one actor turn can reserve its bounded semantic review call before saving', async () => {
  const state = fixture(); let calls = 0;
  await runAutomationBrowserAgent({ ...state.options, maxTurns: 1, complete: async prompt => {
    calls++; const packet = reviewPacket(prompt);
    return packet ? verdict(packet, true, [2, 3]) : actor([click, check('#status'), check('#row')]);
  } });
  assert.equal(calls, 2); assert.equal(state.saves.length, 1);
});

test('review rationale reaches the actor privately while public diagnostics retain only safe issue facts', async () => {
  const state = fixture(), observations = [];let actors = 0, reviews = 0;
  const rationale = 'The document title stayed unchanged; compare the specific rendered status and row instead.';
  await runAutomationBrowserAgent({ ...state.options, onObservation: item => observations.push(item), complete: async prompt => {
    const packet = reviewPacket(prompt);
    if (packet) {
      if (++reviews === 2) return verdict(packet, true, [3, 4]);
      return JSON.stringify({ decision: 'reject', obligations: [{ id: 'address', action_operations: [1], assertion_operations: [] }],
        issues: [{ code: 'expected_result_not_covered', obligation_id: 'address', message: rationale }] });
    }
    if (++actors === 1) return actor([click, check('#heading')]);
    const current = JSON.parse(prompt.match(/^Current browser state and confirmed section progress .*?: (.+)$/m)[1]);
    assert.equal(current.semantic_review_feedback.assessment_details.issues[0].message, rationale);
    assert.equal(current.semantic_review_feedback.assessment_details.assessment_source, 'untrusted_model_assessment');
    return actor([check('#status'), check('#row')]);
  } });
  assert.equal(state.saves.length, 1);assert.equal(reviews, 2);
  assert.equal(state.calls.filter(item => item.name === 'browser_click').length, 1);
  assert.ok(observations.some(item => item.tool === 'automation_semantic_review_feedback'));
  assert.doesNotMatch(JSON.stringify({ observations, events: state.events, saves: state.saves }), /The document title stayed unchanged/);
});

test('duplicating a successful check after a rejected review cannot spend another review or save', async () => {
  const state = fixture();let actors = 0, reviews = 0;
  await assert.rejects(runAutomationBrowserAgent({ ...state.options, complete: async prompt => {
    const packet = reviewPacket(prompt);
    if (packet) { reviews++;return verdict(packet, false, [2]); }
    return ++actors === 1 ? actor([click, check('#heading')]) : actor([check('#heading')]);
  } }), { code: 'AUTOMATION_SEMANTIC_REVIEW_STALLED' });
  assert.equal(reviews, 1);assert.equal(actors, 2);assert.equal(state.saves.length, 0);
  assert.equal(state.calls.filter(item => item.name === 'browser_click').length, 1);
});

test('new outcome checks reopen completion acknowledgement and require fresh review before saving', async () => {
  const state = fixture(); let actors = 0, reviews = 0;
  const result = await runAutomationBrowserAgent({ ...state.options, complete: async prompt => {
    const packet = reviewPacket(prompt);
    if (packet) {
      reviews++;assert.equal(state.saves.length, 0);
      return verdict(packet, reviews === 2, reviews === 1 ? [2] : [3, 4]);
    }
    const current = JSON.parse(prompt.match(/^Current browser state and confirmed section progress .*?: (.+)$/m)[1]);
    actors++;
    if (actors === 1) return actor([click, check('#heading')]);
    if (actors === 2) {
      assert.equal(current.recorded_section.completion_available, false);
      return JSON.stringify({ stage: 'act', step_id: 'address', section_complete: false, tool_calls: [check('#status'), check('#row')] });
    }
    assert.equal(actors, 3);assert.equal(reviews, 1, 'new checks do not imply review acceptance');
    assert.equal(state.saves.length, 0);
    assert.equal(current.recorded_section.receipts_ready, true);
    assert.equal(current.recorded_section.completion_available, true);
    assert.equal(current.recorded_section.semantic_review_status, 'pending');
    assert.equal(current.recorded_section.semantic_review_required_before_save, true);
    assert.equal(current.recorded_section.verification_status, 'unverified');
    assert.equal(current.pending_contract.next_required, 'model_goal_acknowledgement');
    assert.equal(current.pending_contract.expected_result_check, 'satisfied_after_latest_action');
    assert.equal(current.semantic_review_feedback.code, 'AUTOMATION_SEMANTIC_REVIEW_REJECTED');
    assert.equal(current.semantic_review_feedback.applies_to, 'previous_candidate');
    assert.equal(current.semantic_review_feedback.candidate_changed, true);
    assert.equal(current.semantic_review_feedback.review_required, true);
    return actor();
  } });
  assert.equal(actors, 3);assert.equal(reviews, 2);assert.equal(state.saves.length, 1);
  assert.equal(state.calls.filter(item => item.name === 'browser_click').length, 1);
  assert.match(result.steps[0].automation_code, /#status/);assert.match(result.steps[0].automation_code, /#row/);
});

test('a repeated successful predicate does not reopen rejected completion even across a separate acknowledgement turn', async () => {
  const state = fixture(); let actors = 0, reviews = 0;
  await assert.rejects(runAutomationBrowserAgent({ ...state.options, complete: async prompt => {
    const packet = reviewPacket(prompt);
    if (packet) { reviews++;return verdict(packet, false, [2]); }
    actors++;
    if (actors === 1) return actor([click, check('#heading')]);
    if (actors === 2) return JSON.stringify({ stage: 'act', step_id: 'address', section_complete: false, tool_calls: [check('#heading')] });
    assert.equal(actors, 3);
    const current = JSON.parse(prompt.match(/^Current browser state and confirmed section progress .*?: (.+)$/m)[1]);
    assert.equal(current.recorded_section.completion_available, false);
    assert.equal(current.pending_contract.next_required, 'correct_manual_obligation_evidence');
    assert.equal(current.semantic_review_feedback.candidate_changed, undefined);
    return actor();
  } }), { code: 'AUTOMATION_SEMANTIC_REVIEW_STALLED' });
  assert.equal(reviews, 1);assert.equal(actors, 3);assert.equal(state.saves.length, 0);
  assert.equal(state.calls.filter(item => item.name === 'browser_click').length, 1);
});

test('a changed candidate remains unsaved when fresh review rejects its coverage', async () => {
  const state = fixture(); let actors = 0, reviews = 0;
  await assert.rejects(runAutomationBrowserAgent({ ...state.options, complete: async prompt => {
    const packet = reviewPacket(prompt);
    if (packet) { reviews++;return verdict(packet, false, reviews === 1 ? [2] : [3]); }
    actors++;
    if (actors === 1) return actor([click, check('#heading')]);
    if (actors === 2) return JSON.stringify({ stage: 'act', step_id: 'address', section_complete: false, tool_calls: [check('#status')] });
    const current = JSON.parse(prompt.match(/^Current browser state and confirmed section progress .*?: (.+)$/m)[1]);
    assert.equal(current.recorded_section.completion_available, true);
    assert.equal(state.saves.length, 0);
    return actor();
  } }), { code: 'AUTOMATION_SEMANTIC_REVIEW_EXHAUSTED' });
  assert.equal(reviews, 2);assert.equal(actors, 3);assert.equal(state.saves.length, 0);
  assert.equal(state.calls.filter(item => item.name === 'browser_click').length, 1);
});
