const { aiInstructionBlock } = require('@hellotest/platform/backend/src/utils/aiInstructionBlocks');
const { authorizeFreshEvidence, MAX_GROUNDED_HITS, MIN_GROUNDED_SCORE, asArray, asObject, assessEvidenceSufficiency, buildDeterministicRetrievalQueries, createError, mergeRetrievalResults, normalizeAssistantFilters, normalizeId, retrieve, retrieveContext } = require("@hellotest/knowledge/backend/services/knowledgeRetrieval.service");
const { randomUUID: uuid } = require("crypto");
const db = require("@hellotest/platform/backend/src/db");
const aiLlmSelectionService = require("@hellotest/integration/backend/services/aiLlmSelection.service");
const integrationService = require("@hellotest/integration/backend/services/integration.service");
const knowledgeRagService = require("@hellotest/knowledge/backend/services/knowledgeRag.service");
const knowledgeContracts = require("@hellotest/knowledge/backend/services/knowledgeContracts.service");
const execution = require("@hellotest/knowledge/backend/services/knowledgeExecution.service");
const modelGateway = require("@hellotest/knowledge/backend/services/knowledgeModelGateway.service");
const knowledgeAuthorization = require("@hellotest/knowledge/backend/services/knowledgeAuthorization.service");
const { getCompletionContent: completionContent } = require("@hellotest/platform/backend/src/utils/llmResponse");
const { modelFailureCode, modelFailureMessage } = require("@hellotest/platform/backend/src/utils/knowledgeAssistantErrors");
const {
  fingerprint,
  normalizeText,
  sanitizeAiText
} = require("@hellotest/platform/backend/src/security/aiTextPolicy");

const MAX_HISTORY_MESSAGES = 8;
const MAX_PLANNED_QUERIES = 3;
const MAX_RETRIEVAL_QUERIES = 5;
const MAX_RETRIEVAL_ROUNDS = 2;


const MAX_EVIDENCE_CHARS = 52_000;

const PLANNABLE_SOURCE_KINDS = new Set(["requirement", "test_case", "execution", "bug", "knowledge_item", "file", "text", "chat", "url", "product_help"]);
const LIVE_SCOPE_BY_SOURCE_KIND = Object.freeze({ requirement: "stories", test_case: "test-cases", execution: "runs", bug: "bugs" });
const SENSITIVE_DISCLOSURE_ACTION = /\b(?:reveal|expose|dump|print|return|extract|leak|bypass|repeat|display|list all|show(?: me)?|give(?: me)?|send(?: me)?|provide(?: me)?|tell me)\b/i;
const SENSITIVE_DISCLOSURE_TARGET = /\b(?:system prompt|developer message|hidden instructions?|chain[- ]of[- ]thought|private reasoning|api keys?|access tokens?|passwords?|secrets?|credentials?|personal data|pii|users table|user profiles?|e-?mail(?: addresses?)?|phone(?: numbers?)?|addresses?|date of birth|dob|passports?|aadhaar|aadhar|national ids?|usernames?|login ids?|ip addresses?|person names?|full names?|author names?|owner names?|reviewer names?|assignee names?|reporter names?)\b/i;
const POLICY_OR_REQUIREMENT_CONTEXT = /\b(?:policy|policies|requirement|requirements|retention|rotation|masking|redaction|encryption|handling|classification|control|controls|test|testing|acceptance criteria)\b/i;
const ACTUAL_VALUE_CONTEXT = /\b(?:actual|stored|raw|unredacted|current|real|value|values|contents?|verbatim)\b/i;
const requestsSensitiveDisclosure = (value) => {
  const text = String(value || "");
  if (!SENSITIVE_DISCLOSURE_ACTION.test(text) || !SENSITIVE_DISCLOSURE_TARGET.test(text)) return false;
  if (POLICY_OR_REQUIREMENT_CONTEXT.test(text) && !ACTUAL_VALUE_CONTEXT.test(text)) return false;
  return true;
};
const EXPLICITLY_OUTSIDE_DOMAIN = /\b(?:weather forecast|sports score|stock price|crypto price|investment advice|medical diagnosis|write malware|phishing email|celebrity gossip|recipe for|dating advice)\b/i;
const ASSISTANT_TURN_TIMEOUT_MS = 120_000;
const ANSWER_FINALIZATION_RESERVE_MS = 12_000;
const MIN_MODEL_CALL_GAP_MS = 300;
const scheduleAssistantDelay = setTimeout;
const cancelAssistantDelay = clearTimeout;
const answerModelTimeout = () => Math.max(0, Math.min(65_000,
  (execution.current()?.turn?.deadlineAt ?? (Date.now() + 77_000)) - Date.now() - ANSWER_FINALIZATION_RESERVE_MS));



const assistantRead = async (task, { timeoutMs = 5_000, code = "ASSISTANT_SETUP_TIMEOUT" } = {}) => {
  try { return await execution.bounded(task, { timeoutMs }); }
  catch (error) {
    execution.assertActive();
    if (/TIMEOUT|TIMED_OUT|DEADLINE_EXCEEDED/.test(error.code || "")) throw createError("The assistant read did not finish in time.", 503, code);
    throw error;
  }
};

const waitForModelCallGap = async (completedAt, minimumGapMs = MIN_MODEL_CALL_GAP_MS) => {
  const remainingMs = Math.max(0, Number(completedAt || 0) + minimumGapMs - Date.now());
  if (!remainingMs) return;
  const signal = execution.current()?.signal;
  await new Promise((resolve, reject) => {
    let timer;
    const stop = () => {
      cancelAssistantDelay(timer);
      signal?.removeEventListener("abort", stop);
      reject(signal?.reason || Object.assign(new Error("The assistant request was cancelled."), { code: "REQUEST_ABORTED" }));
    };
    if (signal?.aborted) return stop();
    timer = scheduleAssistantDelay(() => {
      signal?.removeEventListener("abort", stop);
      resolve();
    }, remainingMs);
    signal?.addEventListener("abort", stop, { once: true });
  });
};




const normalizeIntegrationId = (value) => normalizeId(value) || null;
const normalizeSmartContext = (value) => {
  const input = asObject(value);
  const reviewed = sanitizeAiText(normalizeText(input.reviewed_context, 12_000));
  return {
    query: normalizeText(input.query, 2_000),
    source_ids: [...new Set(asArray(input.source_ids).map(normalizeId).filter(Boolean))].slice(0, 100),
    source_kinds: [...new Set(asArray(input.source_kinds).map((item) => normalizeText(item, 80)).filter(Boolean))].slice(0, 20),
    reviewed_context: reviewed.text,
    risk_flags: reviewed.risk_flags || [],
    redaction_count: reviewed.redaction_count || 0
  };
};

// Smart Context narrows the user's selected sources. It cannot silently replace
// an explicit source filter with a different, broader retrieval scope.
const mergeAssistantContextFilters = ({ base, override, smartContext }) => {
  const merged = { ...asObject(base), ...asObject(override) };
  for (const key of ['source_ids', 'source_kinds']) {
    const smart = asArray(smartContext?.[key]);
    if (!smart.length) continue;
    const selected = asArray(merged[key]);
    const matches = selected.length ? smart.filter(value => selected.includes(value)) : smart;
    if (!matches.length) throw createError('Smart Context does not overlap your selected sources. Update the source selection or clear Smart Context.', 422, 'KNOWLEDGE_SOURCE_SELECTION_CONFLICT');
    merged[key] = [...new Set(matches)];
  }
  return merged;
};

const assertIdempotentTurnRequest = ({ originalUserMessage, questionFingerprint, integrationId }) => {
  if (originalUserMessage?.content_fingerprint !== questionFingerprint) {
    throw createError("client_turn_id was already used for a different message.", 409);
  }
  const originalIntegrationId = normalizeIntegrationId(asObject(originalUserMessage?.retrieval).requested_integration_id);
  if (originalIntegrationId !== normalizeIntegrationId(integrationId)) {
    throw createError("client_turn_id was already used with a different LLM integration.", 409);
  }
};

const isUsableAssistantIntegration = (integration) => Boolean(
  integration
  && integration.type === "llm"
  && integration.is_active
  && normalizeText(integration.model, 255)
  && integrationService.isUsableApiCredential(integration.api_key)
);

const integrationScope = (integration) => normalizeId(asObject(integration?.config).project_id);

const listAvailableLlmIntegrations = async ({ projectId, userId } = {}) => {
  const normalizedProjectId = normalizeId(projectId);
  if (!normalizedProjectId) throw createError("project_id is required.");
  const integrations = await integrationService.getIntegrations({ type: "llm", is_active: true });
  let defaultIntegrationId = null;
  try {
    const configured = await aiLlmSelectionService.resolveLlmIntegrationForUsage({
      userId,
      usageKey: "ai.knowledge.assistant",
      projectId: normalizedProjectId,
      fallback: "project-then-global",
      allowMissing: true
    });
    knowledgeRagService.assertLlmIntegrationProjectScope(configured, normalizedProjectId);
    if (isUsableAssistantIntegration(configured)) defaultIntegrationId = configured.id;
  } catch {
    defaultIntegrationId = null;
  }
  return integrations
    .filter((integration) => {
      const scopedProjectId = integrationScope(integration);
      return isUsableAssistantIntegration(integration) && (!scopedProjectId || scopedProjectId === normalizedProjectId);
    })
    .sort((left, right) => (
      Number(right.id === defaultIntegrationId) - Number(left.id === defaultIntegrationId)
      || Number(Boolean(integrationScope(right))) - Number(Boolean(integrationScope(left)))
    ))
    .map((integration) => ({
      id: integration.id,
      name: integration.name || "Configured LLM",
      model: integration.model,
      scope: integrationScope(integration) ? "project" : "workspace",
      project_id: integrationScope(integration) || null,
      is_default: integration.id === defaultIntegrationId
    }));
};

const resolveAssistantIntegration = async ({ integrationId, userId, projectId, allowMissing = true } = {}) => {
  const explicitIntegrationId = normalizeIntegrationId(integrationId);
  let integration = null;
  try {
    integration = await aiLlmSelectionService.resolveLlmIntegrationForUsage({
      integrationId: explicitIntegrationId,
      userId,
      usageKey: "ai.knowledge.assistant",
      projectId,
      fallback: "project-then-global",
      allowMissing
    });
    knowledgeRagService.assertLlmIntegrationProjectScope(integration, projectId);
  } catch (error) {
    if (error?.statusCode) throw error;
    throw createError("The selected LLM integration is unavailable.", 400, "LLM_INTEGRATION_UNAVAILABLE");
  }
  if (integration && !isUsableAssistantIntegration(integration)) {
    if (explicitIntegrationId) {
      throw createError("The selected LLM integration is not ready for use.", 400, "LLM_INTEGRATION_NOT_READY");
    }
    integration = null;
  }
  if (!integration && !explicitIntegrationId) {
    const available = await listAvailableLlmIntegrations({ projectId, userId });
    if (available.length) integration = await integrationService.getIntegration(available[0].id);
  }
  if (!integration && !allowMissing) throw createError("No active LLM integration is configured.", 400, "LLM_INTEGRATION_MISSING");
  return integration;
};



const serializeSession = async (row) => {
  const metrics = await db.prepare(`
    SELECT COUNT(*)::INTEGER AS message_count, MAX(created_at) AS last_message_at
    FROM ai_knowledge_assistant_messages WHERE session_id = ?
  `).get(row.id);
  return { ...row, message_count: Number(metrics?.message_count || 0), last_message_at: metrics?.last_message_at || null };
};

const assertSessionAccess = async (id, user) => {
  const row = await db.prepare("SELECT * FROM ai_knowledge_assistant_sessions WHERE id = ?").get(id);
  if (!row) throw createError("Knowledge assistant session not found.", 404);
  if (!row.created_by) {
    await db.prepare("UPDATE ai_knowledge_assistant_sessions SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND created_by IS NULL").run(id);
    if (user?.role !== "admin" && !user?.is_workspace_admin) {
      throw createError("This assistant conversation no longer has an authorized owner.", 403);
    }
    row.status = "archived";
  }
  if (row.created_by && row.created_by !== user?.id && user?.role !== "admin" && !user?.is_workspace_admin) {
    throw createError("This assistant conversation belongs to another workspace member.", 403);
  }
  return row;
};

const insertMessage = async ({ sessionId, projectId, role, content, status, citations = [], retrieval = {}, safety = {}, provider, model, clientTurnId, contentFingerprint, ignoreConflict = false }) => {
  execution.assertActive();
  const id = uuid();
  const safeContent = sanitizeAiText(normalizeText(content, 16_000));
  const row = await db.prepare(`
    INSERT INTO ai_knowledge_assistant_messages (
      id, session_id, project_id, role, content, status, citations, retrieval, safety,
      provider, model, client_turn_id, content_fingerprint
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ${ignoreConflict && clientTurnId ? "ON CONFLICT (session_id, client_turn_id, role) WHERE client_turn_id IS NOT NULL DO NOTHING" : ""}
    RETURNING *
  `).get(
    id, sessionId, projectId, role, safeContent.text, status, citations, retrieval,
    { ...safety, redaction_count: safeContent.redaction_count, risk_flags: [...new Set([...(safety.risk_flags || []), ...safeContent.risk_flags])] },
    provider || null, model || null, normalizeId(clientTurnId) || null, contentFingerprint || fingerprint(safeContent.text)
  );
  return row || null;
};

const extractJson = (value) => {
  const text = String(value || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  if (!text) throw new Error("Configured LLM returned an empty completion.");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  let parsed;
  try {
    parsed = JSON.parse(start >= 0 && end >= start ? text.slice(start, end + 1) : text);
  } catch {
    throw new Error("Configured LLM returned a non-JSON completion.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Configured LLM returned an invalid JSON completion.");
  }
  return parsed;
};

const openAiJsonCompletion = require("@hellotest/knowledge/backend/services/knowledgeJsonCompletion.service");
const { resolveChatCompletionsUrl, isJsonModeCompatibilityRejection } = openAiJsonCompletion;

modelGateway.registerAdapter("openai_compatible", openAiJsonCompletion);
const requestJsonCompletion = (input) => modelGateway.request(input);

const buildEvidencePayload = (hits, maxChars = MAX_EVIDENCE_CHARS) => {
  const evidence = [];
  let usedChars = 2;
  for (const hit of hits.slice(0, MAX_GROUNDED_HITS)) {
    const citation = asObject(hit.citation);
    const base = {
      citation_id: citation.id,
      title: normalizeText(hit.title, 500),
      source_kind: normalizeText(hit.source_kind, 80),
      source_ref_id: normalizeText(hit.source_ref_id, 500),
      source_hash: citation.source_hash || null,
      version_hash: citation.version_hash || null,
      chunk_hash: citation.chunk_hash || null,
      retrieval_score: Number(hit.retrieval_fusion_score || hit.score || 0),
      risk_flags: asArray(hit.risk_flags).slice(0, 10),
      content: ""
    };
    const overhead = JSON.stringify(base).length + 1;
    const remaining = Math.max(0, maxChars - usedChars - overhead);
    if (remaining < 160) break;
    base.content = normalizeText(hit.content, Math.min(4_500, remaining)) || "";
    const serializedLength = JSON.stringify(base).length + 1;
    if (!base.content || usedChars + serializedLength > maxChars) break;
    evidence.push(base);
    usedChars += serializedLength;
  }
  return evidence;
};

const buildSeedQueries = (question, history = []) => {
  const current = normalizeText(question, 4_000);
  const queries = current ? [current] : [];
  const lastUserMessage = [...history].reverse().find((message) => message?.role === "user" && normalizeText(message.content, 2_000));
  const wordCount = String(current || "").trim().split(/\s+/).filter(Boolean).length;
  const looksLikeFollowUp = wordCount <= 20 && /^(?:and|also|then|so|what about|how about|why|which|where|when)|\b(?:it|its|that|those|them|this|these|same)\b/i.test(current || "");
  if (lastUserMessage && looksLikeFollowUp) {
    queries.push(normalizeText(`Previous project question: ${lastUserMessage.content}\nCurrent follow-up: ${current}`, 4_000));
  }
  return [...new Map(queries.filter(Boolean).map((query) => [query.toLowerCase(), query])).values()].slice(0, 2);
};



const normalizeRetrievalPlanDetails = (candidate, existingQueries = []) => {
  const existing = new Set(existingQueries.map((query) => String(query || "").trim().toLowerCase()).filter(Boolean));
  const rawQueries = asArray(candidate?.search_queries || candidate?.queries || candidate?.retrieval_queries);
  const planned = [];
  for (const value of rawQueries) {
    const raw = typeof value === "string" ? value : value?.query;
    const sanitized = sanitizeAiText(normalizeText(raw, 700));
    const query = sanitized.text;
    const key = String(query || "").toLowerCase();
    if (!query || existing.has(key) || EXPLICITLY_OUTSIDE_DOMAIN.test(query) || requestsSensitiveDisclosure(query)) continue;
    existing.add(key);
    planned.push(query);
    if (planned.length >= MAX_PLANNED_QUERIES) break;
  }
  const sourceKinds = [...new Set(asArray(candidate?.source_kinds || candidate?.needed_source_kinds)
    .map((kind) => normalizeText(kind, 80).toLowerCase().replace(/[\s-]+/g, "_"))
    .filter((kind) => PLANNABLE_SOURCE_KINDS.has(kind)))].slice(0, 8);
  const informationNeeds = [...new Set(asArray(candidate?.information_needs || candidate?.missing_context)
    .map((item) => sanitizeAiText(normalizeText(typeof item === "string" ? item : item?.description, 400)).text)
    .filter(Boolean))].slice(0, 8);
  return {
    queries: planned,
    source_kinds: sourceKinds,
    information_needs: informationNeeds,
    stop_if_sufficient: candidate?.stop_if_sufficient !== false
  };
};

// Retain the small array contract used by existing agents/tests while the
// assistant consumes the richer planning contract above.
const normalizeRetrievalPlan = (candidate, existingQueries = []) => normalizeRetrievalPlanDetails(candidate, existingQueries).queries;





const buildProcessingTrace = ({ retrieval = {}, outcome = {}, provider, model } = {}) => {
  const route = asObject(retrieval.context_route);
  const plannedQueries = asArray(retrieval.planned_queries);
  const groundedCount = Number(retrieval.grounded_result_count || retrieval.returned_count || 0);
  return [
    {
      phase: "understand",
      label: "Understood the question",
      detail: `${normalizeText(retrieval.query_class, 40) || "SEARCH"} query; ${normalizeText(route.query_category || route.input_type, 80) || "project question"}; ${normalizeText(route.answer_depth, 40) || "standard"} answer; ${route.conversation_reference_used ? "resolved against recent conversation" : "treated as a new request"}`,
      status: "complete"
    },
    {
      phase: "plan",
      label: "Planned project context",
      detail: `${asArray(route.effective_scopes).join(", ") || "authorized project knowledge"}; ${asArray(route.information_needs).join("; ") || "question-specific evidence"}${plannedQueries.length ? `; model proposed ${plannedQueries.length} focused follow-up quer${plannedQueries.length === 1 ? "y" : "ies"}` : ""}`,
      status: "complete"
    },
    {
      phase: "retrieve",
      label: "Retrieved and ranked evidence",
      detail: `${Number(retrieval.query_count || 0)} search quer${Number(retrieval.query_count || 0) === 1 ? "y" : "ies"} across ${Number(retrieval.retrieval_round_count || 0)} adaptive round${Number(retrieval.retrieval_round_count || 0) === 1 ? "" : "s"}; ${groundedCount} grounded result${groundedCount === 1 ? "" : "s"}; ${Number(retrieval.live_context_count || 0)} live project snapshot${Number(retrieval.live_context_count || 0) === 1 ? "" : "s"}; ${asArray(retrieval.vector_modes).join(" + ") || "authorized structured retrieval"}`,
      status: retrieval.retrieval_failed ? "failed" : "complete"
    },
    {
      phase: "synthesize",
      label: "Synthesized the answer",
      detail: provider ? `${provider}${model ? ` · ${model}` : ""}` : "Deterministic evidence-only fallback",
      status: outcome.status === "error" ? "failed" : "complete"
    },
    {
      phase: "verify",
      label: "Checked grounding and citations",
      detail: `${outcome.safety?.model_verification_completed
        ? "A second model pass checked citation support and answer boundaries"
        : outcome.safety?.model_synthesis_completed
          ? "Citation IDs and grounded-answer contract validated"
          : "No unsupported model claims were added"}; ${Number(retrieval.answer_contract?.grounding?.supported_claim_count || 0)} supported claim${Number(retrieval.answer_contract?.grounding?.supported_claim_count || 0) === 1 ? "" : "s"}; stopped because ${normalizeText(retrieval.termination_reason, 80).replace(/_/g, " ") || "the bounded answer was complete"}`,
      status: "complete"
    }
  ];
};

const requestRetrievalPlan = async ({ integration, question, hits = [], history = [], projectScope, reviewedContext, signal, timeoutMs = 12_000 }) => {
  const active = execution.current();
  const request = knowledgeContracts.buildRetrievalRequest({
    projectId: projectScope.project_id,
    query: question,
    filters: projectScope.filters,
    budgets: { ...active?.modelBudget, max_evidence_items: Math.min(8, active?.modelBudget?.max_evidence_items ?? 8) },
    traceId: active?.traceId,
    queryId: active?.queryId,
    requestId: active?.requestId
  });
  const packet = knowledgeContracts.buildContextPacket({
    retrievalRequest: request,
    evidence: hits,
    authorization: { project_scope_enforced: true, source_acl_enforced: true }
  });
  const modelRequest = knowledgeContracts.buildModelRequest({ contextPacket: packet, question, conversation: history, model: integration.model });
  const data = JSON.parse(modelRequest.messages[1].content);
  data.reviewed_smart_context = normalizeText(reviewedContext, 1200);
  return requestJsonCompletion({
    integration,
    operation: "knowledge.assistant.plan-intent",
    timeoutMs,
    signal,
    maxOutputTokens: 768,
    messages: [
      {
        role: "system",
        content: [
          aiInstructionBlock("ai.knowledge.intent", "knowledgeAssistant.requestRetrievalPlan.2")
        ].join(" ")
      },
      { role: "user", content: JSON.stringify(data) }
    ]
  });
};

const requestGroundedAnswer = async ({ integration, question, hits, history = [], projectScope, retrievalPlan, reviewedContext, contextPacket }) => {
  if (!contextPacket) throw Object.assign(new Error("A bounded authorized ContextPacket is required before synthesis."), { code: "ERR_CONTRACT_VALIDATION" });
  const modelRequest = knowledgeContracts.buildModelRequest({ contextPacket, question, conversation: history, model: integration.model });
  const data = JSON.parse(modelRequest.messages[1].content);
  data.answer_focus = {
    answer_depth: projectScope?.context_route?.answer_depth,
    outcome_sections: projectScope?.context_route?.outcome_sections
  };
  data.reviewed_smart_context = normalizeText(reviewedContext, 1200);
  // Synthesis sees the combined evidence packet after all retrieval rounds,
  // together with bounded coverage summaries, never separate candidate answers.
  data.retrieval_outcome = {
    rounds_completed: Number(retrievalPlan?.retrieval_round_count || 0),
    termination_reason: retrievalPlan?.termination_reason || null,
    source_count: new Set(contextPacket.evidence.map(item => item.source_id)).size,
    evidence_count: contextPacket.evidence.length,
    information_needs: asArray(retrievalPlan?.intent_plan?.information_needs).slice(0, 8)
  };
  const deadlineAt = Date.now() + answerModelTimeout();
  const request = {
    integration,
    operation: "knowledge.assistant.synthesize",
    maxOutputTokens: modelRequest.max_output_tokens,
    outputSchema: modelRequest.output_schema,
    messages: [
      { role: "system", content: [
        aiInstructionBlock("ai.knowledge.assistant", "knowledgeAssistant.request.10")
      ].join(" ") + aiInstructionBlock("ai.knowledge.assistant", "knowledgeAssistant.request.27") + JSON.stringify(modelRequest.output_schema) },
      { role: "user", content: JSON.stringify(data) }
    ]
  };
  const complete = async (repair = false) => {
    const remainingMs = Math.max(0, deadlineAt - Date.now());
    const candidate = await requestJsonCompletion({
      ...request,
      timeoutMs: remainingMs,
      // Allow a slow but progressing answer to use its allotted time. A fixed
      // 30-second attempt previously cancelled otherwise valid completions.
      attemptTimeoutMs: remainingMs,
      messages: repair ? [
        { ...request.messages[0], content: `${request.messages[0].content} ${aiInstructionBlock("ai.knowledge.assistant", "knowledgeAssistant.contractRepair")}` },
        request.messages[1]
      ] : request.messages
    });
    const validated = knowledgeContracts.validateModelAnswer(candidate);
    const groundingHits = hits || contextPacket.evidence.map(item => ({ citation: { id: item.evidence_id, source_id: item.source_id, title: item.title } }));
    const grounded = normalizeModelAnswer(validated, groundingHits);
    if (grounded.safety?.invented_citations_rejected || grounded.safety?.citation_required) {
      throw Object.assign(new Error("The answer did not satisfy the evidence citation contract."), { code: "MODEL_INVALID_RESPONSE" });
    }
    return validated;
  };
  try {
    return await complete();
  } catch (error) {
    execution.assertActive();
    const repairable = ["ERR_CONTRACT_VALIDATION", "MODEL_INVALID_RESPONSE", "MODEL_EMPTY_RESPONSE", "MODEL_OUTPUT_TRUNCATED"].includes(error?.code);
    const active = execution.current();
    const budgetAvailable = !Number.isFinite(active?.modelBudget?.max_tool_calls) || active.modelStats.calls < active.modelBudget.max_tool_calls;
    if (!repairable || !budgetAvailable || deadlineAt - Date.now() < 2_000) throw error;
    // One bounded regeneration uses the same authorized input; malformed
    // model text is never promoted into another instruction or returned raw.
    execution.emit("GENERATION", "started", { error_code: modelFailureCode(error), model_attempt: 2, model_max_attempts: 2 });
    return complete(true);
  }
};

const requestGroundedVerification = async ({ integration, question, hits, draft, projectScope, reviewedContext, contextPacket }) => requestJsonCompletion({
  integration,
  operation: "knowledge.assistant.verify",
  timeoutMs: 25_000,
  messages: [
    {
      role: "system",
      content: [
        aiInstructionBlock("ai.knowledge.verification", "knowledgeAssistant.requestGroundedVerification.28")
      ].join(" ")
    },
    {
      role: "user",
      content: JSON.stringify({
        project_scope: projectScope,
        question,
        reviewed_smart_context: reviewedContext || undefined,
        draft,
        context_packet: contextPacket || {
          contract_version: knowledgeContracts.CONTRACTS.context_packet,
          evidence: buildEvidencePayload(hits).map((item) => ({ ...item, evidence_id: item.citation_id }))
        }
      }, null, 2)
    }
  ]
});

const normalizeModelAnswer = (candidate, hits) => {
  const allowedById = new Map(hits.filter((hit) => hit?.citation?.id).map((hit) => [hit.citation.id, hit.citation]));
  const structuredSections = [
    ["Summary", normalizeText(candidate?.executive_summary || candidate?.answer || candidate?.response, 3_000)],
    ["Findings", asArray(candidate?.findings).map((item) => normalizeText(typeof item === "string" ? item : item?.detail || item?.statement, 1_600)).filter(Boolean)],
    ["Recommended next steps", asArray(candidate?.recommendations).map((item) => normalizeText(typeof item === "string" ? item : item?.detail, 1_200)).filter(Boolean)],
    ["Evidence gaps", asArray(candidate?.evidence_gaps).map((item) => normalizeText(typeof item === "string" ? item : item?.detail, 1_200)).filter(Boolean)]
  ];
  let rawAnswer = normalizeText(structuredSections.flatMap(([heading, value]) => {
    const items = Array.isArray(value) ? value : value ? [value] : [];
    return items.length ? [`${heading}:`, ...items.map((item) => heading === "Summary" ? item : `- ${item}`)] : [];
  }).join("\n\n"), 12_000);
  const claims = asArray(candidate?.supported_claims || candidate?.claims);
  const normalizedClaims = claims.map((claim) => ({
    statement: sanitizeAiText(normalizeText(claim?.statement || claim?.detail, 2_000)).text,
    citation_ids: [...new Set(asArray(claim?.citation_ids || claim?.citations)
      .map((item) => normalizeText(typeof item === "string" ? item : item?.id, 255))
      .filter(Boolean))]
  })).filter((claim) => claim.statement);
  const claimIds = claims.flatMap((claim) => asArray(claim?.citation_ids || claim?.citations)
    .map((item) => normalizeText(typeof item === "string" ? item : item?.id, 255))
    .filter(Boolean));
  const requestedIds = [...new Set([
    ...asArray(candidate?.citation_ids || candidate?.citations).map((item) => normalizeText(typeof item === "string" ? item : item?.id, 255)).filter(Boolean),
    ...claimIds
  ])];
  // Evidence IDs are opaque. K-* is one producer's convention, while live
  // records and other adapters may supply IDs with underscores, dots or colons.
  const mentionedIds = [...new Set([
    ...Array.from(rawAnswer.matchAll(/\[([A-Za-z0-9][A-Za-z0-9_.:-]*)\]/g), (match) => match[1]),
    ...(rawAnswer.match(/\bK-[A-Za-z0-9_.:-]+/g) || []).map((id) => id.replace(/[.:]+$/, ""))
  ])];
  const inventedIds = [...new Set([...requestedIds, ...mentionedIds].filter((id) => !allowedById.has(id)))];
  if (inventedIds.length) {
    return {
      content: "I could not validate the model's citations against the retrieved HelloTest evidence, so I will not present that answer. Refine the question or add relevant project context.",
      status: "insufficient_context",
      citations: [],
      safety: { invented_citations_rejected: inventedIds.length }
    };
  }
  const citations = requestedIds.map((id) => allowedById.get(id)).filter(Boolean);
  const normalizedStatus = String(candidate?.status || "").trim().toLowerCase();
  const requestedStatus = ["answered", "insufficient_context", "refused"].includes(normalizedStatus) ? normalizedStatus : "insufficient_context";
  const unsupportedClaims = normalizedClaims.filter((claim) => !claim.citation_ids.length || claim.citation_ids.some((id) => !allowedById.has(id)));
  if (requestedStatus === "answered" && (!citations.length || !normalizedClaims.length || unsupportedClaims.length)) {
    return {
      content: "The generated response did not provide complete claim-level citation support, so it was not presented as grounded. Refine the question or add the relevant Knowledge Repo source and try again.",
      status: "insufficient_context",
      citations: [],
      answer_structure: {
        summary: "The answer could not pass claim-level grounding validation.",
        findings: [],
        recommendations: ["Refine the question or add the relevant Knowledge Repo source, then try again."],
        evidence_gaps: ["One or more factual claims did not have an exact retrieved citation."],
        supported_claims: []
      },
      safety: { citation_required: true, unsupported_claim_count: unsupportedClaims.length || Number(!normalizedClaims.length) }
    };
  }
  if (!rawAnswer && normalizedClaims.length) rawAnswer = normalizedClaims.map((claim) => `${claim.statement} ${claim.citation_ids.map((id) => `[${id}]`).join(" ")}`).join("\n\n");
  const emptyAnswer = requestedStatus === "refused"
    ? "I cannot answer that request within the authorized HelloTest project scope."
    : "The retrieved project evidence was not sufficient to produce a reliable citation-backed answer. Add or refresh the relevant sources and try again.";
  const sanitized = sanitizeAiText(rawAnswer || emptyAnswer);
  const safeSectionValue = (value, max) => sanitizeAiText(normalizeText(value, max)).text;
  const answerStructure = {
    summary: safeSectionValue(candidate?.executive_summary || candidate?.answer || candidate?.response || rawAnswer || emptyAnswer, 3_000),
    findings: asArray(candidate?.findings).map((item) => safeSectionValue(typeof item === "string" ? item : item?.detail || item?.statement, 1_600)).filter(Boolean),
    recommendations: asArray(candidate?.recommendations).map((item) => safeSectionValue(typeof item === "string" ? item : item?.detail, 1_200)).filter(Boolean),
    evidence_gaps: asArray(candidate?.evidence_gaps).map((item) => safeSectionValue(typeof item === "string" ? item : item?.detail, 1_200)).filter(Boolean),
    presentation: candidate?.presentation,
    supported_claims: normalizedClaims.map((claim) => ({ statement: claim.statement, citation_ids: claim.citation_ids.filter((id) => allowedById.has(id)) }))
  };
  if (EXPLICITLY_OUTSIDE_DOMAIN.test(sanitized.text)) {
    return {
      content: "I can only answer about HelloTest and the selected project's authorized quality and application context.",
      status: "refused",
      citations: [],
      answer_structure: { summary: "I can only answer about HelloTest and the selected project's authorized quality and application context.", findings: [], recommendations: [], evidence_gaps: [], supported_claims: [] },
      safety: { post_model_scope_refusal: true }
    };
  }
  return {
    content: sanitized.text,
    status: requestedStatus,
    citations: requestedStatus === "answered" ? citations : [],
    answer_structure: answerStructure,
    safety: {
      output_redaction_count: sanitized.redaction_count,
      output_risk_flags: sanitized.risk_flags,
      supported_claim_count: normalizedClaims.length,
      claim_grounding_coverage: normalizedClaims.length ? Number(((normalizedClaims.length - unsupportedClaims.length) / normalizedClaims.length).toFixed(3)) : 0
    }
  };
};

const respondWithoutModel = ({ status, reason }) => ({
  content: reason,
  status,
  citations: [],
  answer_structure: {
    summary: reason,
    findings: [],
    recommendations: [],
    evidence_gaps: status === "insufficient_context" || status === "provider_unavailable" ? [reason] : [],
    supported_claims: []
  },
  safety: { deterministic_guardrail: true }
});

const summarizeLiveEvidence = (hit) => {
  if (hit?.source_kind !== "live_project") return "";
  let snapshot;
  try {
    snapshot = JSON.parse(String(hit.content || ""));
  } catch {
    return "";
  }
  const count = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  switch (snapshot?.evidence_type) {
    case "authoritative_live_project_record":
      return `${snapshot.project?.name || "The selected project"} has ${asArray(snapshot.applications).length} application workspace${asArray(snapshot.applications).length === 1 ? "" : "s"}.`;
    case "authoritative_live_story_snapshot":
      return snapshot.coverage_available === false
        ? `${count(snapshot.total_records)} Stories; Test Case coverage is unavailable with current access.`
        : `${count(snapshot.total_records)} Stories; ${count(snapshot.covered_records)} linked to Test Cases and ${count(snapshot.uncovered_records)} without linked coverage.`;
    case "authoritative_live_test_case_snapshot":
      return `${count(snapshot.total_records)} Test Cases; ${count(snapshot.automated_or_ready)} automated or automation-ready, ${snapshot.story_traceability_available === false ? "Story traceability unavailable with current access" : `${count(snapshot.without_story_traceability)} without Story traceability`}, and ${count(snapshot.without_steps)} without steps.`;
    case "authoritative_live_execution_snapshot":
      return `${count(snapshot.total_records)} Test Runs; ${count(snapshot.failed_runs)} failed runs${snapshot.results_available === false ? "; result counts are unavailable with current access" : `, ${count(snapshot.failed_results)} failed results, and ${count(snapshot.blocked_results)} blocked results`}.`;
    case "authoritative_live_execution_context":
      return `${count(snapshot.total_environments)} test environments and ${count(snapshot.total_configurations)} test configurations were available; the evidence contains the most relevant bounded records.`;
    case "authoritative_live_object_repository_snapshot":
      return `${count(snapshot.total_records)} repository objects across ${count(snapshot.screens)} screens; ${count(snapshot.low_confidence_records)} have low confidence.`;
    case "authoritative_live_bug_snapshot":
      return `${count(snapshot.total_records)} Defects; ${count(snapshot.open_records)} open and ${count(snapshot.critical_or_high)} critical or high severity/priority.`;
    default:
      return "";
  }
};

const createDeterministicLiveAnswer = ({ question, hits, reason, contextRoute } = {}) => {
  const live = asArray(hits).map((hit) => {
    if (hit?.source_kind !== "live_project" || !hit?.citation?.id) return null;
    try {
      return { hit, snapshot: JSON.parse(String(hit.content || "")) };
    } catch {
      return null;
    }
  }).filter(Boolean);
  if (!live.length) return null;
  const byType = new Map(live.map((entry) => [entry.snapshot.evidence_type, entry]));
  const cited = [];
  const lines = [];
  const use = (entry) => {
    if (entry?.hit?.citation && !cited.some((citation) => citation.id === entry.hit.citation.id)) cited.push(entry.hit.citation);
    return entry?.hit?.citation?.id ? `[${entry.hit.citation.id}]` : "";
  };
  const count = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const recordLabel = (record) => {
    const key = normalizeText(record?.display_id || record?.key || record?.id, 100);
    const title = normalizeText(record?.title || record?.name || record?.locator_intent || record?.page_key, 240);
    return [key, title].filter(Boolean).join(" — ") || "Untitled record";
  };
  const appendRecords = (records, total, entry, details) => {
    const selected = asArray(records).slice(0, 12);
    selected.forEach((record) => {
      const suffix = normalizeText(details?.(record), 240);
      lines.push(`- ${recordLabel(record)}${suffix ? ` · ${suffix}` : ""} ${use(entry)}`);
    });
    if (count(total) > selected.length) lines.push(`- Showing ${selected.length} of ${count(total)} matching records; refine the question to narrow the list. ${use(entry)}`);
  };

  const normalizedQuestion = normalizeText(contextRoute?.resolved_query || question, 8_000).toLowerCase();
  const inputType = contextRoute?.input_type || "project_question";
  const asksStoryCoverage = /(?:stor(?:y|ies)|requirements?).*(?:coverage|covered|uncovered|linked test)|(?:coverage|covered|uncovered).*(?:stor(?:y|ies)|requirements?)|not enough test coverage/i.test(normalizedQuestion);
  const asksCaseQuality = /test cases?.*(?:without|missing|step|trace|quality|coverage)|(?:without|missing).*(?:test cases?|steps?)/i.test(normalizedQuestion);
  const asksFailures = inputType === "execution_failure" || /\b(?:failed|failure|blocked|flaky|run results?|what failed)\b/i.test(normalizedQuestion);
  const asksBugs = inputType === "bug_quality" || /\b(?:bugs?|defects?|triage|severity)\b/i.test(normalizedQuestion);
  const asksAutomation = inputType === "automation" || /\b(?:automation|locator|object repository|selector|binding)\b/i.test(normalizedQuestion);
  const asksExecutionContext = inputType === "execution_context" || /\b(?:environments?|configurations?|browsers?|devices?|platforms?|mobile os)\b/i.test(normalizedQuestion);
  const asksOverview = inputType === "project_overview" || /\b(?:project|summary|overview|health|readiness|main quality risks?|metrics?)\b/i.test(normalizedQuestion);

  const storyEntry = byType.get("authoritative_live_story_snapshot");
  const caseEntry = byType.get("authoritative_live_test_case_snapshot");
  const runEntry = byType.get("authoritative_live_execution_snapshot");
  const bugEntry = byType.get("authoritative_live_bug_snapshot");
  const automationEntry = byType.get("authoritative_live_object_repository_snapshot");
  const executionContextEntry = byType.get("authoritative_live_execution_context");
  const projectEntry = byType.get("authoritative_live_project_record");

  if (asksStoryCoverage && storyEntry) {
    const snapshot = storyEntry.snapshot;
    const uncovered = count(snapshot.uncovered_records);
    const thin = count(snapshot.thin_coverage_records);
    lines.push(snapshot.coverage_available === false
      ? `${count(snapshot.total_records)} Stories are available. Test Case coverage is unavailable with current access; coverage gaps cannot be assessed. ${use(storyEntry)}`
      : `Story coverage: ${count(snapshot.total_records)} total; ${uncovered} have no linked Test Cases and ${thin} have exactly one linked Test Case. Zero links is uncovered; one link is a review signal, not proof of sufficient acceptance-boundary coverage. ${use(storyEntry)}`);
    if (uncovered) {
      lines.push("", "Stories with no linked Test Cases");
      appendRecords(snapshot.coverage_gaps, uncovered, storyEntry, (record) => `${record.status || "status not set"}; priority ${record.priority || "not set"}`);
    }
    if (thin) {
      lines.push("", "Stories needing a thin-coverage review");
      appendRecords(snapshot.thin_coverage_examples, thin, storyEntry, (record) => `${count(record.linked_test_case_count)} linked Test Case; review acceptance boundaries`);
    }
  }

  if (asksCaseQuality && caseEntry) {
    const snapshot = caseEntry.snapshot;
    lines.push(`Test Case quality: ${count(snapshot.total_records)} total; ${count(snapshot.without_steps)} have no steps${snapshot.story_traceability_available === false ? "; Story traceability is unavailable with current access" : ` and ${count(snapshot.without_story_traceability)} have no Story traceability`}. ${use(caseEntry)}`);
    const withoutSteps = snapshot.quality_gaps?.without_steps;
    if (asArray(withoutSteps).length) {
      lines.push("", "Cases without steps");
      appendRecords(withoutSteps, snapshot.without_steps, caseEntry, (record) => `${record.status || "status not set"}${snapshot.story_traceability_available === false ? "" : `; ${count(record.linked_story_count)} linked Stories`}`);
    }
    const withoutTraceability = snapshot.quality_gaps?.without_story_traceability;
    if (asArray(withoutTraceability).length) {
      lines.push("", "Cases without Story traceability");
      appendRecords(withoutTraceability, snapshot.without_story_traceability, caseEntry, (record) => `${count(record.step_count)} steps; ${record.automation_status || "automation status not set"}`);
    }
  }

  if (asksFailures && runEntry) {
    const snapshot = runEntry.snapshot;
    lines.push(`Execution evidence: ${count(snapshot.total_records)} Test Runs; ${count(snapshot.failed_runs)} failed runs${snapshot.results_available === false ? "; result counts are unavailable with current access" : `, ${count(snapshot.failed_results)} failed results, and ${count(snapshot.blocked_results)} blocked results`}. ${use(runEntry)}`);
    if (asArray(snapshot.failed_or_blocked_run_evidence).length) {
      lines.push("", "Failed or blocked run evidence");
      appendRecords(snapshot.failed_or_blocked_run_evidence, snapshot.failed_or_blocked_run_evidence.length, runEntry, (record) => `${record.status || "status not set"}${snapshot.results_available === false ? "; result counts unavailable" : `; ${count(record.failed_count)} failed; ${count(record.blocked_count)} blocked`}${record.build ? `; build ${record.build}` : ""}${record.created_at ? `; created ${record.created_at}` : ""}`);
    }
  }

  if (asksBugs && bugEntry) {
    const snapshot = bugEntry.snapshot;
    lines.push(`Defect evidence: ${count(snapshot.total_records)} total; ${count(snapshot.open_records)} open and ${count(snapshot.critical_or_high)} are critical or high severity/priority. ${use(bugEntry)}`);
    if (asArray(snapshot.open_critical_or_high_records).length) {
      lines.push("", "Open high-risk Defects");
      appendRecords(snapshot.open_critical_or_high_records, snapshot.open_critical_or_high_records.length, bugEntry, (record) => `${record.status || "open"}; ${record.severity || record.priority || "severity not set"}${record.release ? `; ${record.release}` : ""}`);
    }
  }

  if (asksAutomation && automationEntry) {
    const snapshot = automationEntry.snapshot;
    lines.push(`Automation repository: ${count(snapshot.total_records)} locator records across ${count(snapshot.screens)} screens; ${count(snapshot.low_confidence_records)} are below the 0.6 confidence threshold. ${use(automationEntry)}`);
    if (asArray(snapshot.low_confidence_examples).length) {
      lines.push("", "Low-confidence bindings to review");
      appendRecords(snapshot.low_confidence_examples, snapshot.low_confidence_records, automationEntry, (record) => `${record.locator_kind || "locator"}; confidence ${Number(record.confidence || 0).toFixed(2)}`);
    }
  }

  if (asksExecutionContext && executionContextEntry) {
    const snapshot = executionContextEntry.snapshot;
    const environmentTotal = count(snapshot.total_environments);
    const configurationTotal = count(snapshot.total_configurations);
    lines.push(`Execution context: ${environmentTotal} environment${environmentTotal === 1 ? "" : "s"} and ${configurationTotal} configuration${configurationTotal === 1 ? "" : "s"} are available in the selected project scope. ${use(executionContextEntry)}`);
    if (asArray(snapshot.environments).length) {
      lines.push("", "Environments");
      appendRecords(snapshot.environments, snapshot.total_environments, executionContextEntry, (record) => [record.browser, record.base_url].filter(Boolean).join("; "));
    }
    if (asArray(snapshot.configurations).length) {
      lines.push("", "Configurations");
      appendRecords(snapshot.configurations, snapshot.total_configurations, executionContextEntry, (record) => [record.browser, record.mobile_os, record.platform_version, `${count(record.target_count)} targets`].filter(Boolean).join("; "));
    }
  }

  if (asksOverview) {
    if (projectEntry) {
      const project = projectEntry.snapshot.project || {};
      lines.push(`${project.name || "Current project"}: ${project.description || "No project description is recorded."} ${use(projectEntry)}`);
    }
    if (storyEntry && !asksStoryCoverage) lines.push(`- Stories: ${count(storyEntry.snapshot.total_records)} total; ${storyEntry.snapshot.coverage_available === false ? "Test Case coverage unavailable with current access" : `${count(storyEntry.snapshot.uncovered_records)} without linked Test Cases`}. ${use(storyEntry)}`);
    if (caseEntry && !asksCaseQuality) lines.push(`- Test Cases: ${count(caseEntry.snapshot.total_records)} total; ${count(caseEntry.snapshot.without_steps)} without steps; ${caseEntry.snapshot.story_traceability_available === false ? "Story traceability unavailable with current access" : `${count(caseEntry.snapshot.without_story_traceability)} without Story traceability`}. ${use(caseEntry)}`);
    if (runEntry && !asksFailures) lines.push(`- Test Runs: ${count(runEntry.snapshot.total_records)} total; ${count(runEntry.snapshot.failed_runs)} failed; ${runEntry.snapshot.results_available === false ? "result counts unavailable with current access" : `${count(runEntry.snapshot.blocked_results)} blocked results`}. ${use(runEntry)}`);
    if (bugEntry && !asksBugs) lines.push(`- Defects: ${count(bugEntry.snapshot.total_records)} total; ${count(bugEntry.snapshot.open_records)} open; ${count(bugEntry.snapshot.critical_or_high)} critical/high. ${use(bugEntry)}`);
    if (automationEntry && !asksAutomation) lines.push(`- Automation repository: ${count(automationEntry.snapshot.total_records)} objects; ${count(automationEntry.snapshot.low_confidence_records)} low-confidence bindings. ${use(automationEntry)}`);
  }

  if (!lines.length) return null;
  const citedFindings = lines.filter((line) => /\[K-[A-Za-z0-9-]+\]/.test(line));
  return {
    content: [
      ...lines,
      "",
      "This answer was computed directly from current, permission-checked project records because configured LLM synthesis was unavailable. It does not use model memory."
    ].join("\n"),
    status: "answered",
    citations: cited,
    answer_structure: {
      summary: lines.find((line) => normalizeText(line, 2_000)) || "Current project evidence was retrieved.",
      findings: citedFindings,
      recommendations: ["Use the cited records to inspect the highest-risk gaps and confirm the next accountable action."],
      evidence_gaps: [],
      supported_claims: citedFindings.map((statement) => ({
        statement,
        citation_ids: [...new Set(statement.match(/K-[A-Za-z0-9-]+/g) || [])]
      }))
    },
    safety: {
      deterministic_guardrail: true,
      extractive_grounded_fallback: true,
      deterministic_live_answer: true,
      configured_provider_unavailable: true,
      provider_unavailable_reason_present: Boolean(reason)
    }
  };
};

const createGroundedExtractiveFallback = ({ hits, reason, question, contextRoute }) => {
  const liveAnswer = createDeterministicLiveAnswer({ question, hits, reason, contextRoute });
  if (liveAnswer) return liveAnswer;
  const selected = hits.slice(0, 3).filter((hit) => hit?.citation?.id && normalizeText(hit.content, 1_000));
  if (!selected.length) return respondWithoutModel({ status: "provider_unavailable", reason });
  const excerpts = selected.map((hit) => {
    const excerpt = summarizeLiveEvidence(hit) || normalizeText(hit.content, 520).replace(/\s+/g, " ");
    return `- ${normalizeText(hit.title, 240) || "Project evidence"}: ${excerpt} [${hit.citation.id}]`;
  });
  return {
    content: [
      "Summary:",
      "A model-generated synthesis was unavailable. The following result is built only from permission-checked fuzzy and hybrid retrieval.",
      "",
      "Closest supporting evidence:",
      ...excerpts,
      "",
      "Evidence boundary:",
      "No claims beyond these retrieved passages were added. Refine the question or insert reviewed Smart Context for a narrower answer."
    ].join("\n"),
    status: "provider_unavailable",
    citations: selected.map((hit) => hit.citation),
    answer_structure: {
      summary: "A model-generated synthesis was unavailable; this result contains only the closest permission-checked retrieval evidence.",
      findings: excerpts.map((excerpt) => excerpt.replace(/^-\s+/, "")),
      recommendations: ["Refine the question or insert reviewed Smart Context for a narrower answer."],
      evidence_gaps: ["No claims beyond the retrieved passages were added."],
      supported_claims: selected.map((hit) => {
        const content = normalizeText(hit.content, 8_000).replace(/\s+/g, " ");
        const excerpt = content.length > 520 ? content.slice(0, 520).replace(/\s+\S*$/, "") : content;
        return { statement: excerpt, citation_ids: [hit.citation.id] };
      })
    },
    safety: { deterministic_guardrail: true, extractive_grounded_fallback: true }
  };
};

const createSession = async ({ projectId, appTypeId, title, filters, integrationId, user }) => {
  const id = uuid();
  const normalizedProjectId = normalizeId(projectId);
  if (!normalizedProjectId) throw createError("project_id is required.");
  if (!user?.id) throw createError("An authenticated session owner is required.", 401);
  const normalizedAppTypeId = normalizeId(appTypeId) || null;
  const safeFilters = await normalizeAssistantFilters({ projectId: normalizedProjectId, appTypeId: normalizedAppTypeId, base: filters });
  const normalizedIntegrationId = normalizeIntegrationId(integrationId);
  if (normalizedIntegrationId) {
    const selectedIntegration = await resolveAssistantIntegration({
      integrationId: normalizedIntegrationId,
      userId: user.id,
      projectId: normalizedProjectId,
      allowMissing: false
    });
    safeFilters.llm_integration_id = selectedIntegration.id;
  }
  await db.prepare(`
    INSERT INTO ai_knowledge_assistant_sessions (
      id, project_id, app_type_id, title, filters, created_by
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id, normalizedProjectId, normalizedAppTypeId,
    normalizeText(title, 240) || "New knowledge conversation", safeFilters, user?.id || null
  );
  return serializeSession(await db.prepare("SELECT * FROM ai_knowledge_assistant_sessions WHERE id = ?").get(id));
};

const listSessions = async ({ projectId, user }) => {
  const params = [projectId];
  let creatorClause = "";
  if (user?.role !== "admin" && !user?.is_workspace_admin) {
    creatorClause = "AND created_by = ?";
    params.push(user?.id);
  }
  const rows = await db.prepare(`
    SELECT * FROM ai_knowledge_assistant_sessions
    WHERE project_id = ? AND status = 'active' ${creatorClause}
    ORDER BY updated_at DESC LIMIT 100
  `).all(...params);
  return Promise.all(rows.map(serializeSession));
};

const getSession = async ({ id, user, includeMessages = true }) => {
  const row = await assertSessionAccess(id, user);
  const session = await serializeSession(row);
  if (!includeMessages) return session;
  const messages = await db.prepare(`
    SELECT * FROM ai_knowledge_assistant_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT 500
  `).all(id);
  return { ...session, messages: await Promise.all(messages.map((message) => revalidateStoredMessage(message, user))) };
};

const revalidateStoredMessage = async (message, user) => {
  if (!message || message.role !== "assistant") return message;
  const evidence = asArray(message.retrieval?.context_packet?.evidence);
  const citations = evidence.length ? evidence : asArray(message.citations);
  if (!citations.length) {
    if (["answered", "provider_unavailable"].includes(message.status)) return {
      ...message, content: "This older answer has no verifiable evidence. Ask again to retrieve current sources.", status: "insufficient_context", citations: [], retrieval: {}, safety: { evidence_access_changed: true }
    };
    return message;
  }
  try {
    const access = await authorizeFreshEvidence({ projectId: message.project_id, user, hits: citations, asOf: message.retrieval?.context_packet?.applied_filters?.as_of });
    if (!access.denied_ids.length && access.allowed.length === citations.length) return message;
  } catch (error) {
    if (error.statusCode !== 403 && error.statusCode !== 404) throw error;
  }
  // Remove the complete stored answer and packet: summaries and claims may
  // reveal the same revoked evidence even when citation links are hidden.
  return { ...message, content: "The sources or your access have changed. Ask again to retrieve currently available evidence.", status: "insufficient_context", citations: [],
    retrieval: { evidence_access_changed: true }, safety: { evidence_access_changed: true } };
};

// History is helpful context, but stale or slow history must not prevent a new
// question from retrieving fresh evidence. Every included answer is rechecked.
const readConversationHistory = ({ sessionId, userMessageId, user, timeoutMs = 2_500 }) => assistantRead(async () => {
  const rows = (await db.prepare(`
    SELECT * FROM ai_knowledge_assistant_messages WHERE session_id = ? AND id <> ? AND status NOT IN ('pending', 'error')
    ORDER BY created_at DESC, id DESC LIMIT ?
  `).all(sessionId, userMessageId, MAX_HISTORY_MESSAGES)).reverse();
  execution.assertActive();
  return (await Promise.all(rows.map((row) => revalidateStoredMessage(row, user))))
    .filter((row) => !row.safety?.evidence_access_changed
      && (row.role === "user" || row.retrieval?.answer_contract?.contract_type === "AnswerContract")
      && !asArray(row.retrieval?.context_packet?.evidence).some((item) => item.source_kind === "live_project"))
    .map(({ role, content }) => ({ role, content }));
}, { timeoutMs, code: "HISTORY_LOOKUP_TIMEOUT" });

const updateSession = async ({ id, user, title, status }) => {
  const session = await assertSessionAccess(id, user);
  if (status !== undefined && !["active", "archived"].includes(status)) throw createError("Invalid conversation status.");
  if (title !== undefined && !normalizeText(title, 240)) throw createError("Conversation title cannot be empty.");
  await db.prepare("UPDATE ai_knowledge_assistant_sessions SET title = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(title === undefined ? session.title : normalizeText(title, 240), status || session.status, id);
  return getSession({ id, user, includeMessages: false });
};





const formatTurnResponse = async ({ sessionRow, userMessage, assistantMessage, retrieval, provider, model, clientTurnId, replayed = false }) => ({
  session: await serializeSession(sessionRow),
  user_message: userMessage,
  assistant_message: assistantMessage,
  message: assistantMessage,
  citations: asArray(assistantMessage?.citations),
  retrieval: asObject(retrieval || assistantMessage?.retrieval),
  context_packet: asObject(retrieval || assistantMessage?.retrieval).context_packet || null,
  answer_contract: asObject(retrieval || assistantMessage?.retrieval).answer_contract || null,
  guardrails: knowledgeRagService.ASSISTANT_GUARDRAILS,
  client_turn_id: clientTurnId || null,
  idempotent_replay: replayed,
  provenance: {
    provider: provider || assistantMessage?.provider || null,
    model: model || assistantMessage?.model || null,
    integration_id: asObject(retrieval || assistantMessage?.retrieval).selected_integration_id || null,
    generation_mode: asObject(assistantMessage?.safety).model_verification_completed
      ? "configured_llm_grounded_verified"
      : asObject(assistantMessage?.safety).model_synthesis_completed
        ? "configured_llm_grounded"
        : asObject(assistantMessage?.safety).deterministic_live_answer
          ? "deterministic_grounded_live"
        : asObject(assistantMessage?.safety).extractive_grounded_fallback
          ? "deterministic_grounded_extractive"
          : "deterministic_guardrail",
    question_fingerprint: userMessage?.content_fingerprint || null,
    context_count: Number((retrieval || assistantMessage?.retrieval)?.grounded_result_count || 0),
    retrieval_strategy: asObject(retrieval || assistantMessage?.retrieval).chain_strategy || null,
    context_route: asObject(retrieval || assistantMessage?.retrieval).context_route || null,
    project_id: sessionRow.project_id
  }
});

const respondInternal = async ({ sessionId, message, filters, smartContext: smartContextInput, integrationId, retrievalBudgets, responseMode = "answer", user, clientTurnId, retryProvider = false }) => {
  execution.assertActive();
  execution.emit("QUERY_RECEIVED", "completed");
  const sessionRow = await assistantRead(() => assertSessionAccess(sessionId, user));
  if (sessionRow.status !== "active") throw createError("This knowledge conversation is archived.", 409);
  const sanitizedQuestion = sanitizeAiText(normalizeText(message, 8_000));
  if (!sanitizedQuestion.text) throw createError("message is required.");
  const normalizedClientTurnId = normalizeId(clientTurnId) || null;
  const requestedIntegrationId = normalizeIntegrationId(integrationId)
    || normalizeIntegrationId(asObject(sessionRow.filters).llm_integration_id);
  const smartContext = normalizeSmartContext(smartContextInput);
  const smartContextFingerprint = smartContext.reviewed_context ? fingerprint(smartContext.reviewed_context) : null;
  const questionFingerprint = fingerprint(JSON.stringify({
    question: sanitizedQuestion.text,
    filters: asObject(filters),
    response_mode: responseMode,
    smart_context: {
      query: smartContext.query,
      source_ids: smartContext.source_ids,
      source_kinds: smartContext.source_kinds,
      context_fingerprint: smartContextFingerprint
    }
  }));
  const assertSameTurnRequest = (originalUserMessage) => assertIdempotentTurnRequest({
    originalUserMessage,
    questionFingerprint,
    integrationId: requestedIntegrationId
  });
  let retriedUserMessage = null;
  if (normalizedClientTurnId) {
    const completed = await db.prepare(`
      SELECT * FROM ai_knowledge_assistant_messages
      WHERE session_id = ? AND client_turn_id = ? AND role = 'assistant'
    `).get(sessionId, normalizedClientTurnId);
    if (completed) {
      const originalUserMessage = await db.prepare(`
        SELECT * FROM ai_knowledge_assistant_messages
        WHERE session_id = ? AND client_turn_id = ? AND role = 'user'
      `).get(sessionId, normalizedClientTurnId);
      assertSameTurnRequest(originalUserMessage);
      if (retryProvider && completed.status === "provider_unavailable") {
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
        return formatTurnResponse({
          sessionRow,
          userMessage: originalUserMessage,
          assistantMessage: await revalidateStoredMessage(completed, user),
          provider: completed.provider,
          model: completed.model,
          clientTurnId: normalizedClientTurnId,
          replayed: true
        });
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
    clientTurnId: normalizedClientTurnId,
    ignoreConflict: Boolean(normalizedClientTurnId)
  });
  if (!userMessage) {
    const existingUserMessage = await db.prepare(`
      SELECT * FROM ai_knowledge_assistant_messages
      WHERE session_id = ? AND client_turn_id = ? AND role = 'user'
    `).get(sessionId, normalizedClientTurnId);
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
      return {
        pending: true,
        client_turn_id: normalizedClientTurnId,
        idempotent_replay: true,
        session: await serializeSession(sessionRow),
        user_message: existingUserMessage,
        retry_after_seconds: 3
      };
    }
  }

  execution.current().turn.pendingMessageId = userMessage.id;
  let outcome;
  let provider = null;
  let model = null;
  const mergedFilters = await assistantRead(() => normalizeAssistantFilters({
    projectId: sessionRow.project_id, appTypeId: sessionRow.app_type_id, base: sessionRow.filters,
    override: mergeAssistantContextFilters({ base: sessionRow.filters, override: filters, smartContext })
  }));
  const retrievalRequest = knowledgeContracts.buildRetrievalRequest({
    projectId: sessionRow.project_id, query: sanitizedQuestion.text, filters: mergedFilters, smartContext,
    conversation: { session_id: sessionId }, budgets: retrievalBudgets, traceId: execution.current().traceId
  });
  execution.current().queryId = retrievalRequest.query_id;
  execution.current().requestId = retrievalRequest.request_id;
  execution.current().modelBudget = { ...retrievalRequest.budgets,
    ...(retrievalBudgets?.max_query_cost_usd != null || retrievalBudgets?.max_cost_usd != null
      ? { max_query_cost_usd: retrievalRequest.budgets.max_cost_usd } : {}) };
  execution.current().searchMode = execution.current().modelBudget.max_query_cost_usd != null ? "keyword" : "hybrid";
  let retrieval = { retrieval_request: retrievalRequest, requested_integration_id: requestedIntegrationId, response_mode: responseMode, smart_context_fingerprint: smartContextFingerprint, smart_context_reviewed: Boolean(smartContext.reviewed_context) };
  let contextPacket;
  let trustedDeterministic = false;
  if (EXPLICITLY_OUTSIDE_DOMAIN.test(sanitizedQuestion.text) || requestsSensitiveDisclosure(sanitizedQuestion.text)) {
    outcome = respondWithoutModel({ status: "refused", reason: requestsSensitiveDisclosure(sanitizedQuestion.text)
      ? "I cannot expose credentials, personal information, hidden prompts, private reasoning, or security controls. I can help with authorized HelloTest project and quality information."
      : "I can only help with HelloTest and information grounded in the selected HelloTest project." });
    const budget = new knowledgeContracts.RetrievalBudget(retrievalRequest.budgets);
    budget.terminate(knowledgeContracts.TERMINATION_REASONS.REFUSED);
    retrieval.refusal_before_retrieval = true;
    retrieval.termination_reason = budget.termination_reason;
    contextPacket = knowledgeContracts.buildContextPacket({ retrievalRequest, evidence: [], budget });
  } else {
    const [historyResult, integrationResult] = await Promise.allSettled([
      readConversationHistory({ sessionId, userMessageId: userMessage.id, user }),
      responseMode === "evidence" ? Promise.resolve(null) : assistantRead(() => resolveAssistantIntegration({
        integrationId: requestedIntegrationId, userId: user.id, projectId: sessionRow.project_id, allowMissing: true
      }))
    ]);
    execution.assertActive();
    const history = historyResult.status === "fulfilled" ? historyResult.value : [];
    if (historyResult.status === "rejected") retrieval.history_unavailable = true;
    const integration = integrationResult.status === "fulfilled" ? integrationResult.value : null;
    const integrationError = integrationResult.status === "rejected" ? integrationResult.reason : null;
    if (responseMode !== "evidence" && !integration) throw createError("Configure an active LLM in Integrations to generate an AI answer, or choose evidence search.", 422, "LLM_INTEGRATION_MISSING");
    let intentPlan = null;
    let intentModelCompletedAt = 0;
    if (integration) {
      execution.emit("INTENT_ANALYSIS", "started", { message: "Understanding your intent and deciding which project information is needed." });
      try {
        const candidate = await requestRetrievalPlan({
          integration,
          question: sanitizedQuestion.text,
          history,
          projectScope: { project_id: sessionRow.project_id, app_type_id: sessionRow.app_type_id || null, filters: mergedFilters },
          reviewedContext: smartContext.reviewed_context,
          signal: execution.current()?.signal,
          timeoutMs: 12_000
        });
        intentPlan = require("@hellotest/knowledge/backend/services/knowledgeIntentPlanning.service").normalizePlan(candidate, sanitizedQuestion.text);
        const readableKinds = intentPlan.source_kinds.map((kind) => ({ requirement: "Stories", test_case: "Test Cases", execution: "Test Runs", bug: "Defects", knowledge_item: "Knowledge Repository", file: "files", text: "notes", chat: "conversations", url: "linked pages", product_help: "product help" }[kind] || kind));
        execution.emit("INTENT_ANALYSIS", "completed", {
          message: readableKinds.length
            ? `Understood the intent. I will read ${readableKinds.join(", ")} and supporting Knowledge Repository evidence.`
            : "Understood the intent. I will use the project evidence most relevant to this question."
        });
      } catch (error) {
        execution.assertActive();
        retrieval.intent_plan_error_code = modelFailureCode(error);
        execution.emit("INTENT_ANALYSIS", "failed", { error_code: retrieval.intent_plan_error_code,
          message: "The model could not refine the retrieval plan, so the assistant is using the bounded project intent rules." });
      } finally {
        intentModelCompletedAt = Date.now();
      }
    } else {
      execution.emit("INTENT_ANALYSIS", "completed", { message: "Understood the intent using the bounded project evidence rules." });
    }
    if (mergedFilters.as_of) await assistantRead(() => knowledgeAuthorization.assertHistoricalAccess(user, sessionRow.project_id));
    const context = await require("@hellotest/mcp/backend/gateway").retrieveContext({ request: retrievalRequest, user, history, smartContext, integration, intentPlan, signal: execution.current()?.signal, timeoutMs: Math.max(1, execution.current().turn.deadlineAt - Date.now() - ANSWER_FINALIZATION_RESERVE_MS) });
    execution.current().modelBudget.max_tool_calls = execution.current().modelStats.calls + Math.max(0, retrievalRequest.budgets.max_tool_calls - context.budget.tool_calls_used);
    contextPacket = context.packet;
    if (retrieval.history_unavailable) contextPacket.retrieval.history_unavailable = true;
    retrieval = { ...retrieval, ...context.retrieval, selected_integration_id: integration?.id || null,
      intent_plan: intentPlan ? { source_kinds: intentPlan.source_kinds, information_needs: intentPlan.information_needs, query_count: intentPlan.queries.length } : null,
      intent_planning_model_used: Boolean(intentPlan) };
    let hits = context.hits;
    execution.emit("CONTEXT_ASSEMBLY", "completed", {
      evidence_count: hits.length,
      message: `Collected ${hits.length} permitted evidence items across ${Number(context.retrieval.retrieval_round_count || 1)} retrieval rounds. Preparing one response to your question.`
    });
    execution.assertActive();
    const fallback = (reason) => {
      const deterministic = createDeterministicLiveAnswer({ hits, question: sanitizedQuestion.text, contextRoute: context.route });
      if (deterministic) { trustedDeterministic = true; return deterministic; }
      return createGroundedExtractiveFallback({ hits, reason, question: sanitizedQuestion.text, contextRoute: context.route });
    };
    if (!hits.length) {
      outcome = respondWithoutModel({ status: "insufficient_context", reason: context.retrieval.retrieval_failed
        ? "Authorized retrieval is temporarily unavailable. Try again or narrow the selected sources."
        : "The selected sources do not contain enough authorized evidence. Add or refresh the related sources, or narrow your question." });
    } else if (responseMode === "evidence" || !integration) {
      outcome = fallback(responseMode === "evidence" ? "Retrieved passages from your authorized sources." : "Evidence is available; model synthesis is currently unavailable.");
      if (responseMode === "evidence") outcome.status = "answered";
      if (integrationError) retrieval.provider_error_code = "INTEGRATION_UNAVAILABLE";
    } else {
      provider = integration.name || "Configured LLM";
      model = integration.model;
      await waitForModelCallGap(intentModelCompletedAt);
      execution.assertActive();
      execution.emit("GENERATION", "started", { message: `Working on the final answer from ${hits.length} authorized source${hits.length === 1 ? "" : "s"}.` });
      try {
        const candidate = await requestGroundedAnswer({ integration, question: sanitizedQuestion.text, hits, history,
          projectScope: context.projectScope, retrievalPlan: retrieval, reviewedContext: smartContext.reviewed_context, contextPacket });
        const normalized = normalizeModelAnswer(candidate, hits);
        if (normalized.safety?.invented_citations_rejected || normalized.safety?.citation_required) {
          throw Object.assign(new Error("The answer did not satisfy the evidence citation contract."), { code: "MODEL_INVALID_RESPONSE" });
        }
        outcome = { ...normalized, safety: { ...normalized.safety, model_synthesis_completed: true } };
        execution.emit("GENERATION", "completed", { message: "Finished summarizing the retrieved project evidence." });
      } catch (error) {
        execution.assertActive();
        retrieval.provider_error_code = modelFailureCode(error);
        retrieval.provider_error_message = modelFailureMessage(retrieval.provider_error_code).replace("The retrieved evidence is available below.", "Retry or select another configured model.");
        execution.emit("GENERATION", "failed", { error_code: retrieval.provider_error_code });
        throw createError(retrieval.provider_error_message, 502, retrieval.provider_error_code);
      }
    }
    // Access can change while a model is running. Recheck before saving or
    // sending claims, and drop every claim whose evidence is no longer visible.
    execution.emit("VALIDATION", "started", { message: "Checking the final answer against its source references." });
    const access = await assistantRead((signal) => authorizeFreshEvidence({ projectId: sessionRow.project_id, user, hits, asOf: mergedFilters.as_of, signal }), { code: "ANSWER_AUTHORIZATION_TIMEOUT" });
    const allowed = new Set(access.allowed.map((hit) => hit.citation?.id));
    contextPacket.evidence = contextPacket.evidence.filter((item) => allowed.has(item.evidence_id));
    if (access.denied_ids.length) {
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
      retrieval.query_chain = [sanitizedQuestion.text];
      contextPacket.retrieval.query_chain = [sanitizedQuestion.text];
    }
  }
  execution.assertActive();
  if (retrieval.refusal_before_retrieval) execution.emit("VALIDATION", "started");
  retrieval.context_packet = contextPacket;
  retrieval.answer_contract = knowledgeContracts.buildAnswerContract({ outcome, contextPacket, terminationReason: retrieval.termination_reason, trustDeterministic: trustedDeterministic });
  outcome = knowledgeContracts.applyAnswerContract(outcome, retrieval.answer_contract, contextPacket);
  retrieval.answer_structure = outcome.answer_structure;
  retrieval.model_usage = execution.current().usage;
  retrieval.model_budget = { calls_used: execution.current().modelStats.calls, retries_used: Number(execution.current().modelStats.retries || 0), cost_limit_enforced: execution.current().modelBudget?.max_query_cost_usd != null,
    cost_usd: execution.current().usage.length && execution.current().usage.every((item) => item.cost_usd != null)
      ? execution.current().usage.reduce((total, item) => total + item.cost_usd, 0) : null };
  execution.emit("VALIDATION", "completed", { claim_count: retrieval.answer_contract.claims.length });
  retrieval.processing_trace = execution.current().events;
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
    clientTurnId: normalizedClientTurnId,
    ignoreConflict: Boolean(normalizedClientTurnId)
  });
  const terminalAssistantMessage = assistantMessage || await db.prepare(`
    SELECT * FROM ai_knowledge_assistant_messages
    WHERE session_id = ? AND client_turn_id = ? AND role = 'assistant'
  `).get(sessionId, normalizedClientTurnId);
  execution.current().turn.pendingMessageId = null;
  await db.prepare("UPDATE ai_knowledge_assistant_messages SET status = 'answered', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(userMessage.id);
  await db.prepare("UPDATE ai_knowledge_assistant_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(sessionId);
  execution.emit("COMPLETED", "completed");
  return formatTurnResponse({
    sessionRow,
    userMessage: { ...userMessage, status: "answered" },
    assistantMessage: terminalAssistantMessage,
    retrieval: assistantMessage ? retrieval : terminalAssistantMessage?.retrieval,
    provider: assistantMessage ? provider : terminalAssistantMessage?.provider,
    model: assistantMessage ? model : terminalAssistantMessage?.model,
    clientTurnId: normalizedClientTurnId
  });
};

const respond = (input) => execution.run({ signal: input.signal, onProgress: input.onProgress,
  turn: { deadlineAt: Date.now() + ASSISTANT_TURN_TIMEOUT_MS, pendingMessageId: null } }, async () => {
  try { return await execution.bounded(() => respondInternal(input), { timeoutMs: ASSISTANT_TURN_TIMEOUT_MS }); }
  catch (error) {
    const pendingId = execution.current().turn.pendingMessageId;
    // Cleanup has a separate short deadline so a cancelled request can be
    // resumed with its existing turn ID, even when its main signal is aborted.
    if (pendingId) await execution.bounded(() => db.prepare("UPDATE ai_knowledge_assistant_messages SET status = 'error', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'").run(pendingId),
      { timeoutMs: 2_000, signal: new AbortController().signal }).catch(() => undefined);
    throw error;
  }
});



module.exports = {
  createSession,
  getSession,
  listAvailableLlmIntegrations,
  listSessions,
  updateSession,
  retrieve,
  respond,
  _internals: {
    answerModelTimeout,
    assistantRead,
    readConversationHistory,
    insertMessage,
    authorizeFreshEvidence,
    revalidateStoredMessage,
    MIN_GROUNDED_SCORE,
    assertIdempotentTurnRequest,
    buildEvidencePayload,
    buildProcessingTrace,
    buildSeedQueries,
    buildDeterministicRetrievalQueries,
    assessEvidenceSufficiency,
    completionContent,
    createDeterministicLiveAnswer,
    createGroundedExtractiveFallback,
    isJsonModeCompatibilityRejection,
    isUsableAssistantIntegration,
    mergeRetrievalResults,
    summarizeLiveEvidence,
    normalizeAssistantFilters,
    normalizeSmartContext,
    mergeAssistantContextFilters,
    normalizeRetrievalPlan,
    normalizeRetrievalPlanDetails,
    requestsSensitiveDisclosure,
    normalizeModelAnswer,
    requestGroundedAnswer,
    requestGroundedVerification,
    requestJsonCompletion,
    requestRetrievalPlan,
    waitForModelCallGap,
    resolveChatCompletionsUrl
  }
};
