const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const execution = require('@hellotest/platform/backend/src/utils/aiExecutionConfiguration');
const selection = require('@hellotest/integration/backend/services/aiLlmSelection.service');
const draft = { id: 'case', title: 'Search a product', description: 'Search the public catalog.', steps: [
  { action: 'Search the supplied product code', expected_result: 'The documented product is displayed.' }
] };
const review = () => ({ summary: 'The supplied catalog action is observable.', dimensions: [{ id: 'execution-clarity',
  explanation: 'The selected product is identified.', evidence: ['draft:test-case:case'], recommendation: 'Keep the exact product assertion.' }], insights: [], limitations: [] });

function fixture(t, respond, policy) {
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(selection, 'resolveLlmIntegrationForUsage', async () => ({ id: 'model', model: 'fixture', base_url: 'https://provider.invalid/v1' }));
  const calls = [];
  const file = require.resolve('../../backend/services/artifactAssurance.service'), local = createRequire(file), module = { exports: {} };
  new Function('require', 'module', 'exports', fs.readFileSync(file, 'utf8'))(id => id === '@hellotest/platform/backend/src/utils/llmHttpClient'
    ? { fetchLlmWithRetry: async (_url, init, options) => {
      calls.push({ ...options, signal: init.signal });
      const reply = await respond(calls.length);
      now += reply.elapsed || 0;
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(reply.value) } }] });
    } } : local(id), module, module.exports);
  const run = () => execution.run({ source: 'workflow_node', id: 'assurance', feature_id: 'ai.quality.test_case_assurance',
    config: policy ? { agent_execution: policy } : {} }, () => module.exports.reviewArtifact({ artifactType: 'test-case', savedArtifact: draft,
    projectId: 'project', user: { id: 'actor' } }));
  return { calls, run };
}

test('a slow first assurance response can use the existing aggregate budget without a fresh provider call', async t => {
  const f = fixture(t, async () => ({ elapsed: 75_000, value: review() }));
  const result = await f.run();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].timeoutMs, 120_000);
  assert.equal(f.calls[0].maxAttempts, 1);
  assert.equal(result.verification.status, 'passed');
  assert.equal(result.model_execution.deadline_ms, 120_000);
});

test('format repair shares the aggregate deadline and receives only the time left by the original generation', async t => {
  const f = fixture(t, async call => ({ elapsed: call === 1 ? 85_000 : 10_000, value: call === 1 ? { summary: 'Incomplete' } : review() }));
  const result = await f.run();
  assert.deepEqual(f.calls.map(call => call.timeoutMs), [120_000, 35_000]);
  assert.equal(result.response_repaired, true);
  assert.equal(result.model_execution.model_calls, 2);
});

test('lower explicit node model time budgets remain authoritative for generation and repair', async t => {
  const f = fixture(t, async call => ({ elapsed: call === 1 ? 30_000 : 1000, value: call === 1 ? { summary: 'Incomplete' } : review() }),
    { timeout_ms: 45_000, max_model_calls: 2, max_revision_rounds: 1, max_followups: 0 });
  const result = await f.run();
  assert.deepEqual(f.calls.map(call => call.timeoutMs), [45_000, 15_000]);
  assert.equal(result.model_execution.deadline_ms, 45_000);
});

test('explicit single-call or zero-correction policies never dispatch a format-repair generation', async t => {
  for (const policy of [{ max_model_calls: 1, max_revision_rounds: 0 }, { max_model_calls: 4, max_revision_rounds: 0 }]) {
    await t.test(JSON.stringify(policy), async t => {
      const f = fixture(t, async () => ({ value: { summary: 'Incomplete' } }), { timeout_ms: 90_000, max_followups: 0, ...policy });
      await assert.rejects(f.run(), error => error.code === 'AI_BUDGET_EXCEEDED' && error.model_execution.max_model_calls === 1
        && error.model_execution.format_repair_attempted === false && error.generation_received === true && error.retryable === false);
      assert.equal(f.calls.length, 1);
    });
  }
});

test('an exhausted shared deadline cannot reset itself for a format repair', async t => {
  const f = fixture(t, async () => ({ elapsed: 120_000, value: { summary: 'Incomplete' } }));
  await assert.rejects(f.run(), { code: 'AI_BUDGET_EXCEEDED' });
  assert.equal(f.calls.length, 1);
});
