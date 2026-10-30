const test = require('node:test');
const assert = require('node:assert/strict');
const { failureInfo } = require('../../backend/workflows/runtimeEvents');

test('native completion failures retain actionable bounded diagnostics without provider payloads or secrets', () => {
  const failure = {
    code: 'AUTOMATION_BUILD_INCOMPLETE', statusCode: 422, completed_sections: 0, total_sections: 2,
    publicMessage: 'Automation generation is incomplete. Review the validated API fields before retrying.',
    validation_feedback: Array.from({length: 9}, () => ({step_id: 'draft-step-1', code: 'API_REQUEST_INVALID',
      message: 'Omit auth.location for auth.type=none. password=fixture-private-password', provider_response: 'private-provider-body'})),
    response_payload: 'raw response must never reach the workflow UI',
  };
  const projected = failureInfo(failure);
  assert.equal(projected.code, 'AUTOMATION_BUILD_INCOMPLETE');
  assert.equal(projected.status_code, 422); assert.equal(projected.completed_sections, 0); assert.equal(projected.total_sections, 2);
  assert.match(projected.message, /Review the validated API fields/); assert.equal(projected.retryable, false);
  assert.equal(projected.validation_feedback.length, 5);
  assert.match(projected.validation_feedback[0].message, /Omit auth.location/);
  assert.doesNotMatch(JSON.stringify(projected), /fixture-private-password|private-provider-body|raw response/);
  assert.equal(projected.validation_feedback[0].step_id, 'draft-step-1');
});
