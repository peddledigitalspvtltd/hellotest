const CATALOG = require('../../../../shared/workflowDataOperations.json');

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

module.exports = { CATALOG, OPERATIONS, MAX_ITEMS, MAX_BYTES, MAX_CONFIG_BYTES, RESERVED, SORT_TYPES, fail, object, pathParts, get, set, remove, checkSize, assertJson, clone, json, choose, flag, fields, projection, assertMapping, comparisons, dateValue, sortValue, stableKey };
