import test from 'node:test';
import assert from 'node:assert/strict';
import { pushRecorderAction } from '../dist/lib/recorder.js';

test('typing is deduplicated only within one uninterrupted action burst', () => {
  const session = { paused: false, actions: [] };
  const add = (type, value, seconds, page_id = 'page-one') => pushRecorderAction(session, { type, locator: '#search', value, page_id, timestamp: `2026-09-28T12:00:${String(seconds).padStart(2, '0')}Z` });
  add('fill', 'a', 0);
  add('fill', 'apple', 1);
  assert.equal(session.actions.length, 1);
  add('click', null, 2);
  add('fill', 'pear', 3);
  assert.deepEqual(session.actions.map(({ type, value, index }) => [type, value, index]), [['fill', 'apple', 1], ['click', null, 2], ['fill', 'pear', 3]]);
  add('fill', 'orange', 4, 'page-two');
  assert.equal(session.actions.length, 4);
  add('fill', 'stale', 2, 'page-two');
  assert.equal(session.actions.length, 5, 'an older event must not overwrite newer input');
});

test('bounded recorder actions retain monotonic sequence numbers', () => {
  const session = { paused: false, actions: [] };
  for (let index = 0; index < 1200; index++) pushRecorderAction(session, { type: 'click', index: 1, locator: 'button', timestamp: new Date().toISOString() });
  assert.equal(session.actions.at(-1).index, 1200);
  assert.equal(new Set(session.actions.map(({ index }) => index)).size, session.actions.length);
});
