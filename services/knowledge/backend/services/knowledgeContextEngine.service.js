const contracts = require("./knowledgeContracts.service");
const execution = require("./knowledgeExecution.service");
const { boundedRetrievalStage } = require("@hellotest/platform/backend/src/utils/knowledgeRetrievalTiming");

const array = (value) => Array.isArray(value) ? value : [];
const PLAN_SCOPE_BY_SOURCE_KIND = Object.freeze({
  requirement: "stories",
  test_case: "test-cases",
  execution: "runs",
  bug: "bugs",
  knowledge_item: "knowledge",
  file: "knowledge",
  text: "knowledge",
  chat: "knowledge",
  url: "knowledge",
  product_help: "knowledge"
});
const unique = (values) => [...new Set(values.filter(Boolean))];
const identity = (hit) => hit.chunk_id || hit.citation?.id;
const packetHits = (hits, packet) => {
  const accepted = new Map(array(packet.evidence).map((item) => [item.evidence_id, item]));
  return hits.filter((hit) => accepted.has(hit.citation?.id)).map((hit) => ({
    ...hit, content: accepted.get(hit.citation.id).content, citation: { ...hit.citation }
  }));
};

const anchoredQueries = (queries, { question, hits, seen }) => {
  const anchors = new Set(`${question} ${hits.map((hit) => `${hit.title || ""} ${hit.content || ""}`).join(" ")}`
    .toLowerCase().match(/[a-z0-9][a-z0-9_-]{3,}/g) || []);
  return [...new Set(array(queries).map((value) => String(value).trim()).filter(Boolean))]
    .filter((query) => !seen.has(query.toLowerCase()) && (query.toLowerCase().match(/[a-z0-9][a-z0-9_-]{3,}/g) || []).some((word) => anchors.has(word)));
};

// Context retrieval is independent of answer generation and can be consumed by
// chat, agents, or the public ContextPacket endpoint. Dependencies are injected
// so the same budgets and authorization boundaries can be evaluated offline.
const retrieve = async ({ request, user, history = [], smartContext = {}, integration, intentPlan, dependencies }) => {
  const { search, liveEvidence, planContext, merge, assess, planQueries, authorize, expandParents, expandRelationships } = dependencies;
  const budget = new contracts.RetrievalBudget(request.budgets);
  // Retrieval/enrichment must leave time to recheck live ACLs. Previously each
  // optional job could consume the entire budget and erase already-found hits.
  const authorizationReserveMs = Math.min(1_000, Math.max(1, Math.floor(budget.limits.deadline_ms / 6)));
  const stageTime = (cap, reserve = authorizationReserveMs) => Math.max(0, Math.min(cap, budget.remaining().deadline_ms - reserve));
  const stage = (task, code, timeoutMs) => boundedRetrievalStage(task, {
    timeoutMs, signal: execution.current()?.signal, code
  });
  const authorizeHits = (candidates, final = false) => candidates.length
    ? stage((signal) => authorize(candidates, { signal, timeoutMs: final ? budget.remaining().deadline_ms : stageTime(1_500) }),
      "AUTHORIZATION_TIMEOUT", final ? budget.remaining().deadline_ms : stageTime(1_500))
    : Promise.resolve({ allowed: [], denied_ids: [], partial: false });
  const filters = request.filters || {};
  const pinned = array(filters.source_ids).length || array(filters.collection_ids).length;
  const scopedLive = Array.isArray(filters.requested_scopes) && Object.keys(filters.evidence_scope || {}).length > 0;
  const nativeSourceKinds = unique(array(filters.requested_scopes).flatMap(scope => ({stories:['requirement'],'test-cases':['test_case'],automation:['test_case'],runs:['execution'],bugs:['bug']}[scope] || [])));
  const requestedScopes = array(filters.requested_scopes).length ? filters.requested_scopes : unique(array(filters.source_kinds).map(kind => PLAN_SCOPE_BY_SOURCE_KIND[kind]).filter(Boolean));
  const route = planContext({ prompt: request.query, mode: "chat", history, requestedScopes, agentId: filters.agent_id });
  const plannedKinds = unique(array(intentPlan?.source_kinds).map((kind) => String(kind || "").trim().toLowerCase()).filter((kind) => PLAN_SCOPE_BY_SOURCE_KIND[kind]));
  const plannedScopes = unique(plannedKinds.map((kind) => PLAN_SCOPE_BY_SOURCE_KIND[kind]));
  if (!array(filters.requested_scopes).length && !array(filters.source_kinds).length && !pinned && plannedScopes.length) {
    route.effective_scopes = unique([...plannedScopes, ...array(route.effective_scopes), "knowledge"]);
    route.priority_scopes = unique([...plannedScopes, ...array(route.priority_scopes)]).filter((scope) => route.effective_scopes.includes(scope));
    route.live_scopes = route.effective_scopes.filter((scope) => scope !== "knowledge");
    route.indexed_source_kinds = unique([...plannedKinds, ...array(route.indexed_source_kinds)]);
  }
  if (Array.isArray(filters.requested_scopes)) {
    route.effective_scopes = [...filters.requested_scopes];
    route.live_scopes = filters.requested_scopes.filter(scope => scope !== 'knowledge');
    route.priority_scopes = array(route.priority_scopes).filter(scope => filters.requested_scopes.includes(scope));
    const selectedKinds = { stories: ['requirement'], 'test-cases': ['test_case'], automation: ['test_case'], runs: ['execution'], bugs: ['bug'], knowledge: ['knowledge_item','file','text','chat','url'] };
    route.indexed_source_kinds = unique(filters.requested_scopes.flatMap(scope => selectedKinds[scope] || []));
  }
  route.information_needs = unique([...array(intentPlan?.information_needs), ...array(route.information_needs)]).slice(0, 12);
  route.intent_plan_applied = Boolean(plannedKinds.length || array(intentPlan?.queries).length);
  route.query_class = request.query_class;
  const allowedKinds = new Set(route.indexed_source_kinds || []);
  const selectedKinds = Array.isArray(filters.requested_scopes) && array(filters.source_kinds).length ? filters.source_kinds.filter(kind => allowedKinds.has(kind)) : filters.source_kinds;
  const indexedSelectionConflict = Array.isArray(filters.requested_scopes) && array(filters.source_kinds).length > 0 && !array(selectedKinds).length;
  const effectiveFilters = array(filters.source_kinds).length || pinned ? {...filters,...(Array.isArray(filters.requested_scopes) ? {source_kinds:array(filters.source_kinds).length ? selectedKinds : route.indexed_source_kinds} : {})} : { ...filters, source_kinds: route.indexed_source_kinds };
  const projectScope = { project_id: request.project_id, app_type_id: filters.app_type_id || null, filters: effectiveFilters, context_route: route };
  execution.emit("QUERY_UNDERSTANDING", "completed", { query_class: request.query_class });
  execution.emit("AUTHORIZATION", "started");
  const results = [];
  const errors = [];
  const rounds = [];
  const relationships = [];
  const seen = new Set();
  let hits = [];
  let live = { hits: [], counts: {}, route };
  let candidateCount = 0;
  let embeddingBatchCount = 0;
  let degraded = false;
  let partialAuthorization = false;
  let skippedQueryCount = 0;
  let accessChangedBeforeAssembly = false;
  const searchMode = execution.current()?.searchMode || "hybrid";
  let initialQueries = Array.isArray(filters.requested_scopes) && !filters.requested_scopes.length ? [] : [...new Set([request.query, ...array(intentPlan?.queries), smartContext.query, route.retrieval_query].filter(Boolean))]
    .slice(0, Math.min(5, budget.remaining().queries));
  let queries = initialQueries;
  execution.emit("RETRIEVAL_PLANNING", "completed", { query_count: queries.length });
  while (queries.length && budget.canContinue()) {
    const liveEnabled = (!Array.isArray(filters.requested_scopes) || array(route.live_scopes).length > 0) && !rounds.length && (!pinned || scopedLive) && !filters.as_of && budget.remaining().tool_calls >= 2;
    // Reserve part of the candidate budget for current native facts. Previously
    // indexed queries could consume every slot before the failed run or pinned
    // Story was added, silently losing the very evidence the user selected.
    const remainingCandidates = Math.max(0, budget.limits.max_candidates - candidateCount);
    const liveCandidateBudget = liveEnabled
      ? Math.min(Math.max(1, array(route.live_scopes).length), Math.max(1, Math.floor(remainingCandidates / 2)), remainingCandidates)
      : 0;
    const indexedCandidateBudget = remainingCandidates - liveCandidateBudget;
    if (!budget.consumeRound(queries.length, liveEnabled ? 2 : 1)) break;
    queries.forEach((query) => seen.add(query.toLowerCase()));
    const before = new Set(hits.map(identity));
    execution.emit(searchMode === "keyword" ? "LEXICAL_SEARCH" : "HYBRID_SEARCH", "started", { round: rounds.length + 1 });
    execution.emit("KNOWLEDGE_REPO_SEARCH", "started", { round: rounds.length + 1,
      message: `Searching the Knowledge Repository${rounds.length ? " again" : ""} with ${queries.length} focused quer${queries.length === 1 ? "y" : "ies"}.` });
    if (liveEnabled) execution.emit("STRUCTURED_LOOKUP", "started");
    try {
      const searchTimeoutMs = stageTime(5_000, authorizationReserveMs * 2);
      const liveTimeoutMs = Math.min(2_500, searchTimeoutMs);
      const readIndexed = (maxCandidates, timeoutMs) => stage((signal) => search({ queries, mode: searchMode,
        projectId: request.project_id, filters: effectiveFilters, integrationId: integration?.id, user, signal,
        timeoutMs: Math.max(1, timeoutMs - Math.min(50, Math.floor(timeoutMs / 10))), maxCandidates
      }), "INDEXED_SEARCH_TIMEOUT", timeoutMs);
      const jobs = [indexedSelectionConflict || !indexedCandidateBudget ? Promise.resolve({results:[],errors:[]}) : readIndexed(indexedCandidateBudget, searchTimeoutMs)];
      if (liveEnabled) jobs.push(stage((signal) => liveEvidence({ projectId: request.project_id, appTypeId: filters.app_type_id, prompt: request.query, user, route, sourceKinds: scopedLive ? nativeSourceKinds : effectiveFilters.source_kinds, evidenceScope: filters.evidence_scope, signal, timeoutMs: liveTimeoutMs }), "LIVE_CONTEXT_TIMEOUT", liveTimeoutMs));
      const settled = await Promise.allSettled(jobs);
      execution.assertActive();
      // A one-candidate request tries its explicitly selected live fact first.
      // If that fact is absent/unavailable, spend the same reserved slot on an
      // allowed KB lookup; do not return empty context solely due to reservation.
      if (!indexedCandidateBudget && !indexedSelectionConflict && remainingCandidates > 0
        && !(settled[1]?.status === "fulfilled" && array(settled[1].value?.hits).length) && stageTime(5_000) > 0) {
        [settled[0]] = await Promise.allSettled([readIndexed(remainingCandidates, stageTime(5_000))]);
      }
      for (const [index, entry] of settled.entries()) {
        if (entry.status === "rejected") {
          if (entry.reason?.name === "AbortError") throw entry.reason;
          degraded = true;
          errors.push(entry.reason?.code || "RETRIEVAL_UNAVAILABLE");
          continue;
        }
        if (index === 1) {
          live = entry.value;
          // Snapshot builders can return several scopes. The model context is
          // bounded by the caller's candidate limit even for live evidence.
          const indexedWork = results.filter(item => !item.counted).reduce((count, item) => count
            + Math.max(array(item.result?.results).length, Number(item.result?.retrieval?.candidate_count || 0)), 0);
          const unusedIndexedBudget = Math.max(0, indexedCandidateBudget - indexedWork);
          live.hits = array(live.hits).slice(0, liveCandidateBudget + unusedIndexedBudget);
          results.push({ query: "authoritative live project context", result: { results: live.hits, retrieval: { mode: "live_project", result_count: live.hits.length } } });
        } else {
          results.push(...array(entry.value.results));
          embeddingBatchCount += Number(entry.value.embedding_batch_count || 0);
          skippedQueryCount += Number(entry.value.skipped_query_count || 0);
          errors.push(...array(entry.value.errors).map((error) => error?.code || "SEARCH_UNAVAILABLE"));
          degraded ||= array(entry.value.errors).length > 0;
        }
      }
      const reservedLiveCandidates = results.filter(entry => !entry.counted && entry.result.retrieval?.mode === "live_project")
        .reduce((count, entry) => count + array(entry.result.results).length, 0);
      for (const entry of results) {
        const available = Math.max(0, budget.limits.max_candidates - candidateCount
          - (entry.result.retrieval?.mode === "live_project" ? 0 : reservedLiveCandidates));
        if (entry.counted) continue;
        entry.result.results = array(entry.result.results).slice(0, available);
        candidateCount += Math.min(available, Math.max(entry.result.results.length, Number(entry.result.retrieval?.candidate_count || 0)));
        entry.counted = true;
      }
      const summaries = results.map((entry) => entry.result.retrieval || {});
      errors.push(...summaries.flatMap((item) => array(item.error_codes)));
      degraded ||= summaries.some((item) => item.degraded);
      partialAuthorization ||= summaries.some((item) => item.source_acl?.partial || item.partial_authorization);
      execution.emit(searchMode === "keyword" ? "LEXICAL_SEARCH" : "HYBRID_SEARCH", "completed", { candidate_count: candidateCount });
      execution.emit("KNOWLEDGE_REPO_SEARCH", "completed", { candidate_count: candidateCount,
        message: `Knowledge Repository search found ${candidateCount} authorized candidate${candidateCount === 1 ? "" : "s"}.` });
      if (liveEnabled) execution.emit("STRUCTURED_LOOKUP", "completed", { evidence_count: live.hits.length });
      if (summaries.some((item) => item.vector_mode && item.vector_mode !== "not_applicable" && item.vector_mode !== "disabled")) {
        execution.emit("SEMANTIC_SEARCH", "completed", { degraded });
      }
      // RRF is ranking, not a claim that a cross-encoder reranker ran.
      hits = merge(results, Math.min(budget.limits.max_evidence_items, 30));
      const authorized = await authorizeHits(hits);
      hits = authorized.allowed;
      partialAuthorization ||= Boolean(authorized.partial || authorized.denied_ids?.length);
      execution.emit("AUTHORIZATION", "completed", { evidence_count: hits.length, partial: partialAuthorization });
      if (!rounds.length && hits.length && assess(hits, { contextRoute: route, question: request.query }).requires_more_context && stageTime(1_500, authorizationReserveMs * 2) > 0) {
        const expansionJobs = [];
        const expansionTimeoutMs = stageTime(1_500, authorizationReserveMs * 2);
        if (expandParents && candidateCount < budget.limits.max_candidates && budget.reserve({ toolCalls: 1 })) {
          execution.emit("PARENT_EXPANSION", "started");
          expansionJobs.push({ stage: "PARENT_EXPANSION", job: stage((signal) => expandParents({ signal, timeoutMs: expansionTimeoutMs, maxCandidates: Math.max(0, budget.limits.max_candidates - candidateCount), projectId: request.project_id, user, hits, window: 1, limit: Math.min(8, budget.remaining().candidates), asOf: filters.as_of }), "PARENT_EXPANSION_TIMEOUT", expansionTimeoutMs) });
        }
        if (expandRelationships && !pinned && !filters.app_type_id && !array(filters.source_kinds).length && !filters.as_of
          && candidateCount < budget.limits.max_candidates && ["LOOKUP", "ANALYTICAL", "INVESTIGATIVE"].includes(request.query_class) && budget.reserve({ toolCalls: 1 })) {
          execution.emit("RELATIONSHIP_SEARCH", "started");
          expansionJobs.push({ stage: "RELATIONSHIP_SEARCH", job: stage((signal) => expandRelationships({ signal, timeoutMs: expansionTimeoutMs, mode: searchMode, maxCandidates: Math.max(0, budget.limits.max_candidates - candidateCount), projectId: request.project_id, user, hits, query: request.query, limit: 6 }), "RELATIONSHIP_SEARCH_TIMEOUT", expansionTimeoutMs) });
        }
        const expansions = await Promise.allSettled(expansionJobs.map((item) => item.job));
        execution.assertActive();
        for (const [index, expansion] of expansions.entries()) {
          if (expansion.status === "rejected") {
            execution.assertActive();
            degraded = true;
            errors.push(expansion.reason?.code || "EXPANSION_UNAVAILABLE");
            execution.emit(expansionJobs[index].stage, "failed");
            continue;
          }
          const additions = array(expansion.value.results).slice(0, Math.max(0, budget.limits.max_candidates - candidateCount));
          errors.push(...array(expansion.value.retrieval?.error_codes));
          degraded ||= Boolean(expansion.value.retrieval?.degraded);
          candidateCount += additions.length;
          results.push({ query: expansionJobs[index].stage.toLowerCase(), result: { results: additions }, counted: true });
          relationships.push(...array(expansion.value.relationships));
          execution.emit(expansionJobs[index].stage, "completed", { evidence_count: additions.length });
        }
        hits = merge(results, Math.min(budget.limits.max_evidence_items, 30));
        const expandedAccess = await authorizeHits(hits);
        hits = expandedAccess.allowed;
        partialAuthorization ||= Boolean(expandedAccess.partial);
      }
      const sufficiency = assess(hits, { contextRoute: route, question: request.query });
      execution.emit("CONTEXT_SUFFICIENCY", "completed", { evidence_count: hits.length, round: rounds.length + 1,
        message: sufficiency.requires_more_context
          ? `Found ${hits.length} usable source${hits.length === 1 ? "" : "s"}; checking for more supporting context.`
          : `Found sufficient context from ${hits.length} authorized source${hits.length === 1 ? "" : "s"}.` });
      const novelty = hits.filter((hit) => !before.has(identity(hit))).length;
      rounds.push({ round: rounds.length + 1, query_count: queries.length, evidence_after: hits.length, new_evidence_count: novelty });
      if (hits.length && !sufficiency.requires_more_context) { budget.terminate(contracts.TERMINATION_REASONS.CONTEXT_SUFFICIENT); break; }
      if (candidateCount >= budget.limits.max_candidates) { budget.terminate(contracts.TERMINATION_REASONS.CANDIDATE_BUDGET); break; }
      if (rounds.length > 1 && !novelty) { budget.terminate(contracts.TERMINATION_REASONS.EVIDENCE_SATURATED); break; }
      if (!budget.canContinue() || !integration || !planQueries || budget.remaining().tool_calls < 2) break;
      execution.emit("RETRIEVAL_PLANNING", "started", { round: rounds.length + 1 });
      if (!budget.reserve({ toolCalls: 1 })) break;
      const planningTimeoutMs = stageTime(2_000);
      const plan = await stage((signal) => planQueries({ integration, question: request.query, hits, history, projectScope, reviewedContext: smartContext.reviewed_context, signal, timeoutMs: planningTimeoutMs }), "RETRIEVAL_PLANNING_TIMEOUT", planningTimeoutMs);
      queries = anchoredQueries(plan.search_queries || plan.queries, { question: request.query, hits, seen }).slice(0, budget.remaining().queries);
      execution.emit("RETRIEVAL_PLANNING", "completed", { query_count: queries.length });
      if (!queries.length) budget.terminate(contracts.TERMINATION_REASONS.NO_NEW_QUERY);
    } catch (error) {
      execution.assertActive();
      if (error?.name === "AbortError") throw error;
      errors.push(error?.code || "RETRIEVAL_UNAVAILABLE");
      degraded = true;
      if (error?.code === "DEADLINE_EXCEEDED") budget.terminate(contracts.TERMINATION_REASONS.DEADLINE);
      break;
    }
  }
  // A planner or expansion can outlive the access decision from initial search.
  // Context-only consumers receive the same final access gate as chat.
  if (hits.length) {
    try {
      if (budget.remaining().deadline_ms <= 0) throw Object.assign(new Error("Deadline reached before final authorization."), { code: "DEADLINE_EXCEEDED" });
      const access = await authorizeHits(hits, true);
      hits = access.allowed;
      accessChangedBeforeAssembly = Boolean(access.denied_ids?.length);
      partialAuthorization ||= Boolean(access.partial || access.denied_ids?.length);
    } catch (error) {
      execution.assertActive();
      hits = [];
      accessChangedBeforeAssembly = true;
      partialAuthorization = true;
      degraded = true;
      errors.push(error.code || "AUTHORIZATION_RECHECK_UNAVAILABLE");
      if (error.code === "DEADLINE_EXCEEDED") budget.terminate(contracts.TERMINATION_REASONS.DEADLINE);
    }
  }
  if (!hits.length && errors.some((code) => /TIMEOUT|DEADLINE_EXCEEDED/.test(code))) budget.terminate(contracts.TERMINATION_REASONS.DEADLINE);
  if (!budget.termination_reason) budget.terminate(hits.length
    ? assess(hits, { contextRoute: route, question: request.query }).requires_more_context
      ? contracts.TERMINATION_REASONS.NO_NEW_QUERY : contracts.TERMINATION_REASONS.CONTEXT_SUFFICIENT
    : contracts.TERMINATION_REASONS.NO_EVIDENCE);
  const liveMetadata = (evidence) => {
    const visible = new Set(evidence.map(identity));
    const allowedLive = live.hits.filter((hit) => visible.has(identity(hit)));
    const scopes = new Set(allowedLive.map((hit) => String(hit.source_id || "").replace(`live-project-${request.project_id}-`, "")));
    const countScopes = { stories: "stories", test_cases: "test-cases", runs: "runs", environments: "execution-context", configurations: "execution-context", repository_objects: "object-repository", bugs: "bugs" };
    return { live_context_count: allowedLive.length,
      live_context_counts: Object.fromEntries(Object.entries(live.counts || {}).filter(([key]) => scopes.has(countScopes[key]))) };
  };
  const retrieval = {
    chain_strategy: "authorized-hybrid+reciprocal-rank-fusion+bounded-expansion",
    retrieval_request: request, query_class: request.query_class, context_route: route,
    search_mode: searchMode, cost_limited_keyword_mode: searchMode === "keyword", skipped_query_count: skippedQueryCount, budget_partial: skippedQueryCount > 0,
    candidate_count: candidateCount, query_count: seen.size, query_chain: accessChangedBeforeAssembly ? [request.query] : [...seen], seed_query_count: initialQueries.length,
    retrieval_rounds: rounds, retrieval_round_count: rounds.length, embedding_batch_count: embeddingBatchCount,
    ...liveMetadata(hits),
    evidence_sufficiency: assess(hits, { contextRoute: route, question: request.query }),
    degraded, partial_authorization: partialAuthorization, retrieval_error_count: errors.length,
    error_codes: [...new Set(errors)], retrieval_failed: !hits.length && errors.length > 0,
    vector_modes: [...new Set(results.map((entry) => entry.result.retrieval?.vector_mode).filter(Boolean))]
  };
  execution.emit("CONTEXT_ASSEMBLY", "started");
  const evidenceRelationships = relationships.map((edge) => ({ ...edge,
    evidence_ids: hits.filter((hit) => [edge.source_canonical_id, edge.target_canonical_id].includes(hit.source_id)).map((hit) => hit.citation?.id).filter(Boolean)
  })).filter((edge) => hits.some((hit) => hit.source_id === edge.source_canonical_id) && hits.some((hit) => hit.source_id === edge.target_canonical_id));
  // Stage failures do not identify unavailable sources: local evidence can stay
  // accessible after an embedding or optional enrichment provider times out.
  const packet = contracts.buildContextPacket({ retrievalRequest: request, interpretedRequest: route, evidence: hits, relationships: evidenceRelationships, authorization: { project_scope_enforced: true, source_acl_enforced: true, authorization_partial: partialAuthorization }, retrieval, budget });
  hits = packetHits(hits, packet);
  Object.assign(retrieval, liveMetadata(hits));
  Object.assign(retrieval, { context_packet: packet, budget: budget.snapshot(), termination_reason: budget.termination_reason, result_count: hits.length, grounded_result_count: hits.length, returned_count: hits.length });
  execution.emit("CONTEXT_ASSEMBLY", "completed", { evidence_count: hits.length });
  return { request, packet, hits, retrieval, budget, projectScope, route };
};

module.exports = { retrieve, packetHits, anchoredQueries };
