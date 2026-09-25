import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const exports = {};
const source = readFileSync(new URL('../../frontend/lib/sprintHealthMetrics.ts', import.meta.url), 'utf8');
new Function('exports', ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText)(exports);
const { sprintHealthMetrics } = exports;

function scope(overrides = {}) {
  const values = {
    total_stories: 120, completed_stories: 30, completed_percent: 25,
    covered_stories: 90, coverage_percent: 75, linked_cases: 180,
    executed_linked_cases: 100, passed_cases: 80, pass_percent: 80,
    at_risk_stories: 6, slippage_stories: 4, total_bugs: 15, open_p1_p2_bugs: 2
  };
  return {
    iteration_id: 'sprint', name: 'Sprint Alpha', ...values,
    exact_fields: Object.keys(values), observed: { ...values, stories_scanned: values.total_stories },
    completeness: { complete: true, partial: false, reasons: [] }, ...overrides
  };
}
const cards = view => Object.fromEntries(view.metrics.map(metric => [metric.label, metric]));

test('Sprint health uses authoritative scope counts and separate QA, coverage and execution denominators', () => {
  const view = sprintHealthMetrics(scope());
  const metrics = cards(view);
  assert.equal(view.count, 120);
  assert.equal(metrics['QA Story Completion'].value, '25%');
  assert.equal(metrics['Test Coverage'].value, '75%');
  assert.equal(metrics['Pass Rate'].value, '80%');
  assert.equal(metrics['Defect Density'].value, '0.13');
  assert.equal(metrics['At Risk'].value, 6);
  assert.match(metrics['QA Story Completion'].detail, /30 of 120.*QA Done or Done/);
  assert.match(metrics['Pass Rate'].detail, /80 of 100 distinct linked Test Cases/);
  assert.match(metrics['At Risk'].methodology, /slipped.*blocked.*Critical\/High priority without linked test coverage/);
  assert.match(view.summary, /current catalog filters, across all pages/);
});

test('missing or inaccessible Sprint evidence never becomes zero or a healthy score', () => {
  const view = sprintHealthMetrics(undefined, 'Sprint health access is unavailable.');
  assert.equal(view.count, '—');
  assert.ok(view.metrics.length > 3);
  assert.ok(view.metrics.every(metric => metric.value === '—' && metric.tone === 'neutral'));
  assert.ok(view.metrics.every(metric => metric.detail === 'Sprint health access is unavailable.'));
});

test('partial Story evidence exposes observed minimums without deriving ratios from a loaded page', () => {
  const values = scope();
  const view = sprintHealthMetrics({
    ...values, exact_fields: [],
    observed: { ...values.observed, stories_scanned: 25, completed_stories: 10, at_risk_stories: 0 },
    completeness: { complete: false, partial: true, reasons: ['story_scan_limit'] }
  });
  const metrics = cards(view);
  assert.equal(view.count, '≥25');
  assert.equal(view.countLabel, 'Stories Seen');
  for (const name of ['QA Story Completion', 'Test Coverage', 'Pass Rate', 'Defect Density', 'At Risk']) {
    assert.equal(metrics[name].value, '—', name);
  }
  assert.match(metrics['Stories'].detail, /25 Stories observed/);
  assert.match(view.summary, /story scan limit/);
});

test('result permission restrictions keep Story totals exact while execution metrics remain unavailable', () => {
  const values = scope();
  const executionKeys = ['executed_linked_cases', 'passed_cases', 'pass_percent'];
  const view = sprintHealthMetrics({
    ...values, executed_linked_cases: null, passed_cases: null, pass_percent: null,
    exact_fields: values.exact_fields.filter(key => !executionKeys.includes(key)),
    observed: { ...values.observed, executed_linked_cases: null, passed_cases: null },
    completeness: { complete: false, partial: true, reasons: ['Execution metrics require result access.'] }
  });
  const metrics = cards(view);
  assert.equal(view.count, 120);
  assert.equal(metrics['QA Story Completion'].value, '25%');
  assert.equal(metrics['Pass Rate'].value, '—');
  assert.equal(metrics['Executed Test Cases'].value, '—');
  assert.match(metrics['Pass Rate'].detail, /execution evidence is unavailable/);
  assert.doesNotMatch(metrics['Pass Rate'].detail, /null|undefined|NaN/);
});

test('empty Sprint and no-run scope distinguish absent denominators from zero performance', () => {
  const values = scope();
  const zero = Object.fromEntries(values.exact_fields.map(key => [key, 0]));
  const empty = cards(sprintHealthMetrics({ ...values, ...zero, observed: { ...zero, stories_scanned: 0 } }));
  assert.equal(empty['Stories'].value, 0);
  assert.equal(empty['At Risk'].value, 0);
  assert.equal(empty['QA Story Completion'].value, 'N/A');
  assert.equal(empty['Test Coverage'].value, 'N/A');
  assert.equal(empty['Defect Density'].value, 'N/A');
  assert.equal(empty['Pass Rate'].value, 'No Runs');
  assert.equal(empty['Executed Test Cases'].value, 0);
  const noRuns = cards(sprintHealthMetrics(scope({ executed_linked_cases: 0, passed_cases: 0, pass_percent: 0 })));
  assert.equal(noRuns['QA Story Completion'].value, '25%');
  assert.equal(noRuns['Pass Rate'].value, 'No Runs');
});
