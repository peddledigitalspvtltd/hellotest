const test = require('node:test');
const assert = require('node:assert/strict');
const { createAutomationSemanticReviewer } = require('../../backend/lib/automationSemanticReview');
const { recordBrowserOperation } = require('../../backend/lib/automationBrowserRecording');
const { recordBrowserCheck } = require('../../backend/lib/automationBrowserRecovery');

const execution = { required: true, step_id: 'section', action: 'Save the address', expected_result: 'The address is saved' };
const result = (value, isError = false) => ({ isError, content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', ...value }) }] });
function snapshot(title = 'Addresses', extras = {}) {
  return { tool: 'browser_snapshot', execution_step_id: 'section', result: result({ observation_id: 'page', url: 'https://app.test/addresses', title,
    accessibility: '- main\n  - button "Save address"\n  - status "Address saved"',
    elements: [{ tag: 'button', accessible_role: 'button', accessible_name: 'Save address', displayed: true, locators_validated: true, locator_candidates: ['#save'] },
      { tag: 'div', accessible_role: 'status', text: 'Address saved', displayed: true, locators_validated: true, locator_candidates: ['#result'] }], ...extras }) };
}
function operation(name, args, extras = {}) {
  const observation = { tool: name, execution_step_id: 'section', arguments: { ...args, ...(Object.hasOwn(args, 'value') ? { value: '[redacted]' } : {}) },
    result: result(name === 'browser_assert' ? { assertion_outcome: 'satisfied' } : { action_outcome: 'completed' }), ...extras };
  recordBrowserOperation(observation, { name, arguments: args });
  return observation;
}
const successful = () => [snapshot(), operation('browser_click', { locator: '#save' }), operation('browser_assert', { assertion: 'text', locator: '#result', value: 'Address saved' }), snapshot()];
const accepted = (ids = ['section'], rows) => ({ decision: 'accept', obligations: rows || ids.map(id => ({ id, action_operations: [1], assertion_operations: [2] })), issues: [] });
const rejected = (id = 'section', code = 'unrelated_assertion', message = 'The heading does not establish that the address was saved.') => ({ decision: 'reject', obligations: [{ id, action_operations: [], assertion_operations: [] }], issues: [{ code, obligation_id: id, message }] });
const reviewer = (complete, options = {}) => createAutomationSemanticReviewer({ execution, complete, ...options });
const packet = prompt => JSON.parse(prompt.slice(prompt.indexOf('\n\n') + 2));

test('semantic review uses protected operations, pinned requirements and observed target meaning', async () => {
  let calls = 0;
  const events = [];
  const review = reviewer(async prompt => {
    calls++;
    assert.match(prompt, /⟦HELLOTEST_AI:ai\.automation\.keyword_generation:automationBrowserAgent\.semanticReview⟧/);
    const data = packet(prompt);
    assert.equal(data.phase, 'semantic_review');
    assert.deepEqual(data.obligations, [{ id: 'section', source: 'section', action: execution.action, expected_result: execution.expected_result }]);
    assert.equal(data.confirmed_operations[0].confirmation, 'action_completed');
    assert.equal(data.confirmed_operations[0].observed_target.name, 'Save address');
    assert.equal(data.confirmed_operations[1].arguments.value, 'Address saved');
    assert.equal(data.confirmed_operations[1].confirmation, 'assertion_satisfied');
    assert.equal(data.current_page.url, undefined);assert.equal(data.current_page.title, undefined);
    assert.deepEqual(data.page_metadata_context.after, {});
    assert.deepEqual(data.page_metadata_context.omitted_incidental_fields, ['url', 'title']);
    assert.doesNotMatch(prompt, /automation_code|section_complete|redacted/);
    return JSON.stringify(accepted());
  }, { onProgress: async event => events.push(event) });
  const outcome = await review.review({ observations: successful(), current: { snapshot_available: true } });
  assert.equal(outcome.accepted, true);assert.equal(outcome.review_count, 1);assert.equal(calls, 1);
  assert.deepEqual(outcome.obligation_mappings, accepted().obligations);assert.equal(outcome.confirmed_operation_count, 2);
  assert.equal(outcome.feedback.verification_status, 'unverified');
  assert.ok(events.some(event => event.phase === 'automation.agent.semantic.accepted'));
});

test('an unrelated satisfied assertion does not save the requested manual outcome', async () => {
  const observations = [snapshot(), operation('browser_assert', { assertion: 'visible', locator: '#heading' })];
  const review = reviewer(async prompt => { assert.equal(packet(prompt).confirmed_operations[0].name, 'browser_assert');return JSON.stringify(rejected()); });
  const outcome = await review.review({ observations });
  assert.equal(outcome.accepted, false);assert.equal(outcome.feedback.code, 'AUTOMATION_SEMANTIC_REVIEW_REJECTED');
  assert.equal(outcome.feedback.issues[0].code, 'unrelated_assertion');
});

test('a model acceptance cannot save an interactive action that no current requirement justifies',async()=>{
 const observations=[snapshot(),operation('browser_click',{locator:'#unrelated-sidebar'}),operation('browser_click',{locator:'#save'}),operation('browser_assert',{assertion:'text',locator:'#result',value:'Address saved'}),snapshot()];
 let calls=0;
 const review=reviewer(async prompt=>{calls++;assert.match(packet(prompt).response_contract.accept.rule,/every interactive operation/);return JSON.stringify(accepted(['section'],[{id:'section',action_operations:[2],assertion_operations:[3]}]));});
 const outcome=await review.review({observations});
 assert.equal(outcome.accepted,false);assert.equal(outcome.feedback.assessment_source,'host_action_accountability_guard');
 assert.equal(outcome.feedback.requirement,'all_recorded_interactions_justified');assert.equal(outcome.feedback.issues[0].code,'unnecessary_action');
 assert.equal(calls,1);
 const repeated=await review.review({observations});assert.equal(repeated.cached,true);assert.equal(calls,1,'unchanged unjustified work cannot get another review to hide its action');
});

test('correction readiness requires new protected nonduplicate assertion evidence rather than snapshots or copied receipts', async () => {
  let calls = 0;
  const observations = successful();
  const review = reviewer(async () => { calls++;return JSON.stringify(rejected()); });
  await review.review({ observations });
  assert.deepEqual(review.correctionState({ observations }), { candidate_changed: false });
  observations.push(snapshot('Incidental document title', { observation_id: 'different-capture-id', captured_at: 'later' }));
  assert.equal(review.correctionState({ observations }).candidate_changed, false, 'another snapshot is not an executable check');
  observations.push(structuredClone(operation('browser_assert', { assertion: 'visible', locator: '#row' })));
  assert.equal(review.correctionState({ observations }).candidate_changed, false, 'serialized/copied assertions have no protected operation receipt');
  observations.push(operation('browser_assert', { assertion: 'text', locator: '#result', value: 'Address saved' }));
  assert.equal(review.correctionState({ observations }).candidate_changed, false, 'duplicate successful predicates on unchanged meaningful page state add no coverage');
  observations.push(operation('browser_assert', { assertion: 'visible', locator: '#row' }));
  assert.equal(review.correctionState({ observations }).candidate_changed, true, 'a distinct protected check reopens only the review request');
  assert.equal(calls, 1, 'readiness itself neither reviews nor accepts the correction');
  const rejectedAgain = await review.review({ observations });
  assert.equal(rejectedAgain.accepted, false);
  assert.equal(calls, 2);
  assert.equal(review.correctionState({ observations }).candidate_changed, false, 'a second rejection closes that reviewed candidate');
});

test('all section and linked source requirements must receive exact evidence mappings', async () => {
  const events=[];
  const obligations = [{ id: 'section', source: 'section', action: 'Save address', expected_result: 'Address is saved' },
    { id: 'manual:17', source: 'manual', action: 'Save address', expected_result: 'Confirmation is shown and the row displays the new address' }];
  const review = reviewer(async prompt => {
    assert.deepEqual(packet(prompt).obligations, obligations);
    return JSON.stringify({ decision: 'reject', obligations: obligations.map(item => ({ id: item.id, action_operations: [1], assertion_operations: [2] })), issues: [{ code: 'expected_result_not_covered', obligation_id: 'manual:17', message: 'The updated row was not checked.' }] });
  }, { execution: { ...execution, obligations }, onProgress:async event=>events.push(event) });
  const outcome = await review.review({ observations: successful() });
  assert.equal(outcome.accepted, false);assert.equal(outcome.feedback.issues[0].obligation_id, 'manual:17');
  const rejectedEvent=events.find(event=>event.phase==='automation.agent.semantic.rejected');
  assert.deepEqual(rejectedEvent.details.semantic_issues,[{code:'expected_result_not_covered',obligation_id:'manual:17'}]);
  assert.doesNotMatch(JSON.stringify(events),/updated row was not checked/,'model rationale is not public activity data');
});

test('combined encoded manual identities preserve the authorized source case and step without UUID length assumptions', async () => {
  const id = `manual:${encodeURIComponent('漢'.repeat(200))}:${encodeURIComponent('字'.repeat(200))}`;
  const obligations = [{ id, source: 'manual_step', action: execution.action, expected_result: execution.expected_result }];
  const review = reviewer(async prompt => { assert.equal(packet(prompt).obligations[0].id, id);return JSON.stringify(accepted([id])); }, { execution: { ...execution, obligations } });
  assert.equal((await review.review({ observations: successful() })).accepted, true);
});

test('visible validation feedback is accepted when it is the requested negative-test outcome', async () => {
  const negative = { ...execution, action: 'Submit without an address', expected_result: 'Address is required is displayed' };
  const observations = [snapshot(), operation('browser_click', { locator: '#save' }), operation('browser_assert', { assertion: 'text', locator: '#error', value: 'Address is required' }), snapshot('Addresses', { elements: [{ tag: 'div', accessible_role: 'alert', text: 'Address is required', locator_candidates: ['#error'], locators_validated: true }] })];
  const review = reviewer(async prompt => { assert.equal(packet(prompt).current_page.targets[0].role, 'alert');return JSON.stringify(accepted()); }, { execution: negative });
  assert.equal((await review.review({ observations })).accepted, true);
});

test('already reached read-only goals can cite assertions without inventing a new mutation', async () => {
  const readOnly = { ...execution, action: 'Open the address list', expected_result: 'The address list is displayed' };
  const review = reviewer(async () => JSON.stringify(accepted(['section'], [{ id: 'section', action_operations: [], assertion_operations: [1] }])), { execution: readOnly });
  assert.equal((await review.review({ observations: [snapshot(), operation('browser_assert', { assertion: 'visible', locator: '#addresses' })] })).accepted, true);
});

test('a cached rejected candidate cannot consume repeated model calls or mutate the cached verdict', async () => {
  let calls = 0;
  const observations = successful();
  const review = reviewer(async () => { calls++;return JSON.stringify(rejected()); });
  const first = await review.review({ observations });first.feedback.issues[0].message = 'forged';assert.equal(first.cached, false);
  const second = await review.review({ observations });
  assert.equal(calls, 1);assert.equal(second.review_count, 1);assert.notEqual(second.feedback.issues[0].message, 'forged');assert.equal(second.cached, true);
});

test('a fresh observation identifier and timestamp do not turn unchanged page evidence into another review', async () => {
  let calls = 0;const observations = successful();
  const review = reviewer(async () => { calls++;return JSON.stringify(rejected()); });
  await review.review({ observations });
  observations.push(snapshot('Addresses', { observation_id: 'new-observation', captured_at: '2026-10-17T12:30:01Z' }));
  const outcome = await review.review({ observations });assert.equal(outcome.accepted, false);assert.equal(outcome.cached, true);assert.equal(calls, 1);
});

test('repeating an exact satisfied predicate on unchanged evidence reuses the rejected assessment without another review', async () => {
  let calls = 0;const observations = successful();
  const review = reviewer(async () => { calls++;return JSON.stringify(rejected()); });
  const first = await review.review({ observations });assert.equal(first.cached, false);
  observations.push(operation('browser_assert', { assertion: 'text', locator: '#result', value: 'Address saved' }), snapshot('Addresses', { observation_id: 'fresh-identical' }));
  const second = await review.review({ observations });
  assert.equal(second.accepted, false);assert.equal(second.cached, true);assert.equal(second.review_count, 1);assert.equal(calls, 1);
  assert.equal(observations.filter(row => row.tool === 'browser_assert').length, 2, 'canonical cache does not remove actual assertions from the source ledger');
});

test('different predicates, confirmed actions, failed checks or changed page evidence each permit a fresh bounded review', async () => {
  const sameCheck = () => operation('browser_assert', { assertion: 'text', locator: '#result', value: 'Address saved' });
  for (const additions of [[operation('browser_assert', { assertion: 'visible', locator: '#row' })], [operation('browser_click', { locator: '#save-another' }), sameCheck()],
    [{ tool: 'browser_assert', execution_step_id: 'section', result: result({ assertion_outcome: 'not_satisfied' }, true) }, sameCheck()],
    [snapshot('Changed state', { accessibility: '- main\n  - status "Actually changed rendered state"' }), sameCheck()]]) {
    let calls = 0;const observations = successful();const review = reviewer(async () => { calls++;return JSON.stringify(rejected()); });
    await review.review({ observations });observations.push(...additions);
    const next = await review.review({ observations });assert.equal(next.cached, false);assert.equal(next.review_count, 2);assert.equal(calls, 2);
  }
});

test('a typed action error cannot reuse accepted evidence until a later actual check supports a fresh review', async () => {
  for(const tool of ['browser_navigate','browser_click','browser_fill','browser_press_key','browser_select_option','browser_hover','browser_check','browser_uncheck']){
    let calls=0;const observations=successful();
    const review=reviewer(async prompt=>{
      calls++;const data=packet(prompt);
      if(calls===2){assert.equal(data.unsuccessful_actions.at(-1).tool,tool);assert.equal(data.unsuccessful_actions.at(-1).action_outcome,'not_confirmed');}
      return JSON.stringify(accepted(['section'],[{id:'section',action_operations:[1],assertion_operations:[calls===1?2:3]}]));
    });
    assert.equal((await review.review({observations})).accepted,true);
    observations.push({tool,execution_step_id:'section',result:{isError:true,content:[]}});
    const unfinished=await review.review({observations});
    assert.equal(unfinished.accepted,false,tool);assert.equal(unfinished.feedback.code,'AUTOMATION_SEMANTIC_REVIEW_EVIDENCE_REQUIRED');assert.equal(calls,1);
    observations.push(operation('browser_assert',{assertion:'text',locator:'#result',value:'Address saved'}),snapshot());
    const corrected=await review.review({observations});assert.equal(corrected.accepted,true,tool);assert.equal(corrected.cached,false);assert.equal(calls,2);
    assert.equal(observations.filter(row=>row.tool==='browser_click'&&!row.result.isError).length,1,'the completed mutation is preserved and is not replayed');
  }
});

test('read-only browser errors do not require replay or a new assertion but invalidate an older exact review cache', async () => {
  for(const tool of ['browser_snapshot','browser_screenshot','browser_validate_locator']){
    let calls=0;const observations=successful();const review=reviewer(async()=>{calls++;return JSON.stringify(accepted());});
    await review.review({observations});observations.push({tool,execution_step_id:'section',result:{isError:true,content:[]}});
    const next=await review.review({observations});assert.equal(next.accepted,true,tool);assert.equal(next.cached,false);assert.equal(calls,2);
  }
});

test('reviewer interpretation is returned only as bounded sanitized private correction context', async () => {
  const events = [], secret = 'private-owned-value';
  const reason = `The document title stayed unchanged, but the observed main panel changed; inspect that rendered transition. ${secret} reviewer@example.test`;
  const review = reviewer(async () => JSON.stringify(rejected('section', 'expected_result_not_covered', reason)), {
    projectPrivateText: value => value.replaceAll(secret, '[private parameter value]'), onProgress: async event => events.push(event)
  });
  const outcome = await review.review({ observations: successful() });
  assert.equal(outcome.private_feedback.assessment_source, 'untrusted_model_assessment');
  assert.match(outcome.private_feedback.issues[0].message, /observed main panel changed/);
  assert.doesNotMatch(JSON.stringify(outcome.private_feedback), /private-owned-value|reviewer@example\.test/);
  assert.ok(outcome.private_feedback.issues[0].message.length <= 700);
  assert.doesNotMatch(JSON.stringify({ feedback: outcome.feedback, events }), /document title stayed unchanged|observed main panel changed|private-owned-value|reviewer@example\.test/);
});

test('a failed privacy projection never releases the raw reviewer rationale', async () => {
  const rationale = 'private reviewer rationale';
  for (const callback of [() => undefined, () => { throw new Error(rationale); }]) {
    const review = reviewer(async () => JSON.stringify(rejected('section', 'unrelated_assertion', rationale)), {
      projectPrivateText: value => value === rationale ? callback() : value
    });
    const outcome = await review.review({ observations: successful() });
    assert.equal(outcome.accepted, false);assert.doesNotMatch(JSON.stringify(outcome), /private reviewer rationale/);
    assert.equal(outcome.private_feedback.issues[0].message, outcome.feedback.issues[0].message);
  }
});

test('changed browser work receives another review and a third distinct candidate exhausts the bounded review budget', async () => {
  let calls = 0;
  const review = reviewer(async () => { calls++;return JSON.stringify(rejected()); });
  const observations = successful();
  await review.review({ observations });
  observations.push(operation('browser_assert', { assertion: 'visible', locator: '#confirmation' }));
  assert.equal((await review.review({ observations })).review_count, 2);
  observations.push(operation('browser_assert', { assertion: 'visible', locator: '#row' }));
  await assert.rejects(review.review({ observations }), failure => failure.code === 'AUTOMATION_SEMANTIC_REVIEW_EXHAUSTED' && failure.nonRetryable);
  assert.equal(calls, 2);
});

test('a changed page beyond the compact excerpt invalidates a cached acceptance', async () => {
  let calls = 0;
  const review = reviewer(async () => { calls++;return JSON.stringify(accepted()); });
  const observations = successful();
  observations.push(snapshot('Addresses', { accessibility: 'a'.repeat(6000) + 'before' }));
  assert.equal((await review.review({ observations })).accepted, true);
  observations.push(snapshot('Addresses', { accessibility: 'a'.repeat(6000) + 'after' }));
  const outcome = await review.review({ observations });assert.equal(outcome.accepted, true);assert.equal(outcome.cached, false);
  assert.equal(calls, 2);
});

test('malformed pinned requirements and oversized review inputs stop before another model or browser action', async () => {
  let calls = 0;const complete = async () => { calls++;return JSON.stringify(accepted()); };
  const invalid = reviewer(complete, { execution: { ...execution, obligations: [{ id: 'section', source: 'section', action: '', expected_result: '' }] } });
  await assert.rejects(invalid.review({ observations: successful() }), failure => failure.code === 'AUTOMATION_SEMANTIC_REVIEW_INVALID' && failure.nonRetryable);
  const oversized = reviewer(complete, { execution: { ...execution, obligations: Array.from({ length: 10 }, (_, index) => ({ id: `manual:${index}`, source: 'manual', action: 'a'.repeat(10_000), expected_result: 'The saved row appears' })) } });
  await assert.rejects(oversized.review({ observations: successful() }), failure => failure.code === 'AUTOMATION_SEMANTIC_REVIEW_INPUT_TOO_LARGE' && failure.nonRetryable);
  assert.equal(calls, 0);
});

test('forged and cloned observation payloads cannot become semantic action evidence', async () => {
  let calls = 0;
  const review = reviewer(async () => { calls++;return JSON.stringify(accepted()); });
  const observations = JSON.parse(JSON.stringify(successful()));
  const outcome = await review.review({ observations });
  assert.equal(outcome.accepted, false);assert.equal(outcome.feedback.code, 'AUTOMATION_SEMANTIC_REVIEW_EVIDENCE_REQUIRED');assert.equal(calls, 0);
});

test('missing page evidence, unresolved late checks and checks before the last action fail before model review', async () => {
  for (const observations of [successful().slice(1, 3), [snapshot(), operation('browser_assert', { assertion: 'visible', locator: '#result' }), operation('browser_click', { locator: '#save' })],
    [...successful(), { tool: 'browser_assert', execution_step_id: 'section', result: result({ assertion_outcome: 'not_satisfied' }, true) }]]) {
    let calls = 0;const review = reviewer(async () => { calls++;return JSON.stringify(accepted()); });
    const outcome = await review.review({ observations });
    assert.equal(outcome.accepted, false);assert.equal(outcome.feedback.code, 'AUTOMATION_SEMANTIC_REVIEW_EVIDENCE_REQUIRED');assert.equal(calls, 0);
  }
});

test('a later action invalidates an earlier accepted requirement mapping', async () => {
  let calls = 0;const review = reviewer(async () => { calls++;return JSON.stringify(accepted()); });
  const observations = successful();assert.equal((await review.review({ observations })).accepted, true);
  observations.push(operation('browser_click', { locator: '#cancel' }));
  assert.equal((await review.review({ observations })).accepted, false);assert.equal(calls, 1);
});

test('strict review schema rejects unknown or missing requirements, forged indices, duplicate mappings and ungrounded acceptance', async () => {
  const malformed = [null, { ...accepted(), tool_calls: [] }, { ...accepted(), issues: rejected().issues }, accepted(['foreign']), { ...accepted(), obligations: [] },
    accepted(['section'], [{ id: 'section', action_operations: [2], assertion_operations: [2] }]),
    accepted(['section'], [{ id: 'section', action_operations: [1], assertion_operations: [1] }]),
    accepted(['section'], [{ id: 'section', action_operations: [1], assertion_operations: [3] }]),
    accepted(['section'], [{ id: 'section', action_operations: [1, 1], assertion_operations: [2] }]),
    accepted(['section'], [{ id: 'section', action_operations: [1], assertion_operations: [] }]),
    { ...rejected(), issues: [{ code: 'invented', obligation_id: 'section', message: 'Unknown review classification' }] }];
  for (const verdict of malformed) {
    const review = reviewer(async () => JSON.stringify(verdict));
    await assert.rejects(review.review({ observations: successful() }), failure => failure.code === 'AUTOMATION_SEMANTIC_REVIEW_INVALID' && failure.nonRetryable);
  }
});

test('every expected outcome needs an assertion after its own mapped action when the review accepts', async () => {
  const observations = [snapshot(), operation('browser_assert', { assertion: 'visible', locator: '#old-result' }), operation('browser_click', { locator: '#save' }),
    operation('browser_assert', { assertion: 'visible', locator: '#new-result' }), snapshot()];
  const review = reviewer(async () => JSON.stringify(accepted(['section'], [{ id: 'section', action_operations: [2], assertion_operations: [1] }])));
  await assert.rejects(review.review({ observations }), failure => failure.code === 'AUTOMATION_SEMANTIC_REVIEW_INVALID' && failure.nonRetryable);
});

test('independent manual obligations retain intermediate checks before later manual actions in their section', async () => {
  const obligations = [{ id: 'manual:city', source: 'manual_step', action: 'Enter the city', expected_result: 'The city input retains the configured city' },
    { id: 'manual:postal', source: 'manual_step', action: 'Enter the postal code', expected_result: 'The postal input retains the configured postal code' }];
  const observations = [snapshot(), operation('browser_fill', { locator: '#city', value: '@t.city' }), operation('browser_assert', { assertion: 'value', locator: '#city', value: '@t.city' }),
    operation('browser_fill', { locator: '#postal', value: '@t.postal' }), operation('browser_assert', { assertion: 'value', locator: '#postal', value: '@t.postal' }), snapshot()];
  const mappings = [{ id: 'manual:city', action_operations: [1], assertion_operations: [2] }, { id: 'manual:postal', action_operations: [3], assertion_operations: [4] }];
  const review = reviewer(async prompt => {
    assert.deepEqual(packet(prompt).obligations, obligations);
    assert.deepEqual(packet(prompt).confirmed_operations.map(row => row.name), ['browser_fill', 'browser_assert', 'browser_fill', 'browser_assert']);
    return JSON.stringify(accepted([], mappings));
  }, { execution: { ...execution, obligations } });
  assert.equal((await review.review({ observations })).accepted, true);
});

test('a grouped manual assertion before its own action remains invalid despite another final successful check', async () => {
  const obligations = [{ id: 'manual:city', source: 'manual_step', action: 'Enter the city', expected_result: 'The city input retains the configured city' },
    { id: 'manual:postal', source: 'manual_step', action: 'Enter the postal code', expected_result: 'The postal input retains the configured postal code' }];
  const observations = [snapshot(), operation('browser_assert', { assertion: 'value', locator: '#city', value: '@t.city' }), operation('browser_fill', { locator: '#city', value: '@t.city' }),
    operation('browser_fill', { locator: '#postal', value: '@t.postal' }), operation('browser_assert', { assertion: 'value', locator: '#postal', value: '@t.postal' }), snapshot()];
  const review = reviewer(async () => JSON.stringify(accepted([], [{ id: 'manual:city', action_operations: [2], assertion_operations: [1] },
    { id: 'manual:postal', action_operations: [3], assertion_operations: [4] }])), { execution: { ...execution, obligations } });
  await assert.rejects(review.review({ observations }), failure => failure.code === 'AUTOMATION_SEMANTIC_REVIEW_INVALID' && failure.nonRetryable);
});

test('failed-check history survives an unrelated later success and is projected for private review', async () => {
  const observations = [snapshot(), operation('browser_click', { locator: '#save' })];
  const failed = { tool: 'browser_assert', execution_step_id: 'section', arguments: { assertion: 'text', locator: '#result', value: '[redacted]' }, result: result({ assertion_outcome: 'not_satisfied', message: 'Expected address was not saved' }, true) };
  recordBrowserCheck(failed, { name: 'browser_assert', arguments: { assertion: 'text', locator: '#result', value: '@t.address' } }, 'state');
  observations.push(failed, operation('browser_assert', { assertion: 'visible', locator: '#heading' }), snapshot());
  const review = reviewer(async prompt => {
    const data = packet(prompt);assert.equal(data.unsuccessful_checks.length, 1);assert.equal(data.unsuccessful_checks[0].expected_reference, '@t.address');
    assert.equal(data.latest_failure, null);return JSON.stringify(rejected());
  });
  assert.equal((await review.review({ observations, current: {} })).accepted, false);
});

test('all prompt strings use the authorized private-data projection and public issues discard model prose', async () => {
  const secret = 'private-value-831';
  const custom = { ...execution, action: `Save ${secret}`, expected_result: `${secret} appears in the row` };
  const observations = [snapshot(secret), operation('browser_fill', { locator: '#address', value: secret }), operation('browser_assert', { assertion: 'value', locator: '#address', value: secret }), snapshot(secret)];
  const review = reviewer(async prompt => {
    assert.doesNotMatch(prompt, new RegExp(secret));assert.match(prompt, /@t\.private/);
    return JSON.stringify(rejected('section', 'expected_result_not_covered', `${secret} should be displayed`));
  }, { execution: custom, projectText: value => value.replaceAll(secret, '@t.private') });
  const outcome = await review.review({ observations });
  assert.equal(outcome.accepted, false);assert.doesNotMatch(JSON.stringify(outcome), new RegExp(secret));
});

test('already projected goals and page text preserve token-looking literals while original parameter inputs resolve once', async () => {
  const { createBrowserParameterResolver } = require('../../backend/lib/automationBrowserParameters');
  const literal = 'prefix @r.name suffix';
  const resolver = createBrowserParameterResolver({ caseValues: { 't.literal': literal, 'r.name': 'MUST_NOT_REINTERPRET', 't.password': 'private-live-value' } });
  const section = resolver.projectSteps([{ ...execution, id: execution.step_id, action: 'Enter @t.literal', expected_result: '@t.literal is retained' }])[0];
  const observations = [snapshot(literal, { accessibility: `Literal ${literal}; private-live-value` }),
    operation('browser_fill', { locator: '#first', value: '@t.literal' }),
    operation('browser_fill', { locator: '#second', value: literal }),
    operation('browser_assert', { assertion: 'value', locator: '#second', value: '@t.literal' }), snapshot(literal, { accessibility: `Literal ${literal}; private-live-value` })];
  const review = reviewer(async prompt => {
    const data = packet(prompt);
    assert.equal(data.obligations[0].action, `Enter ${literal}`);assert.equal(data.obligations[0].expected_result, `${literal} is retained`);
    assert.equal(data.page_metadata_context.after.title, undefined);assert.match(data.current_page.accessibility, /prefix @r\.name suffix/);
    assert.deepEqual(data.confirmed_operations.map(row => row.arguments.value), [literal, literal, literal]);
    assert.doesNotMatch(prompt, /MUST_NOT_REINTERPRET|private-live-value/);
    return JSON.stringify(accepted([], [{ id: 'section', action_operations: [1, 2], assertion_operations: [3] }]));
  }, { execution: { ...execution, action: section.action, expected_result: section.expected_result }, projectText: resolver.projectText, projectPrivateText: resolver.projectPrivateText });
  assert.equal((await review.review({ observations })).accepted, true);
});

test('provider, parsing, permission and deadline failures cannot produce an acceptance', async () => {
  const unavailable = reviewer(async () => { throw new Error('provider response containing private data'); });
  await assert.rejects(unavailable.review({ observations: successful() }), failure => failure.code === 'AUTOMATION_SEMANTIC_REVIEW_UNAVAILABLE' && failure.nonRetryable && !failure.message.includes('private data'));
  const invalid = reviewer(async () => 'not JSON');
  await assert.rejects(invalid.review({ observations: successful() }), failure => failure.code === 'AUTOMATION_SEMANTIC_REVIEW_INVALID' && failure.nonRetryable);
  const denied = Object.assign(new Error('Access revoked'), { statusCode: 403 });
  await assert.rejects(reviewer(async () => { throw denied; }).review({ observations: successful() }), failure => failure === denied);
  const expired = reviewer(async () => { throw new Error('must not run'); }, { deadlineMs: Date.now() - 1 });
  await assert.rejects(expired.review({ observations: successful() }), failure => failure.code === 'AUTOMATION_SEMANTIC_REVIEW_DEADLINE' && failure.nonRetryable);
});

test('trusted host model and build budgets retain their typed failure instead of being reported as provider outages', async () => {
  for (const code of ['AUTOMATION_BROWSER_MODEL_BUDGET_EXHAUSTED', 'AUTOMATION_BUILD_DEADLINE', 'AUTOMATION_SEMANTIC_REVIEW_DEADLINE']) {
    const original = Object.assign(new Error('Host budget stopped this request'), { code, nonRetryable: true });
    await assert.rejects(reviewer(async () => { throw original; }).review({ observations: successful() }), failure => failure === original);
  }
});
