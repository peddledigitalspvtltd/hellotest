const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../../backend/services/batchProcess.service'), 'utf8');
const selected = source.slice(source.indexOf('const isRetryableBatchError ='), source.indexOf('const resolveJobMaxAttempts ='));
const { isRetryableBatchError, isAiCapacityError, resolveRetryDelayMs } = new Function('AI_RECOVERY_DELAY_MS', 'MAX_RETRY_DELAY_MS', `${selected};return {isRetryableBatchError,isAiCapacityError,resolveRetryDelayMs};`)(3600000, 3600000);

test('provider reset controls queue timing without an hour floor or a premature cap', () => {
  assert.equal(resolveRetryDelayMs({ statusCode: 429, retryAfterMs: 46005 }, 1), 46005);
  assert.equal(resolveRetryDelayMs({ statusCode: 429, retryAfterMs: 7200000 }, 1), 7200000);
  assert.equal(resolveRetryDelayMs({ statusCode: 429, retryAfterMs: 0 }, 1), 1000);
  assert.equal(resolveRetryDelayMs({ statusCode: 429 }, 1), 3600000);
});

test('quota, oversized requests and token words cannot cause automatic capacity retries', () => {
  for (const error of [{ statusCode: 429, code: 'LLM_QUOTA_EXCEEDED', nonRetryable: true },
    { statusCode: 502, upstreamStatusCode: 401, code: 'LLM_AUTHENTICATION_FAILED', nonRetryable: true },
    { statusCode: 413, upstreamStatusCode: 413, code: 'LLM_REQUEST_TOO_LARGE', nonRetryable: true, message: 'Rate limit request too large' },
    { statusCode: 429, code: 'LLM_RATE_LIMIT_REQUEST_TOO_LARGE', retryable: false },
    { message: 'token expired' }, { message: 'quota mentioned by generated output' }, { code: 'AI_OUTPUT_TRUNCATED', message: 'Output token limit' }]) {
    assert.equal(isRetryableBatchError(error), false); assert.equal(isAiCapacityError(error), false);
  }
  assert.equal(isAiCapacityError({ upstreamStatusCode: 429, statusCode: 503 }), true);
  assert.equal(isRetryableBatchError({ statusCode: 429, code: 'LLM_RATE_LIMITED' }), true);
});
