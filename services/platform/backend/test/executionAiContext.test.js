const test = require('node:test');
const assert = require('node:assert/strict');
const { boundedExecutionAiContext } = require('../src/utils/executionAiContext');

test('long execution context stays valid JSON and preserves a late failure before routine passed steps', () => {
  const input = { reviewer_request: { focus: 'Investigate the failed assertion' }, execution: { id: 'run' }, test_case: { id: 'case' },
    result: { status: 'failed' }, steps: Array.from({ length: 100 }, (_, i) => ({ id: `step-${i}`, step_order: i + 1,
      status: i === 99 ? 'failed' : 'passed', action: 'Do the action', expected_result: 'Observe expected outcome',
      note: i === 99 ? 'Final assertion failed' : 'x'.repeat(1000), captures: { payload: 'y'.repeat(5000) } })) };
  const result = boundedExecutionAiContext(input);
  const serialized = JSON.stringify(result);
  assert.ok(serialized.length <= 18000);
  assert.deepEqual(JSON.parse(serialized), result);
  assert.equal(result.steps.find(step => step.id === 'step-99').note, 'Final assertion failed');
  assert.equal(result.reviewer_request.focus, input.reviewer_request.focus);
  assert.equal(result.evidence_boundary.total_steps, 100);
  assert.ok(result.evidence_boundary.omitted_steps > 0);
  assert.equal(result.steps.length + result.evidence_boundary.omitted_steps, 100);
});

test('execution excerpts preserve PostgreSQL timestamps at every evidence level', () => {
  const started = new Date('2026-09-20T10:00:00Z');
  const finished = new Date('2026-09-20T10:03:00Z');
  const context = boundedExecutionAiContext({ execution: { started_at: started, ended_at: finished },
    result: { created_at: finished }, steps: [{ id: 'failure', status: 'failed', captures: { observed_at: finished } }] });
  assert.equal(context.execution.started_at, started.toISOString());
  assert.equal(context.execution.ended_at, finished.toISOString());
  assert.equal(context.result.created_at, finished.toISOString());
  assert.equal(context.steps[0].captures.observed_at, finished.toISOString());
});
