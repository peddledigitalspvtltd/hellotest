// removeDuplicates: owns operation-specific validation and transformation.
const { get, set, choose, fields, projection, stableKey } = require('../shared/dataValues');

function compile(data, helpers, config) {
  config.compare = choose(data.dataCompare, ['all', 'selected', 'allExcept'], 'Duplicate comparison');
  config.fields = fields(data.dataFields, { required: config.compare !== 'all' });
}

function execute({ config, input, context, helpers, output, source_items, push, perItem, abort }) {
    const seen = new Map();
    input.forEach((item, index) => {
      abort();
      const compared = config.compare === 'selected' ? config.fields.map(field => get(item, field)) : projection(item, config.compare === 'allExcept' ? 'allExcept' : 'all', config.fields);
      const key = JSON.stringify(stableKey(compared));
      if (seen.has(key)) source_items[index].output_indexes.push(seen.get(key));
      else { seen.set(key, output.length); push(item, [index]); }
    });
}

module.exports = { compile, execute };
