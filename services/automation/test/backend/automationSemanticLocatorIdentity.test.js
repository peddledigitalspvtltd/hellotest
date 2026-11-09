const test = require('node:test');
const assert = require('node:assert/strict');
const { createAutomationSemanticReviewer } = require('../../backend/lib/automationSemanticReview');
const { recordBrowserOperation } = require('../../backend/lib/automationBrowserRecording');

const pretty = "getByRole('textbox', { name: 'Joined Date* Joined Date*', exact: true })";
const compact = 'getByRole("textbox",{name:"Joined Date* Joined Date*",exact:true})';
const reordered = 'getByRole("textbox",{exact:true,name:"Joined Date* Joined Date*"})';
const parameter = '@r.employee_joined_date';
const goals = [
  { id: 'section', source: 'section', action: 'Fill the Joined Date input with @r.employee_joined_date.', expected_result: 'The Joined Date input retains @r.employee_joined_date.' },
  { id: 'manual:17', source: 'manual', action: 'Fill the Joined Date input with @r.employee_joined_date.', expected_result: 'The Joined Date input retains @r.employee_joined_date.' }
];
const execution = { required: true, step_id: 'section', action: goals[0].action, expected_result: goals[0].expected_result, obligations: goals, source_obligations: goals };
const result = value => ({ content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', ...value }) }] });
const pageOf = snapshot => JSON.parse(snapshot.result.content[0].text);
const input = candidate => ({ tag: 'input', accessible_role: 'textbox', accessible_name: 'Joined Date* Joined Date*', displayed: true,
  attributes: { type: 'text' }, locators_validated: true, locator_candidates: [candidate] });
let sequence = 0;
function snapshot(candidate = pretty, extras = {}) {
  return { tool: 'browser_snapshot', execution_step_id: 'section', result: result({ observation_id: `date-${++sequence}`,
    url: 'https://app.test/employees', title: 'Employee information', scope: 'body', accessibility: '- textbox "Joined Date* Joined Date*"',
    elements: [input(candidate)], ...extras }) };
}
function operation(name, locator, snapshot) {
  const page = pageOf(snapshot);
  const frame = page.frame_path ? { frame: page.frame_path } : {};
  const args = { ...frame, locator, ...(name === 'browser_assert' ? { assertion: 'value' } : {}), value: parameter };
  const observation = { tool: name, execution_step_id: 'section', arguments: { ...args, value: '[redacted]' },
    result: result({ ...(name === 'browser_assert' ? { assertion_outcome: 'satisfied' } : { action_outcome: 'completed' }),
      ...(page.frame_path ? { frame_path: page.frame_path, frame_document_id: page.frame_document_id } : {}) }) };
  recordBrowserOperation(observation, { name, arguments: args }, { snapshot });
  return observation;
}
function observations({ before = snapshot(), after = snapshot(), fill = pretty, check = reordered } = {}) {
  return [before, operation('browser_fill', fill, before), after, operation('browser_assert', check, after)];
}
const accepted = () => ({ decision: 'accept', obligations: goals.map(goal => ({ id: goal.id, action_operations: [1], assertion_operations: [2] })), issues: [] });
const packet = prompt => JSON.parse(prompt.slice(prompt.indexOf('\n\n') + 2));

for (const candidate of [pretty, compact]) {
  test(`equivalent quote/spacing/property order attaches the native date target and preserves same-control coverage: ${candidate}`, async () => {
    let reviews = 0;
    const reviewer = createAutomationSemanticReviewer({ execution, complete: async prompt => {
      reviews++;
      const data = packet(prompt);
      assert.deepEqual(data.obligations, goals);
      assert.equal(data.confirmed_operations.length, 2);
      for (const row of data.confirmed_operations) {
        assert.equal(row.observed_target.name, 'Joined Date* Joined Date*');
        assert.equal(row.observed_target.tag, 'input');
        assert.equal(row.observed_target.evidence, 'snapshot_before_operation');
        assert.equal(row.observed_target.coverage_aliases, undefined, 'private identity fingerprints never enter the model packet');
      }
      assert.equal(data.confirmed_operations[0].arguments.locator, pretty);
      assert.equal(data.confirmed_operations[1].arguments.locator, reordered);
      assert.equal(data.confirmed_operations[1].arguments.value, parameter);
      return JSON.stringify(accepted());
    } });
    const outcome = await reviewer.review({ observations: observations({ after: snapshot(candidate) }) });
    assert.equal(outcome.accepted, true, JSON.stringify(outcome));
    assert.equal(outcome.confirmed_operation_count, 2);
    assert.deepEqual(outcome.obligation_mappings, accepted().obligations);
    assert.equal(reviews, 1);
  });
}

const rejectedFixtures = [
  ['fuzzy matching is distinct from exact matching', () => ({ check: 'getByRole("textbox",{name:"Joined Date* Joined Date*",exact:false})' })],
  ['a different accessible name is a different target', () => ({ check: 'getByRole("textbox",{name:"Other Date",exact:true})' })],
  ['adding an index does not inherit unindexed target proof', () => ({ check: `${compact}.nth(0)` })],
  ['CSS string literal spaces remain meaningful', () => {
    const candidate = '[data-label="Joined Date* Joined Date*"]';
    return { before: snapshot(candidate), after: snapshot(candidate), fill: candidate, check: '[data-label="Joined Date*  Joined Date*"]' };
  }],
  ['two validated rows with equivalent candidates remain ambiguous', () => ({ after: snapshot(compact, { elements: [input(pretty), input(compact)] }) })],
  ['identical locator aliases in a new frame document cannot prove retained content', () => ({
    before: snapshot(pretty, { frame_path: ['#employee-frame'], frame_url: 'https://app.test/embedded', frame_document_id: 'document-1' }),
    after: snapshot(compact, { frame_path: ['#employee-frame'], frame_url: 'https://app.test/embedded', frame_document_id: 'document-2' })
  })],
  ['identical locators in another frame cannot share control proof', () => ({
    before: snapshot(pretty, { frame_path: ['#employee-frame'], frame_url: 'https://app.test/embedded', frame_document_id: 'document-1' }),
    after: snapshot(compact, { frame_path: ['#other-frame'], frame_url: 'https://app.test/embedded', frame_document_id: 'document-1' })
  })],
  ['a changed native target scope cannot share control proof', () => ({ before: snapshot(pretty, { target_id: 'employee-page-1' }), after: snapshot(compact, { target_id: 'employee-page-2' }) })]
];

for (const [name, fixture] of rejectedFixtures) {
  test(name, async () => {
    let modelCalls = 0;
    const reviewer = createAutomationSemanticReviewer({ execution, complete: async () => { modelCalls++;return JSON.stringify(accepted()); } });
    const outcome = await reviewer.review({ observations: observations(fixture()) });
    assert.equal(outcome.accepted, false, JSON.stringify(outcome));
    assert.equal(outcome.feedback.assessment_source, 'host_native_value_coverage_guard');
    assert.ok(outcome.feedback.issues.every(issue => issue.code === 'expected_result_not_covered'));
    assert.equal(modelCalls, 0, 'a model acceptance cannot override missing unique same-document native proof');
  });
}
