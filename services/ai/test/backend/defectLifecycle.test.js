const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const lifecycle = require('../../backend/services/generationLifecycle');
const trace = require('../../../platform/backend/src/utils/llmTraceContext');

function fixture({ error } = {}) {
  const file = require.resolve('../../backend/services/aiBugDraft.service'), native = createRequire(file), module = { exports: {} };
  const stages = []; let modelCalls = 0;
  const draft = { title: 'The observed save failed', message: 'Recorded incident', steps_to_reproduce: 'Save the invoice', expected_result: 'The invoice is saved', actual_result: 'The observed save failed' };
  const grounding = {
    BUG_DRAFT_USAGE_KEY: 'ai.bug.draft', DRAFT_FIELDS: Object.keys(draft),
    normalizeText: (value, max = 12000) => String(value || '').slice(0, max), normalizeImageAssets: () => [], normalizeExternalLinks: () => [], unique: list => [...new Set(list)],
    loadEvidence: async () => ({ run: null, cases: [], requirements: [], failures: [], execution_images: [], linked_test_suite_ids: [], linked_module_ids: [], boundaries: { requested: { execution_images: 0 }, included: {}, omitted: {} } }),
    buildEvidenceSources: () => [{ ref: 'reporter:incident', type: 'reporter-input', id: 'incident', title: 'Observed incident', excerpt: 'A reported save failure' }],
    buildPromptContextSnapshot: context => ({ ...context, content_limits: {}, content_omissions: [] }),
    deterministicDraft: () => ({ draft, gaps: [], assumptions: [], field_evidence: {} }),
    normalizeCandidate: () => ({ draft, gaps: [], assumptions: [], field_evidence: {}, fallback_fields: [] }),
    requestLlmDraft: async () => {
      modelCalls++;
      assert.equal(trace.current().authoring_stage, 'specialist');
      assert.equal(trace.current().authoring_profile, 'defect');
      if (error) throw error;
      return { draft };
    },
    hasWrittenIncident: () => true,
    buildProcessingSnapshot: () => lifecycle.processing({ status: 'completed', stage: 'review', profile: 'defect', outputCount: 1 }), fingerprint: () => 'fixture-hash'
  };
  new Function('require', 'module', 'exports', fs.readFileSync(file, 'utf8'))(id => {
    if (id === '@hellotest/platform/backend/src/db') return { prepare: () => ({ get: async () => ({ id: 'project' }) }) };
    if (id === '@hellotest/integration/backend/services/aiLlmSelection.service') return { resolveLlmIntegrationForUsage: async () => ({ id: 'provider', name: 'Configured provider', model: 'fixture' }) };
    if (id === './bugDraftGrounding') return grounding;
    return native(id);
  }, module, module.exports);
  return { service: module.exports, stages, modelCalls: () => modelCalls, run: (input = {}) => module.exports.preview({ user: { id: 'author' }, project_id: 'project', intent: 'The observed invoice save failed', onProgress: snapshot => stages.push(snapshot.active_stage_id), ...input }) };
}

test('Defect server telemetry reports actual shared stages and trace context at the provider boundary', async () => {
  const f = fixture(), response = await f.run();
  assert.deepEqual(f.stages, ['intake', 'context', 'guardrails', 'specialist', 'outcome', 'evaluation', 'review']);
  assert.equal(f.modelCalls(), 1); assert.equal(response.processing.schema_version, 1);
  assert.equal(response.processing.total_stage_count, 7); assert.equal(response.processing.active_stage_id, 'review');
});

for (const [code, expectedStage] of [['LLM_QUOTA_EXCEEDED', 'specialist'], ['DEPENDENCY_NETWORK_ERROR', 'specialist'], ['AI_NATIVE_CONTRACT_INVALID', 'outcome']]) {
  test(`Defect ${code} keeps the confirmed failure stage and structured recovery fields`, async () => {
    const failure = Object.assign(new Error('Safe provider diagnostic'), { code, publicMessage: 'Safe provider diagnostic', retryAfterSeconds: 11 });
    const f = fixture({ error: failure });
    await assert.rejects(f.run(), result => {
      assert.equal(result.authoring_failure.stage_id, expectedStage);
      assert.equal(result.authoring_processing.active_stage_id, expectedStage);
      assert.equal(result.authoring_processing.schema_version, 1);
      if (code !== 'AI_NATIVE_CONTRACT_INVALID') assert.equal(result.authoring_failure.retry_after_seconds, 11);
      return true;
    });
    assert.equal(f.modelCalls(), 1);
  });
}

test('Defect request preflight has no provider phase and HTTP failures retain the safe stage envelope', async () => {
  const f = fixture();
  await assert.rejects(f.run({ intent: '' }), result => {
    assert.equal(result.authoring_failure.stage_id, 'context');
    assert.equal(result.code, 'AI_DEFECT_EVIDENCE_REQUIRED'); return true;
  });
  assert.equal(f.modelCalls(), 0);
  const failed = fixture({ error: Object.assign(new Error('Safe quota diagnostic'), { code: 'LLM_QUOTA_EXCEEDED', statusCode: 429, publicMessage: 'Safe quota diagnostic', retryAfterSeconds: 11 }) });
  const app = require('fastify')({ logger: false });
  try {
    await app.register(require('../../../platform/backend/src/plugins/errorHandler'));
    app.get('/fixture', () => failed.run());
    const response = await app.inject('/fixture'), payload = response.json();
    assert.equal(response.statusCode, 429); assert.equal(response.headers['retry-after'], '11');
    assert.equal(payload.failure.stage_id, 'specialist'); assert.equal(payload.processing.schema_version, 1);
    assert.equal(payload.failure.code, 'LLM_QUOTA_EXCEEDED');
    assert.doesNotMatch(JSON.stringify(payload.processing), /Recorded incident|invoice/);
  } finally { await app.close(); }
});
