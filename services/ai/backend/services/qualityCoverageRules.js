const { createHash } = require('node:crypto');
const list = value => Array.isArray(value) ? value : [];
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const criterionText = value => typeof value === 'string' ? value : String(value?.text || value?.description || value?.title || '');
const criteria = story => list(story.acceptance_criteria || story.additional_fields?.acceptance_criteria);
const storyRevision = story => hash([story.id, story.updated_at, criteria(story)]);
const assertionHash = step => hash([step.action || '', step.expected_result || '', step.step_type || '', step.automation_code || '', step.api_request || null]);
const specificationHash = test => hash([test.title || '',test.description || '',list(test.steps).map(assertionHash)]);
const testRevision = test => hash([test.id, test.updated_at,specificationHash(test),list(test.steps).map(step => step.id)]);
const obligationId = (story, index) => `${story.id}:criterion:${index + 1}:${hash(criterionText(criteria(story)[index])).slice(0,12)}`;

function coverage(snapshot) {
  const tests = new Map(list(snapshot.tests).map(test => [test.id,test]));
  const runs = new Map(list(snapshot.runs).map(run => [run.id,run]));
  const reviews = list(snapshot.assertion_reviews);
  const exact = Boolean(snapshot.scope.build && snapshot.scope.environment_id);
  const rows = [];
  for (const story of list(snapshot.stories)) for (const [index, criterion] of criteria(story).entries()) {
    const id = obligationId(story,index), revision = storyRevision(story);
    const matching = reviews.filter(review => review.obligation_id === id && review.decision === 'approved' && review.reviewed_by);
    const verified = matching.filter(review => {
      const test = tests.get(review.test_case_id), step = test?.steps?.find(item => item.id === review.step_id);
      return list(story.test_case_ids).includes(review.test_case_id) && review.story_revision === revision && test && review.test_revision === testRevision(test)
        && step?.expected_result?.trim() && review.assertion_hash === assertionHash(step);
    });
    const observations = verified.flatMap(review => list(snapshot.attempts).filter(attempt => {
      const run = runs.get(attempt.execution_id);
      return attempt.test_case_id === review.test_case_id && attempt.specification_hash === specificationHash(tests.get(review.test_case_id)) && run && run.build === snapshot.scope.build && run.test_environment_id === snapshot.scope.environment_id
        && list(attempt.assertions).some(assertion => assertion.hash === review.assertion_hash && assertion.status === 'passed');
    }));
    const failures = verified.some(review => list(snapshot.attempts).some(attempt => attempt.test_case_id === review.test_case_id
      && runs.get(attempt.execution_id)?.build === snapshot.scope.build && runs.get(attempt.execution_id)?.test_environment_id === snapshot.scope.environment_id
      && attempt.specification_hash === specificationHash(tests.get(review.test_case_id)) && list(attempt.assertions).some(assertion => assertion.hash === review.assertion_hash && ['failed','blocked'].includes(assertion.status))));
    const observed = !verified.length || !exact ? 'unknown' : failures ? 'failed' : observations.some(attempt => attempt.status === 'passed') ? 'covered' : 'unknown';
    rows.push({ obligation_id:id, story_id:story.id, story_revision:revision, text:criterionText(criterion), weight:1,
      linked_test_ids:list(story.test_case_ids).filter(id=>tests.has(id)), reviewed_assertions:verified.map(item=>({review_id:item.id,test_case_id:item.test_case_id,step_id:item.step_id,verifier:item.verifier_version})),
      designed:verified.length ? 'covered' : matching.length ? 'stale' : 'unknown',
      // Observed execution proves this assertion could execute in that exact scope.
      // Authored automation text alone is never treated as a compiler receipt.
      executable: observations.length ? 'covered' : 'unknown', observed,
      evidence:observations.map(attempt=>`attempt:${attempt.id}`),
      reason: !verified.length ? matching.length ? 'Story or assertion changed; review this mapping again.' : 'Review a relevant assertion before counting designed coverage.'
        : failures ? 'The mapped assertion has a recorded failure; passing retries do not erase it.' : observed === 'covered' ? 'Reviewed assertion passed on the selected build and environment.' : 'Designed assertion reviewed; exact-build assertion-level execution evidence is missing.' });
  }
  const denominatorComplete = (snapshot.coverage_complete ?? snapshot.complete) && list(snapshot.stories).length > 0 && snapshot.stories.every(story=>criteria(story).length > 0);
  const percent = kind => denominatorComplete && rows.length && rows.some(row=>['covered','failed'].includes(row[kind])) ? Math.round(10000 * rows.filter(row=>row[kind]==='covered').length / rows.length) / 100 : null;
  return { obligation_count:rows.length,total_weight:rows.length,unknown_weight:rows.filter(row=>row.observed==='unknown'||row.observed==='stale').length,
    designed_percent:percent('designed'),executable_percent:percent('executable'),observed_percent:percent('observed'),rows,denominator_complete:denominatorComplete,
    limitations:['Equal obligation weights; percentages count only verified rows. Unknown and stale obligations remain in the denominator.',
      'A reviewed design mapping does not establish execution. Observations require the identical assertion, build and environment; failures remain blocking.'] };
}
module.exports = { specificationHash, coverage, storyRevision, testRevision, assertionHash, obligationId, criterionText, criteria };
