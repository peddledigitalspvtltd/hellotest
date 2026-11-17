// sort: owns operation-specific validation and transformation.
const { SORT_TYPES, fail, object, pathParts, get, json, choose, sortValue } = require('../shared/dataValues');

function compile(data, helpers, config) {
  config.sort = json(data.dataSortFields, 'Sort fields', 'array');
    if (!config.sort.length || config.sort.length > 10) throw fail('Choose 1–10 sort fields.');
    for (const field of config.sort) {
      if (!object(field)) throw fail('Each sort field needs a field, direction and type.');
      pathParts(field.field, 'Sort field');
      choose(field.direction || 'asc', ['asc', 'desc'], 'Sort direction');
      if (!SORT_TYPES.has(field.type || 'auto')) throw fail('Choose a supported sort type.');
      choose(field.nulls || 'last', ['first', 'last'], 'Missing value order');
    }
}

function execute({ config, input, context, helpers, output, source_items, push, perItem, abort }) {
    const values = input.map((item, index) => ({ item, index, values: config.sort.map(field => sortValue(get(item, field.field), field.type || 'auto')) }));
    for (const [column, field] of config.sort.entries()) if ((field.type || 'auto') === 'auto') {
      const types = new Set(values.map(item => item.values[column]).filter(value => value !== null).map(value => typeof value));
      if (types.size > 1) throw fail(`Sort field ${field.field} contains mixed types. Choose consistent typed input.`);
    }
    values.sort((left, right) => {
      for (const [index, field] of config.sort.entries()) {
        const a = left.values[index], b = right.values[index];
        if (a === b) continue;
        if (a === null || b === null) return (a === null ? -1 : 1) * (field.nulls === 'first' ? 1 : -1);
        return (a < b ? -1 : 1) * (field.direction === 'desc' ? -1 : 1);
      }
      return left.index - right.index;
    });
    for (const item of values) push(item.item, [item.index]);
}

module.exports = { compile, execute };
