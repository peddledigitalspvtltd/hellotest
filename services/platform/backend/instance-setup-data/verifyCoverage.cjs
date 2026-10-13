'use strict';
const assert = require('node:assert/strict');
const { DROPDOWN_FIELDS_BY_KEY } = require('../src/domain/dropdownCatalog');
const { TEST_CASE_REVIEW_STATUS_VALUES } = require('../src/domain/catalog');
const values = key => DROPDOWN_FIELDS_BY_KEY.get(key).options.map(option => option.value);
function verifyExpandedCoverage({ manifest, byTable, byId, coverage }) {
  if (manifest.version < 8) return;
  const rows = table => (byTable.get(table) || []).map(item => item.record);
  const v8 = table => rows(table).filter(row => row.id?.startsWith('sample-v8-ht-'));
  const requireValues = (actual, expected, label) => {
    const observed = new Set(actual);
    for (const value of expected) assert(observed.has(value), `${label}: missing ${value}`);
  };
  requireValues(rows('app_types').map(row => row.type), values('app_types.types'), 'Application platforms');
  requireValues(v8('requirements').map(row => row.status), values('requirements.statuses'), 'Story lifecycle');
  requireValues(v8('test_cases').map(row => row.test_case_type), values('test_cases.types'), 'Test purposes');
  requireValues(v8('test_cases').map(row => row.status), values('test_cases.statuses'), 'Case lifecycle');
  requireValues(v8('test_cases').map(row => row.review_status), TEST_CASE_REVIEW_STATUS_VALUES, 'Case review lifecycle');
  requireValues(v8('test_steps').map(row => row.step_type), values('test_steps.types'), 'Step platforms');
  requireValues(v8('feedback').map(row => row.bug_type), values('issues.bug_types'), 'Defect taxonomy');
  requireValues(v8('feedback').map(row => row.status), values('issues.statuses'), 'Defect lifecycle');
  requireValues(v8('feedback').map(row => row.severity), values('issues.severities'), 'Defect severity');
  requireValues(v8('executions').map(row => row.trigger === 'manual' ? 'manual' : row.trigger === 'local' || row.execution_mode === 'local' ? 'local' : 'remote'), ['manual','local','remote'], 'Run modes');
  requireValues(v8('execution_results').map(row => row.status), values('executions.result_statuses'), 'Result lifecycle');
  assert(v8('execution_schedules').every(row => row.is_active === false), 'Sample schedules cannot launch work');
  for (const feature of coverage.features) {
    const boundary = byId.get(feature.boundary_case_id)?.record;
    assert.equal(boundary?.requirement_id, feature.story_id, `${feature.key}: boundary traceability`);
    assert(rows('test_steps').filter(step => step.test_case_id === boundary.id).every(step => step.action && step.expected_result), `${feature.key}: complete boundary outcomes`);
  }
  for (const story of v8('requirements')) {
    assert(story.additional_fields.acceptance_criteria.length >= 3);
    assert(story.additional_fields.effort_story_points > 0);
    if (story.iteration_id) {
      const sprint = byId.get(story.iteration_id).record;
      assert.equal(story.sprint, sprint.name);
      assert(Date.parse(story.dev_completion_target_date) <= Date.parse(story.qa_completion_target_date));
      if (sprint.state === 'closed') assert(['qa_done','done'].includes(story.status), 'Completed Sprint contains unfinished Story');
    }
  }
  for (const sprint of v8('requirement_iterations')) assert.equal(sprint.effort_points, v8('requirements').filter(story => story.iteration_id === sprint.id).reduce((sum, story) => sum + story.additional_fields.effort_story_points, 0));
  for (const snapshot of rows('execution_case_snapshots').filter(row => row.execution_id.startsWith('sample-v8-ht-'))) {
    const run = byId.get(snapshot.execution_id).record;
    const testCase = byId.get(snapshot.test_case_id).record;
    assert.equal(run.app_type_id, testCase.app_type_id, 'Run/case application mismatch');
    assert(Date.parse(testCase.created_at) <= Date.parse(run.created_at), 'Run precedes authored case');
    assert.equal(snapshot.test_data_set_snapshot.expected_iterations, snapshot.test_data_set_snapshot.rows.length);
    for (const result of rows('execution_results').filter(result => result.execution_id === run.id && result.test_case_id === testCase.id)) {
      assert.deepEqual(result.data_set_row_snapshot, snapshot.test_data_set_snapshot.rows[result.data_set_iteration_index]);
      assert.equal(JSON.parse(result.logs).synthetic_evidence, true);
    }
  }
}
module.exports = { verifyExpandedCoverage };
