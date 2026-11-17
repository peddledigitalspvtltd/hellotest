const ENGINE_ENVELOPE_VERSION = 'engine-run/1';
const engineEnvelopeSchema = Object.freeze({
  $id: 'https://hellotest.ai/contracts/engine-run/1', type: 'object',
  required: ['engine_run_id', 'hellotest_run_id', 'hellotest_test_case_id', 'steps'],
  properties: {
    engine_envelope_version: { const: ENGINE_ENVELOPE_VERSION },
    engine_run_id: { type: 'string', minLength: 1 }, hellotest_run_id: { type: 'string', minLength: 1 },
    hellotest_test_case_id: { type: 'string', minLength: 1 },
    automation_case_type: { enum: ['web', 'api', 'android', 'ios', 'unified'] },
    steps: { type: 'array', items: { type: 'object' } }, hooks: { type: 'array', items: { type: 'object' } }
  },
  additionalProperties: true
});

/** Preserve legacy immutable envelopes and every extension field. Version 1
 * describes the transport boundary; worker-native validators own step syntax. */
function engineEnvelopeIssues(value, { allowLegacy = true } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['Supply an engine envelope object.'];
  const issues = [];
  if (value.engine_envelope_version == null ? !allowLegacy : value.engine_envelope_version !== ENGINE_ENVELOPE_VERSION) issues.push('Unsupported engine envelope version.');
  for (const key of engineEnvelopeSchema.required.filter(key => key !== 'steps')) if (typeof value[key] !== 'string' || !value[key].trim()) issues.push(`Missing ${key}.`);
  if (!Array.isArray(value.steps) || value.steps.some(step => !step || typeof step !== 'object' || Array.isArray(step))) issues.push('Engine steps must be objects in an ordered array.');
  if (value.hooks != null && (!Array.isArray(value.hooks) || value.hooks.some(hook => !hook || typeof hook !== 'object' || Array.isArray(hook)))) issues.push('Engine hooks must be objects in an array.');
  if (value.automation_case_type != null && !engineEnvelopeSchema.properties.automation_case_type.enum.includes(value.automation_case_type)) issues.push('Unsupported automation case type.');
  return issues;
}
function versionEngineEnvelope(value) {
  if (value?.engine_envelope_version != null && value.engine_envelope_version !== ENGINE_ENVELOPE_VERSION) throw Object.assign(new Error('Unsupported engine envelope version.'), {code:'ENGINE_ENVELOPE_INVALID',statusCode:422});
  const envelope = { ...value, engine_envelope_version: ENGINE_ENVELOPE_VERSION };
  const issues = engineEnvelopeIssues(envelope, { allowLegacy: false });
  if (issues.length) throw Object.assign(new Error('The engine envelope is invalid.'), { code: 'ENGINE_ENVELOPE_INVALID', statusCode: 422, issues });
  return envelope;
}
module.exports = { ENGINE_ENVELOPE_VERSION, engineEnvelopeSchema, engineEnvelopeIssues, versionEngineEnvelope };
