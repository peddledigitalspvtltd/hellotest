"use strict";

// Synthesis stage: turn retrieved, authorized evidence into an answer outcome.
//
// One interface, and a fixed ladder of fallbacks so a model failure never throws
// retrieved evidence away:
//
//   1. no usable model or evidence-only request  -> the deterministic/extractive answer
//   2. model answer that satisfies the citation contract (optionally audited)
//   3. model failure after evidence was found     -> the extractive answer, marked
//                                                    model-unavailable (status
//                                                    provider_unavailable)
//
// Before this stage existed in this form a synthesis failure ended the turn in an
// error, the evidence was discarded, and a retry repeated planning and retrieval.

const { auditedClaimVerifier, specificsVerifier, verificationMode, verifyWithModel } = require("./claimVerification");

const createSynthesis = (deps) => {
  const { execution, createDeterministicLiveAnswer, createGroundedExtractiveFallback, respondWithoutModel, requestGroundedAnswer,
    normalizeModelAnswer, requestGroundedVerification, modelFailureCode, modelFailureMessage, waitForModelCallGap, createError } = deps;

  /**
   * @returns {Promise<{outcome: object, provider: string|null, model: string|null, trustedDeterministic: boolean,
   *   claimVerifier: Function|undefined, verificationMethod: string|undefined}>}
   */
  const synthesize = async ({ integration, integrationError, responseMode, question, hits, history, context, retrieval, contextPacket,
    reviewedContext, retrievalDisabled, intentModelCompletedAt, user, authorizeEvidence }) => {
    let trustedDeterministic = false;
    let provider = null;
    let model = null;
    let claimVerifier;
    let verificationMethod;
    const fallback = (reason) => {
      const deterministic = createDeterministicLiveAnswer({ hits, question, contextRoute: context.route });
      if (deterministic) { trustedDeterministic = true; return deterministic; }
      return createGroundedExtractiveFallback({ hits, reason, question, contextRoute: context.route });
    };
    let outcome;

    if (!hits.length) {
      outcome = respondWithoutModel({ status: "insufficient_context", reason: context.retrieval.retrieval_failed
        ? "Authorized retrieval is temporarily unavailable. Try again or narrow the selected sources."
        : "The selected sources do not contain enough authorized evidence. Add or refresh the related sources, or narrow your question." });
    } else if (responseMode === "evidence" || !integration) {
      outcome = fallback(responseMode === "evidence" ? "Retrieved passages from your authorized sources." : "Evidence is available; model synthesis is currently unavailable.");
      if (responseMode === "evidence") outcome.status = "answered";
      if (integrationError) retrieval.provider_error_code = "INTEGRATION_UNAVAILABLE";
    } else {
      // Permissions may change after retrieval. Recheck at the exact model-input
      // boundary, then retain the existing post-generation check before save.
      // A failed authorization read must stop synthesis rather than send stale
      // passages to a provider.
      const preflight = await authorizeEvidence(hits);
      const allowedEvidenceIds = new Set(preflight.allowed.map(hit => hit.citation?.id).filter(Boolean));
      const deniedCount = Math.max(0, hits.length - preflight.allowed.length);
      hits = preflight.allowed;
      contextPacket.evidence = (contextPacket.evidence || []).filter(item => allowedEvidenceIds.has(item.evidence_id));
      contextPacket.relationships = (contextPacket.relationships || []).filter(edge =>
        Array.isArray(edge.evidence_ids) && edge.evidence_ids.length && edge.evidence_ids.every(id => allowedEvidenceIds.has(id)));
      contextPacket.relationship_evidence = contextPacket.relationships;
      if (deniedCount) {
        retrieval.pre_model_access_rechecked = true;
        retrieval.pre_model_access_denied_count = deniedCount;
        contextPacket.limitations.authorization_partial = true;
        contextPacket.limitations.retrieval_status = "PARTIAL";
      }
      if (!hits.length) {
        outcome = respondWithoutModel({ status: "insufficient_context", reason: "The selected evidence is no longer available under your current permissions." });
        return { outcome, provider, model, trustedDeterministic, claimVerifier, verificationMethod };
      }
      provider = integration.name || "Configured LLM";
      model = integration.model;
      await waitForModelCallGap(intentModelCompletedAt);
      execution.assertActive();
      if (contextPacket?.retrieval?.context_graph?.status === "recorded") {
        const evidenceIds = hits.map(hit => hit.citation?.id).filter(Boolean).slice(0, 30);
        const allowedEvidence = new Set(evidenceIds);
        const relationships = (contextPacket.relationships || []).flatMap(edge => {
          const edgeEvidence = (edge.evidence_ids || []).filter(id => allowedEvidence.has(id));
          return edge.knowledge_edge_id && edgeEvidence.length
            ? [{ knowledge_edge_id: edge.knowledge_edge_id, evidence_ids: edgeEvidence }] : [];
        }).slice(0, 100);
        retrieval.context_trace_model_input = await require("@hellotest/mcp/backend/contextTraceTools").rememberDecision({
          projectId: contextPacket.project_id, user, packet: contextPacket,
          event: { id: `model-input:${contextPacket.context_packet_id}`, type: "CONTEXT_SENT", status: "submitted",
            rationale: "The recorded evidence identifiers were submitted in the grounded synthesis request.",
            metadata: { evidence_ids: evidenceIds, relationships } }
        });
      }
      execution.emit("GENERATION", "started", { message: `Working on the final answer from ${hits.length} authorized source${hits.length === 1 ? "" : "s"}.` });
      try {
        const candidate = await requestGroundedAnswer({ integration, question, hits, history,
          projectScope: context.projectScope, retrievalPlan: retrieval, reviewedContext, contextPacket });
        const normalized = normalizeModelAnswer(candidate, hits);
        if (normalized.safety?.invented_citations_rejected || normalized.safety?.citation_required) {
          throw Object.assign(new Error("The answer did not satisfy the evidence citation contract."), { code: "MODEL_INVALID_RESPONSE" });
        }
        outcome = { ...normalized, safety: { ...normalized.safety, model_synthesis_completed: true } };
        // Claims are always screened for invented identifiers and quotations. That
        // screen is not entailment and is labelled as what it is.
        claimVerifier = specificsVerifier;
        verificationMethod = "specifics_check";
        if (verificationMode() === "model" && outcome.status === "answered") {
          try {
            execution.emit("VALIDATION", "started", { message: "Auditing the draft answer against its cited evidence." });
            const audit = await verifyWithModel({ deps: { requestVerification: requestGroundedVerification, normalizeModelAnswer },
              integration, question, hits, draftOutcome: outcome, projectScope: context.projectScope, reviewedContext, contextPacket });
            // The audited answer replaces the draft, even when the auditor found it
            // unsupportable: an unsupported draft must not outlive its audit.
            outcome = { ...audit.outcome, safety: { ...audit.outcome.safety, model_synthesis_completed: true, model_verification_completed: true,
              verification_dropped_claim_count: audit.dropped_claim_count } };
            claimVerifier = auditedClaimVerifier(audit.kept_statements);
            verificationMethod = "model_audit";
            retrieval.verification = { status: "completed", dropped_claim_count: audit.dropped_claim_count };
          } catch (error) {
            execution.assertActive();
            // The draft stands, honestly labelled as not independently verified.
            retrieval.verification = { status: "unavailable", error_code: modelFailureCode(error) };
          }
        }
        execution.emit("GENERATION", "completed", { message: "Finished summarizing the retrieved project evidence." });
      } catch (error) {
        execution.assertActive();
        retrieval.provider_error_code = modelFailureCode(error);
        retrieval.provider_error_message = modelFailureMessage(retrieval.provider_error_code).replace("The retrieved evidence is available below.", "Retry or select another configured model.");
        execution.emit("GENERATION", "failed", { error_code: retrieval.provider_error_code });
        if (!hits.length) throw createError(retrieval.provider_error_message, 502, retrieval.provider_error_code);
        // Evidence was found, so it is kept: the turn ends with the extractive
        // answer, marked model-unavailable, and a retry reuses this evidence.
        outcome = fallback(modelFailureMessage(retrieval.provider_error_code));
        outcome.status = "provider_unavailable";
        retrieval.synthesis_fallback = trustedDeterministic ? "deterministic_live" : "extractive";
        claimVerifier = undefined;
      }
    }
    if (trustedDeterministic) claimVerifier = undefined;
    return { outcome, provider, model, trustedDeterministic, claimVerifier, verificationMethod };
  };

  return { synthesize };
};

module.exports = { createSynthesis };
