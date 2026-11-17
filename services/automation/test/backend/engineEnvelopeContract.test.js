const test = require('node:test');
const assert = require('node:assert/strict');
const { versionEngineEnvelope, engineEnvelopeIssues, ENGINE_ENVELOPE_VERSION } = require('@hellotest/contracts/engine');
test('versioned engine envelopes preserve frozen fields and reject unsupported transport contracts without evaluating source', () => {
  const legacy = { engine_run_id: 'engine', hellotest_run_id: 'run', hellotest_test_case_id: 'case', steps: [{ id: 's', automation_code: 'do not execute' }], immutable_extension: { private: 'kept inside runtime' } };
  const before = structuredClone(legacy), versioned = versionEngineEnvelope(legacy);
  assert.equal(versioned.engine_envelope_version, ENGINE_ENVELOPE_VERSION);assert.deepEqual(legacy, before);
  assert.deepEqual(versioned.immutable_extension, legacy.immutable_extension);assert.deepEqual(engineEnvelopeIssues(legacy), []);
  assert.ok(engineEnvelopeIssues(legacy, { allowLegacy: false }).length);
  assert.ok(engineEnvelopeIssues({ ...legacy, engine_envelope_version: 'engine-run/99' }).length);
  assert.throws(() => versionEngineEnvelope({...legacy,engine_envelope_version:'engine-run/99'}), {code:'ENGINE_ENVELOPE_INVALID'});
  assert.throws(() => versionEngineEnvelope({ ...legacy, steps: ['untyped'] }), { code: 'ENGINE_ENVELOPE_INVALID' });
});
