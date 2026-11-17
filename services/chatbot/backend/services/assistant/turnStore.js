"use strict";

// Turn store: idempotent turn bookkeeping and persistence for one chat turn.
//
//   openTurn      claims the turn by client turn id (or replays/resumes it) and
//                 stores the user's message
//   completeTurn  stores the assistant's message, marks the turn answered and
//                 records the outcome on the context trace
//
// Stages receive their collaborators explicitly so this module has no import
// cycle with the assistant service that composes it.

const asObject = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};

const createTurnStore = (deps) => {
  const { db, execution, createError, insertMessage, formatTurnResponse, revalidateStoredMessage, serializeSession, assertIdempotentTurnRequest } = deps;

  /**
   * @returns {Promise<{response: object} | {userMessage: object, reuse: object|null}>}
   *   `response` is a finished or pending turn to return as is. Otherwise the
   *   turn proceeds; `reuse` carries the evidence packet of a previous attempt
   *   that ended with the model unavailable, for a same-turn retry.
   */
  const openTurn = async ({ sessionId, sessionRow, user, clientTurnId, questionFingerprint, requestedIntegrationId, sanitizedQuestion,
    smartContext, smartContextFingerprint, retryProvider = false }) => {
    const assertSameTurnRequest = (originalUserMessage) => assertIdempotentTurnRequest({
      originalUserMessage, questionFingerprint, integrationId: requestedIntegrationId
    });
    let retriedUserMessage = null;
    let reuse = null;
    if (clientTurnId) {
      const completed = await db.prepare(`
        SELECT * FROM ai_knowledge_assistant_messages
        WHERE session_id = ? AND client_turn_id = ? AND role = 'assistant'
      `).get(sessionId, clientTurnId);
      if (completed) {
        const originalUserMessage = await db.prepare(`
          SELECT * FROM ai_knowledge_assistant_messages
          WHERE session_id = ? AND client_turn_id = ? AND role = 'user'
        `).get(sessionId, clientTurnId);
        assertSameTurnRequest(originalUserMessage);
        if (retryProvider && completed.status === "provider_unavailable") {
          // Keep what the failed attempt already retrieved. The retry spends one
          // synthesis call, not another round of planning and retrieval, and the
          // evidence is re-authorized before it reaches the model again.
          const previous = asObject(completed.retrieval);
          if (previous.context_packet?.contract_type === "ContextPacket" && Array.isArray(previous.context_packet.evidence) && previous.context_packet.evidence.length) {
            reuse = { packet: previous.context_packet, intent_plan: previous.intent_plan || null, retrieval: previous };
          }
          retriedUserMessage = await db.prepare(`
            WITH removed AS (
              DELETE FROM ai_knowledge_assistant_messages
              WHERE id = ? AND status = 'provider_unavailable'
              RETURNING id
            )
            UPDATE ai_knowledge_assistant_messages
            SET status = 'pending', updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND role = 'user' AND EXISTS (SELECT 1 FROM removed)
            RETURNING *
          `).get(completed.id, originalUserMessage.id);
        } else {
          return { response: await formatTurnResponse({
            sessionRow,
            userMessage: originalUserMessage,
            assistantMessage: await revalidateStoredMessage(completed, user),
            provider: completed.provider,
            model: completed.model,
            clientTurnId,
            replayed: true
          }) };
        }
      }
    }

    let userMessage = retriedUserMessage || await insertMessage({
      sessionId,
      projectId: sessionRow.project_id,
      role: "user",
      content: sanitizedQuestion.text,
      contentFingerprint: questionFingerprint,
      status: "pending",
      retrieval: {
        requested_integration_id: requestedIntegrationId,
        smart_context_fingerprint: smartContextFingerprint,
        smart_context_source_ids: smartContext.source_ids,
        smart_context_reviewed: Boolean(smartContext.reviewed_context)
      },
      safety: { input_redaction_count: sanitizedQuestion.redaction_count, risk_flags: sanitizedQuestion.risk_flags },
      clientTurnId,
      ignoreConflict: Boolean(clientTurnId)
    });
    if (!userMessage) {
      const existingUserMessage = await db.prepare(`
        SELECT * FROM ai_knowledge_assistant_messages
        WHERE session_id = ? AND client_turn_id = ? AND role = 'user'
      `).get(sessionId, clientTurnId);
      if (!existingUserMessage) throw createError("client_turn_id could not be resumed.", 409);
      assertSameTurnRequest(existingUserMessage);
      userMessage = await db.prepare(`
        UPDATE ai_knowledge_assistant_messages
        SET status = 'pending', updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND (status = 'error' OR (status = 'pending'
          AND updated_at < CURRENT_TIMESTAMP - INTERVAL '5 minutes'))
        RETURNING *
      `).get(existingUserMessage.id);
      if (!userMessage) {
        return { response: {
          pending: true,
          client_turn_id: clientTurnId,
          idempotent_replay: true,
          session: await serializeSession(sessionRow),
          user_message: existingUserMessage,
          retry_after_seconds: 3
        } };
      }
    }
    execution.current().turn.pendingMessageId = userMessage.id;
    return { userMessage, reuse };
  };

  const completeTurn = async ({ sessionId, sessionRow, userMessage, outcome, retrieval, provider, model, clientTurnId, questionFingerprint, user, contextPacket }) => {
    const assistantMessage = await insertMessage({
      sessionId,
      projectId: sessionRow.project_id,
      role: "assistant",
      content: outcome.content,
      status: outcome.status,
      citations: outcome.citations,
      retrieval,
      safety: {
        ...outcome.safety,
        project_scope_enforced: true,
        supported_sensitive_identifier_redaction_enforced: true,
        retrieved_content_untrusted: true,
        chained_grounding_enforced: true,
        no_model_memory_fallback: true,
        question_fingerprint: questionFingerprint
      },
      provider,
      model,
      clientTurnId,
      ignoreConflict: Boolean(clientTurnId)
    });
    const terminalAssistantMessage = assistantMessage || await db.prepare(`
      SELECT * FROM ai_knowledge_assistant_messages
      WHERE session_id = ? AND client_turn_id = ? AND role = 'assistant'
    `).get(sessionId, clientTurnId);
    execution.current().turn.pendingMessageId = null;
    await db.prepare("UPDATE ai_knowledge_assistant_messages SET status = 'answered', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(userMessage.id);
    await db.prepare("UPDATE ai_knowledge_assistant_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(sessionId);
    if (contextPacket?.retrieval?.context_graph?.status === "recorded" && assistantMessage?.id) {
      const citationIds = [...new Set((outcome.citations || []).map(citation => citation.id).filter(Boolean))].slice(0, 30);
      const citedSet = new Set(citationIds);
      const citedRelationships = (contextPacket.relationships || []).flatMap(edge => {
        const evidenceIds = (edge.evidence_ids || []).filter(id => citedSet.has(id));
        return edge.knowledge_edge_id && evidenceIds.length
          ? [{ knowledge_edge_id: edge.knowledge_edge_id, evidence_ids: evidenceIds }] : [];
      }).slice(0, 100);
      retrieval.context_graph_citations = await require("@hellotest/mcp/backend/contextTraceTools").rememberDecision({
        projectId: sessionRow.project_id, user, packet: contextPacket,
        event: { id: `citations:${terminalAssistantMessage.id}`, type: "CITATIONS_RECORDED",
          status: "recorded", reference_id: terminalAssistantMessage.id,
          rationale: "Citations were persisted with the assistant response after the answer contract was applied.",
          metadata: { evidence_ids: citationIds, relationships: citedRelationships } }
      });
      retrieval.context_graph_outcome = await require("@hellotest/mcp/backend/contextTraceTools").rememberDecision({
        projectId: sessionRow.project_id, user, packet: contextPacket,
        event: { id: `assistant-message:${terminalAssistantMessage.id}`, type: "OUTCOME_RECORDED",
          status: terminalAssistantMessage.status, reference_id: terminalAssistantMessage.id,
          rationale: "The assistant response was persisted after the native answer and grounding checks. This records its observed response status, not execution of a proposed action." }
      });
      // Save the actual outcome receipt beside the original packet. Returning it
      // only in memory made history and idempotent replay lose the task lineage.
      // A concurrent losing turn must never attach its packet to the saved reply.
      await execution.bounded(() => db.prepare(`UPDATE ai_knowledge_assistant_messages
        SET retrieval = retrieval || ?::jsonb WHERE id = ? AND session_id = ? AND project_id = ? AND role = 'assistant'`)
        .run({ context_graph_outcome: retrieval.context_graph_outcome }, assistantMessage.id, sessionId, sessionRow.project_id),
      { timeoutMs: 1500, signal: new AbortController().signal }).catch(() => {
        retrieval.context_graph_outcome_persistence = "unavailable";
      });
      assistantMessage.retrieval = retrieval;
    }
    return { assistantMessage, terminalAssistantMessage };
  };

  return { openTurn, completeTurn };
};

module.exports = { createTurnStore };
