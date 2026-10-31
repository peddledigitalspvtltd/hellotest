const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const catalog = require('../../shared/aiFeatureCatalog.json');
const execution = require('../src/utils/aiExecutionConfiguration');

const featureIds = ['ai.automation.keyword_generation', 'ai.agentic.automation-engineer', 'ai.agentic.automation-repair'];
const blockKeys = ['automationBrowserAgent.goalReview', 'automationBrowserAgent.recovery', 'automationBrowserAgent.semanticReview'];

function configurationWith(records) {
  const file = require.resolve('../services/aiConfiguration.service');
  const local = createRequire(file);
  const module = { exports: {} };
  const db = {
    prepare: () => ({
      get: async key => records.has(key) ? { value: structuredClone(records.get(key)) } : undefined,
      all: async () => []
    })
  };
  new Function('require', 'module', 'exports', fs.readFileSync(file, 'utf8'))(
    id => id === '../src/db' ? db : local(id), module, module.exports
  );
  return module.exports;
}

for (const featureId of featureIds) {
  test(`${featureId} resolves stock outcome guidance without weakening authored notification or delivery requirements`, async () => {
    const feature = catalog.find(item => item.id === featureId);
    const prior = structuredClone(feature.defaults);
    for (const key of blockKeys) {
      const previous = feature.instruction_default_migrations[key].at(-1);
      assert.ok(previous && previous !== feature.defaults.instruction_blocks[key]);
      prior.instruction_blocks[key] = previous;
    }
    const records = new Map([[`ai_feature_configuration:${featureId}`, {
      revision: 6,
      published: { version: 4, config: prior },
      draft: { config: prior }
    }]]);
    const configuration = configurationWith(records);
    const runtime = await configuration.resolve(featureId);
    const agentOwned=feature.configuration_owner==='agent';
    const detail = agentOwned ? null : await configuration.detail(featureId);
    if(agentOwned)await assert.rejects(configuration.detail(featureId),{code:'AI_CONFIGURATION_OWNER'});
    assert.equal(runtime.published_version, agentOwned?0:4);
    for (const key of blockKeys) {
      assert.equal(runtime.config.instruction_blocks[key], feature.defaults.instruction_blocks[key]);
      if(detail)assert.equal(detail.draft.config.instruction_blocks[key], feature.defaults.instruction_blocks[key]);
    }
    const goal = runtime.config.instruction_blocks['automationBrowserAgent.goalReview'];
    assert.match(goal, /persistent in-page message/);
    assert.match(goal, /current accessibility, targets and validation feedback/);
    assert.match(goal, /request read-only discovery/);
    assert.match(goal, /Preserve explicit notification requirements, quoted literals and exact values/);
    assert.match(goal, /without repeating the completed action/);
    const review = runtime.config.instruction_blocks['automationBrowserAgent.semanticReview'];
    assert.match(review, /code-entry form alone does not prove a code was sent or delivered/);
    assert.match(review, /sent message does not prove inbox receipt/);
    configuration.validate(runtime.config, featureId);
  });

  test(`${featureId} retains reviewed custom outcome instructions in published and draft configurations`, async () => {
    const feature = catalog.find(item => item.id === featureId);
    const custom = structuredClone(feature.defaults);
    for (const key of blockKeys) custom.instruction_blocks[key] = `Reviewed ${key}: verify the exact requested notification and preserve its quoted text.`;
    const records = new Map([[`ai_feature_configuration:${featureId}`, {
      revision: 7,
      published: { version: 5, config: custom },
      draft: { config: custom }
    }]]);
    const configuration = configurationWith(records);
    if(feature.configuration_owner==='agent') {
      await assert.rejects(configuration.detail(featureId),{code:'AI_CONFIGURATION_OWNER'});
      const inherited=await configuration.resolve(featureId);
      for(const key of blockKeys)assert.equal(inherited.config.instruction_blocks[key],feature.defaults.instruction_blocks[key]);
      const node=await execution.run({source:'workflow_node',id:'outcome-review',feature_id:featureId,config:{instruction_blocks:Object.fromEntries(blockKeys.map(key=>[key,custom.instruction_blocks[key]]))}},()=>configuration.resolve(featureId));
      for(const key of blockKeys)assert.equal(node.config.instruction_blocks[key],custom.instruction_blocks[key]);
      assert.equal(node.configuration_source,'workflow_node');
      return;
    }
    const runtime = await configuration.resolve(featureId);
    const detail = await configuration.detail(featureId);
    for (const key of blockKeys) {
      assert.equal(runtime.config.instruction_blocks[key], custom.instruction_blocks[key]);
      assert.equal(detail.draft.config.instruction_blocks[key], custom.instruction_blocks[key]);
    }
  });
}
