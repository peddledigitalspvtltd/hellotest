const test = require('node:test');
const assert = require('node:assert/strict');
const { scanEligibleJobs } = require('../../backend/services/testEngineDispatch.service')._internals;
const db = require('@hellotest/platform/backend/src/db');
const obsDb = require('@hellotest/platform/backend/src/obsDb');
test.after(() => Promise.all([db.close(), obsDb.close()]));

test('serially blocked jobs cannot starve a runnable job beyond the first 50 candidates', async () => {
  const jobs = Array.from({ length: 121 }, (_, index) => ({ id: String(index).padStart(4, '0'), created_at: '2026-10-29T00:00:00Z', eligible: index === 120 }));
  const cursors = [];
  const found = await scanEligibleJobs(async cursor => {
    cursors.push(cursor);
    return jobs.filter(job => !cursor || job.id > cursor.id).slice(0, 50);
  }, async job => job.eligible);
  assert.equal(found.id, '0120');
  assert.deepEqual(cursors.map(cursor => cursor?.id || null), [null, '0049', '0099']);
});
test('an entirely blocked queue terminates and can be reconsidered on the next poll', async () => {
  const jobs = Array.from({ length: 50 }, (_, index) => ({ id: String(index), created_at: '2026-10-29T00:00:00Z' }));
  let reads = 0;
  assert.equal(await scanEligibleJobs(async cursor => { reads++; return cursor ? [] : jobs; }, async () => false), null);
  assert.equal(reads, 2);
  assert.equal((await scanEligibleJobs(async () => jobs, async () => true)).id, '0');
});
