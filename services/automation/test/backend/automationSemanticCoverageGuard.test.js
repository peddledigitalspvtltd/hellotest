const test = require('node:test');
const assert = require('node:assert/strict');
const { createAutomationSemanticReviewer } = require('../../backend/lib/automationSemanticReview');
const { recordBrowserOperation } = require('../../backend/lib/automationBrowserRecording');

const execution = { required: true, step_id: 'current', action: 'Enter @r.input', expected_result: 'The input is entered without errors.' };
const receipt = value => ({ content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', ...value }) }] });
function snapshot(extra = {}) {
  return { tool: 'browser_snapshot', execution_step_id: 'current', result: receipt({ observation_id: 'page', url: 'https://app.test/form', scope: 'body',
    elements: [{ tag: 'input', attributes: { type: 'text' }, accessible_role: 'textbox', accessible_name: 'Input', locators_validated: true, locator_candidates: ['#input'] },
      { tag: 'p', accessible_role: 'status', text: 'Input accepted', locators_validated: true, locator_candidates: ['#validation'] },
      { tag: 'select', accessible_role: 'combobox', accessible_name: 'Choice', locators_validated: true, locator_candidates: ['#selection'] },
      ...['checkbox', 'radio', 'hidden'].map(type => ({ tag: 'input', attributes: { type }, locators_validated: true, locator_candidates: [`#${type}`] }))], ...extra }) };
}
function operation(name, args) {
  const observation = { tool: name, execution_step_id: 'current', result: receipt(name === 'browser_assert' ? { assertion_outcome: 'satisfied' } : { action_outcome: 'completed' }) };
  recordBrowserOperation(observation, { name, arguments: args });return observation;
}
const fill = () => operation('browser_fill', { locator: '#input', value: '@r.input' });
const value = () => operation('browser_assert', { assertion: 'value', locator: '#input', value: '@r.input' });
const validation = () => operation('browser_assert', { assertion: 'text_content', locator: '#validation', value: 'Input accepted' });
const observations = () => [snapshot(), fill(), snapshot(), value()];
const accepted = assertions => ({ decision: 'accept', obligations: [{ id: 'current', action_operations: [1], assertion_operations: assertions }], issues: [] });
const packet = prompt => JSON.parse(prompt.split('\n').at(-1));

test('content-only validation proof is rejected before a reviewer call and unchanged repeats reuse its rejection', async () => {
  let calls = 0;const events = [], rows = observations();
  const review = createAutomationSemanticReviewer({ execution, complete: async () => { calls++;return JSON.stringify(accepted([2])); }, onProgress: async event => events.push(event) });
  const first = await review.review({ observations: rows });
  assert.equal(first.accepted, false);assert.equal(first.cached, false);assert.equal(first.review_count, 0);assert.equal(calls, 0);
  assert.equal(first.feedback.assessment_source, 'host_native_value_coverage_guard');
  assert.equal(first.private_feedback.assessment_source, 'host_native_value_coverage_guard');
  assert.match(first.private_feedback.issues[0].message, /independent relevant observed validation/);
  assert.equal(events.some(event => event.phase === 'automation.agent.semantic.review'), false);
  rows.push(value(), snapshot({ observation_id: 'fresh-same-page' }));
  const repeated = await review.review({ observations: rows });assert.equal(repeated.cached, true);assert.equal(repeated.review_count, 0);assert.equal(calls, 0);
});

test('adding real validation evidence permits one ordinary review without repeating the completed fill', async () => {
  let calls = 0;const rows = observations();
  const review = createAutomationSemanticReviewer({ execution, complete: async prompt => {
    calls++;const data = packet(prompt);assert.equal(data.assertion_evidence_contract[0].requirement, 'independent_field_validation_predicate');
    assert.equal(Object.hasOwn(data, 'source_obligations'), false);
    return JSON.stringify(accepted([2, 3]));
  } });
  assert.equal((await review.review({ observations: rows })).accepted, false);
  rows.push(validation());const result = await review.review({ observations: rows });
  assert.equal(result.accepted, true);assert.equal(calls, 1);assert.equal(result.review_count, 1);
  assert.equal(rows.filter(row => row.tool === 'browser_fill').length, 1);
});

test('a selected-field validation predicate permits scoped entry-without-errors review and stays in every obligation mapping', async () => {
  let calls = 0;
  const rows = observations();
  const review = createAutomationSemanticReviewer({ execution, complete: async prompt => {
    calls++;
    const data = packet(prompt);
    const instruction = require('@hellotest/platform/shared/aiFeatureCatalog.json')
      .find(feature => feature.id === 'ai.automation.keyword_generation').defaults.instruction_blocks['automationBrowserAgent.semanticReview'];
    assert.match(instruction, /satisfied field_valid assertion on the same authored control/);
    assert.match(instruction, /cannot discharge explicit business\/server acceptance/);
    assert.equal(data.confirmed_operations[2].arguments.assertion, 'field_valid');
    assert.equal(data.confirmed_operations[2].arguments.locator, data.confirmed_operations[1].arguments.locator);
    return JSON.stringify(accepted([2, 3]));
  } });
  const rejected = await review.review({ observations: rows });
  assert.equal(rejected.accepted, false);
  assert.match(rejected.private_feedback.issues[0].message, /When advertised, field_valid/);
  assert.equal(calls, 0);
  rows.push(operation('browser_assert', { assertion: 'field_valid', locator: '#input' }));
  const result = await review.review({ observations: rows });
  assert.equal(result.accepted, true);
  assert.deepEqual(result.obligation_mappings[0].assertion_operations, [2, 3]);
  assert.equal(rows.filter(row => row.tool === 'browser_fill').length, 1);
  assert.equal(calls, 1);
});

test('native validity cannot certify declared field-error absence before review or through a model accept mapping', async () => {
  const exact = { ...execution, expected_result: 'The email field contains @r.input and no field errors are displayed.' };
  const rows = [...observations(), operation('browser_assert', { assertion: 'valid', locator: '#input' })];
  let calls = 0;
  const review = createAutomationSemanticReviewer({ execution: exact, complete: async prompt => {
    calls++;
    const data = packet(prompt);
    assert.equal(data.assertion_evidence_contract[0].validation_scope, 'declared_field_errors');
    return JSON.stringify(accepted([2, 4]));
  } });
  const blocked = await review.review({ observations: rows });
  assert.equal(blocked.accepted, false); assert.equal(calls, 0);
  assert.equal(blocked.feedback.assessment_source, 'host_native_value_coverage_guard');
  assert.match(blocked.private_feedback.issues[0].message, /valid\/invalid check constraints only/);
  rows.push(operation('browser_assert', { assertion: 'field_valid', locator: '#input' }));
  assert.equal((await review.review({ observations: rows })).accepted, true);
  assert.equal(calls, 1);
  const wrongMapping = createAutomationSemanticReviewer({ execution: exact, complete: async () => JSON.stringify(accepted([2, 3])) });
  const rejectedMapping = await wrongMapping.review({ observations: rows });
  assert.equal(rejectedMapping.accepted, false);
  assert.equal(rejectedMapping.feedback.assessment_source, 'host_native_value_coverage_guard');
  assert.equal(rejectedMapping.review_count, 1, 'a model accept does not override the stronger authored clause');
  assert.equal(rows.filter(row => row.tool === 'browser_fill').length, 1);
});

test('an explicit native-only validity requirement can still use native valid without app-error proof', async () => {
  let calls = 0;
  const review = createAutomationSemanticReviewer({ execution: { ...execution, expected_result: 'The input is valid according to native constraints.' }, complete: async prompt => {
    calls++;
    assert.equal(packet(prompt).assertion_evidence_contract[0].validation_scope, undefined);
    return JSON.stringify(accepted([2, 3]));
  } });
  const result = await review.review({ observations: [...observations(), operation('browser_assert', { assertion: 'valid', locator: '#input' })] });
  assert.equal(result.accepted, true); assert.equal(calls, 1);
});

test('a model accept cannot omit validation from its obligation mapping among mixed operations', async () => {
  let calls = 0;const rows = [...observations(), validation()];
  const review = createAutomationSemanticReviewer({ execution, complete: async () => { calls++;return JSON.stringify(accepted([2])); } });
  const result = await review.review({ observations: rows });
  assert.equal(result.accepted, false);assert.equal(result.feedback.assessment_source, 'host_native_value_coverage_guard');assert.equal(calls, 1);
  assert.equal((await review.review({ observations: rows })).cached, true);assert.equal(calls, 1);
});

test('an additional select value cannot bypass pre-review or mapped native-content coverage', async () => {
  const selectValue = () => operation('browser_assert', { assertion: 'value', locator: '#selection', value: 'choice' });
  let preCalls = 0;
  const preReview = createAutomationSemanticReviewer({ execution, complete: async () => { preCalls++;return JSON.stringify(accepted([2, 3])); } });
  const contentOnly = [...observations(), selectValue()];
  assert.equal((await preReview.review({ observations: contentOnly })).accepted, false);assert.equal(preCalls, 0);
  let postCalls = 0;
  const postReview = createAutomationSemanticReviewer({ execution, complete: async () => { postCalls++;return JSON.stringify(accepted([2, 3])); } });
  const mapped = await postReview.review({ observations: [...contentOnly, validation()] });
  assert.equal(mapped.accepted, false);assert.equal(mapped.feedback.assessment_source, 'host_native_value_coverage_guard');assert.equal(postCalls, 1);
});

test('non-text input values cannot bypass either proof gate through an unrelated control', async () => {
  for (const type of ['checkbox', 'radio', 'hidden']) {
    const otherValue = operation('browser_assert', { assertion: 'value', locator: `#${type}`, value: 'control-value' });
    const contentOnly = [...observations(), otherValue];
    let preCalls = 0;
    const preReview = createAutomationSemanticReviewer({ execution, complete: async () => { preCalls++;return JSON.stringify(accepted([2, 3])); } });
    assert.equal((await preReview.review({ observations: contentOnly })).accepted, false, type);assert.equal(preCalls, 0, type);
    let postCalls = 0;
    const postReview = createAutomationSemanticReviewer({ execution, complete: async () => { postCalls++;return JSON.stringify(accepted([2, 3])); } });
    const mapped = await postReview.review({ observations: [...contentOnly, validation()] });
    assert.equal(mapped.accepted, false, type);assert.equal(mapped.feedback.assessment_source, 'host_native_value_coverage_guard');assert.equal(postCalls, 1, type);
  }
});

test('original source clauses control the guard and projected parameter literals cannot invent or erase validation requirements', async () => {
  const raw = { id: 'current', source: 'section', action: 'Enter @r.input', expected_result: 'The field value equals @r.expected.' };
  let calls = 0;
  const review = createAutomationSemanticReviewer({ execution: { ...execution, expected_result: 'The field value equals without errors.', source_obligations: [raw] }, complete: async prompt => {
    calls++;const data = packet(prompt);assert.equal(data.assertion_evidence_contract, undefined);assert.doesNotMatch(prompt, /@r\.expected/);return JSON.stringify(accepted([2]));
  } });
  assert.equal((await review.review({ observations: observations() })).accepted, true);assert.equal(calls, 1);
  const privateSource = { ...raw, action: 'original-only-private-source', expected_result: 'The input is entered without errors.' };
  const blocked = createAutomationSemanticReviewer({ execution: { ...execution, expected_result: 'The configured input is entered.', source_obligations: [privateSource] }, complete: async () => { throw new Error('must not call'); } });
  const outcome = await blocked.review({ observations: observations() });assert.equal(outcome.accepted, false);assert.doesNotMatch(JSON.stringify(outcome), /original-only-private-source/);
});

test('quoted content-only expectations and ordinary value checks remain supported', async () => {
  for (const expected_result of ['The configured input is entered.', 'The input value is "without errors".',
    'Value equals @r.[no errors shown].', 'Value equals @r.[field is accepted].']) {
    let calls = 0;const review = createAutomationSemanticReviewer({ execution: { ...execution, expected_result }, complete: async () => { calls++;return JSON.stringify(accepted([2])); } });
    assert.equal((await review.review({ observations: observations() })).accepted, true);assert.equal(calls, 1);
  }
});

test('malformed or mismatched original requirement identities cannot disable the host guard', async () => {
  for (const source_obligations of [[], [{ id: 'other', source: 'section', action: 'Enter data', expected_result: 'Data is entered' }]]) {
    const review = createAutomationSemanticReviewer({ execution: { ...execution, source_obligations }, complete: async () => 'unused' });
    await assert.rejects(review.review({ observations: observations() }), error => error.code === 'AUTOMATION_SEMANTIC_REVIEW_INVALID' && error.nonRetryable);
  }
});
