import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveStoryMetrics, formatStoryPassRate, deriveBacklogPlanningMetrics, storyCoverageBreakdown } from '../../frontend/lib/storyMetrics.ts';

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
  assert.equal(metrics.readiness, null, 'Coverage and pass counts cannot invent readiness approvals');
  assert.equal(metrics.defectDensity, 2, 'individual Story density uses one Story as denominator');
  assert.equal(formatStoryPassRate(metrics.passRate), '67%');
});

test('Closed Bugs improve resolution without inventing readiness approvals', () => {
  const metrics = deriveStoryMetrics({ ...story, catalog_metrics: { ...story.catalog_metrics, closed_bugs: 2, open_bugs: 0 } });
  assert.equal(metrics.bugResolution.percent, 100);
  assert.equal(metrics.readiness, null);
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

test('Story tile bars keep actual finalized and automation populations without inventing failure outcomes', () => {
  const metrics = deriveStoryMetrics(story);
  assert.deepEqual(storyCoverageBreakdown(metrics.passRate, 'pass'), {
    total: 3,
    segments: [
      { key: 'passed', label: 'Passed', count: 2 },
      { key: 'unknown', label: 'Other finalized outcomes', count: 1 }
    ]
  });
  assert.deepEqual(storyCoverageBreakdown(metrics.automation, 'automation'), {
    total: 4,
    segments: [
      { key: 'covered', label: 'Automated', count: 3 },
      { key: 'uncovered', label: 'Not automated', count: 1 }
    ]
  });
});

test('Story tile bars do not manufacture populations when complete evidence is unavailable', () => {
  assert.equal(storyCoverageBreakdown(undefined, 'pass'), undefined);
  assert.equal(storyCoverageBreakdown({ total: 4, covered: 1, complete: false }, 'automation'), undefined);
  assert.deepEqual(storyCoverageBreakdown({ total: 0, covered: 0, complete: true }, 'pass')?.segments.map(segment => segment.count), [0, 0]);
});


test('Backlog priority thresholds use exact populations and report combined High/Critical percentage', () => {
  const metrics = { total:1000, highPriority:599, criticalPriority:199, highOnlyPriority:400 };
  assert.equal(deriveBacklogPlanningMetrics(metrics).priority.value, '60%');
  assert.equal(deriveBacklogPlanningMetrics(metrics).priority.tone, 'success', 'Rounding does not trigger the 60% threshold');
  assert.equal(deriveBacklogPlanningMetrics({ ...metrics,highPriority:600 }).priority.tone, 'danger');
  assert.equal(deriveBacklogPlanningMetrics({ ...metrics,criticalPriority:200 }).priority.tone, 'warning');
  assert.equal(deriveBacklogPlanningMetrics({ ...metrics,total:0 }).priority.value, '—');
});

test('Monthly backlog flow uses durable additions and departures, marks partial history, and keeps no-history unknown', () => {
  const growth = { added:10, completed:4, removed:1, departures:5, net:5, partial:true, tracking_started_at:'2026-09-20T00:00:00Z',period_start:'2026-09-01T00:00:00Z' };
  const result = deriveBacklogPlanningMetrics({ total:20,growth });
  assert.equal(result.growth.value, '10:5');
  assert.equal(result.growth.tone, 'danger');
  assert.match(result.growth.detail, /net \+5.*Full project.*Partial UTC month/);
  assert.equal(deriveBacklogPlanningMetrics({ total:20 }).growth.value, '—');
});
