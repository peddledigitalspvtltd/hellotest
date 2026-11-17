// Shared admission, JSON limits and provenance surround actual per-action owners.
const strategies = require('./nodes/data');
const { CATALOG, OPERATIONS, MAX_ITEMS, MAX_BYTES, fail, pathParts, checkSize, assertJson, clone, stableKey } = require('./nodes/shared/dataValues');

function compile(raw, helpers) {
  const operation = raw.dataOperation;
  if (!OPERATIONS.has(operation)) throw fail('Choose a supported data operation.');
  const data = { ...CATALOG[operation].defaults, ...raw };
  const source = data.dataSourceKey || 'input';
  if (typeof source !== 'string') throw fail('Items path must be a dot-separated path.');
  pathParts(source.replace(/^\$/, ''), 'Items path');
  const config = { operation, source };
  strategies[operation].compile(data, helpers, config);
  return config;
}

function validate(data, helpers) { compile(data, helpers); }

function execute(data, context, helpers) {
  const config = compile(data, helpers);
  const input = helpers.readPath(context, config.source);
  if (!Array.isArray(input)) throw fail('Items path must resolve to an array. Choose an array field or use the Map JSON node to wrap a single object.');
  if (input.length > MAX_ITEMS) throw fail(`Data operations support at most ${MAX_ITEMS} input items.`);
  checkSize(input, 'Input data');
  assertJson(input);
  const source_items = input.map((_, input_index) => ({ input_index, output_indexes: [] }));
  const output = [];
  let outputBytes = 2;
  const push = (value, indexes) => {
    if (output.length >= MAX_ITEMS) throw fail(`Data operations support at most ${MAX_ITEMS} output items.`);
    outputBytes += Buffer.byteLength(checkSize(value, 'Output item')) + 1;
    if (outputBytes > MAX_BYTES) throw fail('Output data exceeds its 128 KB limit.');
    const index = output.length;
    output.push(clone(value));
    for (const source of indexes) source_items[source].output_indexes.push(index);
  };
  const perItem = (item, index) => ({ ...context, input: item, item, iteration: { index, number: index + 1, total: input.length } });
  const abort = () => { if (helpers.signal?.aborted) throw Object.assign(fail('Data operation cancelled.'), { statusCode: 499 }); };
  abort();
  const routed = strategies[config.operation].execute({config,input,context,helpers,output,source_items,push,perItem,abort});
  if (routed) return routed;
  const result = { data: output, operation: config.operation, input_count: input.length, item_count: output.length, source_items };
  checkSize(result, 'Output data');
  return result;
}

module.exports = { CATALOG, OPERATIONS, MAX_ITEMS, MAX_BYTES, validate, execute, _internals: { pathParts, stableKey } };
