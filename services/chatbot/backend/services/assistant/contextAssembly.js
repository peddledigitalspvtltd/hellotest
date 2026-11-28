"use strict";

const { buildContextPacket, RetrievalBudget, TERMINATION_REASONS } = require("@hellotest/knowledge/backend/services/knowledgeContracts.service");
const { assessEvidenceSufficiency } = require("@hellotest/knowledge/backend/services/knowledgeRetrieval.service");
const { contextFromPacket } = require("@hellotest/mcp/backend/gateway");

const list = value => Array.isArray(value) ? value : [];
const count = value => Math.max(0, Number(value) || 0);
const idOf = hit => hit.citation?.id || hit.evidence_id;
const budgetUsed = context => context.packet?.budget?.used || context.budget?.used || {};

// Give each ranked list a chance to contribute before a long first page can
// exhaust the final packet. The first occurrence supplies the citation text.
function interleaveEvidence(...groups) {
  const distinct = new Map();
  for (let index = 0; index < Math.max(0, ...groups.map(group => group.length)); index += 1) {
    for (const group of groups) {
      const hit = group[index];
      const id = hit && idOf(hit);
      if (id && !distinct.has(id)) distinct.set(id, hit);
    }
  }
  return [...distinct.values()];
}

function refinementBudgets(limits, context) {
  const used = budgetUsed(context);
  return {
    max_rounds: Math.max(0, limits.max_rounds - count(used.rounds)),
    max_queries: Math.max(0, limits.max_queries - count(used.queries)),
    max_candidates: Math.max(0, limits.max_candidates - count(used.candidates)),
    max_cost_usd: Math.max(0, limits.max_cost_usd - count(used.cost_usd))
  };
}

function assembleContext({ request, initial, refined, toolResult, informationNeeds }) {
  const selected = refined?.hits.length ? refined : initial;
  const stages = [initial, refined].filter(Boolean);
  const toolEvidence = list(toolResult?.evidence);
  const hits = interleaveEvidence(initial.hits, refined?.hits || [], toolEvidence);
  const relationships = new Map();
  for (const edge of [...stages.flatMap(stage => list(stage.packet.relationships)), ...list(toolResult?.relationships)]) {
    const id = edge.id || edge.knowledge_edge_id;
    const key = id || JSON.stringify([edge.source, edge.target, edge.type, edge.evidence_ids]);
    if (!relationships.has(key)) relationships.set(key, { ...edge, id });
  }

  // Keep the actual retrieval receipt available for same-turn recovery. This
  // budget packs one final context, so excerpts from different rounds share it.
  const budget = new RetrievalBudget(request.budgets);
  const sum = key => stages.reduce((total, stage) => total + count(budgetUsed(stage)[key]), 0);
  budget.reserve({ rounds: sum("rounds"), toolCalls: sum("tool_calls"), queries: sum("queries"),
    candidates: sum("candidates"), costUsd: Math.min(request.budgets.max_cost_usd, sum("cost_usd")) });

  const records = stages.map(stage => stage.retrieval);
  const { context_packet: _intermediate, context_graph: _previousTrace, ...base } = selected.retrieval;
  const authPartial = stages.some(stage => stage.packet.limitations?.authorization_partial);
  const unknownToolUsage = records.some(record => record.tool_call_usage_unknown);
  const rounds = records.flatMap(record => list(record.retrieval_rounds));
  const retrieval = {
    ...base,
    retrieval_request: request,
    status: hits.length ? "COMPLETE" : base.status,
    retrieval_failed: !hits.length && records.some(record => record.retrieval_failed),
    degraded: records.some(record => record.degraded || record.retrieval_failed) || ["partial", "failed"].includes(toolResult?.status),
    partial_authorization: authPartial,
    query_count: sum("queries"),
    query_chain: [...new Set(records.flatMap(record => list(record.query_chain)))],
    retrieval_rounds: rounds,
    retrieval_round_count: records.reduce((total, record) => total + count(record.retrieval_round_count), 0),
    embedding_batch_count: records.reduce((total, record) => total + count(record.embedding_batch_count), 0),
    candidate_count: sum("candidates"),
    ...(unknownToolUsage ? { tool_call_usage_unknown: true, tool_calls_reserved: stages.reduce((total, stage) => total
      + count(stage.budget?.tool_calls_reserved ?? stage.retrieval?.tool_calls_reserved ?? budgetUsed(stage).tool_calls), 0) } : {}),
    retrieval_error_count: records.reduce((total, record) => total + count(record.retrieval_error_count), 0),
    error_codes: [...new Set(records.flatMap(record => list(record.error_codes)))],
    vector_modes: [...new Set(records.flatMap(record => list(record.vector_modes)))],
    budget_partial: stages.some(stage => stage.packet.limitations?.budget_partial),
    unavailable_sources: Math.max(...stages.map(stage => count(stage.packet.limitations?.unavailable_sources)))
  };
  const packet = buildContextPacket({ retrievalRequest: request, interpretedRequest: selected.route, evidence: hits,
    relationships: [...relationships.values()], authorization: { ...selected.packet.authorization, authorization_partial: authPartial }, retrieval, budget });
  const context = contextFromPacket(packet, request);
  const finalHits = context.hits;
  const sufficiency = assessEvidenceSufficiency(finalHits, { contextRoute: selected.route, question: request.query, informationNeeds });
  const reason = budget.terminate(finalHits.length ? sufficiency.requires_more_context ? TERMINATION_REASONS.NO_NEW_QUERY
    : TERMINATION_REASONS.CONTEXT_SUFFICIENT : base.termination_reason || TERMINATION_REASONS.NO_EVIDENCE);
  const toolIds = new Set(toolEvidence.map(idOf));
  const liveContextCount = finalHits.filter(hit => hit.source_kind === "live_project").length;
  const liveScopes = new Set(finalHits.map(hit => hit.source_id?.replace(`live-project-${request.project_id}-`, "")));
  const liveCountScopes = { stories: "stories", test_cases: "test-cases", runs: "runs", environments: "execution-context",
    configurations: "execution-context", repository_objects: "object-repository", bugs: "bugs" };
  Object.assign(packet.retrieval, {
    evidence_sufficiency: sufficiency, termination_reason: reason, result_count: finalHits.length, grounded_result_count: finalHits.length,
    returned_count: finalHits.length, read_tool_evidence_count: finalHits.filter(hit => toolIds.has(idOf(hit))).length,
    live_context_count: liveContextCount, live_context_counts: Object.fromEntries(Object.entries(base.live_context_counts || {})
      .filter(([key]) => liveScopes.has(liveCountScopes[key]))),
    ...(sufficiency.requires_more_context && finalHits.length ? { status: "PARTIAL" } : {})
  });
  packet.limitations.retrieval_status = packet.retrieval.status;
  packet.budget = budget.snapshot();
  return contextFromPacket(packet, request);
}

module.exports = { assembleContext, interleaveEvidence, refinementBudgets };
