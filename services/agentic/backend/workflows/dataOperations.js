const CATALOG = require('../../shared/workflowDataOperations.json');

const OPERATIONS = new Set(Object.keys(CATALOG));
const MAX_ITEMS = 1000;
const MAX_BYTES = 128 * 1024;
const MAX_CONFIG_BYTES = 16 * 1024;
const RESERVED = new Set(['__proto__', 'prototype', 'constructor']);
const SORT_TYPES = new Set(['auto', 'string', 'number', 'boolean', 'date']);

function fail(message) {
  return Object.assign(new Error(message), { publicMessage: message, statusCode: 422, code: 'WORKFLOW_DATA_INVALID', retryable: false });
}
function object(value) { return value != null && typeof value === 'object' && !Array.isArray(value); }
function pathParts(value, label = 'Field') {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 512)
    throw fail(`${label} must be a non-empty dot-separated field path.`);
  const parts = value.split('.');
  if (parts.length > 12 || parts.some(part => !part || RESERVED.has(part)))
    throw fail(`${label} must use at most 12 path segments without reserved keys.`);
  return parts;
}
function get(root, path) {
  return pathParts(path).reduce((value, key) => value != null && Object.hasOwn(value, key) ? value[key] : undefined, root);
}
function set(root, path, value) {
  const parts = pathParts(path);
  let target = root;
  for (const part of parts.slice(0, -1)) {
    if (!Object.hasOwn(target, part)) target[part] = {};
    if (!object(target[part])) throw fail(`Field ${path} conflicts with an existing non-object parent.`);
    target = target[part];
  }
  target[parts.at(-1)] = value;
}
function remove(root, path) {
  const parts = pathParts(path);
  let target = root;
  for (const part of parts.slice(0, -1)) {
    if (target == null || !Object.hasOwn(target, part)) return;
    target = target[part];
  }
  if (target != null && typeof target === 'object') delete target[parts.at(-1)];
}
function checkSize(value, label, max = MAX_BYTES) {
  let serialized;
  try { serialized = JSON.stringify(value); }
  catch { throw fail(`${label} must be serializable JSON.`); }
  if (serialized === undefined || Buffer.byteLength(serialized) > max) throw fail(`${label} exceeds its ${max / 1024} KB limit.`);
  return serialized;
}
function assertJson(value) {
  const pending = [{ value, depth: 0 }];
  while (pending.length) {
    const { value: item, depth } = pending.pop();
    if (depth > 32) throw fail('Data nesting exceeds 32 levels.');
    if (item === null || typeof item === 'string' || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) continue;
    if (typeof item !== 'object') throw fail('Data operations require JSON values without undefined or non-finite numbers.');
    if (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item))) throw fail('Data operations require plain JSON objects.');
    for (const value of Object.values(item)) pending.push({ value, depth: depth + 1 });
  }
}
function clone(value, depth = 0) {
  if (depth > 32) throw fail('Data nesting exceeds 32 levels.');
  if (Array.isArray(value)) return value.map(item => clone(item, depth + 1));
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item, depth + 1)]));
  return value;
}
function json(value, label, expected) {
  let parsed;
  try { parsed = typeof value === 'string' ? JSON.parse(value) : value; }
  catch { throw fail(`${label} must be valid JSON.`); }
  if (expected === 'object' ? !object(parsed) : !Array.isArray(parsed)) throw fail(`${label} must be a JSON ${expected}.`);
  checkSize(parsed, label, MAX_CONFIG_BYTES);
  return parsed;
}
function choose(value, choices, label) {
  if (!choices.includes(value)) throw fail(`${label} must be one of: ${choices.join(', ')}.`);
  return value;
}
function flag(value, fallback, label) {
  if (value == null) return fallback;
  if (typeof value !== 'boolean') throw fail(`${label} must be true or false.`);
  return value;
}
function fields(value, { required = false } = {}) {
  const parsed = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',').map(item => item.trim()).filter(Boolean) : value == null ? [] : null;
  if (!parsed || parsed.length > 30 || (required && !parsed.length)) throw fail('Choose 1–30 fields.');
  for (const field of parsed) pathParts(field);
  if (new Set(parsed).size !== parsed.length) throw fail('Field paths must be unique.');
  return parsed;
}
function projection(item, include, selected) {
  if (include === 'all') return clone(item);
  if (include === 'none') return {};
  if (!object(item)) throw fail('Selected field projection requires object items.');
  if (include === 'allExcept') {
    const result = clone(item);
    for (const field of selected) remove(result, field);
    return result;
  }
  const result = {};
  for (const field of selected) {
    const value = get(item, field);
    if (value !== undefined) set(result, field, clone(value));
  }
  return result;
}
function assertMapping(value, depth = 0) {
  if (depth > 12) throw fail('Field mapping is too deeply nested.');
  if (Array.isArray(value)) return value.forEach(item => assertMapping(item, depth + 1));
  if (object(value)) {
    const names = [];
    for (const [key, item] of Object.entries(value)) {
      pathParts(key, 'Mapping field');
      if (names.some(name => name.startsWith(key + '.') || key.startsWith(name + '.'))) throw fail('Mapping field paths must not overlap.');
      names.push(key);
      assertMapping(item, depth + 1);
    }
  }
  // Validate variable paths even when an empty item list would skip execution.
  if (typeof value === 'string' && /^\$(input|request|item|nodes|iteration)(\.|$)/.test(value)) pathParts(value.slice(1), 'Mapping source');
}
function comparisons(value, combinator, helpers) {
  const conditions = json(value, 'Conditions', 'array');
  if (!conditions.length || conditions.length > 20 || conditions.some(item => !object(item) || item.conditions != null)) throw fail('Use 1–20 simple conditions.');
  choose(combinator || 'all', ['all', 'any'], 'Condition combination');
  for (const item of conditions) {
    if (item.conditionPath != null && typeof item.conditionPath !== 'string') throw fail('Condition path must be a dot-separated path.');
    if (item.conditionValue != null && typeof item.conditionValue !== 'string') throw fail('Comparison value must be JSON text (quote text values).');
    pathParts((item.conditionPath || 'input.status').replace(/^\$/, ''), 'Condition path');
    // The shared condition helper validates operators and JSON comparison values.
    helpers.condition(item, {});
  }
  return { conditions, conditionCombinator: combinator || 'all' };
}
function compile(raw, helpers) {
  const operation = raw.dataOperation;
  if (!OPERATIONS.has(operation)) throw fail('Choose a supported data operation.');
  const data = { ...CATALOG[operation].defaults, ...raw };
  const source = data.dataSourceKey || 'input';
  if (typeof source !== 'string') throw fail('Items path must be a dot-separated path.');
  pathParts(source.replace(/^\$/, ''), 'Items path');
  const config = { operation, source };
  if (operation === 'editFields') {
    config.mapping = json(data.dataMapping, 'Field mapping', 'object');
    assertMapping(config.mapping);
    config.keep = flag(data.dataKeepOtherFields, true, 'Keep other fields');
  } else if (operation === 'splitOut') {
    pathParts(data.dataSplitField, 'Array field'); pathParts(data.dataDestinationField, 'Destination field');
    config.field = data.dataSplitField; config.destination = data.dataDestinationField;
    config.include = choose(data.dataIncludeFields, ['none', 'all', 'selected'], 'Parent fields');
    config.fields = fields(data.dataFields, { required: config.include === 'selected' });
  } else if (operation === 'aggregate') {
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
  } else if (operation === 'limit') {
    config.limit = Number(data.dataLimit);
    if (!(typeof data.dataLimit === 'number' || typeof data.dataLimit === 'string' && /^\d+$/.test(data.dataLimit)) || !Number.isInteger(config.limit) || config.limit < 0 || config.limit > MAX_ITEMS) throw fail(`Limit must be an integer between 0 and ${MAX_ITEMS}.`);
    config.keep = choose(data.dataKeep, ['first', 'last'], 'Keep items');
  } else if (operation === 'sort') {
    config.sort = json(data.dataSortFields, 'Sort fields', 'array');
    if (!config.sort.length || config.sort.length > 10) throw fail('Choose 1–10 sort fields.');
    for (const field of config.sort) {
      if (!object(field)) throw fail('Each sort field needs a field, direction and type.');
      pathParts(field.field, 'Sort field');
      choose(field.direction || 'asc', ['asc', 'desc'], 'Sort direction');
      if (!SORT_TYPES.has(field.type || 'auto')) throw fail('Choose a supported sort type.');
      choose(field.nulls || 'last', ['first', 'last'], 'Missing value order');
    }
  } else if (operation === 'removeDuplicates') {
    config.compare = choose(data.dataCompare, ['all', 'selected', 'allExcept'], 'Duplicate comparison');
    config.fields = fields(data.dataFields, { required: config.compare !== 'all' });
  } else if (operation === 'filter') config.comparison = comparisons(data.dataConditions, data.dataConditionCombinator, helpers);
  else if (operation === 'switch') {
    config.routes = json(data.dataRoutes, 'Routes', 'array');
    if (!config.routes.length || config.routes.length > 10) throw fail('Choose 1–10 routes.');
    const ids = new Set();
    config.routes = config.routes.map(route => {
      if (!object(route) || typeof route.id !== 'string' || !/^[a-zA-Z][\w-]{0,63}$/.test(route.id) || RESERVED.has(route.id) || route.id === 'fallback' || ids.has(route.id)) throw fail('Use unique route IDs starting with a letter; fallback is reserved.');
      ids.add(route.id);
      return { id: route.id, ...comparisons(route.conditions, route.conditionCombinator, helpers) };
    });
    config.all = flag(data.dataRouteAll, false, 'Send to all matching routes');
    config.fallback = choose(data.dataFallback, ['none', 'fallback', 'first'], 'Fallback route');
  }
  return config;
}
function validate(data, helpers) { compile(data, helpers); }
function dateValue(value) {
  if (typeof value !== 'string') return NaN;
  // A time without an explicit zone would sort differently on remote hosts.
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d))?$/.exec(value);
  if (!match) return NaN;
  const calendar = new Date(0);
  calendar.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (calendar.getUTCFullYear() !== Number(match[1]) || calendar.getUTCMonth() !== Number(match[2]) - 1 || calendar.getUTCDate() !== Number(match[3])) return NaN;
  return Date.parse(value);
}
function sortValue(value, type) {
  if (value == null) return null;
  if (type === 'auto') {
    if (typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' || typeof value === 'boolean') return value;
    throw fail('Automatic sort requires string, number or boolean field values.');
  }
  if (type === 'number' && typeof value === 'number' && Number.isFinite(value)) return value;
  if (type === 'string' && typeof value === 'string') return value;
  if (type === 'boolean' && typeof value === 'boolean') return value;
  if (type === 'date' && Number.isFinite(dateValue(value))) return dateValue(value);
  throw fail(`Sort values must match the configured ${type} type.`);
}
function stableKey(value) {
  if (value === undefined) return ['missing'];
  if (value === null || typeof value !== 'object') return [typeof value, value];
  if (Array.isArray(value)) return ['array', value.map(stableKey)];
  return ['object', Object.keys(value).sort().map(key => [key, stableKey(value[key])])];
}
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
  if (config.operation === 'editFields') input.forEach((item, index) => {
    abort();
    if (config.keep && !object(item)) throw fail('Keep other fields requires object items. Turn it off to map primitive items.');
    const result = config.keep ? clone(item) : {};
    const mapped = helpers.mapValues(config.mapping, perItem(item, index));
    for (const [field, value] of Object.entries(mapped)) set(result, field, clone(value));
    push(result, [index]);
  });
  else if (config.operation === 'splitOut') input.forEach((item, index) => {
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
  else if (config.operation === 'aggregate') {
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
  } else if (config.operation === 'limit') {
    const start = config.keep === 'last' ? Math.max(0, input.length - config.limit) : 0;
    const end = config.keep === 'last' ? input.length : Math.min(config.limit, input.length);
    for (let index = start; index < end; index++) push(input[index], [index]);
  } else if (config.operation === 'sort') {
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
  } else if (config.operation === 'removeDuplicates') {
    const seen = new Map();
    input.forEach((item, index) => {
      abort();
      const compared = config.compare === 'selected' ? config.fields.map(field => get(item, field)) : projection(item, config.compare === 'allExcept' ? 'allExcept' : 'all', config.fields);
      const key = JSON.stringify(stableKey(compared));
      if (seen.has(key)) source_items[index].output_indexes.push(seen.get(key));
      else { seen.set(key, output.length); push(item, [index]); }
    });
  } else if (config.operation === 'filter') input.forEach((item, index) => {
    abort();
    if (helpers.condition(config.comparison, perItem(item, index))) push(item, [index]);
  });
  else if (config.operation === 'switch') {
    const routes = Object.fromEntries(config.routes.map(route => [route.id, []]));
    if (config.fallback === 'fallback') routes.fallback = [];
    const route_items = Object.fromEntries(Object.keys(routes).map(id => [id, []]));
    input.forEach((item, index) => {
      abort();
      // Evaluate every rule before selecting first/all so invalid comparisons
      // cannot be hidden by a prior match.
      const matched = config.routes.filter(route => helpers.condition(route, perItem(item, index)));
      let ids = (config.all ? matched : matched.slice(0, 1)).map(route => route.id);
      if (!ids.length && config.fallback !== 'none') ids = [config.fallback === 'first' ? config.routes[0].id : 'fallback'];
      if (ids.length) push(item, [index]);
      for (const id of ids) { route_items[id].push(index); routes[id].push(clone(item)); }
    });
    const result = { data: output, operation: config.operation, input_count: input.length, item_count: output.length, routed_count: Object.values(routes).reduce((sum, items) => sum + items.length, 0), source_items, routes, route_items };
    checkSize(result, 'Output data');
    return result;
  }
  const result = { data: output, operation: config.operation, input_count: input.length, item_count: output.length, source_items };
  checkSize(result, 'Output data');
  return result;
}

module.exports = { CATALOG, OPERATIONS, MAX_ITEMS, MAX_BYTES, validate, execute, _internals: { pathParts, stableKey } };
