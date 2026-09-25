const test = require("node:test");
const assert = require("node:assert/strict");
const { mapWithConcurrency } = require("../src/utils/boundedConcurrency");

test("bounded mapping preserves input order while limiting active work", async () => {
  let active = 0;
  let maximum = 0;
  const values = Array.from({ length: 100 }, (_, index) => index);
  const actual = await mapWithConcurrency(values, 4, async value => {
    maximum = Math.max(maximum, ++active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    return value * 2;
  });
  assert.deepEqual(actual, values.map(value => value * 2));
  assert.equal(maximum, 4);
  assert.equal(active, 0);
});

test("failed mapping stops scheduling and drains active work before rejection", async () => {
  const started = [];
  const completed = [];
  let finish;
  let settled = false;
  const failure = new Error("write failed");
  const pending = mapWithConcurrency([0, 1, 2, 3], 2, async value => {
    started.push(value);
    if (!value) { await new Promise(resolve => setImmediate(resolve)); throw failure; }
    await new Promise(resolve => { finish = resolve; });
    completed.push(value);
  });
  pending.then(() => { settled = true; }, () => { settled = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  assert.deepEqual(started, [0, 1]);
  finish();
  await assert.rejects(pending, error => error === failure);
  assert.deepEqual(completed, [1]);
  assert.deepEqual(started, [0, 1]);
});

test("bounded mapping handles empty input and rejects invalid limits", async () => {
  assert.deepEqual(await mapWithConcurrency([], 4, () => assert.fail()), []);
  for (const value of [0, -1, 1.5, NaN, Infinity]) await assert.rejects(mapWithConcurrency([1], value, () => 1), RangeError);
  await assert.rejects(mapWithConcurrency([1], 1, () => { throw null; }), error => error === null);
});
