const db = require("@hellotest/platform/backend/src/db");
const knowledgeRagService = require("./knowledgeRag.service");
const aiContextOrchestrator = require("@hellotest/ai/backend/services/aiContextOrchestrator.service");
const knowledgeContracts = require("./knowledgeContracts.service");
const contextEngine = require("./knowledgeContextEngine.service");
const execution = require("./knowledgeExecution.service");
const knowledgeAuthorization = require("./knowledgeAuthorization.service");
const { normalizeText } = require("@hellotest/platform/backend/src/security/aiTextPolicy");
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
    "execution-context": ["environment.view", "configuration.view"],
    "object-repository": ["automation.view"], bugs: ["feedback.view"]
  };
  const corePermissions = { stories: ["requirement.view"], "test-cases": ["testcase.view"], runs: ["run.view"], "execution-context": [] };
  const storySupportPermissions = ['comment.view', 'attachment.view'];
  const permissionAccess = await getOptionalEvidenceAccess(user, projectId, [...new Set([...Object.values(livePermissions).flat(), ...storySupportPermissions])]);
  checkActive();
  for (const hit of live) {
    const sourceId = hit.source_id || hit.citation?.source_id || "";
    const prefix = `live-project-${projectId}-`;
    const scope = sourceId.startsWith(prefix) ? sourceId.slice(prefix.length) : null;
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

const MIN_GROUNDED_SCORE = 0.06;

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
  if (merged.evidence_scope && typeof merged.evidence_scope === 'object') filters.evidence_scope = Object.fromEntries(['story_id','test_case_id','execution_id','release_id','build','environment_id'].filter(key => typeof merged.evidence_scope[key] === 'string' && merged.evidence_scope[key].trim()).map(key => [key, normalizeText(merged.evidence_scope[key], 255)]));
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

const mergeRetrievalResults = (queryResults, limit = MAX_GROUNDED_HITS) => {
  const fused = new Map();
  queryResults.forEach((entry, queryIndex) => {
    const graphProofs = new Set(entry?.result?.retrieval?.vector_mode === "graph_witnesses"
      ? asArray(entry.result.relationships).filter(edge => edge.endpoints_authorized === true
        && ['DETERMINISTIC', 'SOURCE_EXPLICIT', 'HUMAN_VERIFIED'].includes(edge.provenance_type)
        && edge.source_canonical_id && edge.target_canonical_id && edge.source_canonical_id !== edge.target_canonical_id)
        .flatMap(edge => asArray(edge.evidence_ids)) : []);
    asArray(entry?.result?.results).forEach((hit, rank) => {
      const key = hit?.chunk_id || hit?.citation?.id;
      // A permission-checked exact graph witness is evidence even though it has
      // no lexical/vector similarity score. Keep its rank signal at zero rather
      // than manufacturing a confidence score to get past the search threshold.
      if (!key || Number(hit.score || 0) < MIN_GROUNDED_SCORE && !graphProofs.has(hit.citation?.id)) return;
      const current = fused.get(key) || {
        hit,
        bestScore: Number(hit.score || 0),
        reciprocalRank: 0,
        queryIndexes: new Set()
      };
      if (Number(hit.score || 0) > current.bestScore) {
        current.hit = hit;
        current.bestScore = Number(hit.score || 0);
      }
      current.reciprocalRank += 1 / (60 + rank + 1);
      current.queryIndexes.add(queryIndex);
      fused.set(key, current);
    });
  });
  const ranked = [...fused.values()].map((entry) => ({
    ...entry.hit,
    retrieval_query_match_count: entry.queryIndexes.size,
    retrieval_fusion_score: Number(Math.min(1, entry.bestScore * 0.82 + Math.min(0.18, entry.reciprocalRank * 4)).toFixed(6))
  })).sort((left, right) => (
    right.retrieval_fusion_score - left.retrieval_fusion_score
    || right.retrieval_query_match_count - left.retrieval_query_match_count
    || Number(right.score || 0) - Number(left.score || 0)
  ));
  const sourceCounts = new Map();
  const diversified = [];
  for (const hit of ranked) {
    const sourceKey = hit.source_id || hit.citation?.source_id || hit.chunk_id;
    const sourceCount = sourceCounts.get(sourceKey) || 0;
    if (sourceCount >= MAX_HITS_PER_SOURCE) continue;
    sourceCounts.set(sourceKey, sourceCount + 1);
    diversified.push(hit);
    if (diversified.length >= limit) break;
  }
  return diversified;
};

const assessEvidenceSufficiency = (hits = [], { contextRoute, question } = {}) => {
  const citationReady = asArray(hits).filter((hit) => hit?.citation?.id);
  const indexed = citationReady.filter((hit) => hit.source_kind !== "live_project");
  const liveCount = citationReady.length - indexed.length;
  const distinctSources = new Set(citationReady.map((hit) => hit.source_id || hit.citation?.source_id || hit.citation.id)).size;
  const scores = indexed.map((hit) => Number(hit.retrieval_fusion_score || hit.score || 0)).filter(Number.isFinite);
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
  return {
    score,
    status: score >= 65 ? "strong" : score >= 45 ? "usable" : "weak",
    citation_ready_count: citationReady.length,
    distinct_source_count: distinctSources,
    live_evidence_count: liveCount,
    corroborated_result_count: corroboratedCount,
    route_aligned_result_count: routeAlignedCount,
    topically_matched_result_count: topicallyMatchedCount,
    strongest_retrieval_score: Number(strongestScore.toFixed(4)),
    requires_more_context: score < 65
  };
};

const retrieveContext = ({ request, user, history, smartContext, integration, intentPlan, signal }) => execution.run({
  ...execution.current(), signal: signal && execution.current()?.signal ? AbortSignal.any([signal,execution.current().signal]) : signal || execution.current()?.signal
}, () => contextEngine.retrieve({
  request, user, history, smartContext, integration, intentPlan,
  dependencies: {
    search: runRagSearchBatch, liveEvidence: aiContextOrchestrator.buildLiveProjectEvidence,
    planContext: aiContextOrchestrator.planContext, merge: mergeRetrievalResults, assess: assessEvidenceSufficiency,
    // The LLM intent planner runs once before retrieval. Any second retrieval
    // round uses bounded deterministic variants, never another planning call.
    planQueries: ({ question }) => ({ search_queries: buildDeterministicRetrievalQueries(question) }),
    authorize: (hits, { signal } = {}) => authorizeFreshEvidence({ projectId: request.project_id, user, hits, asOf: request.filters?.as_of, signal }),
    expandParents: knowledgeRagService.expandEvidence, expandRelationships: knowledgeRagService.expandRelationships
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

const retrieveDirect = (input) => execution.run({ signal: input.signal || execution.current()?.signal, onProgress: input.onProgress || execution.current()?.onProgress }, async () => {
  const filters = await normalizeAssistantFilters({ projectId: input.projectId, appTypeId: input.appTypeId, base: input.filters });
  const request = knowledgeContracts.buildRetrievalRequest({ projectId: input.projectId, query: input.query, filters, budgets: input.budgets });
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
  const planning = Array.isArray(filters.requested_scopes) && !filters.requested_scopes.length ? {mode:"disabled",plan:null,reason:"NO_REQUESTED_CONTEXT"} : await require("./knowledgeIntentPlanning.service").planIntent({ request, user: input.user,
    integration: input.integration, integrationId: input.integrationId, history: input.history, signal: input.signal || execution.current()?.signal });
  const intentModelCalls = Number(execution.current().modelStats.calls || 0);
  const retrievalRequest = { ...request, budgets: { ...request.budgets,
    max_tool_calls: Math.max(0, request.budgets.max_tool_calls - intentModelCalls),
    max_cost_usd: Math.max(0, request.budgets.max_cost_usd - Number(execution.current().modelStats.reservedCostUsd || 0)),
    deadline_ms: Math.max(1, request.budgets.deadline_ms - (Date.now() - started)) } };
  const result = await retrieveContext({ request: retrievalRequest, user: input.user, intentPlan: planning.plan });
  const { context_packet, ...diagnostics } = result.retrieval;
  result.packet.retrieval = { ...diagnostics, ...result.packet.retrieval, intent_planning_mode: planning.mode,
    intent_planning_model_used: planning.mode === "llm", intent_model_calls: intentModelCalls, intent_plan_error_code: planning.reason,
    model_context_plan: planning.plan ? { source_kinds: planning.plan.source_kinds, information_needs: planning.plan.information_needs } : null };
  execution.emit("COMPLETED", "completed");
  return result.packet;
});

const retrieve = (input) => require("@hellotest/mcp/backend/gateway").retrievePacket(input);

// Adapt one authorized packet for existing search consumers without losing citation identity.
const retrieveSearch = async input => {
  const packet = await retrieve(input);
  const results = (packet.evidence || []).map(item => ({
    source_id: item.source_id, source_kind: item.source_kind, source_ref_id: item.source_ref_id,
    document_id: item.document_id, chunk_id: item.chunk_id || item.evidence_id, title: item.title,
    content: item.content, excerpt: item.content, score: item.scores?.fused || 0,
    citation: { ...item, id: item.evidence_id, label: item.title,
      current: item.freshness?.current, source_version: item.freshness?.source_version }
  }));
  return { project_id: input.projectId, query: input.query, results,
    retrieval: { ...packet.retrieval, returned_count: results.length, grounded_result_count: results.length,
      context_packet_id: packet.packet_id, context_transport: "mcp", model_context_plan: packet.retrieval?.model_context_plan },
    guardrails: knowledgeRagService.ASSISTANT_GUARDRAILS };
};

module.exports = { fetchEvidence: input => require('./knowledgeEvidence.service').fetchEvidence(input), retrieveSearch, retrieveDirect, retrieveContextDirect: retrieveContext, authorizeFreshEvidence, MAX_GROUNDED_HITS, MAX_HITS_PER_SOURCE, MIN_GROUNDED_SCORE, asArray, asObject, assessEvidenceSufficiency, buildDeterministicRetrievalQueries, createError, mergeRetrievalResults, normalizeAssistantFilters, normalizeId, retrieve, retrieveContext, runRagSearchBatch };
