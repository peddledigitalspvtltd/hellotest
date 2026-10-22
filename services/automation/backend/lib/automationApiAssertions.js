const Ajv = require('ajv');
const ajv = new Ajv({ allErrors: true, strict: true });

function compare(actual, expected, operator = 'eq') {
  const equal = JSON.stringify(actual) === JSON.stringify(expected);
  switch (operator) {
    case 'eq': return equal;
    case 'ne': return !equal;
    case 'exists': return actual !== undefined;
    case 'contains': return typeof actual === 'string' ? actual.includes(String(expected)) : Array.isArray(actual) && actual.some(value => JSON.stringify(value) === JSON.stringify(expected));
    case 'lt': return typeof actual === 'number' && Number.isFinite(actual) && typeof expected === 'number' && Number.isFinite(expected) && actual < Number(expected);
    case 'lte': return typeof actual === 'number' && Number.isFinite(actual) && typeof expected === 'number' && Number.isFinite(expected) && actual <= Number(expected);
    case 'gt': return typeof actual === 'number' && Number.isFinite(actual) && typeof expected === 'number' && Number.isFinite(expected) && actual > Number(expected);
    case 'gte': return typeof actual === 'number' && Number.isFinite(actual) && typeof expected === 'number' && Number.isFinite(expected) && actual >= Number(expected);
    default: throw new Error(`Unsupported API assertion operator: ${operator}.`);
  }
}

function validateJsonSchema(body, source) {
  try {
    const schema = JSON.parse(source);
    if (!schema || typeof schema !== 'object' || Array.isArray(schema) || !Object.keys(schema).length) return { passed: false, summary: 'Provide a nonempty JSON Schema object.' };
    const valid = ajv.validate(schema, body);
    return { passed: Boolean(valid), summary: valid ? 'Response matches the JSON Schema.' : `Response does not match the JSON Schema: ${ajv.errorsText(ajv.errors, { dataVar: 'response' })}` };
  } catch { return { passed: false, summary: 'The response JSON Schema is invalid or uses an unsupported schema feature.' }; }
}

function evaluateExtendedApiAssertion(preview, validation) {
  const { kind, target, expected, operator } = validation;
  const response = preview.response;
  if (kind === 'json_schema') {
    try { JSON.parse(response.body_text); } catch { return {passed:false,summary:'Response body is not valid JSON for schema validation.',actual:null}; }
    return { ...validateJsonSchema(response.body_json, expected || target || ''), actual: null };
  }
  if (kind === 'header_present') return { passed: Object.prototype.hasOwnProperty.call(response.headers, String(target || 'content-type').toLowerCase()), actual: response.headers[String(target || 'content-type').toLowerCase()] ?? null, summary: Object.prototype.hasOwnProperty.call(response.headers, String(target || 'content-type').toLowerCase()) ? 'The response contains the expected header.' : `The response is missing header ${target || 'content-type'}.` };
  if (kind === 'body_not_contains') return { passed: !String(response.body_text).includes(expected || ''), actual: String(response.body_text), summary: 'Checked that the response omits the specified text.' };
  if (kind === 'response_time') return { passed: compare(response.duration_ms, Number(expected), operator || 'lte'), actual: String(response.duration_ms), summary: `Response took ${response.duration_ms} ms; expected ${operator || 'lte'} ${expected} ms.` };
  return null;
}

module.exports = { compare, validateJsonSchema, evaluateExtendedApiAssertion };
