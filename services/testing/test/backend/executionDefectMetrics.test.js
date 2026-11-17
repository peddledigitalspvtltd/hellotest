const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeExecutionMetrics: summarize } = require('../../backend/services/execution.service');

// A defect reported from a run is linked on the defect (feedback.linked_test_run_id); a run's results only list defects linked
// at case or step level. The run page showed "0 defects" for a run that two defects had been reported from.
const cases = [{ execution_id: 'run', test_case_id: 'case-1' }];
const failedResult = (extra = {}) => ({ id: 'result-1', execution_id: 'run', test_case_id: 'case-1', status: 'failed', defects: [], case_defects: [], step_defects: {},
  derived: false, created_at: '2026-11-17T09:00:00.000Z', duration_ms: 1000, ...extra });
const reported = [{ defect_id: 'defect-820', display_id: 'BUG-820' }, { defect_id: 'defect-821', display_id: 'BUG-821' }];

test('defects linked at case or step level in the results are still counted', () => {
  assert.equal(summarize(cases, [failedResult({ case_defects: ['BUG-1'], step_defects: { 's1': ['BUG-2'] } })]).defect_count, 2);
});

test('defects reported from the run are counted even when no result lists them', () => {
  const metrics = summarize(cases, [failedResult()], [], reported);
  assert.equal(metrics.defect_count, 2);
  assert.equal(metrics.failed_cases, 1, 'the rest of the summary is unchanged');
});

test('a defect named by its key in a result and by its id on the defect row is counted once', () => {
  assert.equal(summarize(cases, [failedResult({ case_defects: ['BUG-820'] })], [], reported).defect_count, 2);
  assert.equal(summarize(cases, [failedResult({ defects: ['defect-821'] })], [], reported).defect_count, 2);
});

test('a defect that only a result names still counts alongside the reported ones', () => {
  assert.equal(summarize(cases, [failedResult({ case_defects: ['BUG-9'] })], [], reported).defect_count, 3);
});

test('no defects anywhere is zero, and omitting the defect rows behaves as before', () => {
  assert.equal(summarize(cases, [failedResult()]).defect_count, 0);
  assert.equal(summarize(cases, [failedResult()], [], undefined).defect_count, 0);
  assert.equal(summarize(cases, [failedResult()], [], []).defect_count, 0);
});
