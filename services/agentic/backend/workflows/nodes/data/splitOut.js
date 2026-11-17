// splitOut: owns operation-specific validation and transformation.
const { fail, object, pathParts, get, set, remove, clone, choose, fields, projection } = require('../shared/dataValues');

function compile(data, helpers, config) {
    pathParts(data.dataSplitField, 'Array field'); pathParts(data.dataDestinationField, 'Destination field');
  config.field = data.dataSplitField; config.destination = data.dataDestinationField;
  config.include = choose(data.dataIncludeFields, ['none', 'all', 'selected'], 'Parent fields');
  config.fields = fields(data.dataFields, { required: config.include === 'selected' });
}

function execute({ config, input, context, helpers, output, source_items, push, perItem, abort }) {
  input.forEach((item, index) => {
    abort();
    const values = get(item, config.field);
    if (!Array.isArray(values)) throw fail(`Split Out requires an array at ${config.field} for every input item.`);
    for (const value of values) {
      const result = projection(item, config.include, config.fields);
      if (!object(result)) throw fail('Split Out parent fields require object items.');
      remove(result, config.field);
      set(result, config.destination, clone(value));
      push(result, [index]);
    }
  });
}

module.exports = { compile, execute };
