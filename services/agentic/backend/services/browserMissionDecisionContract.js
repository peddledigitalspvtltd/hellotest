// The provider may constrain shape; live observation validation still authorizes
// every target, quoted fact and action immediately before browser dispatch.
const string = (maxLength, minLength = 1) => ({ type: 'string', minLength, maxLength });
const object = properties => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const outcome = object({
  title: string(255), summary: string(4000),
  columns: { type: 'array', maxItems: 6, items: string(120) },
  rows: { type: 'array', maxItems: 20, items: object({
    cells: { type: 'array', minItems: 1, maxItems: 6, items: string(600, 0) },
    evidence: object({ sequence: { type: 'integer', minimum: 1, maximum: 12 }, quote: string(500) })
  }) }
});
const properties = {
  action: { type: 'string', enum: ['click', 'fill', 'select', 'press', 'navigate', 'extract', 'complete', 'blocked', 'scroll', 'hover', 'wait', 'back', 'assert_text'] },
  summary: string(1200), element_id: nullable(string(20)), value: nullable(string(500, 0)),
  key: nullable({ type: 'string', enum: ['Enter', 'Tab', 'Escape', 'ArrowDown', 'ArrowUp'] }),
  url: nullable(string(2000)), direction: nullable({ type: 'string', enum: ['up', 'down'] }),
  text: nullable(string(500)), outcome: nullable(outcome)
};
const SCHEMA = { type: 'object', additionalProperties: false, properties, required: ['action', 'summary'], allOf: [
  { if: { properties: { action: { enum: ['extract', 'complete'] } } }, then: { required: ['outcome'], properties: { outcome } } },
  { if: { properties: { action: { enum: ['click', 'fill', 'select', 'press', 'hover'] } } }, then: { required: ['element_id'], properties: { element_id: string(20) } } },
  { if: { properties: { action: { enum: ['fill', 'select'] } } }, then: { required: ['value'], properties: { value: string(500, 0) } } },
  ...[['navigate', 'url'], ['press', 'key'], ['scroll', 'direction'], ['assert_text', 'text']].map(([action, field]) => ({
    if: { properties: { action: { enum: [action] } } }, then: { required: [field], properties: { [field]: properties[field].anyOf[0] } }
  }))
] };
// OpenAI's strict subset requires every property and omits numeric/string limits
// and conditional keywords. The complete SCHEMA remains the admission contract.
const providerSchema = value => Array.isArray(value) ? value.map(providerSchema) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).filter(([key]) => !['minLength', 'maxLength', 'minimum', 'maximum', 'allOf'].includes(key)).map(([key, item]) => [key, providerSchema(item)])) : value;
const PROVIDER_SCHEMA = providerSchema({ ...SCHEMA, required: Object.keys(properties) });
module.exports = { SCHEMA, PROVIDER_SCHEMA, providerSchema };
