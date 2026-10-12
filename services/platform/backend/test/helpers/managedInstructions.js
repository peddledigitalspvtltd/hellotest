const catalog = require('../../../shared/aiFeatureCatalog.json');
const profiles = new Map(catalog.map(item => [item.id, item.defaults]));

// Provider mocks replace the shared boundary; expand its default markers so
// artifact tests inspect the prompt the provider would actually receive.
function expandManagedInstructions(text) {
  return String(text).replace(/⟦HELLOTEST_AI:([^:⟧]+):([^⟧]+)⟧/g, (_, feature, key) => {
    const block = profiles.get(feature)?.instruction_blocks?.[key];
    if (typeof block !== 'string') throw new Error(`Unknown instruction ${feature}:${key}`);
    return block;
  });
}
module.exports = { expandManagedInstructions };
