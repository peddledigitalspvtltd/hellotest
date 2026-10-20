const { aiInstructionBlock } = require('@hellotest/platform/backend/src/utils/aiInstructionBlocks');
const { createHash, randomUUID: uuid } = require("crypto");
const { VERSION, PRESENTATIONS, STAGES, JSON_SCHEMAS, MODEL_ANSWER_SCHEMA, validateContract, validateNode, contractError } = require("./knowledgeContractSchemas.service");
const { validateGroundedClaims, validatePresentation, normalizeClaimText } = require("./knowledgeGrounding.service");
const {validContentScope,witnessVisible} = require('./knowledgeGraphEvidence');
const CONTRACTS = Object.freeze({
  knowledge_object: "KnowledgeObject.v1",
  retrieval_request: "RetrievalRequest.v1",
  retrieval_event: "RetrievalEvent.v1",
  context_packet: "ContextPacket.v1",
  answer: "AnswerContract.v1"
});
const QUERY_CLASSES = Object.freeze(Object.fromEntries(["LOOKUP", "SEARCH", "ANALYTICAL", "INVESTIGATIVE", "MULTIMODAL"].map(key => [key, key])));
const TERMINATION_REASONS = Object.freeze({
  CONTEXT_SUFFICIENT: "context_sufficient",
  EVIDENCE_SATURATED: "evidence_saturated",
  MAX_ROUNDS: "max_rounds_reached",
  MAX_TOOL_CALLS: "max_tool_calls_reached",
  MAX_QUERIES: "max_queries_reached",
  CANDIDATE_BUDGET: "candidate_budget_reached",
  COST_BUDGET: "cost_budget_reached",
  DEADLINE: "deadline_exceeded",
  CONTEXT_BUDGET: "context_budget_reached",
  NO_NEW_QUERY: "no_new_query",
  NO_EVIDENCE: "no_authorized_evidence",
  REFUSED: "policy_refusal",
  FAILED: "retrieval_failed"
});
const DEFAULT_BUDGETS = Object.freeze({
  deadline_ms: 15000,
  max_rounds: 2,
  max_tool_calls: 10,
  max_queries: 5,
  max_candidates: 250,
  max_reranker_candidates: 40,
  max_evidence_items: 14,
  max_context_tokens: 12000,
  max_cost_usd: 0.04
});
const MAX_BUDGETS = Object.freeze({
  deadline_ms: 60000,
  max_rounds: 4,
  max_tool_calls: 20,
  max_queries: 10,
  max_candidates: 1000,
  max_reranker_candidates: 1000,
  max_evidence_items: 30,
  max_context_tokens: 32000,
  max_cost_usd: 10
});
const BUDGET_ALIASES = Object.freeze({
  max_rounds: "max_retrieval_rounds",
  max_candidates: "max_candidate_documents",
  max_cost_usd: "max_query_cost_usd"
});
const asObject = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const asArray = value => Array.isArray(value) ? value : [];
const compactText = (value, max = 4000) => String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max);
const uniqueStrings = (value, max = 100, itemMax = 255) => [...new Set(asArray(value).filter(item => typeof item === "string").map(item => compactText(item, itemMax)).filter(Boolean))].slice(0, max);
const boundedInt = (value, fallback, min, max) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Math.floor(Number(value)))) : fallback;
const hash = value => createHash("sha256").update(String(value ?? "")).digest("hex");
// Bound evidence with UTF-8 bytes; no tokenizer-specific undercount can exceed the ceiling.
const estimateTokens = value => Buffer.byteLength(String(value ?? ""), "utf8");
const iso = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const contractFields = type => ({
  contract_type: type,
  contract_version: VERSION,
  schema_id: `${type}.v1`
});
const normalizeBudgets = (value = {}) => {
  const input = asObject(value);
  return Object.fromEntries(Object.keys(DEFAULT_BUDGETS).map(key => {
    const raw = [input[key], input[BUDGET_ALIASES[key]]].filter(item => item !== undefined && item !== null && item !== "");
    const parsed = raw.length ? Math.min(...raw.map(item => Number.isFinite(Number(item)) ? Math.max(0, Number(item)) : DEFAULT_BUDGETS[key])) : DEFAULT_BUDGETS[key];
    return [key, Math.min(MAX_BUDGETS[key], key === "max_cost_usd" ? parsed : Math.floor(parsed))];
  }));
};
const classifyQuery = (query, { hasMedia = false } = {}) => {
  const text = compactText(query, 8000);
  if (hasMedia || /\b(?:image|screenshot|diagram|video|audio|recording|visual|ocr)\b/i.test(text))
    return QUERY_CLASSES.MULTIMODAL;
  if (/\b[A-Z][A-Z0-9_]{1,30}-[0-9]+\b/i.test(text) || /\b(?:AT[_-][0-9]+|(?:BUG|TC|TS|STORY|RUN|REQ)-?[A-Z0-9_-]+)\b/i.test(text) || /\b(?:id|key)\s*[:=#]\s*[A-Z0-9_-]+\b/i.test(text))
    return QUERY_CLASSES.LOOKUP;
  if (/\b(?:root cause|why did|why is|investigate|correlat|timeline|regression|failure chain|what changed|contribut)\b/i.test(text))
    return QUERY_CLASSES.INVESTIGATIVE;
  if (/\b(?:compare|trend|coverage|readiness|risk|summari[sz]e|aggregate|count|how many|across|distribution|breakdown)\b/i.test(text))
    return QUERY_CLASSES.ANALYTICAL;
  return QUERY_CLASSES.SEARCH;
};
const buildRetrievalRequest = ({ projectId, tenantId, query, filters, smartContext, conversation, budgets, queryClass, traceId, queryId, requestId } = {}) => {
  const input = asObject(filters);
  const normalizedQuery = compactText(query, 8000);
  const result = {
    ...contractFields("RetrievalRequest"),
    request_id: requestId || uuid(),
    query_id: queryId || uuid(),
    trace_id: traceId || uuid(),
    project_id: compactText(projectId, 500),
    tenant_id: compactText(tenantId || projectId, 500),
    query: normalizedQuery,
    query_fingerprint: hash(normalizedQuery),
    query_class: Object.values(QUERY_CLASSES).includes(queryClass) ? queryClass : classifyQuery(normalizedQuery),
    filters: {
      collection_ids: uniqueStrings(input.collection_ids || input.collections),
      source_ids: uniqueStrings(input.source_ids),
      source_kinds: uniqueStrings(input.source_kinds || input.source_types, 20, 80),
      app_type_id: compactText(input.app_type_id, 255) || null,
      ...(Array.isArray(input.requested_scopes) ? { requested_scopes: uniqueStrings(input.requested_scopes, 6, 30) } : {}),
      ...(input.agent_id ? { agent_id: compactText(input.agent_id, 255) } : {}),
      ...(input.evidence_scope ? { evidence_scope: Object.fromEntries(['story_id','test_case_id','execution_id','release_id','build','environment_id'].filter(key => compactText(input.evidence_scope[key], 255)).map(key => [key, compactText(input.evidence_scope[key], 255)])) } : {}),
      ...(input.as_of ? {
        as_of: iso(input.as_of)
      } : {})
    },
    smart_context: {
      source_ids: uniqueStrings(asObject(smartContext).source_ids),
      source_kinds: uniqueStrings(asObject(smartContext).source_kinds, 20, 80),
      reviewed_context_present: Boolean(compactText(asObject(smartContext).reviewed_context, 12000))
    },
    conversation: {
      session_id: compactText(asObject(conversation).session_id, 255) || null,
      history_message_count: boundedInt(asObject(conversation).history_message_count, 0, 0, 100),
      follow_up: Boolean(asObject(conversation).follow_up)
    },
    budgets: normalizeBudgets(budgets),
    created_at: new Date().toISOString()
  };
  return validateContract(result, "RetrievalRequest");
};
class RetrievalBudget {
  constructor(value, { now = Date.now() } = {}) {
    this.limits = normalizeBudgets(value);
    this.started_at_ms = now;
    this.deadline_at_ms = now + this.limits.deadline_ms;
    this.rounds_used = 0;
    this.tool_calls_used = 0;
    this.queries_used = 0;
    this.candidates_seen = 0;
    this.context_tokens_used = 0;
    this.cost_usd_used = 0;
    this.termination_reason = null;
  }
  remaining(now = Date.now()) {
    return {
      deadline_ms: Math.max(0, this.deadline_at_ms - now),
      rounds: Math.max(0, this.limits.max_rounds - this.rounds_used),
      tool_calls: Math.max(0, this.limits.max_tool_calls - this.tool_calls_used),
      queries: Math.max(0, this.limits.max_queries - this.queries_used),
      candidates: Math.max(0, this.limits.max_candidates - this.candidates_seen),
      context_tokens: Math.max(0, this.limits.max_context_tokens - this.context_tokens_used),
      cost_usd: Math.max(0, this.limits.max_cost_usd - this.cost_usd_used)
    };
  }
  canContinue(now = Date.now()) {
    if (this.termination_reason)
      return false;
    const checks = [[now >= this.deadline_at_ms, "DEADLINE"], [this.rounds_used >= this.limits.max_rounds, "MAX_ROUNDS"], [this.tool_calls_used >= this.limits.max_tool_calls, "MAX_TOOL_CALLS"], [this.queries_used >= this.limits.max_queries, "MAX_QUERIES"], [this.candidates_seen >= this.limits.max_candidates, "CANDIDATE_BUDGET"], [this.context_tokens_used >= this.limits.max_context_tokens, "CONTEXT_BUDGET"], [this.cost_usd_used >= this.limits.max_cost_usd, "COST_BUDGET"]];
    const exhausted = checks.find(([condition]) => condition);
    if (exhausted)
      this.terminate(TERMINATION_REASONS[exhausted[1]]);
    return !this.termination_reason;
  }
  reserve({ rounds = 0, queries = 0, toolCalls = 0, candidates = 0, contextTokens = 0, costUsd = 0, estimatedLatencyMs = 0 } = {}, now = Date.now()) {
    if (this.termination_reason)
      return false;
    const remaining = this.remaining(now);
    const work = {
      rounds,
      queries,
      tool_calls: toolCalls,
      candidates,
      context_tokens: contextTokens,
      cost_usd: costUsd
    };
    const reasons = {
      rounds: "MAX_ROUNDS",
      queries: "MAX_QUERIES",
      tool_calls: "MAX_TOOL_CALLS",
      candidates: "CANDIDATE_BUDGET",
      context_tokens: "CONTEXT_BUDGET",
      cost_usd: "COST_BUDGET"
    };
    if (!Number.isFinite(estimatedLatencyMs) || estimatedLatencyMs < 0 || now >= this.deadline_at_ms || estimatedLatencyMs > remaining.deadline_ms) {
      this.terminate(TERMINATION_REASONS.DEADLINE);
      return false;
    }
    for (const [key, value] of Object.entries(work)) {
      if (!Number.isFinite(value) || value < 0 || (key !== "cost_usd" && !Number.isSafeInteger(value)) || value > remaining[key]) {
        this.terminate(TERMINATION_REASONS[reasons[key]]);
        return false;
      }
    }
    this.rounds_used += rounds;
    this.queries_used += queries;
    this.tool_calls_used += toolCalls;
    this.candidates_seen += candidates;
    this.context_tokens_used += contextTokens;
    this.cost_usd_used += costUsd;
    return true;
  }
  assertCanExecute(work = {}, now = Date.now()) {
    if (!this.reserve(work, now))
      throw contractError("ERR_BUDGET_EXHAUSTED", "Knowledge retrieval budget exhausted");
    return true;
  }
  consumeRound(queryCount = 0, toolCallCount = 1, now = Date.now()) {
    return this.reserve({
      rounds: 1,
      queries: queryCount,
      toolCalls: toolCallCount
    }, now);
  }
  observe({ candidates = 0, contextTokens = 0, costUsd = 0 } = {}) {
    const accepted = {
      candidates: Math.min(Math.max(0, Number(candidates) || 0), this.limits.max_candidates - this.candidates_seen),
      contextTokens: Math.min(Math.max(0, Number(contextTokens) || 0), this.limits.max_context_tokens - this.context_tokens_used),
      costUsd: Math.min(Math.max(0, Number(costUsd) || 0), this.limits.max_cost_usd - this.cost_usd_used)
    };
    this.candidates_seen += accepted.candidates;
    this.context_tokens_used += accepted.contextTokens;
    this.cost_usd_used += accepted.costUsd;
    if (candidates > accepted.candidates || this.candidates_seen >= this.limits.max_candidates)
      this.terminate(TERMINATION_REASONS.CANDIDATE_BUDGET);
    if (contextTokens > accepted.contextTokens || this.context_tokens_used >= this.limits.max_context_tokens)
      this.terminate(TERMINATION_REASONS.CONTEXT_BUDGET);
    if (costUsd > accepted.costUsd || this.cost_usd_used >= this.limits.max_cost_usd)
      this.terminate(TERMINATION_REASONS.COST_BUDGET);
    return accepted;
  }
  terminate(reason) {
    this.termination_reason ||= Object.values(TERMINATION_REASONS).includes(reason) ? reason : TERMINATION_REASONS.FAILED;
    return this.termination_reason;
  }
  snapshot(now = Date.now()) {
    return {
      limits: {
        ...this.limits
      },
      used: {
        rounds: this.rounds_used,
        tool_calls: this.tool_calls_used,
        queries: this.queries_used,
        candidates: this.candidates_seen,
        context_tokens: this.context_tokens_used,
        cost_usd: this.cost_usd_used,
        elapsed_ms: Math.max(0, now - this.started_at_ms)
      },
      remaining: this.remaining(now),
      termination_reason: this.termination_reason
    };
  }
}
const budgetReasons = new Set(["max_rounds_reached", "max_tool_calls_reached", "max_queries_reached", "candidate_budget_reached", "cost_budget_reached", "deadline_exceeded", "context_budget_reached"]);
const normalizedLocation = raw => {
  const location = asObject(raw);
  const result = {};
  for (const key of ["page", "timestamp_start_ms", "timestamp_end_ms", "start_ms", "end_ms", "line", "chunk_index", "offset"])
    if (location[key] !== undefined)
      result[key] = location[key] === null ? null : boundedInt(location[key], 0, 0, Number.MAX_SAFE_INTEGER);
  for (const key of ["section", "field", "uri", "url", "title", "heading"])
    if (location[key] !== undefined)
      result[key] = location[key] === null ? null : compactText(location[key], key === "uri" || key === "url" ? 2000 : 500);
  return result;
};
const buildContextPacket = ({ retrievalRequest, interpretedRequest, evidence, relationships, authorization, retrieval, budget } = {}) => {
  const request = asObject(retrievalRequest), auth = asObject(authorization), retrieved = asObject(retrieval), limits = normalizeBudgets(request.budgets);
  const candidateLimit = limits.max_candidates;
  const maxTokens = Math.min(limits.max_context_tokens, budget?.remaining?.().context_tokens ?? limits.max_context_tokens);
  const selected = [], seen = new Set();
  let tokenCount = 0, truncated = false, tokenTruncated = false, denied = 0;
  const candidates = asArray(evidence).slice(0, candidateLimit);
  for (const raw of candidates) {
    if (selected.length >= limits.max_evidence_items) {
      truncated = true;
      break;
    }
    const hit = asObject(raw), citation = asObject(hit.citation), security = asObject(hit.security), visibility = asObject(hit.visibility);
    const current = hit.is_current ?? hit.freshness?.current ?? citation.is_current;
    const state = String(hit.state || hit.lifecycle?.state || "").toUpperCase();
    if (hit.authorized === false || security.allowed === false || ["DENIED", "NONE"].includes(visibility.state || security.visibility) || ["DELETED", "TOMBSTONED", "UNAVAILABLE"].includes(state) || (hit.project_id && request.project_id && hit.project_id !== request.project_id) || (hit.tenant_id && request.tenant_id && hit.tenant_id !== request.tenant_id)) {
      denied += 1;
      continue;
    }
    if (current === false && !request.filters?.as_of)
      continue;
    const excerptScope=validContentScope(hit.content,hit.content_scope)?hit.content_scope:null;
    const content = excerptScope?hit.content.slice(0,128000):compactText(hit.content || hit.excerpt, 128000);
    if (!content)
      continue;
    const evidenceId = compactText(citation.id || hit.evidence_id || `K-${hit.chunk_id || uuid()}`, 255);
    if (seen.has(evidenceId))
      continue;
    const location = normalizedLocation(hit.locator || citation.location || hit.location);
    const from = iso(hit.effective_from || citation.effective_from), to = iso(hit.effective_to || citation.effective_to);
    if (request.filters?.as_of && ((from && from > request.filters.as_of) || (to && to <= request.filters.as_of)))
      continue;
    const sourceKind = compactText(hit.source_kind || citation.source_kind, 80);
    const item = {
      evidence_id: evidenceId,
      canonical_id: compactText(hit.canonical_id || citation.canonical_id || hit.source_id || citation.source_id, 500) || null,
      knowledge_id: compactText(hit.knowledge_id || citation.knowledge_id || hit.document_id || citation.document_id, 500) || null,
      fragment_id: compactText(hit.fragment_id || citation.fragment_id || hit.chunk_id || citation.chunk_id, 500) || null,
      source_id: compactText(hit.source_id || citation.source_id, 500),
      source_kind: sourceKind,
      source_type: compactText(hit.source_type || sourceKind, 80),
      source_ref_id: compactText(hit.source_ref_id || citation.source_ref_id, 500) || null,
      document_id: compactText(hit.document_id || citation.document_id, 500) || null,
      chunk_id: compactText(hit.chunk_id || citation.chunk_id, 500) || null,
      title: compactText(hit.title || citation.label, 500),
      content,
      ...(excerptScope?{content_scope:excerptScope}:{}),
      location,
      locator: location,
      scores: {
        fused: Math.max(0, Number(hit.retrieval_fusion_score || hit.score) || 0),
        lexical: Math.max(0, Number(hit.lexical_score) || 0),
        semantic: Math.max(0, Number(hit.semantic_score) || 0)
      },
      integrity: {
        source_hash: compactText(citation.source_hash, 255) || null,
        version_hash: compactText(citation.version_hash, 255) || null,
        chunk_hash: compactText(citation.chunk_hash, 255) || hash(content),
        evidence_hash: hash(content)
      },
      authoritative_live: sourceKind === "live_project" || hit.authoritative_live === true,
      freshness: {
        current: typeof current === "boolean" ? current : null,
        status: request.filters?.as_of ? "HISTORICAL" : current === true ? "CURRENT" : current === false ? "STALE" : "UNKNOWN",
        effective_from: from,
        effective_to: to,
        source_version: compactText(hit.source_version || citation.source_version, 500) || null
      },
      visibility: {
        state: visibility.state === "PARTIAL" || security.visibility === "PARTIAL" ? "PARTIAL" : "FULL"
      },
      representation_type: compactText(hit.representation_type || "SOURCE_DIRECT", 80),
      uri: compactText(hit.uri || citation.uri || location.uri || location.url, 2000) || null,
      media_type: compactText(hit.media_type || citation.media_type, 100) || null
    };
    let itemTokens = estimateTokens(JSON.stringify(item));
    if (tokenCount + itemTokens > maxTokens) {
      truncated = true;
      tokenTruncated = true;
      const contentPoints=excerptScope?Array.from(content):null;
      const cut=length=>contentPoints?contentPoints.slice(0,length).join(''):content.slice(0,length);
      const scopeFor=value=>{
        const length=Array.from(value).length;
        const segments=excerptScope.segments.filter(part=>part.content_start<length).map(part=>({...part,content_end:Math.min(length,part.content_end),source_end:part.source_start+Math.min(length,part.content_end)-part.content_start}));
        return {...excerptScope,segments,omitted_codepoints:excerptScope.source_length-segments.reduce((sum,part)=>sum+part.source_end-part.source_start,0)};
      };
      let low = 0, high = contentPoints?contentPoints.length:item.content.length;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        const candidateContent=cut(mid);
        if (tokenCount + estimateTokens(JSON.stringify({
          ...item,
          content: candidateContent,
          ...(excerptScope?{content_scope:scopeFor(candidateContent)}:{})
        })) <= maxTokens)
          low = mid;
        else
          high = mid - 1;
      }
      item.content = excerptScope?cut(low):cut(low).trim();
      if (!item.content)
        continue;
      if(excerptScope)item.content_scope=scopeFor(item.content);
      item.integrity.evidence_hash = hash(item.content);
      itemTokens = estimateTokens(JSON.stringify(item));
      if (tokenCount + itemTokens > maxTokens)
        continue;
    }
    selected.push(item);
    seen.add(evidenceId);
    tokenCount += itemTokens;
  }
  const candidateTruncated = asArray(evidence).length > candidateLimit;
  budget?.observe?.({
    candidates: Math.max(0, Math.min(candidateLimit, Math.max(candidates.length, Number(retrieved.candidate_count) || 0)) - (budget?.candidates_seen || 0)),
    contextTokens: tokenCount
  });
  if (candidateTruncated)
    budget?.terminate?.(TERMINATION_REASONS.CANDIDATE_BUDGET);
  if (truncated)
    budget?.terminate?.(TERMINATION_REASONS.CONTEXT_BUDGET);
  const allowed = new Set(selected.map(item => item.evidence_id));
  const safeRelationships = asArray(relationships).slice(0, 100).flatMap(raw => {
    const edge = asObject(raw), refs = uniqueStrings(edge.evidence_ids);
    const source = compactText(edge.source || edge.source_canonical_id, 500), target = compactText(edge.target || edge.target_canonical_id, 500);
    const provenance = compactText(edge.provenance_type, 80);
    const span=edge.witness_span,proof=span&&selected.find(item=>item.evidence_id===span.evidence_id);
    const groundedSpan=!span||refs.includes(span.evidence_id)&&proof&&witnessVisible(proof,span);
    return source && target && source !== target && ['SOURCE_EXPLICIT','DETERMINISTIC','HUMAN_VERIFIED'].includes(provenance) && groundedSpan && refs.length && refs.every(id => allowed.has(id)) ? [{
        source,
        target,
        type: compactText(edge.type || edge.relationship_type, 80),
        evidence_ids: refs,
        provenance_type: provenance,
        ...(span?{witness_span:{evidence_id:span.evidence_id,start:span.start,end:span.end,offset_unit:'unicode_codepoint',offset_basis:'source_chunk'}}:{})
      }] : [];
  });
  const authorizationPartial = Boolean(auth.authorization_partial || auth.partially_visible_objects || denied || selected.some(item => item.visibility.state === "PARTIAL"));
  const budgetPartial = Boolean(truncated || candidateTruncated || budgetReasons.has(budget?.termination_reason) || retrieved.budget_partial);
  const unavailable = boundedInt(auth.unavailable_objects ?? retrieved.unavailable_sources, 0, 0, 1000000);
  const limitation = {
    retrieval_status: String(retrieved.status || "").toUpperCase() === "FAILED" || retrieved.retrieval_failed === true
      ? "FAILED"
      : String(retrieved.status || "").toUpperCase() === "PARTIAL" || retrieved.evidence_sufficiency?.requires_more_context === true || retrieved.degraded === true || budgetPartial || authorizationPartial || unavailable
        ? "PARTIAL" : "COMPLETE",
    authorization_partial: authorizationPartial,
    budget_partial: budgetPartial,
    stale_sources: selected.filter(item => item.freshness.status === "STALE").map(item => item.source_id),
    unavailable_sources: unavailable,
    freshness_unknown: !selected.length || selected.some(item => item.freshness.status === "UNKNOWN")
  };
  const packetId = uuid();
  const result = {
    ...contractFields("ContextPacket"),
    packet_id: packetId,
    context_packet_id: packetId,
    request_id: request.request_id || null,
    query_id: request.query_id || null,
    trace_id: request.trace_id || null,
    project_id: request.project_id || null,
    tenant_id: request.tenant_id || request.project_id || null,
    query: {
      text: request.query || "",
      original: request.query || "",
      interpreted: compactText(asObject(interpretedRequest).interpreted_query || request.query, 8000),
      class: request.query_class || "SEARCH"
    },
    interpreted_request: asObject(interpretedRequest),
    applied_filters: asObject(request.filters),
    evidence: selected,
    relationship_evidence: safeRelationships,
    relationships: safeRelationships,
    coverage: {
      evidence_count: selected.length,
      source_count: new Set(selected.map(item => item.source_id).filter(Boolean)).size,
      source_kinds: [...new Set(selected.map(item => item.source_kind).filter(Boolean))],
      context_tokens_estimated: tokenCount,
      context_budget_exhausted: tokenTruncated || tokenCount >= maxTokens
    },
    authorization: {
      project_scope_enforced: auth.project_scope_enforced === true || auth.enforced === true,
      source_acl_enforced: auth.source_acl_enforced === true || auth.enforced === true,
      allowed_record_permissions: uniqueStrings(auth.allowed_record_permissions, 100, 100)
    },
    authorization_coverage: {
      fully_visible_objects: selected.filter(item => item.visibility.state === "FULL").length,
      partially_visible_objects: Math.max(selected.filter(item => item.visibility.state === "PARTIAL").length, Number(auth.partially_visible_objects) || 0),
      unavailable_objects: unavailable
    },
    retrieval: {
      ...retrieved,
      status: limitation.retrieval_status,
      termination_reason: budget?.termination_reason || retrieved.termination_reason || null
    },
    limitations: limitation,
    evidence_quality: {
      retrieval_coverage: {
        value: null,
        method: "not_evaluated"
      },
      freshness: {
        status: request.filters?.as_of ? "HISTORICAL" : limitation.stale_sources.length ? "STALE" : limitation.freshness_unknown ? "UNKNOWN" : "CURRENT"
      },
      source_diversity: {
        independent_sources: new Set(selected.map(item => item.source_id)).size,
        method: "distinct_canonical_sources_not_independence_proof"
      },
      contradiction: {
        status: "NOT_EVALUATED",
        detector_version: null
      }
    },
    budget: budget?.snapshot?.() || null,
    created_at: new Date().toISOString()
  };
  return validateContract(result, "ContextPacket");
};
const buildAnswerContract = ({ outcome, contextPacket, terminationReason, claimVerifier, trustDeterministic = false } = {}) => {
  const result = asObject(outcome), packet = asObject(contextPacket), structure = asObject(result.answer_structure);
  const validated = validateGroundedClaims(structure.supported_claims || result.claims || structure.claims, packet.evidence, {
    claimVerifier,
    trustDeterministic
  });
  const requestedStatus = ["answered", "insufficient_context", "refused", "provider_unavailable", "error"].includes(result.status) ? result.status : "insufficient_context";
  // Provider outages still have useful retrieved passages. Only the server's
  // extractive fallback may retain claims under this status, and those claims
  // must pass the same evidence/citation validation as every other answer.
  const claims = requestedStatus === "answered" || (requestedStatus === "provider_unavailable" && result.safety?.extractive_grounded_fallback === true)
    ? validated.claims : [];
  const status = requestedStatus === "answered" && !claims.length ? "insufficient_context" : requestedStatus;
  const fallback = {
    insufficient_context: "The authorized evidence does not support a grounded answer yet. Add or refine the relevant sources and try again.",
    refused: "This request cannot be answered within the authorized project scope.",
    provider_unavailable: "The answer provider is unavailable. The authorized sources remain available for review.",
    error: "The answer could not be completed. Please try again."
  };
  const rendered = claims.map(claim => `${claim.classification === "INTERPRETATION" ? "Interpretation: " : ""}${claim.statement} ${claim.evidence_ids.map(id => `[${id}]`).join(" ")}`);
  const summary = rendered.length ? rendered.slice(0, 2).join("\n\n") : fallback[status] || fallback.insufficient_context;
  const approved = new Set(claims.map(claim => normalizeClaimText(claim.statement)));
  const originalSections = [structure.summary || result.content, ...asArray(structure.findings), ...asArray(structure.recommendations)].filter(value => typeof value === "string" && value.trim());
  const rejectedSections = originalSections.filter(value => !approved.has(normalizeClaimText(value))).length;
  const limitation = {
    retrieval_status: "PARTIAL",
    authorization_partial: false,
    budget_partial: false,
    stale_sources: [],
    unavailable_sources: 0,
    freshness_unknown: true,
    ...asObject(packet.limitations)
  };
  const reason = terminationReason || packet.budget?.termination_reason || packet.retrieval?.termination_reason || null;
  limitation.budget_partial ||= budgetReasons.has(reason);
  if (limitation.budget_partial && limitation.retrieval_status === "COMPLETE")
    limitation.retrieval_status = "PARTIAL";
  const gaps = [];
  if (packet.retrieval?.history_unavailable)
    gaps.push("Previous conversation context was unavailable; this answer uses the current question and retrieved sources.");
  if (limitation.retrieval_status === "PARTIAL" && !limitation.authorization_partial && !limitation.budget_partial && !limitation.unavailable_sources)
    gaps.push("The available retrieval evidence may not resolve all parts of this question.");
  if (limitation.authorization_partial)
    gaps.push("Some related evidence is outside the current authorized view; the answer may be incomplete.");
  if (limitation.budget_partial)
    gaps.push("Retrieval reached a configured limit; the available evidence may be incomplete.");
  if (limitation.stale_sources.length)
    gaps.push("Some selected evidence is stale.");
  if (limitation.freshness_unknown)
    gaps.push("The freshness of some selected evidence could not be established.");
  if (limitation.unavailable_sources)
    gaps.push(`${limitation.unavailable_sources} source${limitation.unavailable_sources === 1 ? " is" : "s are"} unavailable.`);
  if (validated.rejected)
    gaps.push(`${validated.rejected} claim${validated.rejected === 1 ? " was" : "s were"} removed during grounding validation.`);
  if (claims.some(claim => claim.classification === "INTERPRETATION"))
    gaps.push("Interpretations have valid source references but have not passed an independent entailment check.");
  const presentation = validatePresentation(structure.presentation || result.presentation, packet, claims);
  const answer = {
    ...contractFields("AnswerContract"),
    answer_id: uuid(),
    request_id: packet.request_id || null,
    query_id: packet.query_id || null,
    trace_id: packet.trace_id || null,
    context_packet_id: packet.context_packet_id || packet.packet_id || null,
    status,
    answer: {
      summary
    },
    presentation: presentation.presentation,
    summary,
    findings: rendered,
    recommendations: [],
    evidence_gaps: gaps,
    claims,
    citation_ids: [...new Set(claims.flatMap(claim => claim.evidence_ids))],
    grounding: {
      context_evidence_count: asArray(packet.evidence).length,
      supported_claim_count: claims.filter(claim => claim.classification === "SUPPORTED").length,
      citation_bound_claim_count: claims.length,
      unsupported_claim_count: validated.rejected,
      unsupported_section_count: rejectedSections,
      claim_citation_coverage: claims.length ? 1 : 0,
      model_confidence_accepted: false,
      validation_method: trustDeterministic ? "server_deterministic" : claimVerifier ? "entailment_adapter_and_citation_binding" : "extractive_or_labeled_citation_binding",
      presentation_rejected: presentation.rejected
    },
    limitations: limitation,
    evidence_quality: asObject(packet.evidence_quality),
    termination_reason: reason,
    created_at: new Date().toISOString()
  };
  return validateContract(answer, "AnswerContract");
};
const applyAnswerContract = (outcome, answerContract, contextPacket) => {
  validateContract(answerContract, "AnswerContract");
  const packet = asObject(contextPacket), sourceCitations = new Map(asArray(outcome?.citations).map(citation => [citation.id, citation]));
  const evidenceById = new Map(asArray(packet.evidence).map(item => [item.evidence_id, item]));
  const citations = answerContract.citation_ids.flatMap(id => {
    const source = evidenceById.get(id);
    if (!source)
      return [];
    const existing = sourceCitations.get(id);
    return [{
        id,
        label: source.title,
        source_id: source.source_id,
        source_kind: source.source_kind,
        source_ref_id: source.source_ref_id,
        document_id: source.document_id,
        chunk_id: source.chunk_id,
        canonical_id: source.canonical_id,
        knowledge_id: source.knowledge_id,
        fragment_id: source.fragment_id,
        location: source.location,
        source_hash: source.integrity?.source_hash,
        version_hash: source.integrity?.version_hash,
        chunk_hash: source.integrity?.chunk_hash,
        ...(existing?.rank !== undefined ? {
          rank: existing.rank
        } : {})
      }];
  });
  return {
    status: answerContract.status,
    content: [answerContract.summary, ...answerContract.findings.slice(2), ...answerContract.evidence_gaps.map(gap => `Limitation: ${gap}`)].filter(Boolean).join("\n\n"),
    citations,
    answer_structure: {
      summary: answerContract.summary,
      findings: answerContract.findings,
      recommendations: answerContract.recommendations,
      evidence_gaps: answerContract.evidence_gaps,
      supported_claims: answerContract.claims.map(claim => ({
        ...claim,
        citation_ids: claim.evidence_ids
      })),
      presentation: answerContract.presentation
    },
    answer_contract: answerContract,
    safety: {
      ...asObject(outcome?.safety),
      rendered_from_validated_claims: true,
      model_confidence_accepted: false
    }
  };
};
const buildKnowledgeObject = (input = {}) => validateContract({
  ...contractFields("KnowledgeObject"),
  ...input
}, "KnowledgeObject");
const progressMessages = Object.freeze({
  QUERY_RECEIVED: "Request received",
  QUERY_UNDERSTANDING: "Understanding the request",
  INTENT_ANALYSIS: "Understanding the user's intent",
  AUTHORIZATION: "Checking authorized knowledge",
  RETRIEVAL_PLANNING: "Planning bounded retrieval",
  READING_PROJECT: "Reading the current project",
  READING_STORIES: "Reading authorized Stories",
  READING_TEST_CASES: "Reading authorized Test Cases",
  READING_RUNS: "Reading authorized Test Runs",
  READING_BUGS: "Reading authorized Defects",
  READING_AUTOMATION: "Reading authorized automation evidence",
  READING_EXECUTION_CONTEXT: "Reading authorized execution context",
  KNOWLEDGE_REPO_SEARCH: "Searching the authorized Knowledge Repository",
  CONTEXT_SUFFICIENCY: "Checking evidence sufficiency",
  STRUCTURED_LOOKUP: "Looking up authorized records",
  LEXICAL_SEARCH: "Searching authorized text",
  SEMANTIC_SEARCH: "Searching related authorized evidence",
  HYBRID_SEARCH: "Searching authorized knowledge",
  RELATIONSHIP_SEARCH: "Checking authorized relationships",
  MULTIMODAL_SEARCH: "Searching authorized media",
  RERANKING: "Selecting relevant evidence",
  PARENT_EXPANSION: "Checking authorized surrounding context",
  CONTEXT_ASSEMBLY: "Preparing bounded evidence",
  GENERATION: "Preparing an evidence-based answer",
  VALIDATION: "Validating claims and references",
  COMPLETED: "Answer ready",
  FAILED: "The request could not be completed"
});
const buildRetrievalEvent = ({ stage, status = "IN_PROGRESS", traceId, queryId, requestId, sequence = 0, metrics, trustedMessage, contextPacketId, answerId, terminationReason, errorCode } = {}) => {
  stage = String(stage || "").toUpperCase();
  const statusAliases = {
    RUNNING: "IN_PROGRESS",
    PROGRESS: "IN_PROGRESS",
    COMPLETED: "COMPLETE",
    DONE: "COMPLETE",
    ERROR: "FAILED"
  };
  status = String(status).toUpperCase();
  status = statusAliases[status] || status;
  if (stage === "COMPLETED" && status === "IN_PROGRESS")
    status = "COMPLETE";
  if (stage === "FAILED")
    status = "FAILED";
  const allowedMetrics = ["candidates_found", "candidates_selected", "elapsed_ms", "context_tokens", "input_tokens", "output_tokens", "cost_usd", "retrieval_rounds", "model_attempt", "model_max_attempts", "retry_delay_ms"];
  const metricAliases = {
    candidate_count: "candidates_found",
    result_count: "candidates_selected",
    rounds: "retrieval_rounds",
    latency_ms: "elapsed_ms"
  };
  const safeMetrics = Object.fromEntries(Object.entries(asObject(metrics)).flatMap(([key, value]) => {
    const name = metricAliases[key] || key;
    return allowedMetrics.includes(name) ? [[name, value]] : [];
  }));
  const event = {
    ...contractFields("RetrievalEvent"),
    event_type: stage === "FAILED" ? "error" : stage === "COMPLETED" ? "result" : "progress",
    request_id: requestId,
    query_id: queryId,
    trace_id: traceId,
    sequence,
    stage,
    status,
    message: compactText(trustedMessage, 300) || progressMessages[stage] || "Knowledge retrieval progress",
    metrics: safeMetrics,
    context_packet_id: contextPacketId || null,
    answer_id: answerId || null,
    termination_reason: terminationReason || null,
    error_code: errorCode || null,
    created_at: new Date().toISOString()
  };
  return validateContract(event, "RetrievalEvent");
};
const MODEL_SYSTEM_INSTRUCTION = aiInstructionBlock("ai.knowledge.assistant", "knowledgeContracts.MODEL_SYSTEM_INSTRUCTION.1");
const buildModelRequest = ({ contextPacket, question, conversation = [], model, maxOutputTokens = 4000 } = {}) => {
  validateContract(contextPacket, "ContextPacket");
  if (!contextPacket.authorization.project_scope_enforced || !contextPacket.authorization.source_acl_enforced)
    throw contractError("ERR_AUTH_FORBIDDEN", "Model context must have verified project and source authorization");
  // Keep the canonical packet for audit/citations, but do not make the model
  // process repeated query plans, budgets, rankings and duplicate locators.
  // This remains a valid ContextPacket with the exact same evidence text/IDs,
  // scope, freshness, access limitations and source relationships.
  const modelContext = {
    ...contractFields("ContextPacket"),
    context_packet_id: contextPacket.context_packet_id,
    project_id: contextPacket.project_id ?? null,
    applied_filters: asObject(contextPacket.applied_filters),
    evidence: contextPacket.evidence.map(item => Object.fromEntries([
      "evidence_id", "source_id", "source_kind", "source_ref_id", "title", "content", "location",
      "authoritative_live", "freshness", "visibility", "representation_type", "uri", "media_type"
    ].filter(key => item[key] !== undefined).map(key => [key, item[key]]))),
    relationships: asArray(contextPacket.relationships || contextPacket.relationship_evidence),
    ...(contextPacket.coverage ? { coverage: contextPacket.coverage } : {}),
    authorization: contextPacket.authorization,
    limitations: contextPacket.limitations
  };
  validateContract(modelContext, "ContextPacket");
  return {
    messages: [{
        role: "system",
        content: MODEL_SYSTEM_INSTRUCTION
      }, {
        role: "user",
        content: JSON.stringify({
          question: compactText(question || contextPacket.query.text, 8000),
          conversation_for_reference_resolution: asArray(conversation).slice(-6).filter(item => item.role === "user").map(item => ({
            role: "user",
            content: compactText(item.content, 1200)
          })),
          context_packet: modelContext
        })
      }],
    model: model || undefined,
    max_output_tokens: boundedInt(maxOutputTokens, 4000, 1, 8000),
    output_schema: MODEL_ANSWER_SCHEMA,
    tools: [],
    telemetry: {
      trace_id: contextPacket.trace_id,
      query_id: contextPacket.query_id,
      context_packet_id: contextPacket.context_packet_id,
      evidence_ids: contextPacket.evidence.map(item => item.evidence_id)
    }
  };
};
const assertCompatibleContract = (value, expected) => validateContract(value, String(expected).replace(/\.v1$/, ""));
const validateModelAnswer = value => validateNode(value, MODEL_ANSWER_SCHEMA);
module.exports = {
  MODEL_ANSWER_SCHEMA,
  validateModelAnswer,
  CONTRACTS,
  DEFAULT_BUDGETS,
  MAX_BUDGETS,
  BUDGET_ALIASES,
  QUERY_CLASSES,
  TERMINATION_REASONS,
  PRESENTATIONS,
  STAGES,
  JSON_SCHEMAS,
  RetrievalBudget,
  assertCompatibleContract,
  validateContract,
  buildAnswerContract,
  applyAnswerContract,
  buildContextPacket,
  buildRetrievalRequest,
  buildKnowledgeObject,
  buildRetrievalEvent,
  buildModelRequest,
  classifyQuery,
  normalizeBudgets,
  _internals: {
    estimateTokens,
    hash,
    uniqueStrings,
    validateGroundedClaims,
    validatePresentation
  }
};
