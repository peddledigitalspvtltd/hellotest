const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeApiRequest } = require('../src/utils/testStepAutomation');

test('authored API deadlines survive serialization and repeated snapshot normalization', () => {
  const request = { url: 'https://example.test', timeout_ms: 45000 };
  const saved = normalizeApiRequest(request);
  assert.equal(saved.timeout_ms, 45000);
  assert.deepEqual(normalizeApiRequest(JSON.stringify(saved)), saved);
  assert.equal(normalizeApiRequest({ ...request, timeout_ms: 1 }).timeout_ms, 1000);
  assert.equal(normalizeApiRequest({ ...request, timeout_ms: 9999999 }).timeout_ms, 120000);
  for (const value of ['invalid', -1, 0, Infinity, null]) {
    assert.equal(normalizeApiRequest({ ...request, timeout_ms: value }).timeout_ms, 30000);
  }
  assert.equal('timeout_ms' in normalizeApiRequest({ url: request.url }), false, 'existing snapshots retain their shape');
});
