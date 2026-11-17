const test = require('node:test');
const assert = require('node:assert/strict');
const { createLocalRunQueue } = require('../../backend/workflows/localRunQueue');

test('the third development run queues in order, reports position, and starts after a slot releases', async () => {
  const queue = createLocalRunQueue({ concurrency: 2 }), calls = [], updates = [];
  const releases = {};
  const run = id => queue.enqueue(id, () => new Promise(resolve => { calls.push(id); releases[id] = resolve; }), { onPosition: state => updates.push([id, state.state, state.position]) });
  const first = run('first'), second = run('second'), third = run('third'), fourth = run('fourth');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['first','second']);
  assert.equal(third.queued, true); assert.equal(queue.position('third'), 1); assert.equal(queue.position('fourth'), 2);
  releases.first(); await first.promise; await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['first','second','third']); assert.equal(queue.position('fourth'), 1);
  releases.second(); releases.third(); await Promise.all([second.promise,third.promise]);
  await new Promise(resolve => setImmediate(resolve)); releases.fourth(); await fourth.promise;
  assert.ok(updates.some(([id, state, position]) => id === 'fourth' && state === 'queued' && position === 1));
});

test('a cancelled queued run dispatches no node and does not block the following run', async () => {
  const queue = createLocalRunQueue({ concurrency: 1 }), controller = new AbortController(); let release, calls = 0;
  const first = queue.enqueue('first', () => new Promise(resolve => { release = resolve; }));
  const cancelled = queue.enqueue('cancelled', async () => { calls++; }, { signal: controller.signal });
  const next = queue.enqueue('next', async () => { calls++; });
  await new Promise(resolve => setImmediate(resolve)); controller.abort();
  await assert.rejects(cancelled.promise, { name: 'AbortError' });
  release(); await Promise.all([first.promise,next.promise]); assert.equal(calls, 1);
});
