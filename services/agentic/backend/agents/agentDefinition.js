const { createHash } = require('node:crypto');
const { policy } = require('../workflows/specialistPolicy');
const { normalizeOutputContract, outcomeContract } = require('../services/agentOutcomeContracts');
const GUARDRAILS_MAX_LENGTH = 2000;
const RECORD_INPUT_KEYS = { story: 'story_id', test_case: 'test_case_id', run: 'execution_id', release: 'release_id', sprint: 'sprint_id', environment: 'environment_id' };
const validInputName = key => /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) && !['constructor','prototype','__proto__'].includes(key);
const fail = (message, code = 'AGENT_DEFINITION_INVALID', statusCode = 422) => Object.assign(new Error(message), { publicMessage: message, code, statusCode });
const text = (value, name, max, required = false) => {
  if (value != null && typeof value !== 'string') throw fail(`${name} must be text.`);
  const result = (value || '').trim();
  if ((required && !result) || result.length > max) throw fail(`${name} ${required ? 'is required and ' : ''}must be at most ${max} characters.`);
  return result;
};
const integer = (value, fallback, min, max, name) => {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < min || result > max) throw fail(`${name} must be an integer between ${min} and ${max}.`);
  return result;
};
const list = (value, name, max = 100) => {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > max || value.some(item => typeof item !== 'string' || !item.trim() || item.length > 255)) throw fail(`${name} must contain at most ${max} identifiers.`);
  return [...new Set(value.map(item => item.trim()))];
};
function normalizeGuardrails(rules) {
  if (!Array.isArray(rules) || rules.length > 3) throw fail('Choose up to three supported guardrail rules.');
  const ranges = { minimum_citations: [1, 36], maximum_drafts: [0, 8] };
  const normalized = rules.map(rule => {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule) || Object.keys(rule).some(key => !['id', 'value'].includes(key))) throw fail('Choose a supported guardrail rule.');
    if (rule.id === 'exclude_email_addresses' && rule.value === undefined) return { id: rule.id };
    if (!Object.hasOwn(ranges, rule.id)) throw fail('Choose a supported guardrail rule.');
    const [min, max] = ranges[rule.id];
    return { id: rule.id, value: integer(rule.value, min, min, max, rule.id === 'minimum_citations' ? 'Minimum citations' : 'Maximum drafts') };
  });
  if (new Set(normalized.map(rule => rule.id)).size !== normalized.length) throw fail('Select each guardrail once.');
  return normalized;
}
function normalizeLineage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['agent_id', 'descriptor_hash'].includes(key))
    || typeof value.agent_id !== 'string' || !/^[a-z][a-z0-9_-]{1,119}$/.test(value.agent_id)
    || typeof value.descriptor_hash !== 'string' || !/^[a-f0-9]{64}$/.test(value.descriptor_hash)) throw fail('Choose a valid source agent and version.');
  return { agent_id: value.agent_id, descriptor_hash: value.descriptor_hash };
}
function normalizeInputFields(fields) {
  if (!Array.isArray(fields) || fields.length > 20) throw fail('Define at most 20 task inputs.');
  const normalized = fields.map(field => {
    if (!field || typeof field !== 'object' || Array.isArray(field) || Object.keys(field).some(key => !['name', 'label', 'type', 'default', 'required'].includes(key))
      || typeof field.name !== 'string' || !validInputName(field.name) || typeof field.required !== 'boolean') throw fail('Use a valid name and required setting for each input.');
    if (typeof field.type !== 'string' || field.type !== 'text' && (!Object.hasOwn(RECORD_INPUT_KEYS, field.type) || RECORD_INPUT_KEYS[field.type] !== field.name)) throw fail('Use the standard record input name for the selected picker.');
    return { name: field.name, label: text(field.label, 'Input label', 120, true), type: field.type, required: field.required,
      ...(field.default !== undefined ? { default: text(field.default, 'Default value', 255) } : {}) };
  });
  if (new Set(normalized.map(field => field.name)).size !== normalized.length) throw fail('Use a unique name for each input.');
  return normalized;
}
function normalize(input = {}) {
  if (!input || Array.isArray(input) || typeof input !== 'object') throw fail('Provide an agent definition.');
  const allowed = new Set(['name', 'feature_id', 'description', 'objective', 'instructions', 'skills', 'allowed_tools', 'context_scopes', 'context', 'guardrails', 'guardrail_rules', 'integration_id', 'source_ids', 'source_kinds', 'required_inputs', 'input_fields', 'acceptance', 'limits', 'output_contract', 'ai_configuration', 'review_criteria', 'derived_from']);
  if (Object.keys(input).some(key => !allowed.has(key))) throw fail('Agent definition contains unsupported settings.');
  for (const key of ['acceptance', 'limits']) {
    if (input[key] != null && (typeof input[key] !== 'object' || Array.isArray(input[key]))) throw fail(`${key} must be an object.`);
  }
  const inheritedOutput = input.feature_id ? outcomeContract('', { feature_id: input.feature_id }) : null;
  const result = {
    ...(input.feature_id ? { feature_id: text(input.feature_id, 'Capability', 10) } : {}),
    name: text(input.name, 'Agent name', 120, true), description: text(input.description, 'Description', 600),
    objective: text(input.objective, 'Objective', 2000, true), instructions: text(input.instructions, 'Instructions', 3000),
    skills: input.skills ?? [], allowed_tools: input.allowed_tools ?? ['project_evidence', 'knowledge_search'],
    context_scopes: input.context_scopes ?? ['stories', 'test-cases', 'runs', 'bugs', 'knowledge'],
    context: text(input.context, 'Context', 4000), guardrails: text(input.guardrails, 'Guardrails', GUARDRAILS_MAX_LENGTH),
    ...(input.guardrail_rules !== undefined ? { guardrail_rules: normalizeGuardrails(input.guardrail_rules) } : {}),
    ...(input.derived_from !== undefined ? { derived_from: normalizeLineage(input.derived_from) } : {}),
    integration_id: text(input.integration_id, 'Model connection', 255),
    ...(input.ai_configuration !== undefined ? { ai_configuration: require('../workflows/nodeAiConfiguration').normalize(input.ai_configuration) } : {}),
    ...(input.review_criteria !== undefined ? { review_criteria: text(input.review_criteria, 'Review criteria', 4000) } : {}),
    source_ids: list(input.source_ids, 'Knowledge sources'), source_kinds: list(input.source_kinds, 'Source kinds', 20),
    required_inputs: list(input.required_inputs, 'Required inputs', 20),
    ...(input.input_fields !== undefined ? { input_fields: normalizeInputFields(input.input_fields) } : {}),
    output_contract: normalizeOutputContract(input.output_contract ?? (inheritedOutput?.mode === 'author'
      ? { kind: inheritedOutput.artifact_kinds[0], minimum_artifacts: inheritedOutput.minimum_artifacts } : undefined)),
    acceptance: { require_evidence: input.acceptance?.require_evidence ?? true, no_evidence_gaps: input.acceptance?.no_evidence_gaps ?? false, minimum_findings: integer(input.acceptance?.minimum_findings, 0, 0, 8, 'Minimum findings') },
    limits: { timeout_ms: integer(input.limits?.timeout_ms, 150000, 10000, 150000, 'Time limit'), max_model_calls: integer(input.limits?.max_model_calls, 2, 1, 4, 'Model calls'), max_output_tokens: integer(input.limits?.max_output_tokens, 4000, 256, 8000, 'Output tokens') }
  };
  if (result.feature_id && !Object.values(require('@hellotest/contracts/agents/workflowSpecialists.json')).some(profile => profile.featureId === result.feature_id)) throw fail('Choose a supported quality capability.');
  if (!Array.isArray(result.context_scopes) || result.context_scopes.some(scope => typeof scope !== 'string')) throw fail('Select evidence scopes.');
  if (result.required_inputs.some(key => !validInputName(key))) throw fail('Input names must use letters, numbers and underscores, starting with a letter.');
  if (result.input_fields) result.required_inputs = result.input_fields.filter(field => field.required).map(field => field.name);
  if (Object.values(result.acceptance).slice(0, 2).some(value => typeof value !== 'boolean')) throw fail('Completion rules must use boolean values.');
  if (input.acceptance && Object.keys(input.acceptance).some(key => !Object.hasOwn(result.acceptance, key))) throw fail('Choose supported completion rules.');
  if (input.limits && Object.keys(input.limits).some(key => !Object.hasOwn(result.limits, key))) throw fail('Choose supported execution limits.');
  if (result.ai_configuration && ['max_output_tokens', 'agent_execution'].some(key => Object.hasOwn(result.ai_configuration, key))) throw fail('Configure agent output tokens and model calls in execution limits.');
  policy(toNodeData(result));
  result.skills = result.skills.map(skill => ({ id: text(skill.id, 'Skill identifier', 255, true), name: skill.name.trim(), instructions: skill.instructions.trim(), enabled: skill.enabled !== false }));
  if (result.acceptance.require_evidence && !result.allowed_tools.length && !result.required_inputs.length) throw fail('Enable an evidence tool or declare required inputs for evidence-based completion.');
  if (result.guardrail_rules?.some(rule => rule.id === 'maximum_drafts' && rule.value < result.output_contract.minimum_artifacts)) throw fail('Maximum drafts must allow the minimum required by the completion contract.');
  return result;
}
function toNodeData(definition) {
  return { kind: 'agent', agentId: 'quality-evaluator', label: definition.name, summary: definition.description,
    prompt: definition.objective, instructions: definition.instructions, skills: definition.skills,
    allowedTools: definition.allowed_tools, knowledgeScope: definition.context_scopes.join(','),
    contextInstructions: definition.context, guardrails: definition.guardrails,
    aiConfiguration: definition.ai_configuration, reviewCriteria: definition.review_criteria,
    llmIntegrationId: definition.integration_id, knowledgeSourceIds: definition.source_ids, knowledgeSourceKinds: definition.source_kinds,
    timeoutMs: definition.limits.timeout_ms, retryCount: 0 };
}
const definitionHash = definition => createHash('sha256').update(JSON.stringify(definition)).digest('hex');
function verify(result, citations, acceptance = {}) {
  const allowed = new Set(citations.map(item => item.id));
  const used = result.citation_ids || [];
  const checks = [
    { id: 'response', passed: Boolean(result.response?.trim()), label: 'Model returned a response' },
    { id: 'citation_integrity', passed: used.every(id => allowed.has(id)), label: 'References belong to the supplied evidence' },
    ...(acceptance.require_evidence === false ? [] : [{ id: 'evidence', passed: used.length > 0, label: 'Response cites observed input or permitted evidence' }]),
    ...(acceptance.no_evidence_gaps ? [{ id: 'evidence_gaps', passed: !result.evidence_gaps?.length, label: 'No unresolved evidence gaps' }] : []),
    { id: 'findings', passed: (result.findings?.length || 0) >= (acceptance.minimum_findings || 0), label: `At least ${acceptance.minimum_findings || 0} findings` }
  ];
  return { verifier_version: 'agent-contract-v1', status: checks.every(check => check.passed) ? 'passed' : 'needs_input', checks,
    semantic_review: 'human_review_required', limitations: ['Reference checks establish traceability, not factual correctness. Review material claims before acting.'] };
}
function validateInputs(definition, input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('Agent inputs must be a JSON object.', 'AGENT_INPUT_INVALID');
  if (Buffer.byteLength(JSON.stringify(input)) > 16384) throw fail('Agent inputs are limited to 16 KB.', 'AGENT_INPUT_INVALID');
  const values = { ...input };
  for (const field of definition.input_fields || []) {
    const value = Object.hasOwn(input, field.name) ? input[field.name] : field.default;
    if (value == null || value === '') continue;
    if (typeof value !== 'string' || value.trim().length > 255) throw fail(`Provide a valid value for ${field.label}.`, 'AGENT_INPUT_INVALID');
    values[field.name] = value.trim();
  }
  const missing = definition.required_inputs.filter(key => !Object.hasOwn(values, key) || values[key] == null || values[key] === '');
  if (missing.length) throw fail(`Provide required agent inputs: ${missing.join(', ')}.`, 'AGENT_INPUT_REQUIRED');
  return values;
}
module.exports = { normalize, toNodeData, definitionHash, verify, validateInputs, fail, GUARDRAILS_MAX_LENGTH };
