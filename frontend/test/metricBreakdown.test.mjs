import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeMetricBreakdown } from '../src/lib/metricBreakdown.ts';

test('count segments keep exact proportions and distinguish failed, blocked and pending outcomes', () => {
  const result = normalizeMetricBreakdown({ total: 10, segments: [
    { key: 'passed', label: 'Passed', count: 6 },
    { key: 'failed', label: 'Failed', count: 1 },
    { key: 'blocked', label: 'Blocked', count: 1 },
    { key: 'pending', label: 'Pending', count: 2 }
  ] });
  assert.deepEqual(result.segments.map(segment => segment.percent), [60, 10, 10, 20]);
  assert.deepEqual(result.segments.map(segment => segment.displayCount), ['6', '1', '1', '2']);
  assert.equal(result.summary, '6 Passed, 1 Failed, 1 Blocked, 2 Pending');
});

test('score-only metrics label their stacked values as percentages', () => {
  const result = normalizeMetricBreakdown({ total: 100, unit: 'percent', segments: [
    { key: 'covered', label: 'Readiness score', count: 72.5 },
    { key: 'pending', label: 'Remaining score', count: 27.5 }
  ] });
  assert.deepEqual(result.segments.map(segment => segment.displayCount), ['72.5%', '27.5%']);
});

test('missing and invalid evidence never becomes a successful or failed count', () => {
  const segments = [
    { key: 'passed', label: 'Passed', count: 2 },
    { key: 'failed', label: 'Failed', count: NaN },
    { key: 'blocked', label: 'Blocked', count: -1 }
  ];
  for (const total of [0, -1, NaN, Infinity]) {
    assert.deepEqual(normalizeMetricBreakdown({ total, segments }), { segments: [], summary: '' });
  }
  const partial = normalizeMetricBreakdown({ total: 5, segments });
  assert.deepEqual(partial.segments.map(({ key, count }) => ({ key, count })), [
    { key: 'passed', count: 2 }, { key: 'unreported', count: 3 }
  ]);
  const invalid = normalizeMetricBreakdown({ total: 1, segments });
  assert.deepEqual(invalid.segments, []);
  assert.match(invalid.summary, /exceed the total/);
});

test('zero and tiny segments do not distort the denominator', () => {
  const result = normalizeMetricBreakdown({ total: 1000, segments: [
    { key: 'passed', label: 'Passed', count: 999 },
    { key: 'failed', label: 'Failed', count: 1 },
    { key: 'blocked', label: 'Blocked', count: 0 }
  ] });
  assert.equal(result.segments.length, 2);
  assert.equal(result.segments[1].percent, 0.1);
  assert.equal(result.segments[1].displayCount, '1');
});
