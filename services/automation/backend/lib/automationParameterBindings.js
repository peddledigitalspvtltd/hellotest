const { parameterReference, referenceKey } = require('./automationBrowserParameters');

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = () => Object.assign(new Error('The original manual requirements could not be bound to the fixed build parameter names.'), {
  code: 'AUTOMATION_PARAMETER_BINDINGS_INVALID', statusCode: 422, nonRetryable: true
});
const canonicalName = value => typeof value === 'string' && value.length <= 220
  && /^[tsr]\./.test(value) && referenceKey(parameterReference(value)) === value;

/** Preserve which ORIGINAL authored field used each fixed parameter. Public or
 * empty data can remove @tokens from projected prose. Never recover provenance
 * by scanning that projected prose or an inserted value a second time.
 * The supplied host resolver owns legacy @name -> exact t/r alias decisions. */
function buildAutomationParameterBindings({ obligations, referencedParameterNames } = {}) {
  if (!Array.isArray(obligations) || obligations.length > 201 || typeof referencedParameterNames !== 'function') throw invalid();
  const seen = new Set(), result = [];
  for (const row of obligations) {
    if (!record(row) || typeof row.id !== 'string' || !row.id || row.id.length > 4000 || seen.has(row.id)
      || typeof row.action !== 'string' || typeof row.expected_result !== 'string') throw invalid();
    seen.add(row.id);
    const names = field => {
      const selected = referencedParameterNames([{ action: '', expected_result: '', [field]: row[field] }]);
      if (!Array.isArray(selected) || selected.length > 2000 || selected.some(name => !canonicalName(name))) throw invalid();
      return [...new Set(selected)].sort();
    };
    const action = names('action'), expected = names('expected_result');
    if (action.length || expected.length) result.push({ obligation_id: row.id, action_parameters: action, expected_result_parameters: expected });
  }
  return result;
}

/** Validate symbolic hints against the already-authorized pinned IDs and fixed
 * parameter inventory. Hints select names; they disclose no values or grants. */
function validateAutomationParameterBindings({ bindings, obligations, values } = {}) {
  if (!Array.isArray(bindings) || bindings.length > 201 || !Array.isArray(obligations) || !record(values)) throw invalid();
  const byId = new Map(), authorized = new Set(obligations.map(row => row.id));
  for (const row of bindings) {
    if (!record(row) || Object.keys(row).length !== 3 || !['obligation_id', 'action_parameters', 'expected_result_parameters'].every(key => Object.hasOwn(row, key))
      || !authorized.has(row.obligation_id) || byId.has(row.obligation_id)) throw invalid();
    for (const key of ['action_parameters', 'expected_result_parameters']) {
      const selected = row[key];
      if (!Array.isArray(selected) || selected.length > 2000 || new Set(selected).size !== selected.length
        || selected.some(name => !canonicalName(name) || !Object.hasOwn(values, name))) throw invalid();
    }
    if (!row.action_parameters.length && !row.expected_result_parameters.length) throw invalid();
    byId.set(row.obligation_id, { obligation_id: row.obligation_id, action_parameters: [...row.action_parameters].sort(), expected_result_parameters: [...row.expected_result_parameters].sort() });
  }
  return obligations.filter(row => byId.has(row.id)).map(row => byId.get(row.id));
}

module.exports = { buildAutomationParameterBindings, validateAutomationParameterBindings };
