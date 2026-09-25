const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSharedSteps } = require('../../backend/domain/sharedStepDefinition');

test('shared step definitions preserve legacy aliases, code and API content while ordering usable steps', () => {
  const input = [
    { step_order: 9, action: ' Send request ', stepType: 'api', apiRequest: { url: 'https://example.test', method: 'post' } },
    { step_order: 2, expectedResult: ' Receipt appears ', automationCode: '  click()\r\n  verify()\r\n' },
    null, { action: ' ' }
  ];
  const before = structuredClone(input);
  const steps = normalizeSharedSteps(input);
  assert.deepEqual(input, before);
  assert.deepEqual(steps.map(step => step.step_order), [1, 2]);
  assert.equal(steps[0].expected_result, 'Receipt appears');
  assert.equal(steps[0].automation_code, '  click()\n  verify()\n');
  assert.equal(steps[0].step_type, 'web');
  assert.equal(steps[1].action, 'Send request');
  assert.equal(steps[1].step_type, 'api');
  assert.equal(steps[1].api_request.method, 'POST');
  assert.equal(steps[1].api_request.url, 'https://example.test');
  for (const malformed of [null, undefined, {}, 'steps']) assert.deepEqual(normalizeSharedSteps(malformed), []);
});
