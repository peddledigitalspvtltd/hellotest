const test = require('node:test');
const assert = require('node:assert/strict');
const { isAiCapacityError, isRetryableLlmError } = require('../../backend/services/aiGenerationRetryPolicy');
const fs = require('node:fs');
const { createRequire } = require('node:module');

test('generation retries only explicit rate rejection and pre-dispatch boundaries', () => {
  for (const error of [{ statusCode: 429 }, { statusCode: 503, upstreamStatus: 429 },
    { code: 'DEPENDENCY_CIRCUIT_OPEN', statusCode: 503 }, { code: 'DEPENDENCY_OVERLOADED' }]) {
    assert.equal(isRetryableLlmError(error), true);
  }
  for (const error of [
    { code: 'AI_OUTPUT_TRUNCATED', statusCode: 502, message: 'LLM token limit reached' },
    { code: 'AI_INVALID_JSON', statusCode: 502 }, { code: 'AI_PROVIDER_REFUSAL', statusCode: 502 },
    { code: 'DEPENDENCY_TIMEOUT', statusCode: 504, retryable: true },
    { code: 'DEPENDENCY_NETWORK_ERROR', statusCode: 503, retryable: true },
    { statusCode: 502, upstreamStatusCode: 401 }, { statusCode: 500 },
    { message: 'token expired' }, { statusCode: 429, retryable: false }
  ]) assert.equal(isRetryableLlmError(error), false, JSON.stringify(error));
});

test('output token limits and expired credentials are not provider capacity', () => {
  assert.equal(isAiCapacityError({ code: 'AI_OUTPUT_TRUNCATED', message: 'token limit' }), false);
  assert.equal(isAiCapacityError({ message: 'quota mentioned in model output', statusCode: 502 }), false);
  assert.equal(isAiCapacityError({ upstreamStatusCode: 429 }), true);
});

const schedulerFixture = responses => {
  const filename = require.resolve('../../backend/services/aiTestCaseGeneration.service');
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  let calls = 0, waits = 0;
  new Function('require', 'module', 'exports', 'setTimeout', fs.readFileSync(filename, 'utf8') + '\nmodule.exports.previewWithRetry = generateCasesForRequirementWithRetry;')(
    name => {
      if (name.endsWith('/src/db')) return { prepare: () => ({}), transaction: callback => callback };
      if (name.endsWith('/workspaceTransaction.service')) return {};
      if (name.endsWith('/testCase.service')) return { createTestCase: async () => ({ id: 'saved' }) };
      if (name.endsWith('/requirementDesign.service')) return { previewRequirementTestCases: async () => {
        const result = responses[Math.min(calls++, responses.length - 1)];
        if (result instanceof Error) throw result;
        return result;
      } };
      return localRequire(name);
    }, module, module.exports, callback => { waits++; queueMicrotask(callback); return { unref() {} }; }
  );
  return { service: module.exports, calls: () => calls, waits: () => waits };
};

test('scheduler does not regenerate paid output or sleep on rejected capacity', async () => {
  for (const failure of [
    Object.assign(new Error('Output token limit'), { code: 'AI_OUTPUT_TRUNCATED', statusCode: 502 }),
    Object.assign(new Error('Unknown response after dispatch'), { code: 'DEPENDENCY_TIMEOUT', statusCode: 504, retryable: true }),
    Object.assign(new Error('Rejected rate limit'), { statusCode: 429 })
  ]) {
    const fixture = schedulerFixture([failure]);
    await assert.rejects(fixture.service.previewWithRetry({ job: {}, requirement: { id: 'story' }, appType: {} }), error => error === failure);
    assert.equal(fixture.calls(), 1, 'The business worker must not override the transport no-replay policy');
    assert.equal(fixture.waits(), 0, 'Rate recovery belongs to next_run_at, not a sleeping worker');
  }
});

test('a local pre-dispatch bulkhead may recover under the bounded worker attempt limit', async () => {
  const failure = Object.assign(new Error('At local capacity'), { code: 'DEPENDENCY_OVERLOADED', statusCode: 503, retryable: true });
  const fixture = schedulerFixture([failure, { cases: [{ title: 'Reviewed proposal' }] }]);
  assert.equal(await fixture.service.previewWithRetry({ job: { id: 'job', created_by: 'author' }, requirement: { id: 'story' }, appType: { id: 'app' } }), 1);
  assert.equal(fixture.calls(), 2);
  assert.equal(fixture.waits(), 1);
  const exhausted = schedulerFixture([failure]);
  await assert.rejects(exhausted.service.previewWithRetry({ job: {}, requirement: {}, appType: {} }));
  assert.equal(exhausted.calls(), 4);
  assert.equal(exhausted.waits(), 3);
});
