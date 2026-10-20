import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesRoutableId, findByRoutableId, getRoutableId } from '../../../platform/frontend/src/shared/lib/urlSelection.ts';

test('migrated automation links accept the old display ID and emit the current AT identity', () => {
  const automation = { id: 'automation', display_id: 'AT_42', legacy_display_ids: ['TC_107'] };
  const manual = { id: 'manual', display_id: 'TC_42' };
  assert.equal(findByRoutableId([manual, automation], 'TC_107'), automation);
  assert.equal(findByRoutableId([manual, automation], 'TC_42'), manual);
  assert.equal(matchesRoutableId(automation, 'automation'), true);
  assert.equal(matchesRoutableId(automation, 'AT_42'), true);
  assert.equal(matchesRoutableId(automation, 'TC_42'), false);
  assert.equal(getRoutableId(automation), 'AT_42');
});
