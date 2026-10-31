const profiles = require('../../shared/workflowSpecialists.json');
const tasks = require('../../shared/workflowNativeTasks.json');
const executionConfiguration = require('@hellotest/platform/backend/src/utils/aiExecutionConfiguration');

const fail = message => Object.assign(new Error(message), { statusCode: 422, code: 'NODE_AI_CONFIGURATION_INVALID', publicMessage: message });
const fields = new Set(['temperature', 'top_p', 'max_output_tokens', 'context', 'agent_execution', 'output_schema']);
// PostgreSQL JSONB reorders keys. Normalize recursively so a reloaded agent
// retains the same definition hash, including its additional JSON Schema.
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
function normalize(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !fields.has(key))) throw fail('Choose supported node model, evidence and output settings.');
  const value = structuredClone(input);
  for (const [key, min, max, integer] of [['temperature', 0, 2, false], ['top_p', 0.01, 1, false], ['max_output_tokens', 256, 16384, true]]) {
    if (!Object.hasOwn(value, key) || key === 'top_p' && value[key] === null) continue;
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < min || value[key] > max || integer && !Number.isInteger(value[key])) throw fail(`Invalid node ${key}.`);
  }
  if (value.context !== undefined) {
    const context = value.context;
    if (!context || typeof context !== 'object' || Array.isArray(context) || Object.keys(context).some(key => !['mode', 'token_budget', 'max_items', 'required', 'focus'].includes(key))
      || !['none', 'mcp'].includes(context.mode) || !Number.isInteger(context.token_budget) || context.token_budget < 256 || context.token_budget > 8000
      || !Number.isInteger(context.max_items) || context.max_items < 1 || context.max_items > 40 || typeof context.required !== 'boolean'
      || typeof context.focus !== 'string' || context.focus.length > 4000 || context.mode === 'none' && context.required) throw fail('Invalid node evidence policy.');
  }
  if (value.agent_execution !== undefined) {
    const policy = value.agent_execution;
    const ranges = { max_model_calls: [1, 8], max_revision_rounds: [0, 3], max_followups: [0, 3], timeout_ms: [10000, 150000] };
    if (!policy || typeof policy !== 'object' || Array.isArray(policy) || Object.keys(policy).length !== 4 || Object.entries(ranges).some(([key, [min, max]]) => !Number.isInteger(policy[key]) || policy[key] < min || policy[key] > max)
      || policy.max_revision_rounds >= policy.max_model_calls) throw fail('Invalid node model-call policy. Corrections must fit within the model-call budget.');
  }
  if (value.output_schema !== undefined && value.output_schema !== null) {
    // Reuse the shared schema validator; native contracts remain mandatory.
    const configuration = require('@hellotest/platform/backend/services/aiConfiguration.service');
    const defaults = configuration.catalog.find(item => item.id === 'ai.agentic.workflow').defaults;
    configuration.validate({ ...structuredClone(defaults), output_schema: value.output_schema }, 'ai.agentic.workflow');
  }
  if (Buffer.byteLength(JSON.stringify(value)) > 32000) throw fail('Keep node model settings within 32 KB.');
  return canonical(value);
}
function reviewCriteria(data) {
  if (data.reviewCriteria == null) return '';
  if (typeof data.reviewCriteria !== 'string' || data.reviewCriteria.length > 4000) throw fail('Keep node review criteria within 4,000 characters.');
  return data.reviewCriteria.trim();
}
function scopeForNode(node, { revision } = {}) {
  const data = node.data || {};
  const native = data.kind === 'artifactTask';
  const profile = native ? tasks[data.artifactTask] : profiles[data.agentId];
  const primary = native ? profile?.featureKey
    : data.kind === 'repositoryAgent' ? `ai.agentic.repository.${data.repositoryAgentType}`
      : data.agentSnapshot || String(data.agentId || '').startsWith('agent-') ? 'ai.agentic.workflow' : `ai.agentic.${data.agentId || 'quality-evaluator'}`;
  const task = native ? data.task ?? profile?.task : data.prompt ?? data.intent ?? profile?.prompt;
  const instructions = data.instructions ?? (native ? data.prompt ?? profile?.instructions : '');
  const rubric = reviewCriteria(data);
  const definition = data.agentSnapshot?.definition;
  const definitionLimits = definition?.limits ? { max_output_tokens: definition.limits.max_output_tokens, agent_execution: {
    max_model_calls: definition.limits.max_model_calls, max_revision_rounds: Math.min(1, definition.limits.max_model_calls - 1),
    max_followups: Math.max(0, Math.min(3, definition.limits.max_model_calls - 1)), timeout_ms: definition.limits.timeout_ms
  } } : {};
  const prompt = [['Task', task], ['Instructions', instructions], ['Review criteria', rubric]]
    .filter(([, value]) => typeof value === 'string' && value.trim()).map(([label, value]) => `${label}:\n${value.trim()}`).join('\n\n');
  if (prompt.length > 24000) throw fail('Keep the node task, instructions and review criteria within 24,000 characters.');
  if (data.guardrails != null && (typeof data.guardrails !== 'string' || data.guardrails.length > 16000)) throw fail('Keep node guardrails within 16,000 characters.');
  return { source: 'workflow_node', id: node.id || 'node', revision, feature_id: primary,
    config: { ...normalize(definition?.ai_configuration), ...definitionLimits, ...normalize(data.aiConfiguration), ...(prompt ? { prompt } : {}),
      ...(typeof (data.guardrails ?? profile?.guardrails) === 'string' && (data.guardrails ?? profile?.guardrails).trim() ? { guardrails: (data.guardrails ?? profile?.guardrails).trim() } : {}),
      ...(data.llmIntegrationId ? { integration_id: data.llmIntegrationId } : {}) } };
}
function runNode(node, metadata, callback) {
  return executionConfiguration.run(scopeForNode(node, metadata), callback);
}
function runAgent({ id, registered, policy }, callback) {
  if (executionConfiguration.current()) return callback();
  const definition = registered?.definition;
  const profile = profiles[id];
  const rubric = definition?.review_criteria || '';
  const prompt = definition ? [definition.objective, definition.instructions, rubric && `Review criteria:\n${rubric}`].filter(Boolean).join('\n\n') : policy?.configuration_key ? undefined : profile?.outputInstructions;
  return executionConfiguration.run({ source: definition ? 'agent_definition' : 'agent_defaults', id: registered?.id || id,
    revision: registered?.version, feature_id: policy?.configuration_key || (definition ? 'ai.agentic.workflow' : `ai.agentic.${id}`),
    config: { ...normalize(definition?.ai_configuration), ...(prompt ? { prompt } : {}), ...(definition?.guardrails ? { guardrails: definition.guardrails } : {}),
      ...(definition ? { max_output_tokens: definition.limits.max_output_tokens, agent_execution: {
        max_model_calls: definition.limits.max_model_calls, max_revision_rounds: Math.min(1, definition.limits.max_model_calls - 1),
        max_followups: Math.max(0, Math.min(3, definition.limits.max_model_calls - 1)), timeout_ms: definition.limits.timeout_ms } } : {}) } }, callback);
}
function requestSettings(input = {}) {
  const result = {};
  if (input.ai_configuration !== undefined) result.ai_configuration = normalize(input.ai_configuration);
  for (const [key, max] of [['instructions', 4000], ['guardrails', 2000], ['review_criteria', 4000]]) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== 'string' || input[key].length > max) throw fail(`Keep agent ${key.replace('_', ' ')} within ${max} characters.`);
    result[key] = input[key].trim();
  }
  return result;
}
function runRequest(input, featureId, callback, { inherit = true } = {}) {
  if (inherit && executionConfiguration.current()) return callback();
  const settings = requestSettings(input);
  const defaults = require('@hellotest/platform/shared/aiFeatureCatalog.json').find(item => item.id === featureId)?.defaults;
  if (!defaults) throw fail('Choose a supported agent model profile.');
  const guidance = [settings.instructions, settings.review_criteria && `Review criteria:\n${settings.review_criteria}`].filter(Boolean).join('\n\n');
  return executionConfiguration.run({source:'agent_run',id:input.session_id || featureId,feature_id:featureId,config:{
    ...settings.ai_configuration,
    ...(guidance ? {prompt:`${defaults.prompt}\n\n${guidance}`} : {}),
    ...(settings.guardrails ? {guardrails:`${defaults.guardrails}\n\nAdditional task guardrails:\n${settings.guardrails}`} : {})
  }}, callback);
}
module.exports = { normalize, scopeForNode, runNode, runAgent, reviewCriteria, requestSettings, runRequest };
