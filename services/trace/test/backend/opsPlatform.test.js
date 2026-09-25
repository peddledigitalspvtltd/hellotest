const assert = require('node:assert/strict');
const test = require('node:test');
const { createMonitor } = require('../../backend/services/opsPlatform.service');

test('monitoring returns partial availability, bounds concurrency and coalesces polling', async () => {
  let active = 0, peak = 0, calls = 0, time = 100000;
  const snapshot = createMonitor({ environment: { OPS_MONITORING_ENABLED: 'true' }, now: () => time, fetchImpl: async (url, options) => {
    calls++; active++; peak = Math.max(peak, active);
    assert.ok(options.signal instanceof AbortSignal);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    if (url.includes('loki')) throw new Error('secret credentials and private backend details');
    return new Response('{}');
  } });
  const [a, b] = await Promise.all([snapshot(), snapshot()]);
  assert.equal(a, b);
  assert.equal(calls, 8); assert.equal(peak, 4);
  assert.equal(a.state, 'degraded');
  assert.equal(a.components.filter(item => item.state === 'available').length, 7);
  assert.doesNotMatch(JSON.stringify(a), /secret|http:|private backend/);
  await snapshot(); assert.equal(calls, 8);
  time += 31000;
  await snapshot(); assert.equal(calls, 16);
});

test('disabled monitoring makes no dependency requests', async () => {
  const snapshot = createMonitor({ environment: {}, fetchImpl: async () => assert.fail('unexpected network access') });
  const result = await snapshot();
  assert.equal(result.state, 'not_configured');
  assert.equal(result.components.length, 8);
});

test('an unresponsive component reaches its deadline without failing the snapshot', async () => {
  const snapshot = createMonitor({ environment: { OPS_MONITORING_ENABLED: 'true' }, fetchImpl: async (url, { signal }) => {
    if (!url.includes('grafana')) return new Response('{}');
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } });
  const keepAlive = setTimeout(() => {}, 5000);
  try {
    const result = await snapshot();
    assert.equal(result.state, 'degraded');
    assert.equal(result.components.find(item => item.id === 'grafana').state, 'unavailable');
  } finally { clearTimeout(keepAlive); }
});
