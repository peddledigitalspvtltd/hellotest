import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStoryAssuranceAnalysis, buildTestCaseAssuranceAnalysis } from '../../shared/artifactAssurance.mjs';

test('functional Story review does not create an unrelated NFR, benchmark or failure-path requirement', () => {
  const review = buildStoryAssuranceAnalysis({ title: 'Save a customer delivery address', description: 'As a customer I want to save a delivery address so that I can complete checkout using the saved address.', acceptanceCriteria: ['Given a complete address When the customer saves it Then the saved address is displayed at checkout.'], linkedCaseCount: 1, hasDeliveryContext: false });
  const suggestions = JSON.stringify(review.dimensions.map(item => item.recommendation).concat(review.insights));
  assert.doesNotMatch(suggestions, /Add one measurable non-functional|Add one latency|Specify the most damaging failure|Attach an approved excerpt/);
  assert.match(review.summary, /authored scope/);
  assert.equal(review.overall_score, 100, 'A complete functional Story does not need unrelated quality categories.');
});

test('stated NFR objectives ask for sourced acceptance measures without inventing thresholds', () => {
  const review = buildStoryAssuranceAnalysis({ title: 'Report export performance', description: 'As an analyst I want a performance requirement for exports so that I can complete reporting.', acceptanceCriteria: ['An exported report is available to the analyst.'], linkedCaseCount: 1, hasDeliveryContext: false });
  const measure = review.insights.find(item => item.id === 'measure');
  assert.ok(measure);
  assert.match(measure.recommendation, /do not invent/);
});

test('a focused positive manual case remains focused without a Story, negative cases or run history', () => {
  const review = buildTestCaseAssuranceAnalysis({ title: 'Save a delivery address successfully', description: 'Precondition: a customer is on the address page. Verify that saving the supplied complete address displays it in the address list.', steps: [{ action: 'Enter a complete delivery address and save.', expected_result: 'The saved delivery address is displayed in the address list.' }], requirementCount: 0, reviewStatus: 'not_requested', finalizedRunCount: 0 });
  assert.ok(!review.insights.some(item => ['boundary', 'trace', 'run-evidence'].includes(item.id)));
  assert.doesNotMatch(JSON.stringify(review.dimensions.map(item => item.recommendation)), /Add representative invalid|Link the case to the Story/);
  assert.equal(review.overall_score, 100, 'A complete focused manual design is not depressed by absent external metadata.');
  assert.match(review.limitations.join(' '), /Observed execution: unavailable/);
});

test('unrelated coverage categories, linkage, automation and execution outcomes cannot inflate or depress authored-design scores', () => {
  const story = { title: 'Save a delivery address', description: 'A customer saves the supplied address for checkout.', acceptanceCriteria: ['The saved address is displayed at checkout.'], linkedCaseCount: 0, hasDeliveryContext: false };
  const basicStory = buildStoryAssuranceAnalysis(story);
  const decoratedStory = buildStoryAssuranceAnalysis({ ...story, description: story.description + ' Security, accessibility, boundary and 99 percent availability.', linkedCaseCount: 12, hasDeliveryContext: true, labels: ['security'], externalReferences: ['https://example.test/spec'] });
  assert.deepEqual(decoratedStory.dimensions.map(item => item.score), basicStory.dimensions.map(item => item.score));
  assert.equal(basicStory.score_label, 'Story design completeness');
  assert.doesNotMatch(JSON.stringify(decoratedStory.dimensions.flatMap(item => item.frameworks || [])), /ISO|WCAG|ASVS|INVEST/);
  const input = { title: 'Read the saved address', description: 'The customer reads the address currently saved for checkout.', steps: [{ action: 'Read the saved address.', expected_result: 'The saved delivery address is displayed.' }], requirementCount: 0, reviewStatus: 'not_requested', finalizedRunCount: 0 };
  const manual = buildTestCaseAssuranceAnalysis(input);
  assert.equal(manual.score_label, 'Test design completeness');
  assert.doesNotMatch(JSON.stringify(manual.dimensions.flatMap(item => item.frameworks || [])), /ISO|ISTQB/);
  for (const passRate of [0, 100]) {
    const executed = buildTestCaseAssuranceAnalysis({ ...input, requirementCount: 8, suiteCount: 4, labels: ['negative'], externalReferenceCount: 5, reviewStatus: 'approved', finalizedRunCount: 5, passRate, steps: [{ ...input.steps[0], automation_code: 'approved existing automation' }] });
    assert.deepEqual(executed.dimensions.map(item => item.score), manual.dimensions.map(item => item.score));
    assert.equal(executed.overall_score, manual.overall_score);
    assert.match(executed.limitations.join(' '), /Observed execution: 5 finalized run results/);
  }
});

test('missing action/result contracts, vague results and unresolved local data lower the relevant design measurement', () => {
  const input = { title: 'Compare a computed value', description: 'Calculate the sum and compare it to the expected literal.', steps: [{ action: 'Add one and one.', expected_result: '2' }], requirementCount: 0, reviewStatus: 'not_requested' };
  const complete = buildTestCaseAssuranceAnalysis(input);
  assert.equal(complete.overall_score, 100, 'A concrete literal assertion is valid without an English outcome keyword.');
  const incomplete = buildTestCaseAssuranceAnalysis({ ...input, steps: [{ action: 'Add one and one.', expected_result: '' }] });
  assert.ok(incomplete.overall_score < complete.overall_score);
  const vague = buildTestCaseAssuranceAnalysis({ ...input, steps: [{ action: 'Add one and one.', expected_result: 'Works as expected' }] });
  assert.ok(vague.dimensions.find(item => item.id === 'execution-clarity').score < 100);
  const referenced = { ...input, steps: [{ action: 'Add @t.left and @t.right.', expected_result: '2' }] };
  const missing = buildTestCaseAssuranceAnalysis(referenced);
  assert.equal(missing.dimensions.find(item => item.id === 'data-reliability').score, 0);
  const supplied = buildTestCaseAssuranceAnalysis({ ...referenced, parameterValues: { left: '1', right: '1' } });
  assert.equal(supplied.dimensions.find(item => item.id === 'data-reliability').score, 100);
  const noAcceptance = buildStoryAssuranceAnalysis({ title: 'Save an address', description: 'Save the supplied address for checkout.', acceptanceCriteria: [], linkedCaseCount: 0, hasDeliveryContext: false });
  assert.ok(noAcceptance.overall_score < 100);
});
