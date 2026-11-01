const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const configuration = require('../services/aiConfiguration.service');

function runtime() {
  const file = require.resolve('../src/utils/aiFeatureRuntime'), local = createRequire(file), module = { exports: {} };
  const dependencies = {
    '../../services/metricGovernance.service': { resolveForFeature: async () => ({ instruction: '', metrics: [] }) },
    '../../services/aiConfiguration.service': { ...configuration, resolve: async id => {
      const item = configuration.catalog.find(item => item.id === id);
      assert.ok(item, id);
      return { ...item, config: structuredClone(item.defaults), configuration_source: 'evaluation_fixture', published_version: 1, fingerprint: configuration.hash(item.defaults) };
    } }
  };
  new Function('require', 'module', 'exports', fs.readFileSync(file, 'utf8'))(id => dependencies[id] || local(id), module, module.exports);
  return module.exports;
}
const boundary = runtime();
for (const feature of configuration.catalog.filter(item => item.runtime_status !== 'reserved')) test(`${feature.id}: configured boundary preserves user intent, evidence and context limits`, async () => {
  const task = { user_request: 'Assess only the supplied checkout retry. Preserve हिन्दी and the final recorded obligation.', evidence: { id: 'source-1', content: 'Two recorded requests produce one order.', final_obligation: 'Do not invent successful execution.' } };
  const input = feature.transport === 'embedding' ? { model: 'fixture-model', input: [task.evidence.content] } : {
    model: 'fixture-model', max_tokens: 4096, messages: [{ role: 'system', content: 'Host native response contract: preserve supplied evidence identities.' }, { role: 'user', content: JSON.stringify(task) }]
  };
  const result = await boundary.apply({ body: JSON.stringify(input) }, { featureKey: feature.id, contextRetrievalQuery: task.user_request });
  const output = JSON.parse(result.init.body);
  assert.equal(result.options.traceContext.feature, feature.id);
  assert.equal(result.options.traceContext.configuration_source, 'evaluation_fixture');
  if (feature.transport === 'embedding') {
    assert.equal(feature.defaults.context.mode, 'none');
    assert.equal(result.options.mcpContextPolicy, undefined, 'Embedding must not recursively retrieve its own evidence.');
  } else assert.deepEqual(result.options.mcpContextPolicy, feature.defaults.context);
  assert.equal(result.options.contextRetrievalQuery, task.user_request);
  if (feature.transport === 'embedding') assert.deepEqual(output.input, input.input);
  else {
    assert.deepEqual(JSON.parse(output.messages.at(-1).content), task);
    assert.ok(output.messages[0].content.includes(feature.defaults.prompt), 'Feature intent must reach the actual configured boundary.');
    assert.match(output.messages[0].content, /Host native response contract/);
    assert.equal(output.temperature, feature.defaults.temperature);
    assert.ok(output.max_tokens <= feature.defaults.max_output_tokens && output.max_tokens <= input.max_tokens);
  }
});
test.after(() => require('../src/db').close());
