const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeApiRequest, validateAuthoredApiRequest, validateGeneratedApiRequest, hasExecutableApiRequest } = require('../src/utils/testStepAutomation');

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

test('authoring retains incomplete API edits while generated and executable requests require complete inputs', () => {
  const request = {
    method: 'GET', url: '@r.base_url/orders', auth: { type: 'bearer' },
    validations: [{ kind: 'status', expected: '' }], captures: [{ path: '$.id' }]
  };
  const saved = normalizeApiRequest(validateAuthoredApiRequest(request));
  assert.deepEqual(saved.auth, { type: 'bearer' });
  assert.equal(saved.validations[0].expected, null);
  assert.deepEqual(saved.captures, [{ path: '$.id', parameter: null }]);
  assert.equal(hasExecutableApiRequest(saved), false);
  const beforeUrl = normalizeApiRequest(validateAuthoredApiRequest({ auth: { type: 'bearer' }, query_params: [{ key: 'region', value: '@t.region' }] }));
  assert.deepEqual(beforeUrl.auth, { type: 'bearer' });
  assert.equal(beforeUrl.query_params[0].value, '@t.region');
  const completed = {
    ...request, auth: { type: 'bearer', credential_reference: '@r.token' },
    validations: [{ kind: 'status', expected: '@t.expected_status', operator: null }], captures: [{ path: '$.id', parameter: '@r.order_id' }]
  };
  assert.deepEqual(validateGeneratedApiRequest(completed).validations, [{ kind: 'status', expected: '@t.expected_status', target: null }]);
  assert.throws(() => validateAuthoredApiRequest({ ...request, validations: [{ kind: 'status', expected: 'success' }] }), { statusCode: 422, code: 'INVALID_API_REQUEST' });
  assert.throws(() => validateAuthoredApiRequest('broken JSON'), { statusCode: 422, code: 'INVALID_API_REQUEST' });
});
