"use strict";

// Validation stage: access is rechecked AFTER the model has answered.
//
// A turn can run for up to two minutes, and permissions can change while a model
// is writing. Before anything is saved or sent, every cited source is
// re-authorized and any claim whose evidence is no longer visible is dropped.
// This recheck is about access, not about whether the claims are true: claim
// checking is the claim verifier's job (see claimVerification.js), and the
// answer contract states which claims were verified.

const asArray = (value) => Array.isArray(value) ? value : [];

/**
 * Remove evidence the caller can no longer see from the packet, and bring every
 * derived count and limitation back in line with what remains. Mutates
 * `contextPacket` and `retrieval` in place.
 *
 * @param {{allowed: Array, denied_ids: Array}} access result of authorizeFreshEvidence
 * @returns {boolean} whether anything was removed
 */
const applyAccessRecheck = ({ contextPacket, retrieval, access, question }) => {
  const allowed = new Set(asArray(access.allowed).map((hit) => hit.citation?.id));
  contextPacket.evidence = contextPacket.evidence.filter((item) => allowed.has(item.evidence_id));
  if (!asArray(access.denied_ids).length) return false;
  retrieval.partial_authorization = true;
  retrieval.access_changed_during_answer = true;
  retrieval.live_context_counts = {};
  retrieval.live_context_count = contextPacket.evidence.filter((item) => item.source_kind === "live_project").length;
  contextPacket.retrieval.live_context_counts = {};
  contextPacket.retrieval.live_context_count = retrieval.live_context_count;
  contextPacket.limitations.authorization_partial = true;
  contextPacket.limitations.retrieval_status = "PARTIAL";
  contextPacket.coverage.evidence_count = contextPacket.evidence.length;
  contextPacket.coverage.source_count = new Set(contextPacket.evidence.map((item) => item.source_id)).size;
  contextPacket.coverage.source_kinds = [...new Set(contextPacket.evidence.map((item) => item.source_kind))];
  contextPacket.relationships = asArray(contextPacket.relationships).filter((edge) => asArray(edge.evidence_ids).every((id) => allowed.has(id)));
  contextPacket.relationship_evidence = contextPacket.relationships;
  const visibleSources = new Set(contextPacket.evidence.map((item) => item.source_id));
  contextPacket.limitations.stale_sources = asArray(contextPacket.limitations.stale_sources).filter((id) => visibleSources.has(id));
  contextPacket.limitations.freshness_unknown = contextPacket.evidence.some((item) => item.freshness?.status === "UNKNOWN");
  contextPacket.authorization_coverage.fully_visible_objects = contextPacket.evidence.filter((item) => item.visibility?.state === "FULL").length;
  contextPacket.authorization_coverage.partially_visible_objects = contextPacket.evidence.filter((item) => item.visibility?.state === "PARTIAL").length;
  contextPacket.evidence_quality.source_diversity.independent_sources = visibleSources.size;
  contextPacket.evidence_quality.freshness.status = contextPacket.limitations.stale_sources.length ? "STALE" : contextPacket.limitations.freshness_unknown ? "UNKNOWN" : "CURRENT";
  retrieval.grounded_result_count = contextPacket.evidence.length;
  retrieval.result_count = contextPacket.evidence.length;
  contextPacket.retrieval.grounded_result_count = contextPacket.evidence.length;
  contextPacket.retrieval.result_count = contextPacket.evidence.length;
  retrieval.query_chain = [question];
  contextPacket.retrieval.query_chain = [question];
  return true;
};

module.exports = { applyAccessRecheck };
