import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRunPickerCaseBatch, retainEligibleRunCases, runCaseReferences, runPickerIdBatches } from '../../frontend/lib/runPickerCases.ts';

test('selected ID hydration follows bounded pages without scanning the case catalog', async () => {
  const ids = Array.from({ length: 53 }, (_, index) => `case-${index}`);
  const calls = [];
  const rows = await loadRunPickerCaseBatch(ids, async query => {
    calls.push(query);
    assert.equal(query.page_size, 25);
    assert.deepEqual(query.ids.split(','), ids);
    const offset = Number(query.cursor || 0);
    return { items: ids.slice(offset, offset + 25).map(id => ({ id })), next_cursor: offset + 25 < ids.length ? String(offset + 25) : null, is_last: offset + 25 >= ids.length };
  });
  assert.equal(calls.length, 3);
  assert.deepEqual(rows.map(item => item.id), ids);
});

test('empty selections request nothing and exact-ID batches respect the server bound', async () => {
  assert.deepEqual(await loadRunPickerCaseBatch([], async () => { throw new Error('No request expected'); }), []);
  const batches = runPickerIdBatches([...Array.from({ length: 411 }, (_, index) => `case-${index}`), 'case-1', '']);
  assert.deepEqual(batches.map(batch => batch.length), [200, 200, 11]);
  assert.equal(new Set(batches.flat()).size, 411);
});

test('a repeated continuation fails visibly instead of silently dropping selected IDs', async () => {
  let reads = 0;
  await assert.rejects(loadRunPickerCaseBatch(['a', 'b'], async () => { reads += 1; return { items: [{ id: 'a' }], next_cursor: 'same', is_last: false }; }), /Retry the selection lookup/);
  assert.equal(reads, 2);
});

test('parameter plans preserve all selected IDs while labels resolve', () => {
  const known = { id: 'visible', title: 'Selected case' };
  const references = runCaseReferences(['outside-page', 'visible', 'outside-page'], [known]);
  assert.deepEqual(references.map(item => item.id), ['outside-page', 'visible']);
  assert.equal(references[1], known);
  assert.equal(references[0].detail_complete, false);
});

test('automated run eligibility preserves unresolved selections and removes only known manual cases', () => {
  const known = new Map([['manual', { id: 'manual', automated: 'no' }], ['automated', { id: 'automated', automated: 'yes' }]]);
  assert.deepEqual(retainEligibleRunCases(['pending', 'manual', 'automated'], known, true), ['pending', 'automated']);
  assert.deepEqual(retainEligibleRunCases(['pending', 'manual', 'automated'], known, false), ['pending', 'manual', 'automated']);
});
