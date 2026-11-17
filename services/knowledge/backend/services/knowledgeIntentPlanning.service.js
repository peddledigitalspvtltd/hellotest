const { aiInstructionBlock } = require('@hellotest/platform/backend/src/utils/aiInstructionBlocks');
const selection = require("@hellotest/integration/backend/services/aiLlmSelection.service");
const gateway = require("./knowledgeModelGateway.service");
const execution = require("./knowledgeExecution.service");
const { normalizeText, sanitizeAiText } = require("@hellotest/platform/backend/src/security/aiTextPolicy");
const KINDS = new Set(require("./knowledgeOntology").RETRIEVAL_SOURCE_KINDS);
const RETRIEVAL_STRATEGIES = Object.freeze(['hybrid_evidence', 'graph_expand']);
const array = value => Array.isArray(value) ? value : [];

function normalizePlan(candidate, question) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw Object.assign(new Error("Invalid intent plan."), { code: "MODEL_INVALID_RESPONSE" });
  const retrieval_strategy = candidate.retrieval_strategy === undefined ? 'hybrid_evidence' : candidate.retrieval_strategy;
  if (!RETRIEVAL_STRATEGIES.includes(retrieval_strategy)) throw Object.assign(new Error('Unsupported context retrieval strategy.'), { code: 'MODEL_INVALID_RESPONSE' });
  const anchors = new Set(String(question).toLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu) || []);
  const queries = [...new Set(array(candidate.search_queries || candidate.queries)
    .map(value => sanitizeAiText(normalizeText(typeof value === "string" ? value : value?.query, 700)).text)
    .filter(query => query && (query.toLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu) || []).some(word => anchors.has(word))))].slice(0, 3);
  const source_kinds = [...new Set(array(candidate.source_kinds).filter(kind => KINDS.has(kind)))].slice(0, 8);
  const information_needs = array(candidate.information_needs).map(value => sanitizeAiText(normalizeText(value, 400)).text).filter(Boolean).slice(0, 8);
  if (!queries.length && !source_kinds.length && !information_needs.length && candidate.retrieval_strategy === undefined) throw Object.assign(new Error("Empty intent plan."), { code: "MODEL_INVALID_RESPONSE" });
  const optional = {};
  if (candidate.query_class !== undefined) {
    if (!['LOOKUP','SEARCH','ANALYTICAL','INVESTIGATIVE','MULTIMODAL'].includes(candidate.query_class)) throw Object.assign(new Error('Unsupported intent class.'), {code:'MODEL_INVALID_RESPONSE'});
    optional.query_class = candidate.query_class;
  }
  if (candidate.confidence !== undefined) {
    if (!['high','medium','low'].includes(candidate.confidence)) throw Object.assign(new Error('Unsupported intent confidence.'), {code:'MODEL_INVALID_RESPONSE'});
    optional.confidence = candidate.confidence;
  }
  if (candidate.context_scopes !== undefined) {
    if (!Array.isArray(candidate.context_scopes) || candidate.context_scopes.some(scope => !require('@hellotest/contracts/agents/contextIntent').CONTEXT_SCOPES.includes(scope))) throw Object.assign(new Error('Unsupported intent scopes.'), {code:'MODEL_INVALID_RESPONSE'});
    optional.context_scopes = [...new Set(candidate.context_scopes)];
  }
  return { queries, source_kinds, information_needs, retrieval_strategy, stop_if_sufficient: candidate.stop_if_sufficient !== false, ...optional };
}

async function resolveIntegration({ projectId, user, integrationId, integration, signal, timeoutMs = 1_500 }) {
  try {
    return await execution.bounded(async () => {
      const selected = integration || await selection.resolveLlmIntegrationForUsage({
        projectId, userId: user?.id, integrationId, usageKey: "ai.knowledge.assistant", fallback: "project-then-global", allowMissing: true
      });
      require("./knowledgeIntegrationScope.service").assertLlmIntegrationProjectScope(selected, projectId);
      return selected;
    }, { timeoutMs, signal });
  } catch (error) {
    if (error.code === "DEADLINE_EXCEEDED") throw Object.assign(new Error("Knowledge model configuration lookup exceeded its time budget."), {
      code: "INTENT_CONFIGURATION_TIMEOUT", statusCode: 504
    });
    throw error;
  }
}

async function planIntent({ request, user, integration, integrationId, history = [], signal }) {
  execution.emit("INTENT_ANALYSIS", "started", { message: "Understanding the intent before retrieving authorized evidence." });
  try {
    const model = await resolveIntegration({ projectId: request.project_id, user, integrationId, integration, signal,
      timeoutMs: Math.min(1_500, Math.max(1, Math.floor(request.budgets.deadline_ms / 6))) });
    if (!model) {
      execution.emit("INTENT_ANALYSIS", "completed", { message: "No LLM is configured; using standard bounded retrieval." });
      return { plan: null, mode: "standard", reason: "LLM_INTEGRATION_MISSING" };
    }
    const candidate = await gateway.request({
      integration: model, operation: "knowledge.context.plan-intent", signal,
      timeoutMs: Math.min(8000, Math.max(1000, Math.floor(request.budgets.deadline_ms / 3))), maxOutputTokens: 768,
      messages: [{ role: "system", content: [aiInstructionBlock("ai.knowledge.intent", "knowledgeIntentPlanning.candidate.1"), 'Resolve the unresolved intent using structured fields: query_class must be LOOKUP, SEARCH, ANALYTICAL, INVESTIGATIVE or MULTIMODAL; confidence must be high, medium or low; context_scopes must be chosen only from stories, test-cases, automation, runs, bugs, knowledge. Low confidence cannot narrow the evidence boundary. Selected filters are absolute host restrictions.'].join('\n') },
        { role: "user", content: JSON.stringify({ question: sanitizeAiText(request.query).text, scope: { project_id: request.project_id, filters: request.filters }, conversation: array(history).slice(-6).map(item => ({ role: item.role, content: sanitizeAiText(normalizeText(item.content, 1200)).text })) }) }]
    });
    const plan = normalizePlan(candidate, request.query);
    execution.emit("INTENT_ANALYSIS", "completed", { message: "Intent-specific retrieval plan prepared.", source_kinds: plan.source_kinds });
    return { plan, mode: "llm", reason: null };
  } catch (error) {
    execution.assertActive();
    if (signal?.aborted) throw error;
    if ([401, 403].includes(error.statusCode) && !String(error.code || "").startsWith("MODEL_")) throw error;
    const reason = error.code || "INTENT_MODEL_UNAVAILABLE";
    execution.emit("INTENT_ANALYSIS", "failed", { error_code: reason, message: "Intent model unavailable; using standard bounded retrieval." });
    return { plan: null, mode: "standard", reason };
  }
}
module.exports = { planIntent, normalizePlan, resolveIntegration, RETRIEVAL_STRATEGIES };
