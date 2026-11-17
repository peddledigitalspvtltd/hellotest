// aggregate: owns operation-specific validation and transformation.
const { fail, object, pathParts, get, set, clone, json, choose, flag, fields, projection } = require('../shared/dataValues');

function compile(data, helpers, config) {
  config.mode = choose(data.dataAggregateMode, ['all', 'fields'], 'Aggregate mode');
    pathParts(data.dataOutputField, 'Output field'); config.output = data.dataOutputField;
  config.include = choose(data.dataIncludeFields, ['all', 'selected', 'allExcept'], 'Included fields');
  config.fields = fields(data.dataFields, { required: config.include !== 'all' });
  config.merge = flag(data.dataMergeLists, false, 'Merge lists');
  config.keepMissing = flag(data.dataKeepMissing, false, 'Keep missing values');
    if (config.mode === 'fields') {
      config.aggregates = json(data.dataAggregateFields, 'Aggregate fields', 'array');
      if (!config.aggregates.length || config.aggregates.length > 30) throw fail('Choose 1–30 fields to aggregate.');
      const outputs = [];
      for (const item of config.aggregates) {
        if (!object(item)) throw fail('Each aggregate field needs a field and an outputField.');
        pathParts(item.field, 'Aggregate input field'); pathParts(item.outputField, 'Aggregate output field');
        if (outputs.some(output => output === item.outputField || output.startsWith(item.outputField + '.') || item.outputField.startsWith(output + '.'))) throw fail('Aggregate output fields must not overlap.');
        outputs.push(item.outputField);
      }
    }
}

function execute({ config, input, context, helpers, output, source_items, push, perItem, abort }) {
    const result = {};
    if (config.mode === 'all') set(result, config.output, input.map(item => projection(item, config.include, config.fields)));
    else for (const field of config.aggregates) {
      const values = [];
      for (const item of input) {
        const value = get(item, field.field);
        if (value == null && !config.keepMissing) continue;
        if (config.merge && Array.isArray(value)) values.push(...clone(value));
        else values.push(value == null ? null : clone(value));
      }
      set(result, field.outputField, values);
    }
    push(result, input.map((_, index) => index));
}

module.exports = { compile, execute };
