// filter: owns operation-specific validation and transformation.
const { comparisons } = require('../shared/dataValues');

function compile(data, helpers, config) {config.comparison = comparisons(data.dataConditions, data.dataConditionCombinator, helpers);
}

function execute({ config, input, context, helpers, output, source_items, push, perItem, abort }) {
  input.forEach((item, index) => {
    abort();
    if (helpers.condition(config.comparison, perItem(item, index))) push(item, [index]);
  });
}

module.exports = { compile, execute };
