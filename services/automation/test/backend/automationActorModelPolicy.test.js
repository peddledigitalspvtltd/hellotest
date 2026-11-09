const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const { browserActorRequestPolicy } = require('../../backend/lib/automationActorModelPolicy');
const configuration = require('../../../platform/backend/services/aiConfiguration.service');
const trace = require('../../../platform/backend/src/utils/llmTraceContext');
const { prepareChatRequest } = require('../../../platform/backend/src/utils/llmRequestPolicy');

const feature = 'ai.agentic.automation-engineer';
const integration = { id: 'fixture-openai', base_url: 'https://api.openai.com/v1', model: 'gpt-5' };
const actorPolicy = { max_completion_tokens: 4096, reasoning_effort: 'low' };

function managedRuntime(maxOutputTokens) {
  const file = require.resolve('../../../platform/backend/src/utils/aiFeatureRuntime');
  const local = createRequire(file), module = { exports: {} };
  const overrides = {
    '../../services/metricGovernance.service': { resolveForFeature: async () => ({ instruction: '', metrics: [] }) },
    '../../services/aiConfiguration.service': {
      ...configuration,
      resolve: async id => {
        assert.equal(id, feature);
        const item = configuration.catalog.find(row => row.id === id);
        const config = { ...structuredClone(item.defaults), max_output_tokens: maxOutputTokens };
        return { ...item, config, published_version: 1, fingerprint: configuration.hash(config) };
      }
    }
  };
  new Function('require', 'module', 'exports', fs.readFileSync(file, 'utf8'))(
    id => Object.hasOwn(overrides, id) ? overrides[id] : local(id), module, module.exports
  );
  return module.exports;
}

async function managedRequest({ cap, browserActor = true, browserReview = false, phase = 'section_attempt' }) {
  const policy = browserActorRequestPolicy(integration, browserActor, browserReview);
  const init = { body: JSON.stringify({ model: integration.model, messages: [{ role: 'user', content: 'The immutable current browser task and observed evidence.' }], ...policy }) };
  const managed = await trace.run({ automation_browser_loop: true, automation_actor_phase: browserActor === true, generation_scope: phase },
    () => managedRuntime(cap).apply(init, { integration, featureKey: feature, operation: 'automation.generate' }));
  const prepared = prepareChatRequest(managed.init, { ...managed.options, providerUrl: integration.base_url + '/chat/completions' });
  return { policy, managed, prepared };
}

test('only the known official GPT-5 actor models receive the reasoning and visible JSON allowance', () => {
  for (const model of ['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5-2025-08-07', 'gpt-5-mini-2025-08-07', 'gpt-5-nano-2025-08-07']) {
    for (const base_url of ['https://api.openai.com', 'https://api.openai.com/v1', 'https://api.openai.com/v1/chat/completions']) {
      assert.deepEqual(browserActorRequestPolicy({ base_url, model }, true), actorPolicy, `${base_url} ${model}`);
    }
  }
});

test('other providers, OpenAI-compatible proxies and unlisted model variants retain the 2048-token actor policy', () => {
  for (const base_url of ['https://provider.example.test/v1', 'https://api.openai.com.proxy.example/v1', 'https://proxy.example/api.openai.com/v1', 'http://api.openai.com/v1', 'https://api.openai.com:444/v1', 'not-a-url']) {
    assert.deepEqual(browserActorRequestPolicy({ base_url, model: 'gpt-5' }, true), { max_tokens: 2048 }, base_url);
  }
  for (const model of ['gpt-4o', 'gpt-4o-mini', 'gpt-5-chat-latest', 'gpt-5.1', 'gpt-5-pro', 'gpt-5-mini-2025-08-08', 'openai/gpt-5', 'GPT-5', 'gpt-5-preview', 'fixture-model', '', null]) {
    assert.deepEqual(browserActorRequestPolicy({ ...integration, model }, true), { max_tokens: 2048 }, String(model));
  }
});

test('non-actor phases and truthy actor lookalikes receive no actor request controls', () => {
  for (const browserActor of [false, undefined, null, 'true', 1, {}]) {
    assert.deepEqual(browserActorRequestPolicy(integration, browserActor), {});
  }
});

test('only an explicit true review flag selects the known official GPT-5 review allowance', () => {
  for (const model of ['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5-2025-08-07', 'gpt-5-mini-2025-08-07', 'gpt-5-nano-2025-08-07']) {
    assert.deepEqual(browserActorRequestPolicy({ ...integration, model }, false, true), actorPolicy, model);
  }
  for (const browserReview of [false, undefined, null, 'true', 'section_semantic_review', 1, {}]) {
    assert.deepEqual(browserActorRequestPolicy(integration, false, browserReview), {});
  }
  for (const selected of [
    { ...integration, base_url: 'https://provider.example.test/v1' },
    { ...integration, base_url: 'https://api.openai.com.proxy.example/v1' },
    { ...integration, model: 'gpt-4o' },
    { ...integration, model: 'gpt-5-chat-latest' },
    { ...integration, model: 'fixture-model' }
  ]) assert.deepEqual(browserActorRequestPolicy(selected, false, true), {}, selected.model);
});

test('the real managed apply and provider preparation preserve 4096 completion tokens and low effort under an 8192 cap', async () => {
  const { policy, managed, prepared } = await managedRequest({ cap: 8192 });
  assert.deepEqual(policy, actorPolicy);
  assert.equal(managed.options.maxOutputTokens, 4096);
  assert.equal(managed.profile.config.max_output_tokens, 8192);
  for (const payload of [JSON.parse(managed.init.body), prepared.payload]) {
    assert.equal(payload.max_completion_tokens, 4096);
    assert.equal(payload.max_tokens, undefined);
    assert.equal(payload.reasoning_effort, 'low');
  }
  assert.equal(managed.options.traceContext.feature, feature);
});

test('a stricter custom managed output cap remains authoritative without dropping low reasoning effort', async () => {
  const { managed, prepared } = await managedRequest({ cap: 1024 });
  assert.equal(managed.options.maxOutputTokens, 1024);
  assert.equal(JSON.parse(managed.init.body).max_completion_tokens, 1024);
  assert.equal(prepared.payload.max_completion_tokens, 1024);
  assert.equal(prepared.payload.reasoning_effort, 'low');
});

test('explicit semantic review preserves the 4096 low-effort request through managed preparation and respects a smaller cap', async () => {
  for (const cap of [8192, 1024]) {
    const { policy, managed, prepared } = await managedRequest({ cap, browserActor: false, browserReview: true, phase: 'section_semantic_review' });
    assert.deepEqual(policy, actorPolicy);
    assert.equal(managed.options.maxOutputTokens, Math.min(cap, 4096));
    assert.equal(managed.profile.deferred_output_schema, true);
    for (const payload of [JSON.parse(managed.init.body), prepared.payload]) {
      assert.equal(payload.max_completion_tokens, Math.min(cap, 4096));
      assert.equal(payload.max_tokens, undefined);
      assert.equal(payload.reasoning_effort, 'low');
    }
  }
});

test('a review phase without the explicit review flag and other non-actor requests keep their configured policy', async () => {
  for (const phase of ['section_semantic_review', 'case_metadata']) {
    const { policy, managed, prepared } = await managedRequest({ cap: 8192, browserActor: false, phase });
    assert.deepEqual(policy, {});
    assert.equal(managed.options.maxOutputTokens, 8192);
    assert.equal(prepared.payload.max_completion_tokens, 8192);
    assert.equal(prepared.payload.reasoning_effort, undefined);
  }
});
