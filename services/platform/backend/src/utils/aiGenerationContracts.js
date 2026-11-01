// These schemas describe code-owned application fields and allowed values.
// Behavioral guidance belongs to AI Controls; labels are serialized as data.
const { normalizeParameterKey } = require('./stepParameterResolution');
const string = { type: 'string' };
const parameters = { type: 'object', maxProperties: 100, additionalProperties: string };
const step = { type: 'object', required: ['action', 'expected_result'], properties: {
  step_order: { type: 'integer', minimum: 1 }, step_type: { enum: ['web', 'api', 'android', 'ios'] },
  action: { type: 'string', minLength: 1 }, expected_result: { type: 'string', minLength: 1 }
} };
function caseOutputSchema(mode = 'structured', { count, refs, testCaseTypes } = {}) {
  const properties = { title: { type: 'string', minLength: 1, maxLength: 255 }, description: { type: 'string', minLength: 1 },
    priority: { type: 'integer', minimum: 1, maximum: 5 }, test_case_type: testCaseTypes?.length ? { enum: testCaseTypes } : { type: 'string', minLength: 1 },
    authoring_mode: { enum: [mode] }, parameter_values: parameters, steps: { type: 'array', minItems: mode === 'gherkin' ? 0 : 1, maxItems: 30, items: step },
    gherkin_document: mode === 'gherkin' ? { type: 'string', minLength: 1 } : { type: ['string', 'null'] } };
  const required = ['title', 'description', 'priority', 'test_case_type', 'parameter_values', mode === 'gherkin' ? 'gherkin_document' : 'steps'];
  if (count != null) {
    properties.requirement_refs = { type: 'array', minItems: refs?.length ? 1 : 0, maxItems: refs?.length || 0, items: refs?.length ? { type: 'string', enum: refs } : { type: 'string' } };
    return { type: 'object', required: ['testCases'], properties: { applicable_domain: string, testCases: { type: 'array', minItems: 1, maxItems: count, items: { type: 'object', required: [...required, 'requirement_refs'], properties } } } };
  }
  properties.summary = string;
  return { type: 'object', required, properties };
}
function stepOutputSchema() {
  return { type: 'object', required: ['action', 'expected_result'], properties: { summary: string, action: { type: 'string', minLength: 1 }, expected_result: { type: 'string', minLength: 1 } } };
}
const nativeContracts = Object.freeze({
  'ai.requirement.creation': { collection: 'requirements', required: ['title', 'description', 'acceptance_criteria', 'priority'], nonempty_arrays: ['acceptance_criteria'] },
  'ai.requirement.optimization': { required: ['title', 'description', 'acceptance_criteria', 'priority'], nonempty_arrays: ['acceptance_criteria'] },
  'ai.case_authoring.full_case': { required: ['title', 'description', 'priority', 'test_case_type', 'parameter_values'], structured_required: ['steps'], gherkin_required: ['gherkin_document'] },
  'ai.test_case.design': { collection: 'testCases', aliases: ['test_cases'], required: ['title', 'description', 'priority', 'test_case_type', 'parameter_values'], structured_required: ['steps'], gherkin_required: ['gherkin_document'] },
  'ai.bug.draft': { object: 'draft', required: ['title', 'message', 'steps_to_reproduce', 'expected_result', 'actual_result', 'severity', 'priority'] },
  'ai.bug.triage': { collection: 'recommendations', required: ['issue_id', 'category', 'category_explanation', 'category_evidence_refs'] },
  'ai.execution.smart_plan': { collection: 'cases', required: ['test_case_id', 'reason', 'evidence_refs'] }
});
const isObject = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const parameterPattern = /(?<![A-Za-z0-9_])@([tsr])\.(\[(?:\\.|[^\]\\\r\n])+\]|[A-Za-z][A-Za-z0-9_-]*)/gi;
// These native aliases materialize synthetic values through testDataGenerators,
// rather than looking up an undeclared Test Param.
const generatedParameters = new Set(['t.random', 't.string', 't.randomstring', 't.randomnumber', 't.yopmail', 't.today', 't.timestamp']);
const references = text => [...String(text || '').matchAll(parameterPattern)].map(match => normalizeParameterKey(match[0])).filter(name => !generatedParameters.has(name));
const contractError = errors => Object.assign(new Error('The model omitted or invalidated required artifact fields. No incomplete proposal was accepted.'), {
  code: 'AI_NATIVE_CONTRACT_INVALID', statusCode: 502, validation_errors: errors.slice(0, 12)
});
function parameterIssues(item, path = '') {
  const values = item?.parameter_values;
  const errors = [];
  const invalid = (field, issue = 'required_or_invalid') => errors.push({ path, field, issue });
  if (!isObject(values)) { invalid('parameter_values'); return errors; }
  if (Object.keys(values).length > 100) { invalid('parameter_values', 'maximum_100_parameters'); return errors; }
  const normalized = new Map();
  for (const [key, value] of Object.entries(values)) {
    if (!key.trim() || /^@|^[tsr]\./i.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key.trim().toLowerCase()) || typeof value !== 'string') {
      invalid('parameter_values'); continue;
    }
    const name = normalizeParameterKey(key, 't');
    if (normalized.has(name)) invalid('parameter_values', 'duplicate_parameter_name');
    normalized.set(name, value);
  }
  const gherkin = String(item.gherkin_document || '').split('\n').filter(line => !/^\s*[@#]/.test(line)).join('\n');
  const texts = [item.title, item.description, gherkin, ...(Array.isArray(item.steps) ? item.steps.flatMap(row => [row?.action, row?.expected_result]) : [])];
  const dependencies = new Map([...normalized].map(([name, value]) => [name, references(value).filter(ref => ref.startsWith('t.'))]));
  const needed = new Set([...texts.flatMap(references), ...[...dependencies.values()].flat()].filter(ref => ref.startsWith('t.')));
  // @s and @r remain explicit external dependencies. Never fabricate their values.
  for (const name of needed) if (!normalized.has(name)) invalid(`parameter_values.${name.slice(2)}`, 'referenced_parameter_missing');
  const active = new Set(), complete = new Set();
  const visit = name => {
    if (active.has(name)) { invalid('parameter_values', 'cyclic_parameter_reference'); return; }
    if (complete.has(name)) return;
    active.add(name);
    for (const ref of dependencies.get(name) || []) if (normalized.has(ref)) visit(ref);
    active.delete(name); complete.add(name);
  };
  for (const name of dependencies.keys()) visit(name);
  return errors;
}
function validateCaseParameterBindings(item) {
  const errors = parameterIssues(item);
  if (errors.length) throw contractError(errors);
}
function validGherkinCase(document) {
  if (typeof document !== 'string') return false;
  let delimiter = '', feature = false, scenario = null, count = 0;
  const scenarios = [];
  for (const line of document.split(/\r?\n/)) {
    const value = line.trim(), marker = value.match(/^("""|```)/)?.[1];
    if (marker) { delimiter = delimiter ? delimiter === marker ? '' : delimiter : marker; continue; }
    if (delimiter || /^[@#]/.test(value)) continue;
    if (/^Feature\s*:\s*\S/i.test(value)) feature = true;
    if (/^Scenario(?: Outline| Template)?\s*:/i.test(value)) {
      scenario = { named: /^Scenario(?: Outline| Template)?\s*:\s*\S/i.test(value), action: false, outcome: false };
      scenarios.push(scenario); continue;
    }
    if (/^(?:Given|When|Then|And|But|\*)\s+\S/i.test(value)) count++;
    if (scenario && /^When\s+\S/i.test(value)) scenario.action = true;
    if (scenario && /^Then\s+\S/i.test(value) && scenario.action) scenario.outcome = true;
  }
  return feature && !delimiter && count <= 30 && scenarios.length > 0 && scenarios.every(item => item.named && item.action && item.outcome);
}
function nativeArtifactContract(id) { return nativeContracts[id] || null; }
function validateNativeArtifactOutput(id, parsed, { testCaseTypes } = {}) {
  const contract = nativeArtifactContract(id);
  if (!contract) return;
  const errors = [];
  const missing = (path, field) => errors.push({ path, field, issue: 'required_or_invalid' });
  if (!isObject(parsed)) missing('', 'object');
  let items = contract.collection ? [contract.collection, ...(contract.aliases || [])].map(key => parsed?.[key]).find(Array.isArray) : [contract.object ? parsed?.[contract.object] : parsed];
  if (!items?.length) { missing('', contract.collection || contract.object || 'object'); items = []; }
  if (items.length > 30) throw Object.assign(new Error('The model returned too many artifact items. Request a smaller scope.'), {
    code: 'AI_NATIVE_CONTRACT_INVALID', statusCode: 502, validation_errors: [{ path: contract.collection || '', field: 'max_items', issue: 'maximum_30' }]
  });
  for (const [index, item] of items.entries()) {
    const path = contract.collection ? `${contract.collection}[${index}]` : contract.object || '';
    if (!isObject(item)) { missing(path, 'object'); continue; }
    for (const field of contract.required) if (!Object.hasOwn(item, field)) missing(path, field);
    for (const field of contract.required.filter(field => !['priority', 'acceptance_criteria', 'parameter_values', 'category_evidence_refs', 'evidence_refs'].includes(field))) {
      if (typeof item[field] !== 'string' || (!['steps_to_reproduce', 'expected_result', 'actual_result', 'message'].includes(field) && !item[field].trim())) missing(path, field);
    }
    if ('title' in item && (typeof item.title !== 'string' || item.title.trim().length > 255)) missing(path, 'title');
    if ('acceptance_criteria' in item && (!Array.isArray(item.acceptance_criteria) || !item.acceptance_criteria.length || item.acceptance_criteria.some(value => typeof value !== 'string' || !value.trim()))) missing(path, 'acceptance_criteria');
    if (['ai.requirement.creation', 'ai.requirement.optimization', 'ai.case_authoring.full_case', 'ai.test_case.design'].includes(id) && (!Number.isSafeInteger(item.priority) || item.priority < 1 || item.priority > 5)) missing(path, 'priority');
    if (['ai.case_authoring.full_case', 'ai.test_case.design'].includes(id)) {
      errors.push(...parameterIssues(item, path));
      if (Array.isArray(testCaseTypes) && !testCaseTypes.includes(item.test_case_type)) missing(path, 'test_case_type');
      if (item.authoring_mode != null && !['structured', 'gherkin'].includes(item.authoring_mode)) missing(path, 'authoring_mode');
      if (item.authoring_mode === 'gherkin' || (item.authoring_mode == null && item.gherkin_document)) {
        if (!validGherkinCase(item.gherkin_document)) missing(path, 'gherkin_document');
      } else if (!Array.isArray(item.steps) || !item.steps.length || item.steps.length > 30 || item.steps.some(row => !isObject(row) || typeof row.action !== 'string' || !row.action.trim() || typeof row.expected_result !== 'string' || !row.expected_result.trim() || (row.step_type != null && !['web', 'api', 'android', 'ios'].includes(row.step_type)))) missing(path, 'steps');
    }
    if (id === 'ai.bug.draft') {
      if (!['critical', 'high', 'medium', 'low'].includes(item.severity)) missing(path, 'severity');
      if (!['Highest', 'High', 'Medium', 'Low', 'Lowest'].includes(item.priority)) missing(path, 'priority');
      for (const field of ['message', 'steps_to_reproduce', 'expected_result', 'actual_result']) if (!String(item[field] || '').trim() && !(Array.isArray(parsed.gaps) && parsed.gaps.some(gap => gap?.field === field && typeof gap.reason === 'string' && gap.reason.trim()))) missing(path, field);
    }
    for (const field of ['category_evidence_refs', 'evidence_refs'].filter(field => contract.required.includes(field))) if (!Array.isArray(item[field]) || !item[field].length || item[field].some(value => typeof value !== 'string' || !value.trim())) missing(path, field);
  }
  if (errors.length) {
    const error=contractError(errors);
    // An explicit empty proposal is an evidence/no-applicability result. The
    // caller still reports missing input; asking the model to fill it can
    // pressure it to invent evidence and incurs another paid generation.
    if(contract.collection && [contract.collection,...(contract.aliases || [])].some(key=>Array.isArray(parsed?.[key]) && parsed[key].length===0))error.empty_artifact_collection=true;
    throw error;
  }
}
module.exports = { caseOutputSchema, stepOutputSchema, nativeArtifactContract, validateNativeArtifactOutput, validateCaseParameterBindings, validGherkinCase };
