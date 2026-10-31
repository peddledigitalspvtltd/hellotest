import test from 'node:test';
import assert from 'node:assert/strict';
import { findAiMetricCriteriaByLabel, normalizeAiMetricCriteriaOverrides } from '../../frontend/lib/aiPromptRegistry.ts';

test('metric lookup requires a stable identity when display terminology is ambiguous', () => {
  assert.equal(findAiMetricCriteriaByLabel('metric.dashboard.execution_completion')?.key, 'metric.dashboard.execution_completion');
  assert.equal(findAiMetricCriteriaByLabel('Story coverage')?.key, 'metric.story.coverage');
  assert.equal(findAiMetricCriteriaByLabel('confidence'), null);
  assert.equal(findAiMetricCriteriaByLabel(''), null);
  assert.equal(findAiMetricCriteriaByLabel('all invented project metrics'), null);
});

test('client criteria retain the full admin-published 8000-character instruction limit', () => {
  const criteria = 'Criterion '.repeat(800);
  assert.equal(normalizeAiMetricCriteriaOverrides({ 'metric.assurance.story': criteria })['metric.assurance.story'], criteria.trim());
  assert.equal(normalizeAiMetricCriteriaOverrides({ 'metric.assurance.story': 'x'.repeat(8001) })['metric.assurance.story'].length, 8000);
});
