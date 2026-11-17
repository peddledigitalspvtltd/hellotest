const db = require("@hellotest/platform/backend/src/db");
const knowledgeRagService = require("./knowledgeRag.service");
const aiContextOrchestrator = require("@hellotest/ai/services/aiContextOrchestrator");
const knowledgeContracts = require("./knowledgeContracts.service");
const contextEngine = require("./knowledgeContextEngine.service");
const execution = require("./knowledgeExecution.service");
const knowledgeAuthorization = require("./knowledgeAuthorization.service");
const { normalizeText } = require("@hellotest/platform/backend/src/security/aiTextPolicy");
const ranking = require("./knowledgeRanking");
const lexicalQuery = require("./knowledgeLexicalQuery");
const authorizeFreshEvidence = async ({ projectId, user, hits, asOf, signal = execution.current()?.signal }) => {
  const checkActive = () => { execution.assertActive(); if (signal?.aborted) throw execution.abortError(); };
  checkActive();
  const permissionService = require("@hellotest/platform/backend/services/permission.service");
  const projectService = require("@hellotest/platform/backend/public/projectAccess");
  const unavailable = () => ({ allowed: [], denied_ids: hits.map((hit) => hit.evidence_id || hit.citation?.id || hit.chunk_id || hit.id), partial: hits.length > 0 });
  let canReadKnowledge = false;
  try {
    [canReadKnowledge] = await Promise.all([
      permissionService.hasPermission(user, "knowledge.view", projectId),
      projectService.getProject(projectId, user?.id)
    ]);
    checkActive();
  } catch (error) {
    if (error.statusCode === 403 || error.statusCode === 404) return unavailable();
    throw error;
  }
  const live = hits.filter((hit) => (hit.source_kind || hit.citation?.source_kind) === "live_project");
  const indexed = hits.filter((hit) => !live.includes(hit));
  const result = canReadKnowledge ? await knowledgeAuthorization.getEvidenceAccess({ projectId, user, evidence: indexed, asOf, signal })
    : { allowed: [], denied_ids: indexed.map(hit => hit.evidence_id || hit.citation?.id || hit.chunk_id || hit.id), partial: indexed.length > 0 };
  checkActive();
  if (!live.length) return result;
  const { getOptionalEvidenceAccess } = require("@hellotest/platform/backend/services/optionalEvidenceAccess.service");
  const livePermissions = {
    "project-overview": [], stories: ["requirement.view", "testcase.view"],
    "test-cases": ["testcase.view", "requirement.view", "suite.view", "shared_step.view"], runs: ["run.view", "result.view"],
    "run-failures": ["run.view", "result.view", "testcase.view", "comment.view", "attachment.view"],
    "execution-context": ["environment.view", "configuration.view"],
    "object-repository": ["automation.view"], bugs: ["feedback.view"],
    // Computed counts need the same permission as the records they count.
    ...require("./knowledgeAggregates.service").SCOPE_PERMISSIONS
  };
  const corePermissions = { stories: ["requirement.view"], "test-cases": ["testcase.view"], runs: ["run.view"], "run-failures": ["run.view", "result.view", "testcase.view"], "execution-context": [] };
  const storySupportPermissions = ['comment.view', 'attachment.view'];
  const permissionAccess = await getOptionalEvidenceAccess(user, projectId, [...new Set([...Object.values(livePermissions).flat(), ...storySupportPermissions])]);
  checkActive();
  for (const hit of live) {
    const sourceId = hit.source_id || hit.citation?.source_id || "";
    const prefix = `live-project-${projectId}-`;
    const nativeScope = sourceId.startsWith(prefix) ? sourceId.slice(prefix.length) : null;
    const scope = /^run-failure-(?:[1-9]|1[0-9]|20)$/.test(nativeScope || '') ? 'run-failures' : nativeScope;
    let requirements = Object.hasOwn(livePermissions, scope) ? livePermissions[scope] : null;
    // Current server snapshots declare the collaborators they actually include.
    // Old or truncated snapshots retain the conservative combined requirements.
    if (requirements && Object.hasOwn(corePermissions, scope)) {
      let snapshot;
      try { snapshot = JSON.parse(String(hit.content || "")); } catch { /* Legacy citation. */ }
      const declared = snapshot?.evidence_permissions;
      const allowedDeclarations = scope === 'stories' ? [...requirements, ...storySupportPermissions] : requirements;
      if (Array.isArray(declared) && declared.length && declared.every(permission => allowedDeclarations.includes(permission))) {
        requirements = [...new Set([...corePermissions[scope], ...declared])];
      }
    }
    const permitted = requirements && requirements.every(permission => permissionAccess[permission]);
    checkActive();
    if (permitted && !asOf) result.allowed.push(hit);
    else result.denied_ids.push(hit.evidence_id || hit.citation?.id || hit.chunk_id);
  }
  result.partial ||= result.denied_ids.length > 0;
  return result;
};

const MAX_GROUNDED_HITS = 14;

const MAX_HITS_PER_SOURCE = 3;


const createError = (message, statusCode = 400, code) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
};

const asObject = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};

const asArray = (value) => Array.isArray(value) ? value : [];

const normalizeId = (value) => normalizeText(value, 255);

const normalizeAssistantFilters = async ({ projectId, appTypeId, base, override }) => {
  const merged = { ...asObject(base), ...asObject(override) };
  const collectionIds = [...new Set(asArray(merged.collection_ids || merged.collections).map(normalizeId).filter(Boolean))].slice(0, 100);
  if (collectionIds.length) {
    const placeholders = collectionIds.map(() => "?").join(", ");
    const row = await db.prepare(`
      SELECT COUNT(*)::INTEGER AS count FROM ai_knowledge_collections
      WHERE project_id = ? AND id IN (${placeholders})
    `).get(projectId, ...collectionIds);
    if (Number(row?.count || 0) !== collectionIds.length) {
      throw createError("Assistant collection filters must belong to the session project.", 403);
    }
  }
  const filters = {};
  if (Array.isArray(merged.requested_scopes)) filters.requested_scopes = [...new Set(merged.requested_scopes.filter(scope => ['stories','test-cases','runs','bugs','automation','knowledge'].includes(scope)))];
  if (typeof merged.agent_id === 'string') filters.agent_id = normalizeText(merged.agent_id, 255);
  if (merged.evidence_scope && typeof merged.evidence_scope === 'object') filters.evidence_scope = Object.fromEntries(require('@hellotest/contracts/agents/evidenceScopeFields.json').map(field => field.key).filter(key => typeof merged.evidence_scope[key] === 'string' && merged.evidence_scope[key].trim()).map(key => [key, normalizeText(merged.evidence_scope[key], 255)]));
  if (collectionIds.length) filters.collection_ids = collectionIds;
  const sourceKinds = [...new Set(asArray(merged.source_kinds).map((value) => normalizeText(value, 80)).filter(Boolean))].slice(0, 20);
  if (sourceKinds.length) filters.source_kinds = sourceKinds;
  const sourceIds = [...new Set(asArray(merged.source_ids).map(normalizeId).filter(Boolean))].slice(0, 100);
  if (sourceIds.length) filters.source_ids = sourceIds;
  if (appTypeId) filters.app_type_id = appTypeId;
  if (merged.as_of) {
    if (!Number.isFinite(Date.parse(merged.as_of))) throw createError("as_of must be a valid timestamp.");
    filters.as_of = new Date(merged.as_of).toISOString();
  }
  return filters;
};

const buildDeterministicRetrievalQueries = (question) => {
  const input = normalizeText(question, 4_000);
  if (!input) return [];
  const identifiers = [...new Set(input.match(/\b(?:AT[_-][0-9]+|(?:BUG|TC|TS|STORY|RUN|REQ)-?[A-Z0-9_-]+)\b/gi) || [])].slice(0, 4);
  const domainTerms = [
    [/\b(?:fail|failed|failure|error|blocked|flaky)\b/i, "failure symptoms error messages affected runs root cause"],
    [/\b(?:bug|defect|issue|regression)\b/i, "defect defect regression severity status impacted tests"],
    [/\b(?:story|requirement|acceptance criteria|coverage)\b/i, "story requirement acceptance criteria linked test coverage"],
    [/\b(?:test case|scenario|gherkin|step)\b/i, "test case scenario preconditions steps expected result traceability"],
    [/\b(?:release|version|readiness|risk)\b/i, "release version readiness open risks failures defects coverage"],
    [/\b(?:environment|configuration|browser|device|platform)\b/i, "environment configuration browser device platform execution"],
    [/\b(?:automation|locator|selector|object repository)\b/i, "automation locator selector binding confidence maintenance"]
  ].filter(([pattern]) => pattern.test(input)).map(([, query]) => query);
  const identifierQuery = identifiers.length ? `${identifiers.join(" ")} linked evidence status history` : null;
  return [...new Set([identifierQuery, ...domainTerms].filter(Boolean))].slice(0, 2);
};

// Combine the per-query hit lists into one ordered, diversified list.
//
// Order is plain reciprocal-rank fusion across the queries. The raw question is
// retained as a tie-break preference, not given an uncalibrated score multiplier.
// Absolute relevance remains descriptive and feeds sufficiency/reranking only.
const mergeRetrievalResults = (queryResults, limit = MAX_GROUNDED_HITS, { perSourceCap = MAX_HITS_PER_SOURCE, primaryQuery } = {}) => {
  const fused = new Map();
  // The user's own question counts double: queries derived from it (domain variants,
  // open-need follow-ups) refine it and must never outvote it.
  const primary = String(primaryQuery || "").trim().toLowerCase();
  const isPrimary = (entry) => Boolean(primary) && String(entry?.query || "").trim().toLowerCase() === primary;
  const activeQueries = queryResults.filter(entry => asArray(entry?.result?.results).length).length;
  queryResults.forEach((entry, queryIndex) => {
    const result = entry?.result || {};
    const graphMode = result.retrieval?.vector_mode === "graph_witnesses";
    const trustedGraphEvidence = new Set(asArray(result.relationships)
      .filter((edge) => edge?.endpoints_authorized === true
        && ["DETERMINISTIC", "SOURCE_EXPLICIT", "HUMAN_VERIFIED"].includes(edge.provenance_type))
      .flatMap((edge) => asArray(edge.evidence_ids)));
    asArray(result.results).forEach((hit, rank) => {
      const key = hit?.chunk_id || hit?.citation?.id;
      const relevance = Number(hit?.relevance ?? hit?.score ?? 0);
      if (!key) return;
      const evidenceId = hit?.citation?.id || (hit?.chunk_id ? `K-${hit.chunk_id}` : null);
      if (graphMode && !trustedGraphEvidence.has(evidenceId)) return;
      // Zero-score passages are useful only when their exact content proves an
      // authorized trusted relationship or was reached through that relation.
      if (!graphMode && !hit.graph_neighbour && !(relevance > 0)) return;
      const current = fused.get(key) || { hit, bestRelevance: relevance, reciprocalRank: 0, queryIndexes: new Set(), primary: false };
      if (isPrimary(entry)) current.primary = true;
      if (relevance > current.bestRelevance) {
        current.hit = hit;
        current.bestRelevance = relevance;
      }
      current.reciprocalRank += 1 / (ranking.RRF_K + rank + 1);
      current.queryIndexes.add(queryIndex);
      fused.set(key, current);
    });
  });
  const best = activeQueries / (ranking.RRF_K + 1) || 1;
  const ranked = [...fused.values()].map((entry) => ({
    ...entry.hit,
    relevance: Number(entry.bestRelevance.toFixed(6)),
    retrieval_query_match_count: entry.queryIndexes.size,
    matched_primary_query: entry.primary,
    retrieval_fusion_score: Number(Math.min(1, entry.reciprocalRank / best).toFixed(6))
  })).sort((left, right) => (
    right.retrieval_fusion_score - left.retrieval_fusion_score
    || Number(right.matched_primary_query) - Number(left.matched_primary_query)
    || right.retrieval_query_match_count - left.retrieval_query_match_count
    || Number(right.relevance || 0) - Number(left.relevance || 0)
  ));
  return ranking.diversify(ranked, { limit, cap: perSourceCap, sourceOf: (hit) => hit.source_id || hit.citation?.source_id || hit.chunk_id });
};

// For each information need the planner named: do the retrieved passages address
// it? A need counts as covered when one passage contains at least half of its
// key terms. This is a coverage check, not an entailment check.
// Words that describe the question or the answer rather than the subject. A need built
// from them ("the behaviour the question asks about") names nothing to look for.
const NEED_META_WORDS = new Set(["behaviour", "behavior", "question", "questions", "asks", "asked", "asking", "answer", "answers", "information", "details", "detail",
  "relevant", "specific", "exact", "current", "project", "context", "evidence", "facts", "domain", "supporting", "related", "user", "users", "needs", "need", "about", "regarding", "concerning"]);
const needCoverage = (hits, needs) => asArray(needs).map((need) => {
  const terms = lexicalQuery.extractKeyTerms(need, { maxTerms: 8, extraStopWords: NEED_META_WORDS }).terms;
  // A need with fewer than two distinctive terms cannot be checked reliably; it is not
  // evaluated, so a vague need never forces another retrieval round.
  if (terms.length < 2) return null;
  const covering = asArray(hits).filter((hit) => {
    const text = `${hit.title || ""} ${hit.content || ""}`.toLowerCase();
    const tokens = ranking.tokenSet(text);
    return terms.filter((term) => tokens.has(term) || text.includes(term)).length / terms.length >= 0.5;
  });
  return { need: normalizeText(need, 400), covered: covering.length > 0, evidence_ids: covering.slice(0, 3).map((hit) => hit.citation?.id).filter(Boolean) };
}).filter(Boolean).slice(0, 8);

const assessEvidenceSufficiency = (hits = [], { contextRoute, question, informationNeeds } = {}) => {
  const citationReady = asArray(hits).filter((hit) => hit?.citation?.id);
  const indexed = citationReady.filter((hit) => hit.source_kind !== "live_project");
  const liveCount = citationReady.length - indexed.length;
  const distinctSources = new Set(citationReady.map((hit) => hit.source_id || hit.citation?.source_id || hit.citation.id)).size;
  // Absolute relevance, not rank: the best of a poor candidate set must not look strong.
  const scores = indexed.map((hit) => Number(hit.relevance ?? hit.retrieval_fusion_score ?? hit.score ?? 0)).filter(Number.isFinite);
  const strongestScore = scores.length ? Math.max(...scores) : 0;
  const corroboratedCount = citationReady.filter((hit) => Number(hit.retrieval_query_match_count || 0) > 1).length;
  const expectedKinds = new Set(asArray(contextRoute?.indexed_source_kinds));
  const expectedLiveScopes = new Set([...asArray(contextRoute?.live_scopes), ...asArray(contextRoute?.adaptive_live_scopes)]);
  const routeAlignedCount = citationReady.filter((hit) => {
    if (!expectedKinds.size && !expectedLiveScopes.size) return true;
    if (hit.source_kind !== "live_project") return expectedKinds.has(hit.source_kind);
    const source = `${hit.source_id || ""} ${hit.title || ""}`.toLowerCase();
    return [...expectedLiveScopes].some((scope) => source.includes(scope.replace(/-/g, " ")) || source.includes(scope));
  }).length;
  const questionTokens = [...new Set((normalizeText(question, 4_000).toLowerCase().match(/[a-z0-9][a-z0-9_.-]{2,48}/g) || [])
    .filter((token) => !new Set(["the", "and", "for", "with", "from", "this", "that", "what", "which", "about", "project", "hellotest"]).has(token)))];
  const topicallyMatchedCount = questionTokens.length ? citationReady.filter((hit) => {
    const content = `${hit.title || ""} ${hit.content || ""}`.toLowerCase();
    return questionTokens.some((token) => content.includes(token));
  }).length : citationReady.length;
  const score = Math.min(100, Math.round(
    Math.min(24, citationReady.length * 4)
    + Math.min(24, distinctSources * 8)
    + Math.min(20, strongestScore * 20)
    + Math.min(12, corroboratedCount * 4)
    + Math.min(6, liveCount * 3)
    + Math.min(8, routeAlignedCount * 2)
    + Math.min(6, topicallyMatchedCount * 2)
  ));
  // When the intent planner supplied explicit questions, evaluate each one.
  // Otherwise use the user's own question as a single fallback need so an
  // empty planner response cannot turn a pile of unrelated passages into a
  // sufficient context packet.
  const requestedNeeds = asArray(informationNeeds).length ? informationNeeds : question ? [question] : [];
  const needs = needCoverage(citationReady, requestedNeeds);
  const uncoveredNeeds = needs.filter((item) => !item.covered).map((item) => item.need);
  const status = !citationReady.length ? "empty" : uncoveredNeeds.length ? "partial" : "covered";
  return {
    score,
    status,
    information_needs: needs,
    uncovered_needs: uncoveredNeeds,
    needs_coverage_ratio: needs.length ? Number((needs.length - uncoveredNeeds.length) / needs.length).toFixed(2) * 1 : null,
    citation_ready_count: citationReady.length,
    distinct_source_count: distinctSources,
    live_evidence_count: liveCount,
    corroborated_result_count: corroboratedCount,
    route_aligned_result_count: routeAlignedCount,
    topically_matched_result_count: topicallyMatchedCount,
    strongest_retrieval_score: Number(strongestScore.toFixed(4)),
    // Candidate counts and rank scores are diagnostics only. A retrieval round
    // continues because a requested information need remains uncovered.
    requires_more_context: uncoveredNeeds.length > 0
  };
};

const retrieveContext = ({ request, user, history, smartContext, integration, intentPlan, followUpRounds, focusSourceIds, signal }) => execution.run({
  ...execution.current(), signal: signal && execution.current()?.signal ? AbortSignal.any([signal,execution.current().signal]) : signal || execution.current()?.signal
}, () => contextEngine.retrieve({
  request, user, history, smartContext, integration, intentPlan, followUpRounds, focusSourceIds,
  dependencies: {
    search: runRagSearchBatch, liveEvidence: aiContextOrchestrator.buildLiveProjectEvidence,
    planContext: aiContextOrchestrator.planContext, merge: mergeRetrievalResults, assess: assessEvidenceSufficiency,
    // The LLM intent planner runs once before retrieval. Any second retrieval
    // round uses bounded deterministic variants, never another planning call.
    // Follow-up queries are deterministic: the question's own domain variants plus the information needs that no passage addressed yet.
    planQueries: ({ question, openNeeds }) => ({ search_queries: [...asArray(openNeeds), ...buildDeterministicRetrievalQueries(question)] }),
    authorize: (hits, { signal } = {}) => authorizeFreshEvidence({ projectId: request.project_id, user, hits, asOf: request.filters?.as_of, signal }),
    expandParents: knowledgeRagService.expandEvidence, expandRelationships: knowledgeRagService.expandRelationships,
    rerank: ({ query, hits, signal }) => require("./knowledgeReranker").rerank({ query, hits, signal }),
    aggregates: ({ projectId, user, question }) => require("./knowledgeAggregates.service").hits({ projectId, user, question })
  }
}));

const runRagSearchBatch = async ({ queries, projectId, filters, integrationId, user, signal, timeoutMs, maxCandidates, mode = "hybrid" }) => {
  try {
    return await knowledgeRagService.searchMany({
      queries,
      projectId,
      mode,
      limit: 10,
      filters,
      integrationId,
      user, signal, timeoutMs, maxCandidates
    });
  } catch (error) {
    execution.assertActive();
    if (signal?.aborted) throw execution.abortError();
    return { results: [], errors: [error], query_count: asArray(queries).length, embedding_batch_count: 0 };
  }
};

// Inherits the calling turn's execution context (trace id, event log, progress
// stream) when there is one, so retrieval stages stay in the caller's processing
// trace; an external host has no parent context and starts a fresh one.
const retrieveDirect = (input) => execution.run({ ...execution.current(), signal: input.signal || execution.current()?.signal, onProgress: input.onProgress || execution.current()?.onProgress }, async () => {
  try {
  const filters = await normalizeAssistantFilters({ projectId: input.projectId, appTypeId: input.appTypeId, base: input.filters });
  const history = asArray(input.history).filter(message => message && ['user', 'assistant'].includes(message.role) && typeof message.content === 'string').slice(-6);
  const request = knowledgeContracts.buildRetrievalRequest({ projectId: input.projectId, query: input.query, filters, budgets: input.budgets,
    smartContext: input.smartContext, traceId: execution.current()?.traceId,
    conversation: { session_id: input.conversation?.session_id, history_message_count: history.length, follow_up: history.length > 0 } });
  execution.current().modelBudget = { ...request.budgets,
    ...(input.budgets?.max_query_cost_usd != null || input.budgets?.max_cost_usd != null
      ? { max_query_cost_usd: request.budgets.max_cost_usd } : {}) };
  execution.current().searchMode = input.budgets?.max_query_cost_usd != null || input.budgets?.max_cost_usd != null ? "keyword" : "hybrid";
  execution.current().queryId = request.query_id;
  execution.current().requestId = request.request_id;
  execution.current().traceId = request.trace_id;
  execution.emit("QUERY_RECEIVED", "completed");
  if (filters.as_of) await knowledgeAuthorization.assertHistoricalAccess(input.user, input.projectId);
  const started = Date.now();
  // Exact native record reads already have a host-owned scope and intent. A
  // second model must not delay or erase that authoritative evidence packet.
  const scopedNativeRead = Object.keys(filters.evidence_scope || {}).length > 0 && Array.isArray(filters.requested_scopes)
    && filters.requested_scopes.length > 0;
  const suppliedPlan=()=>{
    try{return require('./knowledgeIntentPlanning.service').normalizePlan(input.intentPlan,request.query);}
    catch{throw createError('The supplied retrieval hint must be bounded and related to the original question.',400,'RETRIEVAL_PLAN_INVALID');}
  };
  const deterministicIntent = require('@hellotest/contracts/agents/contextIntent').planContext({prompt:request.query,agentId:filters.agent_id,requestedScopes:filters.requested_scopes,history});
  const planning = Array.isArray(filters.requested_scopes) && !filters.requested_scopes.length ? {mode:"disabled",plan:null,reason:"NO_REQUESTED_CONTEXT"}
    : input.intentPlan ? {mode:'caller_supplied',plan:suppliedPlan(),reason:null}
    : input.planningMode==='deterministic' ? {mode:'deterministic',plan:null,reason:null}
    : scopedNativeRead ? {mode:"scoped_native",plan:null,reason:null}
    : input.planningMode!=='model' && deterministicIntent.route_confidence!=='low' ? {mode:'deterministic_resolved',plan:null,reason:null} : await require("./knowledgeIntentPlanning.service").planIntent({ request, user: input.user,
    integration: input.integration, integrationId: input.integrationId, history: input.history, signal: input.signal || execution.current()?.signal });
  const intentModelCalls = Number(execution.current().modelStats.calls || 0);
  const retrievalRequest = { ...request, ...(deterministicIntent.route_confidence==='low'&&planning.plan?.confidence&&planning.plan.confidence!=='low'&&planning.plan.query_class?{query_class:planning.plan.query_class}:{}), budgets: { ...request.budgets,
    max_tool_calls: Math.max(0, request.budgets.max_tool_calls - intentModelCalls),
    max_cost_usd: Math.max(0, request.budgets.max_cost_usd - Number(execution.current().modelStats.reservedCostUsd || 0)),
    deadline_ms: Math.max(1, request.budgets.deadline_ms - (Date.now() - started)) } };
  // A model-planned or caller-supplied plan, or an explicit request, allows one
  // further deterministic round; the plain deterministic read stays single-round.
  const followUpRounds = input.followUpRounds !== undefined ? Boolean(input.followUpRounds) : Boolean(planning.plan);
  const result = await retrieveContext({ request: retrievalRequest, user: input.user, intentPlan: planning.plan,
    history, smartContext: input.smartContext || {}, followUpRounds, focusSourceIds: asArray(input.focusSourceIds).slice(0, 6) });
  const { context_packet, ...diagnostics } = result.retrieval;
  result.packet.retrieval = { ...diagnostics, ...result.packet.retrieval, intent_planning_mode: planning.mode,
    intent_planning_model_used: planning.mode === "llm", route_confidence:planning.plan?.confidence||deterministicIntent.route_confidence,
    intent_scope_widened:!filters.requested_scopes?.length && (planning.plan?.confidence==='low'||(!planning.plan?.confidence&&deterministicIntent.scope_widened)), intent_model_calls: intentModelCalls, intent_plan_error_code: planning.reason,
    model_context_plan: planning.plan ? { source_kinds: planning.plan.source_kinds, information_needs: planning.plan.information_needs, retrieval_strategy: planning.plan.retrieval_strategy,query_class:planning.plan.query_class,confidence:planning.plan.confidence,context_scopes:planning.plan.context_scopes } : null };
  execution.emit("COMPLETED", "completed");
  execution.recordRetrievalOutcome({ candidate_count: result.packet.retrieval.candidate_count,
    degraded: result.packet.retrieval.degraded, termination_reason: result.packet.retrieval.termination_reason });
  return result.packet;
  } catch (error) {
    execution.recordRetrievalOutcome({ degraded: true,
      termination_reason: error?.code === "DEADLINE_EXCEEDED" ? knowledgeContracts.TERMINATION_REASONS.DEADLINE : knowledgeContracts.TERMINATION_REASONS.FAILED });
    throw error;
  }
});

// Knowledge owns the canonical context-build operation. MCP and HTTP routes
// adapt this same packet contract; the domain package must not depend upward
// on the MCP gateway to retrieve its own evidence.
const retrieve = retrieveDirect;

// Adapt one authorized packet for existing search consumers without losing citation identity.
const retrieveSearch = async input => {
  const packet = await retrieve(input);
  const results = (packet.evidence || []).map(item => ({
    source_id: item.source_id, source_kind: item.source_kind, source_ref_id: item.source_ref_id,
    document_id: item.document_id, chunk_id: item.chunk_id || item.evidence_id, title: item.title,
    content: item.content, excerpt: item.content, score: item.scores?.fused || 0,
    citation: { ...item, id: item.evidence_id, label: item.title,
      current: item.freshness?.current, source_version: item.freshness?.source_version,
      source_hash:item.integrity?.source_hash,version_hash:item.integrity?.version_hash,chunk_hash:item.integrity?.chunk_hash,evidence_hash:item.integrity?.evidence_hash }
  }));
  return { project_id: input.projectId, query: input.query, results,
    retrieval: { ...packet.retrieval, returned_count: results.length, grounded_result_count: results.length,
      context_packet_id: packet.packet_id, context_transport: "mcp", model_context_plan: packet.retrieval?.model_context_plan },
    guardrails: knowledgeRagService.ASSISTANT_GUARDRAILS };
};

module.exports = { fetchEvidence: input => require('./knowledgeEvidence.service').fetchEvidence(input), retrieveSearch, retrieveDirect, retrieveContextDirect: retrieveContext, authorizeFreshEvidence, MAX_GROUNDED_HITS, MAX_HITS_PER_SOURCE, asArray, asObject, assessEvidenceSufficiency, buildDeterministicRetrievalQueries, createError, mergeRetrievalResults, normalizeAssistantFilters, normalizeId, retrieve, retrieveContext, runRagSearchBatch };
