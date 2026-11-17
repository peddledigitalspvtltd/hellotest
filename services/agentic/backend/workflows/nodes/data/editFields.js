// editFields: owns operation-specific validation and transformation.
const { fail, object, set, clone, json, flag, assertMapping } = require('../shared/dataValues');

function compile(data, helpers, config) {
  config.mapping = json(data.dataMapping, 'Field mapping', 'object');
    assertMapping(config.mapping);
  config.keep = flag(data.dataKeepOtherFields, true, 'Keep other fields');
}

function execute({ config, input, context, helpers, output, source_items, push, perItem, abort }) {
  input.forEach((item, index) => {
    abort();
    if (config.keep && !object(item)) throw fail('Keep other fields requires object items. Turn it off to map primitive items.');
    const result = config.keep ? clone(item) : {};
    const mapped = helpers.mapValues(config.mapping, perItem(item, index));
    for (const [field, value] of Object.entries(mapped)) set(result, field, clone(value));
    push(result, [index]);
  });
}

module.exports = { compile, execute };
