// limit: owns operation-specific validation and transformation.
const { MAX_ITEMS, fail, choose } = require('../shared/dataValues');

function compile(data, helpers, config) {
  config.limit = Number(data.dataLimit);
    if (!(typeof data.dataLimit === 'number' || typeof data.dataLimit === 'string' && /^\d+$/.test(data.dataLimit)) || !Number.isInteger(config.limit) || config.limit < 0 || config.limit > MAX_ITEMS) throw fail(`Limit must be an integer between 0 and ${MAX_ITEMS}.`);
  config.keep = choose(data.dataKeep, ['first', 'last'], 'Keep items');
}

function execute({ config, input, context, helpers, output, source_items, push, perItem, abort }) {
    const start = config.keep === 'last' ? Math.max(0, input.length - config.limit) : 0;
    const end = config.keep === 'last' ? input.length : Math.min(config.limit, input.length);
    for (let index = start; index < end; index++) push(input[index], [index]);
}

module.exports = { compile, execute };
