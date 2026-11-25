const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize } = require('../../backend/services/automationBuildScorecard.service');

test('build scorecard counts known first runs, measured durations and repair separately from generation', () => {
  const result = summarize([
    { status: 'generated', duration_ms: '100', verification: { first_attempt_status: 'failed', execution_status: 'passed', attempts: 2, repair_count: 1 } },
    { status: 'generated', duration_ms: '200', verification: { execution_status: 'passed', attempts: 1 } },
    { status: 'generated', verification: { execution_status: 'unknown', attempts: 1 } },
    { status: 'incomplete', duration_ms: '300', failure_code: 'AUTOMATION_UPSTREAM_BUILD_INCOMPLETE' },
    { status: 'failed', failure_code: 'AUTOMATION_UPSTREAM_BUILD_INCOMPLETE' },
    { status: 'failed', duration_ms: '400', failure_code: 'AUTOMATION_BROWSER_ENGINE_UNAVAILABLE' },
  ]);
  assert.equal(result.attempted, 6);
  assert.equal(result.build_success_rate, 50);
  assert.equal(result.first_run_sample, 2);
  assert.equal(result.first_run_pass_rate, 50);
  assert.equal(result.repair_rate, 50);
  assert.equal(result.timed_attempts, 4);
  assert.equal(result.median_duration_ms, 250);
  assert.deepEqual(result.top_failure_codes, [
    { code: 'AUTOMATION_UPSTREAM_BUILD_INCOMPLETE', count: 2 },
    { code: 'AUTOMATION_BROWSER_ENGINE_UNAVAILABLE', count: 1 },
  ]);
  assert.equal(summarize([]).build_success_rate, null);
  assert.equal(summarize([]).first_run_pass_rate, null);
  assert.equal(summarize([]).median_duration_ms, null);
});
