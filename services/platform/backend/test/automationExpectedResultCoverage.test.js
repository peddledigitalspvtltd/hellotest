const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const catalog = require('../../shared/aiFeatureCatalog.json');
const { aiInstructionBlock } = require('../src/utils/aiInstructionBlocks');
const trace = require('../src/utils/llmTraceContext');
const execution = require('../src/utils/aiExecutionConfiguration');
const keys = ['automationBrowserAgent.goalReview', 'automationBrowserAgent.semanticReview'];
const profiles = catalog.filter(item => keys.every(key => typeof item.defaults.instruction_blocks[key] === 'string'));

function load(file, overrides) {
  const local = createRequire(file), module = { exports: {} };
  new Function('require', 'module', 'exports', fs.readFileSync(file, 'utf8'))(id => Object.hasOwn(overrides, id) ? overrides[id] : local(id), module, module.exports);
  return module.exports;
}
function configuration(records = {}) {
  const db = { prepare: () => ({ get: async key => ({ value: records[key?.replace('ai_feature_configuration:', '')] }), all: async () => [] }) };
  return load(require.resolve('../services/aiConfiguration.service'), { '../src/db': db });
}

test('automation stock guidance requires exported validation evidence independently from native input content', () => {
  assert.equal(profiles.length, 6);
  const controls = configuration();
  for (const feature of profiles) {
    controls.validate(feature.defaults, feature.id);
    const actor = feature.defaults.instruction_blocks[keys[0]], reviewer = feature.defaults.instruction_blocks[keys[1]];
    assert.match(actor, /value assertion checks content only/);
    assert.match(actor, /Current page context is not a replacement for an executable check in the exported program/);
    assert.match(actor, /unrelated required fields or alerts do not justify filling later inputs/);
    assert.match(actor, /When the discovered browser_assert schema advertises valid\/invalid/);
    assert.match(reviewer, /Reject a value-only program when that validation clause is not checked/);
    assert.match(reviewer, /cannot substitute for an executable predicate retained in the exported program/);
    assert.match(reviewer, /do not require entire-form validity/);
    assert.match(reviewer, /Never invent an expected status, infer broad absence from sampled targets/);
    assert.match(reviewer, /native constraints and custom validity/);
    assert.match(reviewer, /does not establish server\/business acceptance, entire-form validity/);
  }
});

test('previous stock clause guidance upgrades without publishing or changing reviewed custom policies', async () => {
  for (const feature of profiles) for (const key of keys) {
    const previous = feature.instruction_default_migrations[key].at(-1);
    assert.equal(typeof previous, 'string');assert.notEqual(previous, feature.defaults.instruction_blocks[key]);
    const stored = structuredClone(feature.defaults);stored.instruction_blocks[key] = previous;
    const service = configuration({ [feature.id]: { published: { version: 7, config: stored }, draft: { config: stored } } });
    if(feature.configuration_owner==='agent') {
      await assert.rejects(service.detail(feature.id),{code:'AI_CONFIGURATION_OWNER'});
      const resolved=await service.resolve(feature.id);
      assert.equal(resolved.published_version,0);assert.equal(resolved.config.instruction_blocks[key],feature.defaults.instruction_blocks[key]);
      const custom='Reviewed node-specific input acceptance and validation policy.';
      const scoped=await execution.run({source:'workflow_node',id:'input-validation',feature_id:feature.id,config:{instruction_blocks:{[key]:custom}}},()=>service.resolve(feature.id));
      assert.equal(scoped.config.instruction_blocks[key],custom);
      continue;
    }
    const detail = await service.detail(feature.id);
    assert.equal(detail.config.instruction_blocks[key], feature.defaults.instruction_blocks[key]);
    assert.equal(detail.draft.config.instruction_blocks[key], feature.defaults.instruction_blocks[key]);assert.equal(detail.published_version, 7);
    const custom = structuredClone(stored);custom.instruction_blocks[key] = 'Reviewed project-specific input acceptance and validation policy.';
    const preserved = await configuration({ [feature.id]: { published: { version: 8, config: custom }, draft: { config: custom } } }).detail(feature.id);
    assert.equal(preserved.config.instruction_blocks[key], custom.instruction_blocks[key]);
    assert.equal(preserved.draft.config.instruction_blocks[key], custom.instruction_blocks[key]);
  }
});

test('content and validation coverage guidance reaches its trusted actor and reviewer phases exactly once', async () => {
  const controls = configuration(), runtime = load(require.resolve('../src/utils/aiFeatureRuntime'), { '../../services/aiConfiguration.service': controls });
  for (const feature of profiles) {
    // Repair uses the same stock evidence guidance, while its ordinary runtime
    // owns a different phase contract. Exercise the builder profiles supported
    // by the host's existing managed actor/review transport.
    if (feature.id === 'ai.agentic.automation-repair') continue;
    for (const [key, generation_scope, actor] of [[keys[0], 'section_attempt', true], [keys[1], 'section_semantic_review', false]]) {
      const result = await trace.run({ automation_case_generation: true, automation_browser_loop: true, automation_actor_phase: actor, generation_scope },
        () => runtime.apply({ body: JSON.stringify({ messages: [{ role: 'user', content: aiInstructionBlock(feature.id, key) + '\n{"goal":"Enter configured data without field errors"}' }] }) }, { featureKey: feature.id }));
      const messages = JSON.parse(result.init.body).messages, guidance = feature.defaults.instruction_blocks[key];
      assert.equal(messages[0].role, 'system');assert.ok(messages[0].content.includes(guidance), feature.id);
      assert.equal(messages.slice(1).some(message => message.content.includes(guidance)), false, feature.id);
      assert.match(messages[1].content, /Enter configured data without field errors/);
    }
  }
});
