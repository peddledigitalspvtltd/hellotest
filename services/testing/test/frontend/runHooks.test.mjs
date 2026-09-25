import test from 'node:test';
import assert from 'node:assert/strict';
import { mapRunHooksToExecutionHooks } from '../../frontend/lib/runHooks.ts';

test('run hooks preserve target identity and lifecycle failure policy in submitted order', () => {
  const types = ['BEFORE_ALL', 'BEFORE_SUITE', 'BEFORE_TEST', 'AFTER_TEST', 'AFTER_SUITE', 'AFTER_ALL'];
  const hooks = types.map((hookType, index) => ({ id: `h${index}`, hookType, itemType: index % 2 ? 'suite' : 'test', itemId: `target${index}`, name: `Setup ${index}` }));
  const before = structuredClone(hooks);
  const result = mapRunHooksToExecutionHooks(hooks);
  assert.deepEqual(hooks, before);
  assert.deepEqual(result.map(h => [h.scope, h.phase, h.fail_behavior]), [
    ['run', 'pre', 'fail-run'], ['suite', 'pre', 'fail-run'], ['test', 'pre', 'fail-run'],
    ['test', 'post', 'continue'], ['suite', 'post', 'continue'], ['run', 'post', 'continue']
  ]);
  assert.deepEqual(result.map(h => h.execution_order), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(result.map(h => [h.id, h.hook_type, h.target_id, h.target_kind]), hooks.map(h => [h.id, h.hookType, h.itemId, h.itemType]));
  assert.equal(result[0].name, 'Before Run: Setup 0');
  assert.deepEqual(mapRunHooksToExecutionHooks([]), []);
});
