const Ajv = require('ajv');
const Ajv2019 = require('ajv/dist/2019');
const Ajv2020 = require('ajv/dist/2020');
const { createHash } = require('node:crypto');

const cache = new Map();
const MAX_SCHEMA_BYTES = 64 * 1024, MAX_CACHED_SCHEMAS = 64;
const field = value => typeof value === 'string' ? value.slice(0, 255) : undefined;

function boundedSchema(schema) {
  let nodes = 0;
  const visit = (value, depth = 0) => {
    if (++nodes > 4000 || depth > 24) throw new Error('Schema complexity exceeded');
    if (!value || typeof value !== 'object') return;
    if (value.$async || ['$ref', '$dynamicRef'].some(key => typeof value[key] === 'string' && !value[key].startsWith('#'))) throw new Error('External or async schemas are unsupported');
    for (const child of Object.values(value)) if (Array.isArray(child)) child.forEach(item => visit(item, depth + 1)); else visit(child, depth + 1);
  };
  visit(schema);
  const encoded = JSON.stringify(schema);
  if (!encoded || Buffer.byteLength(encoded, 'utf8') > MAX_SCHEMA_BYTES) throw new Error('Schema size exceeded');
  return encoded;
}

function schemaAt(schema, pointer) {
  let value = schema;
  for (const key of String(pointer || '').replace(/^#\/?/, '').split('/').filter(Boolean)) value = value?.[key.replace(/~1/g, '/').replace(/~0/g, '~')];
  return value;
}

function safeIssue(error, schema) {
  const result = { path: field(error.instancePath) || '', keyword: field(error.keyword), schema_path: field(error.schemaPath) };
  if (typeof error.params?.missingProperty === 'string') result.missing_property = field(error.params.missingProperty);
  if (typeof error.params?.additionalProperty === 'string') result.additional_property = field(error.params.additionalProperty);
  if (error.keyword === 'not') {
    const rule = schemaAt(schema, error.schemaPath);
    if (Array.isArray(rule?.required) && rule.required.every(key => typeof key === 'string')) result.forbidden_combination = rule.required.slice(0, 20).map(field);
  }
  return result;
}

/** Discovery controls shape only. No coercion, default insertion, argument
 * removal, remote schema fetch or access grant occurs here. Errors deliberately
 * omit data, expected values and validator messages that may quote arguments. */
function toolArgumentIssues(schema, args) {
  try {
    const encoded = boundedSchema(schema), key = createHash('sha256').update(encoded).digest('hex');
    let validate = cache.get(key);
    if (!validate) {
      const revision=String(schema?.$schema || '');
      const Constructor = /2020-12/.test(revision) ? Ajv2020 : /2019-09/.test(revision) ? Ajv2019 : Ajv;
      validate = new Constructor({ strict: false, allErrors: true, validateFormats: false, ownProperties: true, coerceTypes: false, useDefaults: false, removeAdditional: false, messages: false, addUsedSchema: false }).compile(schema);
      if (cache.size >= MAX_CACHED_SCHEMAS) cache.delete(cache.keys().next().value);
      cache.set(key, validate);
    }
    return validate(args) ? [] : (validate.errors || []).slice(0, 16).map(error => safeIssue(error, schema));
  } catch {
    return [{ path: '', keyword: 'unsupported_or_invalid_tool_schema' }];
  }
}

module.exports = { toolArgumentIssues };
