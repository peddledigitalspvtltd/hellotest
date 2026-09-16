import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveStoryMetrics, formatStoryPassRate } from '../src/lib/storyMetrics.ts';

const story = {
  id: 'story', title: 'Release authentication', project_id: 'project',
  test_case_ids: ['only-visible-case'], defect_ids: ['only-visible-bug'],
  catalog_metrics: {
    linked_cases: 4, automated_cases: 3, executed_cases: 3, passed_cases: 2,
    total_bugs: 2, open_bugs: 1, closed_bugs: 1, described: true, specified: true,
    groomed: true, slipped: false, completed: false, execution_complete: true
  }
};

test('Story metrics use complete server evidence, including links outside the rendered page', () => {
  const metrics = deriveStoryMetrics(story);
  assert.equal(metrics.linkedCases, 4);
  assert.equal(metrics.totalBugs, 2);
  assert.equal(metrics.passRate.total, 3);
  assert.equal(metrics.passRate.percent, 67);
  assert.equal(metrics.automation.percent, 75);
  assert.equal(metrics.bugResolution.percent, 50);
  assert.equal(metrics.readiness, 78, 'weight raw fractions and round only the final readiness');
  assert.equal(metrics.defectDensity, 2, 'individual Story density uses one Story as denominator');
  assert.equal(formatStoryPassRate(metrics.passRate), '67%');
});

test('Closed Bugs improve readiness without changing distinct Bug density', () => {
  const metrics = deriveStoryMetrics({ ...story, catalog_metrics: { ...story.catalog_metrics, closed_bugs: 2, open_bugs: 0 } });
  assert.equal(metrics.bugResolution.percent, 100);
  assert.equal(metrics.readiness, 83);
  assert.equal(metrics.defectDensity, 2);
});

test('No executions differs from unavailable execution permission', () => {
  const noRuns = deriveStoryMetrics({ ...story, catalog_metrics: { ...story.catalog_metrics, executed_cases: 0, passed_cases: 0 } });
  assert.equal(noRuns.passRate.complete, true);
  assert.equal(formatStoryPassRate(noRuns.passRate), 'No runs');
  assert.equal(noRuns.readiness, null);
  const hidden = deriveStoryMetrics({ ...story, catalog_metrics: { ...story.catalog_metrics, executed_cases: null, passed_cases: null, execution_complete: false } });
  assert.equal(formatStoryPassRate(hidden.passRate), '—');
  assert.equal(hidden.readiness, null);
  assert.equal(hidden.automation.percent, 75);
});

test('Missing summary evidence does not fabricate execution, automation, or resolved Bug metrics', () => {
  const metrics = deriveStoryMetrics({ ...story, catalog_metrics: undefined });
  assert.equal(metrics.passRate.complete, false);
  assert.equal(metrics.automation.complete, false);
  assert.equal(metrics.bugResolution.complete, false);
  assert.equal(metrics.readiness, null);
});

test('An empty Story has no execution or readiness denominator', () => {
  const metrics = deriveStoryMetrics({ ...story, catalog_metrics: { ...story.catalog_metrics, linked_cases: 0, automated_cases: 0, executed_cases: 0, passed_cases: 0, total_bugs: 0, open_bugs: 0, closed_bugs: 0 } });
  assert.equal(formatStoryPassRate(metrics.passRate), 'No runs');
  assert.equal(metrics.readiness, null);
  assert.equal(metrics.automation.total, 0);
});
