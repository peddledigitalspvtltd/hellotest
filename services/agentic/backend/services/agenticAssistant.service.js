const { aiInstructionBlock } = require('@hellotest/platform/backend/src/utils/aiInstructionBlocks');
const { getOptionalEvidenceAccess } = require("@hellotest/platform/backend/services/optionalEvidenceAccess.service");
const crypto = require("crypto");
const artifacts = require("./agentArtifacts");
const presentation = require("./agentOutcomePresentation");
const responseContract = require("./agentResponseContract");
const agentRegistry = require("../agents/agentRegistry.service");
const agentContract = require("../agents/agentDefinition");
const { policy: specialistPolicy, instructionFor } = require("../workflows/specialistPolicy");
const aiKnowledgeService = require("@hellotest/knowledge/backend/services/aiKnowledge.service");
const integrationService = require("@hellotest/integration/backend/services/integration.service");
const permissionService = require("@hellotest/platform/backend/services/permission.service");
const featureFlagService = require("@hellotest/platform/backend/services/featureFlag.service");
const projectService = require("@hellotest/platform/backend/public/projectAccess");
const appTypeService = require("@hellotest/platform/backend/public/applicationAccess");
const workspaceTransactionService = require("@hellotest/platform/backend/services/workspaceTransaction.service");
const aiContextOrchestrator = require("@hellotest/ai/backend/services/aiContextOrchestrator.service");
const { fetchLlmWithRetry } = require("@hellotest/platform/backend/src/utils/llmHttpClient");
const { getCompletionContent: completionContent } = require("@hellotest/platform/backend/src/utils/llmResponse");
const { sanitizeAiText, sanitizeAiEvidence } = require("@hellotest/platform/backend/src/security/aiTextPolicy");
const execution = require("@hellotest/knowledge/backend/services/knowledgeExecution.service");
const evidenceScopes = require("@hellotest/platform/backend/src/utils/agentEvidenceScopeSql");
const nodeAiConfiguration = require('../workflows/nodeAiConfiguration');
const {dedupeInstructions}=require('@hellotest/platform/backend/src/utils/aiPromptEnvelope');

const SESSION_TIMEOUT_MS = 150_000;
const CONTEXT_TIMEOUT_MS = 20_000;
const MODEL_TIMEOUT_MS = 120_000;
const agentError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode, publicMessage: message });

const specialistProfiles = require("../../shared/workflowSpecialists.json");
const AGENT_CATALOG = Object.fromEntries(Object.entries(specialistProfiles).map(([id, profile]) => [id, { name: profile.name, objective: profile.description }]));

const CONTEXT_SCOPES = new Set(aiContextOrchestrator.CONTEXT_SCOPES);
const normalizeText = (value, max = 12_000) => (typeof value === "string" ? value : "").trim().slice(0, max);
const normalizeMode = (value) => String(value || "agent").toLowerCase() === "chat" ? "chat" : "agent";
const normalizeScopes = (value) => [...new Set((Array.isArray(value) ? value : [])
  .map((item) => String(item || "").trim().toLowerCase())
  .filter((item) => CONTEXT_SCOPES.has(item)))].slice(0, 6);
const fingerprint = (value) => crypto.createHash("sha256").update(JSON.stringify(value || {})).digest("hex").slice(0, 20);
const toPlainRecord = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const normalizeSmartContext = (value) => {
  const input = toPlainRecord(value);
  const reviewed = sanitizeAiText(normalizeText(input.reviewed_context, 12_000));
  return {
    query: normalizeText(input.query, 2_000),
    source_ids: [...new Set((Array.isArray(input.source_ids) ? input.source_ids : []).map((item) => normalizeText(item, 255)).filter(Boolean))].slice(0, 100),
    source_kinds: [...new Set((Array.isArray(input.source_kinds) ? input.source_kinds : []).map((item) => normalizeText(item, 80)).filter(Boolean))].slice(0, 20),
    reviewed_context: reviewed.text || null,
    review_risk_flags: reviewed.risk_flags || [],
    review_redaction_count: reviewed.redaction_count || 0
  };
};

const extractJson = (value) => {
  const text = String(value || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return JSON.parse(start >= 0 && end >= start ? text.slice(start, end + 1) : text);
};

const resolveChatCompletionsUrl = (baseUrl) => {
  const normalized = normalizeText(baseUrl, 2_000) || "https://api.openai.com/v1";
  return /\/chat\/completions\/?$/i.test(normalized)
    ? normalized.replace(/\/+$/, "")
    : `${normalized.replace(/\/+$/, "")}/chat/completions`;
};

const JSON_MODE_FIELD = /(?:response[_\s-]?format|json[_\s-]?object|json mode)/i;
const JSON_MODE_REJECTION = /(?:unsupported|not supported|unknown (?:parameter|field)|unrecognized|extra inputs?|not permitted)/i;

const loadWorkspaceContext = async ({ projectId, appTypeId, scopes, prompt, smartContext, user, contextRoute, governedContext, evidenceScope }) => {
  const context = {};
  let knowledgeRetrieval = null;
  if (scopes.includes("knowledge") && user && await permissionService.hasPermission(user, "knowledge.view", projectId)
    && await featureFlagService.areEnabled(featureFlagService.getFeatureKeysForPermission("knowledge.view"), { user })) {
    const packageResult = await execution.bounded(() => aiKnowledgeService.buildKnowledgeContextPackage(projectId, {
      app_type_id: appTypeId || undefined,
      query: normalizeText(`${prompt}\n${smartContext.query || ""}\n${contextRoute?.retrieval_focus || ""}`, 4000),
      limit: Math.min(10, governedContext?.max_items || 10),
      context_token_budget: governedContext?.token_budget,
      source_ids: smartContext.source_ids,
      source_kinds: smartContext.source_kinds,
      evidence_scope: evidenceScope,
      user
    }), { timeoutMs: CONTEXT_TIMEOUT_MS });
    const primaryKnowledge = (packageResult.access_restricted ? [] : packageResult.knowledge || []).map((item) => ({
      id: item.metadata?.chunk_id || item.id,
      title: item.title,
      asset_type: item.asset_type,
      source: item.source,
      description: normalizeText(item.description, 700),
      content: normalizeText(item.content, 1_500),
      score: item.metadata?.retrieval_score || null,
      citation: item.metadata?.citation || null
    }));
    const knowledgeByChunk = new Map(primaryKnowledge.map(item => [item.citation?.chunk_id || item.id, item]));
    context.knowledge = [...knowledgeByChunk.values()];
    knowledgeRetrieval = { ...(packageResult.retrieval || {}),
      chain_strategy: "specialist-mcp-intent-retrieval", result_count: context.knowledge.length,
      returned_count: context.knowledge.length };
    const distinctKnowledgeSources = new Set(context.knowledge.map((item) => item.citation?.source_id || item.id)).size;
    const strongestKnowledgeScore = context.knowledge.reduce((best, item) => Math.max(best, Number(item.score || 0)), 0);
    const evidenceScore = Math.min(100, Math.round(Math.min(55, context.knowledge.length * 5) + Math.min(25, distinctKnowledgeSources * 7) + strongestKnowledgeScore * 20));
    knowledgeRetrieval.evidence_sufficiency = {
      score: evidenceScore,
      status: "retrieved_unverified",
      score_semantics: "Retrieval relevance and breadth; not factual confidence or completeness.",
      citation_ready_count: context.knowledge.length,
      distinct_source_count: distinctKnowledgeSources,
      strongest_retrieval_score: Number(strongestKnowledgeScore.toFixed(4)),
      requires_more_context: evidenceScore < 72
    };
    if (smartContext.reviewed_context) {
      context.reviewed_context = [{
        id: `reviewed-${fingerprint(smartContext.reviewed_context)}`,
        title: "Human-reviewed Smart Context",
        content: smartContext.reviewed_context,
        risk_flags: smartContext.review_risk_flags,
        redaction_count: smartContext.review_redaction_count,
        evidence_boundary: "User-curated retrieval focus; validate claims against the cited Knowledge Repo chunks."
      }];
    }
  }

  return { context, knowledgeRetrieval };
};

const countContext = (context) => Object.fromEntries(
  Object.entries(context).map(([key, value]) => [key, Array.isArray(value) ? value.length : 0])
);

const buildCitations = (context) => Object.entries(context).flatMap(([scope, items]) =>
  scope === "reviewed_context" ? [] : (Array.isArray(items) ? items : []).map((item) => ({
    ...(item.citation && typeof item.citation === "object" ? item.citation : {}),
    scope,
    id: item.citation?.id || item.id,
    label: item.citation?.label || item.display_id || item.name || item.title || item.id
  }))
).slice(0, 36);

const clampScore = (value, fallback) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(100, Math.round(numeric))) : fallback;
};

const normalizeCitedItems = (value, { maxItems = 8, maxContent = 2_400 } = {}) => (Array.isArray(value) ? value : [])
  .map((item, index) => {
    const input = toPlainRecord(item);
    const citationIds = [...new Set((Array.isArray(input.citation_ids) ? input.citation_ids : [])
      .map((citation) => normalizeText(typeof citation === "string" ? citation : citation?.id, 255))
      .filter(Boolean))];
    const title = normalizeText(input.title || input.label, 300);
    const detail = normalizeText(input.detail || input.content || input.summary, maxContent);
    if (!title && !detail) return null;
    return {
      id: normalizeText(input.id, 128) || `finding-${index + 1}`,
      ...(typeof input.artifact_kind === 'string' ? { artifact_kind: input.artifact_kind } : {}),
      ...(typeof input.requires_proposal === 'boolean' ? { requires_proposal: input.requires_proposal } : {}),
      ...(input.type ? { type: normalizeText(input.type, 80) } : {}),
      ...(input.priority ? { priority: normalizeText(input.priority, 40).toLowerCase() } : {}),
      ...Object.fromEntries(["observation", "gap", "impact", "proposed_action", "acceptance_check"].filter(key => typeof input[key] === "string" && input[key].trim()).map(key => [key, normalizeText(input[key], 2400)])),
      title: title || "Agent finding",
      detail,
      citation_ids: citationIds
    };
  })
  .filter(Boolean)
  .slice(0, maxItems);

const collectCandidateCitationIds = (candidate) => [...new Set([
  ...(Array.isArray(candidate?.citation_ids) ? candidate.citation_ids : []),
  ...['findings', 'deliverables', 'artifacts', 'sections', 'tables', 'charts'].flatMap(key => Array.isArray(candidate?.[key]) ? candidate[key] : [])
    .flatMap((item) => Array.isArray(item?.citation_ids) ? item.citation_ids : [])
].map((item) => normalizeText(typeof item === "string" ? item : item?.id, 255)).filter(Boolean))];

function revisionFeedback(candidate, issues, round) {
  // Prior model output remains explicitly untrusted proposal data. Keep whole
  // objects, or omit them with a recorded limit; never slice serialized JSON.
  const draft = candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    ? Object.fromEntries(['response', 'findings', 'deliverables', 'artifacts', 'evidence_gaps'].filter(key => Object.hasOwn(candidate, key)).map(key => [key, candidate[key]])) : null;
  const retained = draft && Buffer.byteLength(JSON.stringify(draft)) <= 12000 ? draft : null;
  return { round, issues: issues.slice(0, 20), previous_draft: retained, previous_draft_omitted: Boolean(draft && !retained), draft_status: 'untrusted_proposal' };
}
function providerUsage(value) {
  const fields = { input_tokens: 'prompt_tokens', output_tokens: 'completion_tokens', total_tokens: 'total_tokens' };
  return value && typeof value === 'object' ? Object.fromEntries(Object.entries(fields).map(([name, key]) => {const count=value[key]??value[name];return [name,
    Number.isSafeInteger(count) && count >= 0 ? count : null];})) : null;
}
function aggregateUsage(records) {
  const keys = ['input_tokens', 'output_tokens', 'total_tokens'];
  return { usage: Object.fromEntries(keys.map(key => [key, records.length && records.every(record => record.usage?.[key] != null)
    ? records.reduce((sum, record) => sum + record.usage[key], 0) : null])),
    usage_unknown_calls: records.filter(record => keys.some(key => record.usage?.[key] == null)).length };
}
const correctableOutputError = error => error instanceof SyntaxError || ['AI_INVALID_JSON', 'AI_INVALID_RESPONSE', 'AI_MANAGED_SCHEMA_INVALID'].includes(error?.code);
function outputErrorIssues(error) {
  if (error.code === 'AI_MANAGED_SCHEMA_INVALID') return (error.validation_errors?.length ? error.validation_errors : [{ path: 'output', keyword: 'published_schema_constraint' }]).slice(0, 5).map(item => ({
    path: normalizeText(item.path, 255), issue: normalizeText(item.keyword, 80) || 'published_schema_constraint',
    ...(typeof item.required_property === 'string' ? { required_property: normalizeText(item.required_property, 120) } : {})
  }));
  return [{ path: error.validation_path || 'output', issue: error instanceof SyntaxError || error.code === 'AI_INVALID_JSON'
    ? 'valid_json_object_required' : 'native_artifact_fields_or_references_invalid' }];
}

const normalizeResult = (candidate, fallback, citations = [], { allowUncited = false, artifactTargets = [], requireMetadata = false, testCaseTypes, pinnedStoryId } = {}) => {
  if (presentation.presentationIssues(candidate, citations).length) return fallback;
  const evaluation = toPlainRecord(candidate?.evaluation);
  const recommendations = Array.isArray(candidate?.recommendations) ? candidate.recommendations : [];
  const assumptions = Array.isArray(candidate?.assumptions) ? candidate.assumptions : [];
  const handoffs = Array.isArray(candidate?.suggested_handoffs) ? candidate.suggested_handoffs : [];
  const allowedCitationIds = new Set(citations.map((citation) => normalizeText(citation?.id, 255)).filter(Boolean));
  const requestedCitationIds = collectCandidateCitationIds(candidate);
  const mentionedCitationIds = [...new Set((JSON.stringify(candidate || {}).match(/K-[A-Za-z0-9-]+/g) || []))];
  const allRequestedCitationIds = [...new Set([...requestedCitationIds, ...mentionedCitationIds])];
  const findings = normalizeCitedItems(candidate?.findings, { maxItems: 20, maxContent: 8000 });
  const deliverables = normalizeCitedItems(candidate?.deliverables, { maxItems: 20, maxContent: 16_000 });
  const oversized = String(candidate?.response || "").length > 32000
    || (Array.isArray(candidate?.findings) && (candidate.findings.length > 20 || candidate.findings.some(item => String(item?.detail || item?.content || item?.summary || "").length > 8000)))
    || (Array.isArray(candidate?.deliverables) && (candidate.deliverables.length > 20 || candidate.deliverables.some(item => String(item?.detail || item?.content || item?.summary || "").length > 16000)));
  if (oversized) return fallback;
  const uncitedClaim = [...findings, ...deliverables].some((item) => !item.citation_ids.length);
  if (!candidate || typeof candidate !== "object" || (!allowUncited && (!allowedCitationIds.size || !requestedCitationIds.length))
    || allRequestedCitationIds.some((id) => !allowedCitationIds.has(id)) || uncitedClaim
    || typeof candidate.response !== "string" || !candidate.response.trim()) {
    return fallback;
  }

  return {
    headline: normalizeText(candidate?.headline, 300) || "Specialist review",
    executive_summary: normalizeText(candidate?.executive_summary || candidate?.summary, 2_400) || "",
    response: normalizeText(candidate?.response, 32_000) || "",
    activity_summary: normalizeText(candidate?.activity_summary, 2_000) || "",
    findings,
    deliverables,
    artifacts: artifacts.normalizeArtifacts(candidate.artifacts, citations, artifactTargets, { requireMetadata, testCaseTypes, pinnedStoryId }),
    ...presentation.normalizePresentation(candidate),
    no_changes_required: candidate.no_changes_required === true,
    recommendations: recommendations.map((item) => normalizeText(item, 1_200)).filter(Boolean).slice(0, 8),
    assumptions: assumptions.map((item) => normalizeText(item, 900)).filter(Boolean).slice(0, 6),
    evidence_gaps: (Array.isArray(candidate?.evidence_gaps) ? candidate.evidence_gaps : (fallback.evidence_gaps || []))
      .map((item) => normalizeText(item, 900)).filter(Boolean).slice(0, 6),
    suggested_handoffs: handoffs.map((item) => normalizeText(item, 240)).filter(Boolean).slice(0, 4),
    citation_ids: requestedCitationIds,
    grounding_status: requestedCitationIds.length ? "grounded" : "insufficient_context",
    evaluation: {
      label: "Evidence review diagnostics",
      method: "model_assessment",
      grounding: clampScore(evaluation.grounding, fallback.evaluation.grounding),
      completeness: clampScore(evaluation.completeness, fallback.evaluation.completeness),
      traceability: clampScore(evaluation.traceability, fallback.evaluation.traceability),
      risk_control: clampScore(evaluation.risk_control, fallback.evaluation.risk_control),
      maturity_score: clampScore(evaluation.maturity_score, fallback.evaluation.maturity_score),
      rationale: normalizeText(evaluation.rationale, 1_500) || fallback.evaluation.rationale
    }
  };
};

const parseLiveAgentEvidence = (context) => (Array.isArray(context?.live_project) ? context.live_project : []).map((item) => {
  try {
    return { item, snapshot: JSON.parse(String(item.content || "")), citationId: item.citation?.id || item.id };
  } catch {
    return null;
  }
}).filter(Boolean);

const buildEvidenceReadiness = ({ context, contextRoute, limitations = [] }) => {
  const evidenceTypes = new Map([
    ["authoritative_live_story_snapshot", "stories"],
    ["authoritative_live_test_case_snapshot", "test-cases"],
    ["authoritative_live_execution_snapshot", "runs"],
    ["authoritative_live_execution_failures", "runs"],
    ["authoritative_live_execution_context", "runs"],
    ["authoritative_live_bug_snapshot", "bugs"],
    ["authoritative_live_object_repository_snapshot", "automation"]
  ]);
  const live = parseLiveAgentEvidence(context).filter(({ snapshot }) => evidenceTypes.has(snapshot.evidence_type));
  const unavailableEvidence = live.flatMap(({ snapshot }) => [
    ...(snapshot.coverage_available === false ? ["Test Case coverage is unavailable with current access."] : []),
    ...(snapshot.story_traceability_available === false ? ["Story traceability is unavailable with current access."] : []),
    ...(snapshot.results_available === false ? ["Run result counts are unavailable with current access."] : [])
  ]);
  const available = new Set(live.map(({ snapshot }) => evidenceTypes.get(snapshot.evidence_type)));
  const knowledgeCount = (context.knowledge || []).length;
  const hasEvidenceScope = Object.keys(evidenceScopes.normalize(contextRoute?.evidence_scope)).length > 0;
  if (knowledgeCount) available.add("knowledge");
  const missingScopes = (contextRoute?.priority_scopes || []).filter((scope) => scope !== "knowledge" && !available.has(scope));
  const taskEvidenceCount = live.length + knowledgeCount + (hasEvidenceScope ? 0 : (context.workflow_input || []).length);
  return {
    status: !taskEvidenceCount ? "insufficient_evidence" : missingScopes.length || limitations.length || unavailableEvidence.length ? "limited_evidence" : "ready_for_review",
    evidence_count: buildCitations(context).length,
    task_evidence_count: taskEvidenceCount,
    missing_scopes: missingScopes,
    limitations: [...new Set([
      ...limitations,
      ...unavailableEvidence,
      ...((context.workflow_input || []).length ? ["Workflow input is supplied data; its claims have not been independently verified."] : []),
      ...(hasEvidenceScope && !live.length && !knowledgeCount ? ["No authorized record evidence matched the selected scope. Supplied inputs cannot establish those records' content or widen the evidence boundary."] : []),
      ...(!taskEvidenceCount ? ["No task-specific evidence was available; project metadata alone does not support this review."] : []),
      ...(missingScopes.length ? [`Current evidence was unavailable for: ${missingScopes.join(", ")}.`] : [])
    ])]
  };
};

const buildFallbackResult = ({ agent, agentId, mode, prompt, context, contextCounts, liveCounts = {}, citations, contextRoute }) => {
  const evidenceCount = citations.length;
  const availableScopes = Object.entries(contextCounts).filter(([, count]) => count > 0).map(([scope]) => scope.replace(/_/g, " "));
  const currentMetricSummary = Object.entries(liveCounts)
    .filter(([, count]) => Number.isFinite(Number(count)))
    .map(([key, count]) => `${key.replace(/_/g, " ")}: ${Number(count)}`)
    .join(" · ");
  const priority = new Map((contextRoute?.priority_scopes || []).map((scope, index) => [scope, index]));
  const liveSignals = parseLiveAgentEvidence(context).flatMap((entry) => {
    const snapshot = entry.snapshot;
    const citation_ids = entry.citationId ? [entry.citationId] : [];
    const count = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
    switch (snapshot.evidence_type) {
      case "authoritative_live_story_snapshot":
        return count(snapshot.uncovered_records) || count(snapshot.thin_coverage_records) ? [{
          scope: "stories",
          title: "Story coverage needs review",
          detail: `${count(snapshot.uncovered_records)} of ${count(snapshot.total_records)} Stories have no linked Test Cases${count(snapshot.thin_coverage_records) ? `; ${count(snapshot.thin_coverage_records)} have only one linked Test Case and still need acceptance-boundary review` : ""}.`,
          priority: count(snapshot.uncovered_records) ? "high" : "medium",
          action: "Prioritize uncovered Stories, then validate whether each one-case Story covers its acceptance boundaries.",
          citation_ids
        }] : [];
      case "authoritative_live_test_case_snapshot":
        return count(snapshot.without_steps) || count(snapshot.without_story_traceability) ? [{
          scope: "test-cases",
          title: "Test Case authoring or traceability is incomplete",
          detail: `${count(snapshot.without_steps)} of ${count(snapshot.total_records)} Test Cases have no steps${snapshot.story_traceability_available === false ? "; Story traceability is unavailable with current access" : ` and ${count(snapshot.without_story_traceability)} have no Story link`}.`,
          priority: count(snapshot.without_steps) ? "high" : "medium",
          action: snapshot.story_traceability_available === false ? "Complete executable steps; Story traceability cannot be assessed with current access." : "Complete executable steps and restore Story traceability before treating the affected cases as release evidence.",
          citation_ids
        }] : [];
      case "authoritative_live_execution_snapshot":
        return count(snapshot.failed_runs) || count(snapshot.failed_results) || count(snapshot.blocked_results) ? [{
          scope: "runs",
          title: "Execution evidence contains failures or blocks",
          detail: snapshot.results_available === false
            ? `${count(snapshot.failed_runs)} failed Runs are present in the current snapshot; result counts are unavailable with current access.`
            : `${count(snapshot.failed_runs)} failed Runs, ${count(snapshot.failed_results)} failed results, and ${count(snapshot.blocked_results)} blocked results are present in the current snapshot.`,
          priority: count(snapshot.failed_results) ? "high" : "medium",
          action: "Separate observed failure clusters from environment hypotheses and verify the newest affected build first.",
          citation_ids
        }] : [];
      case "authoritative_live_bug_snapshot":
        return count(snapshot.open_records) || count(snapshot.critical_or_high) ? [{
          scope: "bugs",
          title: count(snapshot.critical_or_high) ? "Open high-risk Defects require triage" : "Open Defects require triage review",
          detail: `${count(snapshot.open_records)} of ${count(snapshot.total_records)} Defects are open; ${count(snapshot.critical_or_high)} are critical or high severity/priority.`,
          priority: count(snapshot.critical_or_high) ? "high" : "medium",
          action: count(snapshot.critical_or_high)
            ? "Confirm reproducibility, release impact, duplication, and ownership for open high-risk Defects."
            : "Review open Defects for reproducibility, release impact, duplication, and ownership before closure or scheduling.",
          citation_ids
        }] : [];
      case "authoritative_live_object_repository_snapshot":
        return count(snapshot.low_confidence_records) ? [{
          scope: "automation",
          title: "Low-confidence repository bindings need review",
          detail: `${count(snapshot.low_confidence_records)} of ${count(snapshot.total_records)} repository bindings are below the 0.6 confidence review threshold.`,
          priority: "medium",
          action: "Validate locator intent and stable attributes before approving reuse or healing changes.",
          citation_ids
        }] : [];
      default:
        return [];
    }
  }).sort((left, right) => (priority.get(left.scope) ?? 99) - (priority.get(right.scope) ?? 99));
  const findings = liveSignals.slice(0, 6);
  const usedCitationIds = [...new Set(findings.flatMap((finding) => finding.citation_ids))];
  const readiness = buildEvidenceReadiness({ context, contextRoute });
  const grounded = readiness.task_evidence_count > 0;
  const signalSummary = findings.length
    ? findings.slice(0, 3).map((finding) => finding.detail).join(" ")
    : currentMetricSummary || "No current risk signal was established by the retrieved live snapshot.";
  const preliminaryDecision = agentId === "quality-orchestrator"
    ? findings.some((finding) => finding.priority === "high")
      ? "Preliminary review gate: NO-GO until the cited high-priority gaps are resolved or explicitly accepted."
      : findings.length
        ? "Preliminary review gate: WATCH; review the cited signals before proceeding."
        : "Preliminary review gate: UNDETERMINED because no explicit live risk signal was retrieved."
    : "";
  return {
    readiness,
    headline: findings.length ? `${agent.name} · ${findings.length} evidence signal${findings.length === 1 ? "" : "s"} to review` : `${agent.name} evidence review`,
    executive_summary: availableScopes.length
      ? `${preliminaryDecision ? `${preliminaryDecision} ` : ""}${contextRoute?.decision_question || "The requested quality decision requires review"} ${signalSummary} This is a deterministic evidence brief; a person must make the final decision.`
      : "No authorized project evidence matched this task. Add or refresh the relevant project records or Knowledge Repository sources before relying on an AI recommendation.",
    response: mode === "chat"
      ? `${agent.name} routed this as ${contextRoute?.input_type?.replace(/_/g, " ") || "a specialist task"} and reviewed ${evidenceCount} bounded workspace reference${evidenceCount === 1 ? "" : "s"}. ${signalSummary}`
      : `${agent.name} prepared a review-first ${agentId || "specialist"} brief for “${normalizeText(prompt, 260)}”. Required deliverable: ${contextRoute?.deliverable_contract || "an evidence-backed specialist outcome"} No Story, Test Case, automation, Run, or Defect was changed.`,
    activity_summary: `Built bounded context, applied the ${agent.name} contract, checked guardrails, and evaluated the proposed outcome.`,
    findings: findings.length ? findings.map(({ scope, action, ...finding }) => finding) : [{
      title: grounded ? "No explicit live risk signal matched this specialist route" : "Evidence gap blocks a grounded specialist outcome",
      detail: grounded
        ? `${evidenceCount} citation-ready reference${evidenceCount === 1 ? " was" : "s were"} retrieved, but the deterministic path did not infer a specialist conclusion that was not explicit in those records.`
        : "No citation-ready record matched the selected project, application, specialist focus, and context controls.",
      priority: grounded ? "info" : "high",
      citation_ids: grounded ? citations.slice(0, 4).map((citation) => citation.id).filter(Boolean) : []
    }],
    deliverables: [{
      type: `${agentId || "specialist"}_review_contract`,
      title: `${agent.name} deliverable boundary`,
      detail: `${contextRoute?.deliverable_contract || "Produce an evidence-backed specialist review."}\nRequested outcome: ${normalizeText(prompt, 600)}\nEvidence focus: ${contextRoute?.retrieval_focus || agent.objective}`,
      citation_ids: usedCitationIds.slice(0, 8)
    }],
    recommendations: [...new Set([
      ...findings.map((finding) => finding.action),
      "Review the cited workspace evidence before accepting the proposed direction.",
      mode === "agent" ? "Approve only the next bounded action; keep publishing and destructive actions human-owned." : "Switch to Agent mode only when a multi-step execution plan is needed."
    ])].filter(Boolean).slice(0, 8),
    assumptions: grounded ? [] : ["No matching workspace evidence was retrieved for the selected scopes."],
    evidence_gaps: readiness.limitations,
    suggested_handoffs: agentId === "quality-evaluator" ? [] : ["quality-evaluator"],
    citation_ids: (usedCitationIds.length ? usedCitationIds : citations.slice(0, 12).map((citation) => citation.id).filter(Boolean)),
    grounding_status: grounded ? "grounded" : "insufficient_context",
    evaluation: {
      label: "Evidence review diagnostics",
      method: "deterministic",
      grounding: grounded ? Math.min(80, readiness.task_evidence_count * 15) : 0,
      completeness: grounded ? Math.round(100 * Math.max(0, (contextRoute?.priority_scopes?.length || 1) - readiness.missing_scopes.length) / (contextRoute?.priority_scopes?.length || 1)) : 0,
      traceability: grounded ? Math.min(100, usedCitationIds.length * 20) : 0,
      risk_control: grounded ? 100 : 0,
      maturity_score: grounded ? Math.min(70, readiness.task_evidence_count * 10) : 0,
      rationale: evidenceCount
        ? "These rule-based diagnostics describe evidence availability and cited signals, not a calibrated quality score or a verified deliverable."
        : "No task evidence was available. Quality and completeness have not been assessed."
    }
  };
};

const EXACT_INPUT_SCOPES = new Set(['automation_repair','case_intent','workflow_input','task_input']);
const MAX_TASK_INPUT_BYTES = 32_000;
function suppliedInputEvidence(value) {
  const serialized=JSON.stringify(value);
  if(Buffer.byteLength(serialized,'utf8')>MAX_TASK_INPUT_BYTES)throw agentContract.fail('The complete task input exceeds its 32 KB model-input budget. Split the input or use an item loop; no partial input was sent.','AGENT_INPUT_BUDGET');
  const supplied=sanitizeAiEvidence(serialized);
  if(Buffer.byteLength(supplied.text,'utf8')>MAX_TASK_INPUT_BYTES)throw agentContract.fail('The complete sanitized task input exceeds its model-input budget. Split the input; no partial input was sent.','AGENT_INPUT_BUDGET');
  return supplied;
}
const buildBoundedAgentPromptPayload = ({ mode, prompt, context, citations, contextRoute, knowledgeRetrieval, maxBytes = 52_000 }) => {
  // Routing chooses permitted evidence; presentation and task behavior come
  // from the managed feature, rather than a second set of routing defaults.
  const {decision_question,deliverable_contract,outcome_sections,retrieval_focus,retrieval_query,...routeMetadata}=contextRoute || {};
  const compactCitation = (citation) => ({
    id: citation?.id || null,
    label: citation?.label || null,
    scope: citation?.scope || null,
    source_kind: citation?.source_kind || null,
    source_ref_id: citation?.source_ref_id || null,
    source_hash: citation?.source_hash || null,
    version_hash: citation?.version_hash || null,
    chunk_hash: citation?.chunk_hash || null
  });
  const payload = {
    mode,
    request: prompt,
    evidence_scope: evidenceScopes.normalize(contextRoute?.evidence_scope),
    context_route: routeMetadata,
    context_manifest: {
      knowledge_repo_retrieval: {
        mode: knowledgeRetrieval?.mode || null,
        candidate_count: Number(knowledgeRetrieval?.candidate_count || 0),
        result_count: Number(knowledgeRetrieval?.result_count || knowledgeRetrieval?.returned_count || 0),
        live_context_count: Number(knowledgeRetrieval?.live_context_count || 0),
        live_context_counts: knowledgeRetrieval?.live_context_counts || {},
        degraded: Boolean(knowledgeRetrieval?.degraded),
        evidence_sufficiency: knowledgeRetrieval?.evidence_sufficiency || null
      },
      source_precedence: aiInstructionBlock("ai.agentic.workflow", "agenticAssistant.sourcePrecedence"),
      smart_context_reviewed: Boolean(context?.reviewed_context?.length),
      bounded: true,
      selected_context_items: 0,
      omitted_context_items: 0
    },
    citation_contract: (Array.isArray(citations) ? citations : []).map(compactCitation).slice(0, 36),
    bounded_workspace_context: {}
  };
  const orderedScopes = [
    "automation_repair",
    "case_intent",
    "workflow_input",
    "task_input",
    "automation_case",
    "quality_checks",
    "live_project",
    "reviewed_context",
    ...Object.keys(context || {}).filter((scope) => !["automation_repair", "automation_case", "case_intent", "workflow_input", "task_input", "quality_checks", "live_project", "reviewed_context"].includes(scope))
  ];
  const contextItems = orderedScopes.flatMap((scope) => {
    const values = Array.isArray(context?.[scope]) ? context[scope] : [];
    const ordered = scope === "live_project" ? [...values].sort((left, right) => Number(right.score || 0) - Number(left.score || 0)) : values;
    return ordered.map((item) => ({ scope, item }));
  });
  for (const { scope, item } of contextItems) {
    const compact = {
      id: item?.id || null,
      title: item?.title || item?.name || null,
      source_kind: item?.source_kind || item?.asset_type || scope,
      score: Number.isFinite(Number(item?.score)) ? Number(item.score) : null,
      risk_flags: Array.isArray(item?.risk_flags) ? item.risk_flags.slice(0, 8) : [],
      ...(item?.redaction_count?{redaction_count:item.redaction_count}:{}),
      citation: item?.citation ? compactCitation({ ...item.citation, scope }) : null,
      content: EXACT_INPUT_SCOPES.has(scope) ? String(item?.content || item?.description || "")
        : require('@hellotest/platform/backend/src/utils/llmContextFallback').compactEvidenceText(
          String(item?.content || item?.description || ""), scope === "automation_case" ? 36_000 : scope === "quality_checks" ? 12_000 : scope === "reviewed_context" ? 3_000 : scope === "live_project" ? 9_000 : 5_000)
    };
    if(scope === "automation_repair" && compact.content.length > 24_000) throw agentContract.fail("The exact repair contract exceeds its context budget. No incomplete failed section was sent.", "AGENT_CONTEXT_BUDGET");
    if(scope === 'case_intent' && compact.content.length > 40000) throw agentContract.fail('The complete selected case exceeds its authoring context budget. No partial replacement was sent.', 'AGENT_CONTEXT_BUDGET');
    if (!compact.content) continue;
    if(compact.content !== String(item?.content || item?.description || "")) compact.excerpt_truncated = true;
    const currentScope = payload.bounded_workspace_context[scope] || [];
    payload.bounded_workspace_context[scope] = [...currentScope, compact];
    payload.context_manifest.selected_context_items += 1;
    if (Buffer.byteLength(JSON.stringify(payload),'utf8') > maxBytes) {
      if(EXACT_INPUT_SCOPES.has(scope)) throw agentContract.fail("The exact task contract does not fit the selected model context budget. No incomplete source was sent.", "AGENT_CONTEXT_BUDGET");
      payload.bounded_workspace_context[scope].pop();
      payload.context_manifest.selected_context_items -= 1;
      payload.context_manifest.omitted_context_items += 1;
      if (!payload.bounded_workspace_context[scope].length) delete payload.bounded_workspace_context[scope];
    }
  }
  payload.context_manifest.omitted_context_items += Math.max(0, contextItems.length - payload.context_manifest.selected_context_items - payload.context_manifest.omitted_context_items);
  return JSON.stringify(payload);
};

const requestLlmResult = async ({ user, projectId, integration, agent, mode, prompt, context, citations, history, contextRoute, knowledgeRetrieval, promptPayload, deadline = Date.now() + MODEL_TIMEOUT_MS, repair = false, budget = { used: 0, max: 2 } }) => {
  if (Object.keys(evidenceScopes.normalize(contextRoute?.evidence_scope)).length) {
    const scopedEvidence = Object.values(context).flat().some(item => {
      const kind = item?.source_kind || item?.citation?.source_kind;
      if (!kind || ['task_input', 'workflow_input', 'task_context'].includes(kind)) return false;
      if (kind !== 'live_project') return Boolean(item.content?.trim());
      try {
        const snapshot = JSON.parse(item.content);
        return Boolean(snapshot.records?.length || snapshot.result_id || Number(snapshot.returned_records) > 0 || Number(snapshot.total_records) > 0);
      } catch { return false; }
    });
    if (!scopedEvidence) throw Object.assign(agentError('The selected evidence could not be retrieved in the current project and application. Refresh the scope or check source access before retrying.', 422), {
      code: 'AGENT_EVIDENCE_UNAVAILABLE', statusCode: 422
    });
  }
  const messages = [
    {
      role: "system",
      content: dedupeInstructions([
        // The shared boundary inserts the node-owned primary prompt once.
        // Keep native shape and successor-specific guidance in this frame.
        JSON.stringify({ agent_intent: { name: agent.name, objective: agent.objective }, response_schema: responseContract.schema }),
        agent.customObjective ? "" : agent.instructions || "",
        ...(agent.skills || []).map(skill => [aiInstructionBlock("ai.agentic.workflow", "agenticAssistant.service.js.messages.final.2"),String(skill.name),": ",String(instructionFor(skill,agent.configurationKey)),""].join('')),
        agent.guardrails && agent.guardrails !== require('@hellotest/platform/backend/src/utils/aiExecutionConfiguration').current()?.config?.guardrails ? [aiInstructionBlock("ai.agentic.workflow", "agenticAssistant.service.js.messages.final.3"),String(agent.guardrails),""].join('') : "",
        [aiInstructionBlock("ai.agentic.workflow", "agenticAssistant.service.js.messages.final.4"),String(JSON.stringify(agent.acceptance || { require_evidence: true })),aiInstructionBlock("ai.agentic.workflow", "agenticAssistant.service.js.messages.final.5")].join(''),
        aiInstructionBlock("ai.agentic.workflow", "agenticAssistant.messages.1"),
        aiInstructionBlock("ai.agentic.workflow", "agenticAssistant.messages.2"),
        aiInstructionBlock("ai.agentic.workflow", "agenticAssistant.messages.33"),
        aiInstructionBlock("ai.agentic.workflow", "agenticAssistant.outcomes"),
        aiInstructionBlock("ai.agentic.workflow", "agenticAssistant.presentation"),
        aiInstructionBlock("ai.agentic.workflow", "agenticAssistant.evidenceScope"),
        artifacts.CONTRACT,
        aiInstructionBlock("ai.agentic.workflow", "agenticAssistant.messages.11"),
        ...(context.automation_repair ? [aiInstructionBlock("ai.agentic.workflow", "agenticAssistant.messages.38")] : []),
        ...(context.automation_repair ? ["Host-enforced automation repair contract: " + JSON.stringify(require("@hellotest/ai/backend/services/automationRepair.service").modelContract)] : []),
        aiInstructionBlock("ai.agentic.workflow", "agenticAssistant.messages.12"),
        ...(repair ? [aiInstructionBlock("ai.agentic.workflow", "agenticAssistant.messages.43")] : []),
        ...(repair ? [aiInstructionBlock("ai.agentic.workflow", "agenticAssistant.revision")] : []),
        aiInstructionBlock("ai.agentic.workflow", "agenticAssistant.messages.14")
      ]).join("\n\n")
    },
    ...(Array.isArray(history) ? history : []).filter((entry) => entry && ["user", "assistant"].includes(entry.role) && typeof entry.content === "string").slice(-6).map((entry) => ({
      role: entry.role === "assistant" ? "assistant" : "user",
      content: normalizeText(entry.content, 2_500)
    })),
    {
      role: "user",
      content: promptPayload || buildBoundedAgentPromptPayload({ mode, prompt, context, citations, contextRoute, knowledgeRetrieval })
    }
  ];

  const headers = { "Content-Type": "application/json" };
  if (integrationService.isUsableApiCredential(integration.api_key)) headers.Authorization = `Bearer ${integration.api_key}`;
  let effectiveMessages = messages, reducedEvidenceIds = null, currentCallRecord = null;
  const request = async (jsonMode, reducedContent) => {
    effectiveMessages = reducedContent ? [...messages.filter(message => message.role !== "user"), {role:"user",content:reducedContent}] : messages;
    execution.assertActive();
    if (budget.used >= budget.max) throw agentContract.fail("The model call budget is exhausted. Review the output contract or increase the permitted calls.", "AGENT_MODEL_BUDGET");
    const dispatchRecords=[];
    const beforeDispatch=async()=>{
    execution.assertActive();
    if (budget.used >= budget.max) throw agentContract.fail("The model call budget is exhausted. Review the output contract or increase the permitted calls.", "AGENT_MODEL_BUDGET");
    if (user && projectId) {
      if (!await permissionService.hasPermission(user, 'agentic_workflow.run', projectId)) throw agentError('Agent run access changed before the model call.',403);
      const evidence = Object.values(context).flat().filter(item => item.citation?.source_id).map(item => ({ ...item, source_id: item.source_id || item.citation.source_id, source_kind: item.source_kind || item.citation.source_kind, chunk_id: item.chunk_id || item.citation.chunk_id || item.id }));
      if (evidence.length) {
        const fresh = await require('@hellotest/knowledge/backend/services/knowledgeRetrieval.service').authorizeFreshEvidence({projectId,user,hits:evidence});
        if (fresh.denied_ids.length) throw agentError('Evidence access changed before the model call. Start a fresh review.',403);
      }
    }
    if(deadline-Date.now()<1000)throw agentError("The model review deadline was reached.",504);
    budget.used+=1;
    dispatchRecords.push({name:agent.name,trace_id:null,status:'dispatched',attempt:budget.used,usage:null});
    };
    const onTrace=async record=>{
      if(record.dispatched){
        const observed=dispatchRecords.find(item=>item.trace_id===record.trace_id)||dispatchRecords.find(item=>!item.trace_id);
        if(observed){observed.trace_id=record.trace_id;if(record.status!=='running')observed.status=record.status==='succeeded'?'response_received':record.status;if(record.usage)observed.usage=providerUsage(record.usage);if(record.error_code)observed.error_code=record.error_code;}
      }
      const sessionId=require('@hellotest/platform/backend/src/utils/llmTraceContext').current().session_id;
      if(sessionId)await appendEvent(sessionId,require('@hellotest/platform/backend/src/utils/agentModelTrace').modelTraceEvent(record,{name:agent.name}));
    };
    const remaining = deadline - Date.now();
    if (remaining < 1_000) throw agentError("The model review deadline was reached.", 504);
    let response;
    try { response = await fetchLlmWithRetry(resolveChatCompletionsUrl(integration.base_url), {
    method: "POST",
    headers,
    signal: execution.current()?.signal,
    body: JSON.stringify({
      model: integration.model,
      max_tokens: agent.limits?.max_output_tokens || 4000,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      messages: effectiveMessages
    })
    }, {
      integration,
      beforeDispatch,
      featureKey: agent.configurationKey,
      // This request already carries the MCP packet selected for this agent.
      // Automatic enrichment must not widen user-selected sources or tool scopes.
      mcpContextHandled: { evidence_count: citations.filter(item => item.source_id).length },
      traceContext: { mcp_context_depth: 1, mcp_context: citations.some(item => item.source_id) ? 'retrieved' : 'unavailable',
        on_llm_trace:onTrace },
      compatibility: false,
      contextFallback: false,
      operation: jsonMode ? "agentic-assistant.respond" : "agentic-assistant.respond.json-mode-compatibility",
      timeoutMs: remaining,
      attemptTimeoutMs: remaining,
      maxAttempts: 1,
      // Read-only generation still incurs provider work and cost; do not replay on transport failures.
      idempotent: false,
      maxOutputTokens: agent.limits?.max_output_tokens || 4000,
      maxResponseBytes: 512 * 1024
    });
    currentCallRecord=dispatchRecords.at(-1)||null;
    if(currentCallRecord){currentCallRecord.trace_id ||= response.headers?.get?.('x-hellotest-llm-trace-id')||null;if(currentCallRecord.status==='dispatched')currentCallRecord.status=response.ok?'response_received':'failed';}
    } catch (error) {
      for(const record of dispatchRecords)if(record.status==='dispatched'){record.status='failed';record.error_code=error.code||'AGENT_PROVIDER_ERROR';}
      throw error;
    }finally{
      // Hidden native-output corrections still perform provider work. Report
      // every actual POST, and never label a blocked preflight as dispatched.
      if(budget.onCall)for(const record of dispatchRecords)await budget.onCall(record);
    }
    return response;
  };

  let response = await request(true);
  const providerFailure = (failed, detail) => {
    const failure = require('@hellotest/platform/backend/src/utils/upstreamLlmError').createLlmProviderError({status:failed.status,headers:failed.headers,detail});
    failure.provider_failure_code = failure.code;
    // Keep this public agent API code stable while retaining the shared
    // provider classification and safe diagnostics for the workflow node.
    failure.code = 'AGENT_PROVIDER_ERROR';
    return failure;
  };
  if (!response.ok && [400,413,422].includes(Number(response.status)) && budget.used < budget.max && require('@hellotest/platform/backend/src/utils/llmContextFallback').isContextSizeRejection(response.status, await response.clone().text())) {
    const originalPayload = JSON.parse(promptPayload || buildBoundedAgentPromptPayload({mode,prompt,context,citations,contextRoute,knowledgeRetrieval}));
    const reduced = require('./agentMinimalContext').minimalContext(originalPayload);
    const reducedContent=JSON.stringify(reduced.payload);
    if(Buffer.byteLength(reducedContent,'utf8')>=Buffer.byteLength(JSON.stringify(originalPayload),'utf8'))throw agentContract.fail('The provider cannot fit the complete required task input. Split the input or select a larger-context model; no repeated request was sent.','AGENT_CONTEXT_BUDGET');
    reducedEvidenceIds = reduced.ids;
    response = await request(true,reducedContent);
  }
  if (!response.ok) {
    const providerText = typeof response.text === "function" ? await response.text() : "";
    if ([400, 422].includes(Number(response.status)) && budget.used < budget.max && JSON_MODE_FIELD.test(providerText) && JSON_MODE_REJECTION.test(providerText)) response = await request(false, reducedEvidenceIds ? effectiveMessages.at(-1).content : undefined);
    else throw providerFailure(response,providerText);
  }
  if (!response.ok) throw providerFailure(response,typeof response.text === 'function' ? await response.text() : '');
  const payload = await response.json();
  if (currentCallRecord&&!currentCallRecord.usage) currentCallRecord.usage = providerUsage(payload.usage);
  if (payload.choices?.[0]?.finish_reason === "length") throw agentContract.fail("The model output limit was reached. Reduce the requested scope or increase this agent's output limit.", "AGENT_OUTPUT_TRUNCATED", 422);
  const content = completionContent(payload);
  if (!content) throw new Error("Configured LLM returned an empty completion payload");
  const candidate = extractJson(content);
  if (reducedEvidenceIds) Object.defineProperty(candidate,"_suppliedEvidenceIds",{value:reducedEvidenceIds,enumerable:false});
  Object.defineProperty(candidate, "_model", { value: { effective_model: payload.model || integration.model,
    prompt_hash: crypto.createHash("sha256").update(JSON.stringify(effectiveMessages)).digest("hex"),
    context_reduced: Boolean(reducedEvidenceIds),
    usage: providerUsage(payload.usage),
    trace_id: response.headers?.get?.("x-hellotest-llm-trace-id") || null,
    trace_capture: response.headers?.get?.("x-hellotest-llm-trace-status") || null,
    provider_request_id: response.headers?.get?.("x-request-id") || null }, enumerable: false });
  return candidate;
};

const appendEvent = async (transactionId, input) => {
  execution.assertActive();
  const saved = await workspaceTransactionService.appendTransactionEvent(transactionId, input);
  execution.current()?.onProgress?.({contract_type:"AgentProgress",contract_version:"1.0",session_id:transactionId,
    phase:input.phase,message:input.message,progress:input.details?.progress ?? input.metadata?.progress});
  return saved;
};

exports.AGENT_CATALOG = AGENT_CATALOG;

exports.listSessions = async ({ project_id, app_type_id, limit = 20 } = {}, user) => {
  const projectId = normalizeText(project_id, 255);
  const appTypeId = normalizeText(app_type_id, 255) || null;
  if (!projectId) throw agentError("Select a project to list specialist reviews.");
  await projectService.getProject(projectId, user?.id);
  if (!await permissionService.hasPermission(user, "agentic_workflow.view", projectId)) throw agentError("Permission required: agentic_workflow.view", 403);
  if (appTypeId) {
    const app = await appTypeService.getAppType(appTypeId);
    if (app.project_id !== projectId) throw agentError("Selected application must belong to this project.");
  }
  const requestedLimit = Number(limit);
  const summaries = await workspaceTransactionService.listTransactions({
    project_id: projectId, app_type_id: appTypeId || undefined,
    category: "ai_agent", related_kind: "agentic_assistant_session",
    include_global: false,
    limit: Math.max(1, Math.min(100, Number.isInteger(requestedLimit) ? requestedLimit : 20))
  });
  return summaries.map(row => ({ ...row, description: null, metadata: Object.fromEntries(["mode", "agent_id", "agent_name", "progress", "generation_mode", "agent_version"].filter(key => Object.hasOwn(row.metadata || {}, key)).map(key => [key, row.metadata[key]])) }));
};

const normalizeSavedReviewResult = (value, citations = []) => {
  const saved = toPlainRecord(value);
  if (presentation.presentationIssues({ response: saved.response }, []).length) return null;
  const strings = (items, max = 20) => (Array.isArray(items) ? items : []).filter((item) => typeof item === "string").slice(0, max);
  const evaluation = toPlainRecord(saved.evaluation);
  const items = (entries) => (Array.isArray(entries) ? entries : []).filter((item) => item && typeof item === "object" && !Array.isArray(item)).map((item) => ({
    id: normalizeText(item.id, 120), title: typeof item.title === "string" ? item.title : "Saved finding", detail: typeof item.detail === "string" ? item.detail : "", citation_ids: strings(item.citation_ids, 36),
    ...Object.fromEntries(['type', 'priority', 'observation', 'gap', 'impact', 'proposed_action', 'acceptance_check', 'artifact_kind'].filter(key => typeof item[key] === 'string').map(key => [key, item[key]])),
    ...(typeof item.requires_proposal === 'boolean' ? { requires_proposal: item.requires_proposal } : {})
  })).slice(0, 20);
  let recordedArtifacts = [], artifactIssue = null;
  try {
    // These are recorded review references, not fresh mutation grants. Native
    // acceptance still verifies project scope, permissions and Story revision.
    const targets = (Array.isArray(saved.artifacts) ? saved.artifacts : []).flatMap(item => {
      const ids = Array.isArray(item?.citation_ids) ? item.citation_ids.filter(id => typeof id === 'string') : [];
      if (item?.target_id && (!Number.isInteger(item.target_revision) || item.target_revision < 1)) throw new Error('Missing recorded revision');
      return [
        ...(typeof item?.target_id === 'string' ? [{ id: item.target_id, revision: item.target_revision }] : []),
        ...(Array.isArray(item?.requirement_ids) ? item.requirement_ids.filter(id => typeof id === 'string').map(id => ({ id })) : []),
        ...['test_case_ids', 'manual_test_case_ids'].flatMap(key => Array.isArray(item?.[key]) ? item[key].filter(id => typeof id === 'string').map(id => ({ id, kind: 'test_case' })) : [])
      ].flatMap(target => ids.map(citation_id => ({ ...target, citation_id })));
    });
    recordedArtifacts = artifacts.normalizeArtifacts(saved.artifacts, citations, targets);
  } catch {
    // Never compact a malformed proposal array: that would renumber persistent
    // per-proposal receipts and could make a later Accept address another item.
    artifactIssue = { code: 'AGENT_SAVED_PROPOSALS_INVALID', message: 'This historical review contains incomplete proposal fields. Generate a fresh review; existing saved records are unchanged.' };
  }
  return {
    ...saved,
    headline: normalizeText(saved.headline, 300) || 'Saved specialist outcome',
    executive_summary: normalizeText(saved.executive_summary, 2400),
    ...Object.fromEntries(['sections', 'tables', 'charts'].map(field => [field,
      presentation.presentationIssues({ response: saved.response, [field]: saved[field] }, citations).length ? [] : saved[field] || []])),
    activity_summary: typeof saved.activity_summary === "string" ? saved.activity_summary : "Saved specialist review.",
    findings: items(saved.findings),
    artifacts: recordedArtifacts,
    ...(artifactIssue ? { outcome_issues: [...(Array.isArray(saved.outcome_issues) ? saved.outcome_issues : []), artifactIssue],
      verification: { verifier_version: 'recorded-proposal-review/1', semantic_review: 'human_review_required',
        checks: [{ id: 'recorded_proposals', passed: false, label: artifactIssue.message }], limitations: ['Malformed historical proposals require a fresh review.'],
        status: 'needs_input' }, evidence_gaps: [...strings(saved.evidence_gaps), artifactIssue.message] } : {}),
    deliverables: items(saved.deliverables),
    recommendations: strings(saved.recommendations),
    assumptions: strings(saved.assumptions),
    evidence_gaps: [...strings(saved.evidence_gaps), ...(artifactIssue ? [artifactIssue.message] : [])],
    suggested_handoffs: strings(saved.suggested_handoffs),
    citation_ids: strings(saved.citation_ids, 36),
    evaluation: {
      ...evaluation,
      ...Object.fromEntries(["grounding", "completeness", "traceability", "risk_control", "maturity_score"].map((key) => [key, clampScore(evaluation[key], 0)])),
      rationale: typeof evaluation.rationale === "string" ? evaluation.rationale : "This historical review did not record complete evidence diagnostics."
    }
  };
};

exports.getSession = async (id, user) => {
  let transaction;
  try { transaction = await workspaceTransactionService.getTransaction(normalizeText(id, 255)); }
  catch (error) {
    if (error.message === "Workspace transaction not found") throw agentError("Agent review not found.", 404);
    throw error;
  }
  if (!transaction || transaction.category !== "ai_agent" || transaction.related_kind !== "agentic_assistant_session" || !transaction.project_id) {
    throw agentError("Agent review not found.", 404);
  }
  await projectService.getProject(transaction.project_id, user?.id);
  if (!await permissionService.hasPermission(user, "agentic_workflow.view", transaction.project_id)) throw agentError("Permission required: agentic_workflow.view", 403);
  const metadata = toPlainRecord(transaction.metadata);
  const requiredEvidencePermissions = Array.isArray(metadata.evidence_permissions) ? metadata.evidence_permissions
    : [...new Set((metadata.context_scopes || []).flatMap(scope => ({ stories: ["requirement.view"], "test-cases": ["testcase.view"], runs: ["run.view", "result.view"], bugs: ["feedback.view"], automation: ["automation.view"], knowledge: ["knowledge.view"] }[scope] || [])))];
  const currentEvidenceAccess = await getOptionalEvidenceAccess(user, transaction.project_id, requiredEvidencePermissions);
  if (requiredEvidencePermissions.some(permission => !currentEvidenceAccess[permission])) throw agentError("Source access changed. This saved review contains evidence you can no longer access. Request a fresh review with your current permissions.", 403);
  const indexedCitations = (Array.isArray(metadata.citations) ? metadata.citations : []).filter(citation => citation.source_id && citation.source_kind !== 'live_project');
  if (indexedCitations.length) {
    const fresh = await require('@hellotest/knowledge/backend/services/knowledgeRetrieval.service').authorizeFreshEvidence({projectId:transaction.project_id,user,hits:indexedCitations.map(citation=>({...citation,chunk_id:citation.chunk_id || citation.id,citation}))});
    if (fresh.denied_ids.length) throw agentError('Source access or availability changed. Start a fresh review with currently authorized evidence.',403);
  }
  const savedResult = normalizeSavedReviewResult(metadata.result, metadata.citations || []);
  if (savedResult?.quality_assessment?.persistence?.snapshot_id) {
    savedResult.quality_assessment = { ...savedResult.quality_assessment, persistence: { ...savedResult.quality_assessment.persistence,
      ...await require('@hellotest/ai/backend/services/qualityGraphChanges').freshness(transaction.project_id,savedResult.quality_assessment.persistence.snapshot_id) } };
  }
  const complete = transaction.status === "completed" && savedResult;
  const state = complete ? "completed" : ["running", "queued"].includes(transaction.status) ? "running" : transaction.status === "failed" ? "failed" : "unavailable";
  return {
    transaction: { ...transaction, metadata: { ...metadata, result: complete ? savedResult : null } },
    events: await workspaceTransactionService.listTransactionEvents(transaction.id),
    result: complete ? savedResult : null,
    citations: Array.isArray(metadata.citations) ? metadata.citations : [],
    guardrails: Array.isArray(metadata.guardrails) ? metadata.guardrails : [],
    session_state: state,
    message: state === "completed" ? "Saved specialist review loaded."
      : state === "running" ? "This review is still in progress. Its outcome will appear when it completes."
        : state === "failed" ? metadata.cancelled ? "This review was cancelled before completion." : "This review failed before producing a saved outcome. Start a new review to retry."
          : "The saved outcome for this review is unavailable. Start a new review to regenerate it.",
    provenance: {
      provider: metadata.provider || "HelloTest evidence engine",
      model: metadata.model || null,
      generation_mode: metadata.generation_mode || "unknown",
      fallback_reason: metadata.fallback_reason || null,
      context_route: metadata.context_route || null,
      input_fingerprint: metadata.input_fingerprint || null,
      requires_human_review: true,
      degraded: Boolean(metadata.degraded),
      readiness: savedResult?.readiness || metadata.readiness || null,
      agent_version: metadata.agent_version || null, agent_definition_hash: metadata.agent_definition_hash || null,
      cancelled: Boolean(metadata.cancelled)
    }
  };
};

const resolveCaseEvidenceInput = async ({inputs,user,projectId,appTypeId}) => {
  if(!/^(?:AT[_-][0-9]+|TC[_-]?[0-9]+)$/i.test(inputs.test_case_id||''))return inputs;
  const access=await getOptionalEvidenceAccess(user,projectId,['testcase.view']);
  if(!access['testcase.view'])throw agentError('Test Case evidence access is required to resolve this case reference.',403);
  const scoped=await require('@hellotest/platform/backend/services/entityScope.service').resolveEntityScope({entityType:'test_case',entityId:inputs.test_case_id,projectId,appTypeId,allowDisplayId:true});
  return {...inputs,test_case_id:scoped.entityId};
};
const assertPinnedCaseScope = async ({ projectId, appTypeId, evidenceScope }) => {
  if (!evidenceScope.test_case_id || Object.keys(evidenceScope).length < 2) return;
  const filter = evidenceScopes.predicate('test_case', 't', evidenceScope);
  const row = await require('@hellotest/platform/backend/src/db').prepare(`SELECT t.id FROM test_cases t JOIN app_types a ON a.id = t.app_type_id
    WHERE a.project_id = ? AND (? = '' OR t.app_type_id = ?)${filter.sql} LIMIT 1`).get(projectId, appTypeId || '', appTypeId || '', ...filter.params);
  if (!row) throw agentContract.fail('The selected Test Case does not belong to the combined evidence scope. Choose matching records.', 'AGENT_EVIDENCE_SCOPE_MISMATCH');
};
const respond = async ({ user, project_id, app_type_id, mode, agent_id, prompt, context_scopes, smart_context, integration_id, history, workflow_policy, agent_version, inputs } = {}) => {
  const startedAt = Date.now();
  const projectId = normalizeText(project_id, 255);
  const appTypeId = normalizeText(app_type_id, 255) || null;
  const normalizedPrompt = normalizeText(prompt, workflow_policy ? 16_000 : 8_000);
  const normalizedMode = normalizeMode(mode);
  if (!projectId || !normalizedPrompt) throw agentError("project_id and prompt are required");
  if (!await permissionService.hasPermission(user, "agentic_workflow.run", projectId)) throw agentError("Permission required: agentic_workflow.run", 403);
  await projectService.getProject(projectId, user?.id);
  if (appTypeId) {
    const app = await appTypeService.getAppType(appTypeId);
    if (!app || app.project_id !== projectId) throw agentError('The selected application does not belong to this project.', 403);
  }
  if (integration_id && !await permissionService.hasPermission(user,'integration.view',projectId)) throw agentError('Model selection requires integration access.',403);
  const registered = workflow_policy?.agent_definition || (String(agent_id || "").startsWith("agent-") ? await agentRegistry.resolve(agent_id, agent_version, projectId) : null);
  if (agent_id && !registered && !AGENT_CATALOG[agent_id]) throw agentError("Choose a supported workspace specialist.");
  const normalizedAgentId = agent_id || "quality-orchestrator";
  const definition = registered?.definition;
  const runtimeInputs = await resolveCaseEvidenceInput({inputs:{ ...toPlainRecord(workflow_policy?.connected_input?.request), ...toPlainRecord(workflow_policy?.connected_input?.input), ...toPlainRecord(inputs) },user,projectId,appTypeId});
  const evidenceScope = evidenceScopes.normalize(runtimeInputs);
  if (definition) agentContract.validateInputs(definition, runtimeInputs);
  return nodeAiConfiguration.runAgent({ id: normalizedAgentId, registered, policy: workflow_policy }, () => execution.bounded(async () => {
  if (definition && !workflow_policy) workflow_policy = { ...specialistPolicy(agentContract.toNodeData(definition)), custom_task: true,
    connected_input: inputs || {}, agent_definition: registered };
  const policy = workflow_policy || specialistPolicy({ agentId: normalizedAgentId });
  workflow_policy = policy;
  // Validate complete supplied data before optional retrieval can incur work.
  const preparedWorkflowInput=policy.connected_input&&Object.keys(policy.connected_input).length?suppliedInputEvidence(policy.connected_input):null;
  const preparedTaskInput=!policy.connected_input&&Object.keys(runtimeInputs).length?suppliedInputEvidence(runtimeInputs):null;
  const agent = { ...(definition ? { name: definition.name, objective: definition.objective } : workflow_policy?.custom_task ? { name: policy.agent_name || "Custom AI", objective: "Perform the configured task and selected skills using supplied input. Preserve input provenance." } : AGENT_CATALOG[normalizedAgentId]),
    configurationKey: /^ai\.agentic\.repository\.(object_repository|api_tests|repository_knowledge|component_tests)$/.test(policy.configuration_key || "") ? policy.configuration_key : `ai.agentic.${normalizedAgentId}`,
    outputInstructions: (definition?.feature_id ? Object.values(specialistProfiles).find(profile => profile.featureId === definition.feature_id)?.outputInstructions : specialistProfiles[normalizedAgentId]?.outputInstructions) || "",
    customObjective: definition?.objective || "", instructions: definition?.instructions || "", skills: policy.skills, guardrails: policy.guardrails,
    acceptance: definition?.acceptance || { require_evidence: true }, limits: definition?.limits || { max_model_calls: 8, max_output_tokens: 16384 } };
  const configuration = require('@hellotest/platform/backend/services/aiConfiguration.service');
  const governedProfile = await configuration.resolve(configuration.featureId(agent.configurationKey, 'ai.agentic.workflow'));
  require('@hellotest/platform/backend/src/utils/llmTraceContext').update({ feature: agent.configurationKey });
  const executionPolicy = governedProfile.config.agent_execution || configuration.catalog.find(item => item.id === 'ai.agentic.workflow').defaults.agent_execution;
  agent.outputInstructions = governedProfile.config.prompt;
  agent.limits = {
    ...agent.limits,
    max_model_calls: Math.min(agent.limits.max_model_calls, executionPolicy.max_model_calls),
    max_output_tokens: Math.min(agent.limits.max_output_tokens, governedProfile.config.max_output_tokens),
    timeout_ms: Math.min(definition?.limits.timeout_ms || SESSION_TIMEOUT_MS, executionPolicy.timeout_ms)
  };
  return execution.bounded(async () => {
  const outcomeContract = artifacts.outcomeContract(normalizedAgentId, definition);
  const governedContext = governedProfile.config.context;
  const scopes = normalizeScopes(definition ? policy.context_scopes : context_scopes || policy.context_scopes);
  const contextRoute = aiContextOrchestrator.planContext({
    prompt: `${normalizedPrompt}\nSelected task identifiers: ${JSON.stringify(runtimeInputs).slice(0, 2000)}`,
    agentId: policy.configuration_key?.startsWith("ai.agentic.repository.") ? policy.configuration_key.split(".").at(-1) : registered ? "quality-evaluator" : normalizedAgentId,
    requestedScopes: scopes,
    mode: normalizedMode,
    history: Array.isArray(history) ? history : []
  });
  if (workflow_policy) {
    const allowed = new Set(workflow_policy.allowed_tools);
    contextRoute.effective_scopes = scopes.filter(scope => scope === "knowledge" ? allowed.has("knowledge_search") : allowed.has("project_evidence"));
    contextRoute.live_scopes = contextRoute.effective_scopes.filter(scope => scope !== "knowledge");
    contextRoute.priority_scopes = contextRoute.priority_scopes.filter(scope => contextRoute.effective_scopes.includes(scope));
    if (workflow_policy.custom_task) {
      contextRoute.priority_scopes = [];
      contextRoute.deliverable_contract = "Perform the user-configured task and skills on the supplied workflow input; cite that input as supplied data, never as independently verified project evidence.";
    }
    contextRoute.requires_live_context = contextRoute.live_scopes.length > 0;
    contextRoute.requires_indexed_context = contextRoute.effective_scopes.includes("knowledge");
    if (!contextRoute.requires_indexed_context) contextRoute.indexed_source_kinds = [];
  }
  if (governedContext.mode === 'none') { contextRoute.effective_scopes = []; contextRoute.live_scopes = []; contextRoute.priority_scopes = []; contextRoute.requires_live_context = false; contextRoute.requires_indexed_context = false; }
  contextRoute.retrieval_focus = governedContext.focus;
  contextRoute.retrieval_query = `${normalizedPrompt}\n${governedContext.focus}`;
  contextRoute.decision_question = normalizedPrompt;
  contextRoute.deliverable_contract = governedProfile.config.prompt;
  contextRoute.evidence_scope = evidenceScope;
  const requestedScopes = contextRoute.effective_scopes;
  outcomeContract.context_scopes = requestedScopes;
  const possibleEvidencePermissions = [...new Set(requestedScopes.flatMap(scope => ({ stories: ["requirement.view"], "test-cases": ["testcase.view"], runs: ["run.view", "result.view"], bugs: ["feedback.view"], automation: ["automation.view"], knowledge: ["knowledge.view"] }[scope] || [])))];
  if (["F11","F14","F16"].includes(definition?.feature_id || specialistProfiles[normalizedAgentId]?.featureId)) possibleEvidencePermissions.push("quality_gate.view");
  const evidenceAccess = await getOptionalEvidenceAccess(user, projectId, possibleEvidencePermissions);
  const evidencePermissions = possibleEvidencePermissions.filter(code => evidenceAccess[code]);
  const smartContext = normalizeSmartContext({ ...smart_context, ...(definition?.source_ids.length ? { source_ids: definition.source_ids } : {}), ...(definition?.source_kinds.length ? { source_kinds: definition.source_kinds } : {}) });

  if (!projectId || !normalizedPrompt) throw agentError("project_id and prompt are required");
  execution.assertActive();
  if (!await permissionService.hasPermission(user, "agentic_workflow.run", projectId)) throw agentError("Permission required: agentic_workflow.run", 403);
  execution.assertActive();

  const transaction = await workspaceTransactionService.createTransaction({
    project_id: projectId,
    app_type_id: appTypeId,
    category: "ai_agent",
    action: normalizedMode === "chat" ? "chat" : "delegate",
    status: "running",
    title: `${agent.name} · ${normalizedMode === "chat" ? "Chat" : "Agent task"}`,
    description: normalizedPrompt.slice(0, 500),
    metadata: {
      mode: normalizedMode,
      agent_id: normalizedAgentId,
      agent_name: agent.name,
      context_scopes: requestedScopes, evidence_permissions: evidencePermissions,
      evidence_scope: evidenceScope,
      context_route: contextRoute,
      input_fingerprint: fingerprint({ normalizedPrompt, normalizedAgentId, requestedScopes, evidence_scope: evidenceScope, smart_context: smartContext }),
      progress: 5,
      requires_human_review: true,
      agent_version: registered?.version || 1, agent_definition_hash: registered?.definition_hash || null
    },
    related_kind: "agentic_assistant_session",
    created_by: user?.id,
    started_at: new Date().toISOString()
  });
  const transactionId = transaction.id;
  let automationBrowser = null;
  require("@hellotest/platform/backend/src/utils/llmTraceContext").update({ session_id: transactionId });

  try {
    const integration = await agentRegistry.resolveModel(projectId, user?.id, integration_id || definition?.integration_id, agent.configurationKey);
    await appendEvent(transactionId, {
      phase: "intake",
      message: `${agent.name} accepted the ${normalizedMode === "chat" ? "question" : "delegated task"}.`,
      details: { agent_id: normalizedAgentId, mode: normalizedMode, prompt_fingerprint: fingerprint(normalizedPrompt), progress: 12 }
    });

    const contextInputs = {
      projectId,
      appTypeId,
      scopes: requestedScopes,
      prompt: normalizeText(`${normalizedPrompt}\nSelected evidence scope: ${JSON.stringify(runtimeInputs)}`, 8000),
      smartContext,
      user,
      contextRoute,
      governedContext,
      evidenceScope
    };
    const liveInputs = {
      projectId,
      appTypeId,
      prompt: normalizeText(`${normalizedPrompt}\nSelected evidence scope: ${JSON.stringify(runtimeInputs)}`, 8000),
      user,
      route: contextRoute,
      evidenceScope,
      sourceKinds: smartContext?.source_ids?.length ? [] : smartContext?.source_kinds
    };
    const settled = await Promise.allSettled([
      execution.bounded(() => loadWorkspaceContext(contextInputs), { timeoutMs: CONTEXT_TIMEOUT_MS }),
      workflow_policy && !contextRoute.requires_live_context ? Promise.resolve({ hits: [], counts: {} })
        : execution.bounded(() => (async () => {
          const packet = await require('@hellotest/knowledge/backend/services/knowledgeRetrieval.service').retrieveSearch({
            projectId, appTypeId, query: normalizeText(`${liveInputs.prompt}\n${contextRoute.retrieval_focus}`,8000), user,
            budgets: {max_context_tokens:governedContext.token_budget,max_evidence_items:governedContext.max_items,deadline_ms:CONTEXT_TIMEOUT_MS},
            filters: { app_type_id: appTypeId, agent_id: contextRoute.agent_id, requested_scopes: requestedScopes.filter(scope => scope !== 'knowledge'),
              evidence_scope: evidenceScope, source_ids: smartContext.source_ids,
              source_kinds: smartContext.source_kinds?.length ? smartContext.source_kinds : contextRoute.indexed_source_kinds.filter(kind => !['knowledge_item','file','text','chat','url'].includes(kind)) },
          });
          return { hits: packet.results, counts: packet.retrieval?.live_context_counts || {}, retrieval: packet.retrieval };
        })(), { timeoutMs: CONTEXT_TIMEOUT_MS })
    ]);
    execution.assertActive();
    const contextLimitations = [];
    const { context, knowledgeRetrieval: indexedKnowledgeRetrieval } = settled[0].status === "fulfilled"
      ? settled[0].value : { context: {}, knowledgeRetrieval: { degraded: true, error_code: "KNOWLEDGE_CONTEXT_UNAVAILABLE" } };
    const liveProjectEvidence = settled[1].status === "fulfilled" ? settled[1].value : { hits: [], counts: {} };
    if (settled[0].status === "rejected") contextLimitations.push("Knowledge retrieval was unavailable within the time limit; the review uses available current project evidence.");
    if (settled[1].status === "rejected") contextLimitations.push("Current project evidence was unavailable within the time limit; current counts and states could not be confirmed.");
    if (liveProjectEvidence.hits.length) {
      context.live_project = liveProjectEvidence.hits.map((hit) => ({
        id: hit.chunk_id,
        title: hit.title,
        source_kind: hit.source_kind,
        content: hit.content,
        score: hit.score,
        risk_flags: hit.risk_flags,
        citation: hit.citation
      }));
    }
    const knowledgeRetrieval = {
      ...(indexedKnowledgeRetrieval || {}),
      degraded: Boolean(indexedKnowledgeRetrieval?.degraded) || contextLimitations.length > 0,
      limitations: contextLimitations,
      live_context_count: liveProjectEvidence.hits.length,
      live_context_counts: liveProjectEvidence.counts,
      live_context_retrieval: liveProjectEvidence.retrieval || null,
      context_route: contextRoute
    };
    if (workflow_policy?.connected_input && Object.keys(workflow_policy.connected_input).length) {
      const supplied = preparedWorkflowInput;
      context.workflow_input = [{ id: "K-workflow-input", title: "Supplied workflow input (unverified)",
        content: supplied.text, risk_flags: supplied.risk_flags, redaction_count:supplied.redaction_count,
        citation: { id: "K-workflow-input", label: "Supplied workflow input (unverified)", source_kind: "workflow_input" },
      }];
    }
    if (!workflow_policy.connected_input && Object.keys(runtimeInputs).length) {
      const inputSnapshot = preparedTaskInput;
      context.task_input = [{ id: "K-task-input", title: "Supplied task scope (unverified)", content: inputSnapshot.text, risk_flags:inputSnapshot.risk_flags,redaction_count:inputSnapshot.redaction_count,citation: { id: "K-task-input", label: "Supplied task scope (unverified)", source_kind: "task_input" } }];
    }
    if (policy.context) {
      const suppliedContext = sanitizeAiText(policy.context);
      context.task_context = [{ id: "K-task-context", title: "Supplied domain context (unverified)", content: suppliedContext.text,
        citation: { id: "K-task-context", label: "Supplied domain context (unverified)", source_kind: "task_context" } }];
    }
    let qualityAssessment = null;
    const featureProfile = definition?.feature_id ? Object.values(specialistProfiles).find(profile => profile.featureId === definition.feature_id) : !registered && !policy.custom_task ? specialistProfiles[normalizedAgentId] : null;
    if (runtimeInputs.test_case_id && (normalizedAgentId === 'automation-engineer' || ['F06', 'F18'].includes(featureProfile?.featureId))) {
      await assertPinnedCaseScope({projectId,appTypeId,evidenceScope});
    }
    if (governedContext.mode !== 'none' && policy.allowed_tools.includes('project_evidence') && requestedScopes.includes('test-cases')) {
      const fullIntent = await require('./agentCaseIntentEvidence').loadAgentCaseIntentEvidence({ agentId: normalizedAgentId, featureId: featureProfile?.featureId, inputs: runtimeInputs, user, projectId, appTypeId, includeStoryLinks: requestedScopes.includes('stories') });
      if (fullIntent) {
        context.case_intent = [fullIntent.contextItem];
        for (const code of fullIntent.evidence_permissions) if (!evidencePermissions.includes(code)) evidencePermissions.push(code);
      }
    }
    if (featureProfile?.verifier === "quality-evidence/1") {
      const assessment = await require("@hellotest/ai/backend/services/qualityEvidence.service").assess({
        projectId, appTypeId, user, input: runtimeInputs, featureId: featureProfile.featureId,
        scopes: policy.allowed_tools.includes("project_evidence") ? requestedScopes : []
      });
      qualityAssessment = assessment.report;
      context.quality_checks = [{ id: "K-quality-checks", title: "Code-computed quality checks", content: JSON.stringify(assessment.projection),
        citation: { id: "K-quality-checks", label: "Code-computed quality checks", source_kind: "verified_calculation" } }];
    }
    const repairService = featureProfile?.featureId === "F18" ? require("@hellotest/ai/backend/services/automationRepair.service") : null;
    const repairContext = repairService ? policy.allowed_tools.includes("project_evidence") && requestedScopes.includes("automation") && requestedScopes.includes("test-cases") && requestedScopes.includes("runs")
      ? await repairService.prepare({projectId,appTypeId,user,input:runtimeInputs}) : {status:"needs_evidence",detail:"Enable Automation, Test Cases and Runs as evidence scopes."} : null;
    if (repairContext) context.automation_repair = [{id:"K-automation-repair",title:"Pinned automation repair contract",content:JSON.stringify(repairContext.projection || repairContext),citation:{id:"K-automation-repair",label:"Pinned automation repair contract",source_kind:"authoritative_live_automation"}}];
    const isAutomationSpecialist = normalizedAgentId === "automation-engineer" || featureProfile?.featureId === "F18";
    if (governedContext.mode !== "none" && isAutomationSpecialist && runtimeInputs.test_case_id && requestedScopes.includes("automation") && requestedScopes.includes("test-cases")) {
      const builder=require("@hellotest/automation/backend/services/aiAutomationBuilder.service");
      const pinned=await builder.loadAutomationAgentCaseContext({projectId,appTypeId,user,caseId:runtimeInputs.test_case_id});
      if(!requestedScopes.includes("stories"))delete pinned.stories;
      // The repair projection already pins every section's complete intent
      // and the one failed source. Repeating all saved programs here wastes
      // context and can displace the actual failed section on small models.
      if(repairContext?.status === "eligible") delete pinned.sections;
      context.automation_case=[{id:"K-automation-case",title:"Complete pinned automation case and sections",content:JSON.stringify(pinned),citation:{id:"K-automation-case",label:"Complete pinned automation case and sections",source_kind:"authoritative_live_automation"}}];
      try {
        const session=await builder.connectCaseBrowser({projectId,appTypeId,user,caseId:runtimeInputs.test_case_id,environmentId:repairContext?.base?.environment_id || runtimeInputs.environment_id,
          startUrl:runtimeInputs.start_url,allowBrowserActions:runtimeInputs.allow_browser_actions === true,signal:execution.current()?.signal});
        automationBrowser=session.browser;
        const observations=[];
        for(const [name,args] of [["browser_navigate",{url:session.startUrl}],["browser_snapshot",{}]]) {
          execution.assertActive();const observed=await automationBrowser.call(name,args);
          if(observed.isError)throw new Error("Playwright MCP could not inspect the selected application.");
          observations.push({tool:name,arguments:args,result:observed});
        }
        automationBrowser.initialObservations=observations;
        context.playwright_browser=[{id:"K-playwright-browser",title:"Live Playwright MCP observations",content:JSON.stringify(observations),citation:{id:"K-playwright-browser",label:"Live Playwright MCP observations",source_kind:"observed_browser_evidence"}}];
        await appendEvent(transactionId,{phase:"automation.mcp.ready",message:"Connected Playwright MCP and observed the selected application. Browser evidence is not a runner verification.",details:{server:"hellotest-playwright",tool_count:automationBrowser.tools.length}});
      } catch(error) {
        await automationBrowser?.close();automationBrowser=null;
        contextLimitations.push(`Playwright MCP inspection is unavailable (${error.code || error.statusCode || "connection failed"}). No live browser verification is claimed.`);
        await appendEvent(transactionId,{phase:"automation.mcp.unavailable",level:"warning",message:error.publicMessage || error.message || "Playwright MCP inspection is unavailable."});
      }
    }
    const captureSourcePermissions = sourceContext => {
      const approved = new Set(['requirement.view','testcase.view','run.view','result.view','feedback.view','automation.view','knowledge.view','suite.view','shared_step.view','comment.view','attachment.view','environment.view','configuration.view','quality_gate.view']);
      for (const item of Object.values(sourceContext).flat()) {
        if (item.source_kind !== 'live_project') continue;
        try { for(const permission of JSON.parse(item.content).evidence_permissions || []) if(approved.has(permission) && !evidencePermissions.includes(permission)) evidencePermissions.push(permission); } catch { /* An excerpt cannot add source grants. */ }
      }
    };
    captureSourcePermissions(context);
    const contextCounts = countContext(context);
    const citations = buildCitations(context);
    await appendEvent(transactionId, {
      phase: "context",
      message: `Built bounded context from ${citations.length} workspace reference${citations.length === 1 ? "" : "s"}.`,
      details: {
        context_counts: contextCounts,
        citations,
        knowledge_retrieval: knowledgeRetrieval,
        context_route: contextRoute,
        smart_context_reviewed: Boolean(smartContext.reviewed_context),
        progress: 34
      }
    });

    const guardrails = [
      "Project and app-type scope enforced",
      "Workspace evidence treated as untrusted content",
      "Approved read-only retrieval only",
      "Secrets and hidden reasoning excluded",
      "Human approval required before artifact changes",
      ...(workflow_policy?.guardrails ? [workflow_policy.guardrails] : []),
      ...(workflow_policy ? [`Enabled retrieval tools: ${workflow_policy.allowed_tools.join(", ") || "none"}`] : [])
    ];
    await appendEvent(transactionId, {
      phase: "guardrails",
      message: "Applied data, tool, prompt-injection, and human-approval boundaries.",
      details: { guardrails, progress: 48 }
    });

    // A deterministic baseline is used only for validation/readiness diagnostics.
    // Missing models, failed requests and invalid outputs must fail the run.
    const baseline = buildFallbackResult({ agent, agentId: normalizedAgentId, mode: normalizedMode, prompt: normalizedPrompt,
      context, contextCounts, liveCounts: liveProjectEvidence.counts, citations, contextRoute });
    await appendEvent(transactionId, { phase: "specialist", message: `${agent.name} is requesting a review from the configured model.`,
      details: { provider: integration.name, model: integration.model, decision_summary: agent.objective, progress: 68 } });
    const deadline = Math.min(Date.now() + MODEL_TIMEOUT_MS, startedAt + agent.limits.timeout_ms);
    const budget = policy.model_budget || { used: 0, max: agent.limits.max_model_calls };
    budget.max = Math.min(budget.max, agent.limits.max_model_calls);
    const modelCallRecords = [];
    budget.onCall = async record => {
      modelCallRecords.push(record);
      await appendEvent(transactionId,{phase:"model.call",level:record.status === "failed" ? "warning" : "info",message:`${record.name} · model call ${record.attempt} ${record.status === "response_received" ? "response received" : record.status}.`,details:{name:record.name,trace_id:record.trace_id,attempt:record.attempt}});
    };
    const boundedPayload = JSON.parse(buildBoundedAgentPromptPayload({ mode: normalizedMode, prompt: normalizedPrompt, context, citations, contextRoute, knowledgeRetrieval }));
    boundedPayload.outcome_contract = outcomeContract;
    let testCaseTypes;
    const loadCaseTypes = async () => {
      if (!testCaseTypes) {
        execution.assertActive();
        const field = await require('@hellotest/platform/backend/services/dropdownCatalog.service').getField('test_cases.types');
        testCaseTypes = [...new Set(field.options.filter(option => option.active !== false).map(option => option.value))];
      }
      return testCaseTypes;
    };
    if (requestedScopes.includes('test-cases') || outcomeContract.artifact_kinds.some(kind => ['test_case', 'automation'].includes(kind))) boundedPayload.application_contract = { test_case_types: await loadCaseTypes() };
    const suppliedIds = new Set(Object.values(boundedPayload.bounded_workspace_context).flat().map(item => item.citation?.id || item.id));
    let suppliedCitations = citations.filter(citation => suppliedIds.has(citation.id));
    boundedPayload.citation_contract = boundedPayload.citation_contract.filter(citation => suppliedIds.has(citation.id));
    const artifactTargets = artifacts.storyTargets(boundedPayload.bounded_workspace_context);
    boundedPayload.story_targets = artifactTargets.filter(target => target.kind !== 'test_case' && target.kind !== 'story_link');
    boundedPayload.story_link_targets = artifactTargets.filter(target => target.kind === 'story_link');
    boundedPayload.test_case_targets = artifactTargets.filter(target => target.kind === 'test_case');
    const assertOutcomeEvidenceAccess = async () => {
      const currentAccess = await getOptionalEvidenceAccess(user, projectId, evidencePermissions);
      if (evidencePermissions.some(code => !currentAccess[code])) throw agentError('Evidence access changed during this review.', 403);
      const indexed = suppliedCitations.filter(citation => citation.source_id && citation.source_kind !== 'live_project');
      if (indexed.length) {
        const fresh = await require('@hellotest/knowledge/backend/services/knowledgeRetrieval.service').authorizeFreshEvidence({ projectId, user,
          hits: indexed.map(citation => ({ ...citation, chunk_id: citation.chunk_id || citation.id, citation })) });
        if (fresh.denied_ids.length) throw agentError('Evidence access changed before the draft preview.', 403);
      }
      execution.assertActive();
    };
    const emitOutcomePreview = async (currentResult, message, progress) => {
      const onProgress = execution.current()?.onProgress;
      if (!onProgress) return;
      await assertOutcomeEvidenceAccess();
      onProgress({ contract_type: 'AgentProgress', contract_version: '1.0', session_id: transactionId,
        phase: 'outcome.preview', message, progress,
        outcome_preview: Object.fromEntries(['headline', 'executive_summary', 'findings', 'artifacts', 'sections', 'tables', 'charts'].map(key => [key, currentResult[key]])) });
    };
    let result = baseline, modelObservation = null, repairPatch = null, contextReductionUsed = false;
    let revisionRound = 0, outcomeRevisionRounds = 0, previousCandidate = null, previousRejectedHash = null, lastOutputIssues = [];
    const rejectedHashes = new Set();
    while (budget.used < budget.max && Date.now() < deadline && revisionRound <= executionPolicy.max_revision_rounds) {
      const repair = revisionRound > 0;
      let issues = [], candidate;
      try {
        if (repair) outcomeRevisionRounds += 1;
        const complete = toolPrompt => requestLlmResult({ user, projectId, integration, agent, mode: normalizedMode, prompt: normalizedPrompt, context,
          citations: suppliedCitations, history: Object.keys(evidenceScope).length ? [] : Array.isArray(history) ? history : [], contextRoute, knowledgeRetrieval,
          promptPayload: toolPrompt || JSON.stringify(boundedPayload), deadline, repair, budget });
        candidate = automationBrowser ? await require("@hellotest/automation/backend/lib/automationBrowserAgent").runAutomationBrowserAgent({
          featureKey:agent.configurationKey,prompt:JSON.stringify(boundedPayload),browser:automationBrowser,parse:value=>value,complete,maxTurns:Math.max(1,budget.max-budget.used),deadlineMs:deadline,
          initialObservations:automationBrowser.initialObservations,maxCalls:Math.max(0,10-Math.max(0,automationBrowser.initialObservations.length-2)),onObservation:observation=>automationBrowser.initialObservations.push(observation),onProgress:event=>appendEvent(transactionId,event)
        }) : await complete();
        const validatedRepair = repairContext?.status === "eligible" ? require("@hellotest/ai/backend/services/automationRepair.service").validatePatch(repairContext.base,candidate.automation_repair) : null;
        const explicitAbstention = !candidate.findings?.length && !candidate.deliverables?.length && candidate.evidence_gaps?.length > 0;
        const candidateCitations = candidate._suppliedEvidenceIds ? suppliedCitations.filter(citation => candidate._suppliedEvidenceIds.has(citation.id)) : suppliedCitations;
        issues = presentation.presentationIssues(candidate, candidateCitations);
        result = normalizeResult(candidate, baseline, candidateCitations, { allowUncited: explicitAbstention || agent.acceptance.require_evidence === false, artifactTargets, requireMetadata: true, testCaseTypes, pinnedStoryId:evidenceScope.story_id });
        if (result === baseline && !issues.length) issues = [{ path: 'citation_ids', issue: 'only_supplied_evidence_may_support_nonempty_claims' }];
        if (result !== baseline) {
          const outcomeIssues = artifacts.outcomeIssues(result, outcomeContract).filter(issue => outcomeContract.mode === 'author'
            || !['AGENT_OUTCOME_FINDING_UNRESOLVED', 'AGENT_OUTCOME_PROPOSAL_REQUIRED'].includes(issue.code));
          issues = outcomeIssues.filter(issue => !issue.blocked);
          if (issues.length) result = baseline;
        }
        contextReductionUsed ||= Boolean(candidate._model?.context_reduced);
        modelObservation = candidate._model; repairPatch = validatedRepair;
      } catch (failure) {
        execution.assertActive();
        if (!correctableOutputError(failure)) throw failure;
        result = baseline;
        issues = outputErrorIssues(failure);
      }
      if (result !== baseline) break;
      lastOutputIssues = issues;
      previousCandidate = candidate || null;
      previousRejectedHash = previousCandidate ? fingerprint(previousCandidate) : null;
      if (previousRejectedHash && rejectedHashes.has(previousRejectedHash)) break;
      if (previousRejectedHash) rejectedHashes.add(previousRejectedHash);
      revisionRound += 1;
      boundedPayload.revision_feedback = revisionFeedback(previousCandidate, issues, revisionRound);
      if (budget.used < budget.max && revisionRound <= executionPolicy.max_revision_rounds) await appendEvent(transactionId, { level: "warning", phase: "outcome.revision", message: "The outcome needs a correction. The agent is receiving the specific contract issues.", details: { revision_round: revisionRound, issues, model_calls: budget.used, model_max_calls: budget.max, progress: 72 } });
    }
    if (result === baseline) throw responseContract.invalidOutput(lastOutputIssues);
    const followupPlan = ((registered || !policy.custom_task) ? artifacts.planFollowups(normalizedAgentId, requestedScopes, result, {refineExisting:outcomeContract.refine_existing_proposals}) : []).slice(0, executionPolicy.max_followups);
    result.outcome_contract = outcomeContract;
    result.evidence_scope = evidenceScope;
    const primaryReview = {agent_id:normalizedAgentId,summary:result.executive_summary,findings:result.findings,recommendations:result.recommendations,evidence_gaps:result.evidence_gaps};
    result.primary_review = primaryReview;
    result.agent_chain = [{agent_id:normalizedAgentId,name:agent.name,status:"completed",evidence_scope:evidenceScope,trace_id:modelObservation?.trace_id||null}];
    await emitOutcomePreview(result, `${agent.name} produced a validated draft. Outcome review is still in progress.`, 76);
    const authoredRecommendations = [], completedKinds = [];
    for (const handoff of followupPlan) {
      const followupId = handoff.agent_id;
      const profile=specialistProfiles[followupId];
      const handoffFindings = primaryReview.findings.filter(finding => handoff.finding_ids.includes(finding.id));
      const previousProposals = (result.artifacts || []).filter(artifact => artifact.kind === handoff.kind);
      // A required refinement must succeed before its drafts can be approved.
      // Keep the original review visible, but never substitute an earlier draft
      // when the successor fails or the run exhausts its budget.
      if (handoff.refine_existing) result.artifacts = (result.artifacts || []).filter(artifact => artifact.kind !== handoff.kind);
      if (budget.used >= budget.max || Date.now()+5000 >= deadline || (result.artifacts?.length || 0) >= 8) {
        result.agent_chain.push({agent_id:followupId,name:profile.name,status:"needs_input",kind:handoff.kind,reason:handoff.reason,detail:"The run reached its model-call, time or proposal limit before this follow-up could execute."});
        continue;
      }
      await appendEvent(transactionId,{phase:"handoff",message:`${agent.name} handed the findings to ${profile.name} to prepare structured proposals.`,details:{from_agent:normalizedAgentId,to_agent:followupId,progress:78}});
      try {
        execution.assertActive();
        if(!await permissionService.hasPermission(user,"agentic_workflow.run",projectId))throw agentError("Agent run access changed.",403);
        const evidencePermissions = {story:['requirement.view'],test_case:['testcase.view'],defect:['feedback.view'],run:['run.view'],automation:['testcase.view','automation.view']}[handoff.kind] || [];
        for (const code of evidencePermissions) if(!await permissionService.hasPermission(user,code,projectId))throw agentError("Follow-up evidence access changed.",403);
        const successorConfiguration = (await configuration.resolve(`ai.agentic.${followupId}`)).config;
        const successorConfig = successorConfiguration.context;
        const successorExecution = successorConfiguration.agent_execution || executionPolicy;
        const successorScopes = successorConfig.mode === 'none' ? [] : profile.scopes.filter(scope => requestedScopes.includes(scope));
        const successorRoute = aiContextOrchestrator.planContext({ prompt: normalizedPrompt, agentId: followupId, requestedScopes: successorScopes });
        successorRoute.evidence_scope = evidenceScope;
        successorRoute.retrieval_focus = successorConfig.focus;
        successorRoute.deliverable_contract = successorConfiguration.prompt;
        const fresh = successorConfig.mode === 'none' || !successorScopes.length ? {results:[],retrieval:{status:'not_required'}} : await execution.bounded(() => require('@hellotest/knowledge/backend/services/knowledgeRetrieval.service').retrieveSearch({
          projectId, appTypeId, user, budgets: {max_context_tokens:successorConfig.token_budget,max_evidence_items:successorConfig.max_items,deadline_ms:CONTEXT_TIMEOUT_MS}, query: normalizeText(`${normalizedPrompt}\n${handoffFindings.map(finding => `${finding.title}: ${finding.detail}`).join('\n')}\n${successorConfig.focus || ""}`, 4000),
          filters: { app_type_id: appTypeId, agent_id: followupId, requested_scopes: successorScopes, evidence_scope: evidenceScope,
            source_ids: smartContext.source_ids, source_kinds: smartContext.source_kinds },
        }), { timeoutMs: Math.max(1, Math.min(CONTEXT_TIMEOUT_MS, deadline - Date.now() - 5000)) });
        // Each successor receives its own permitted retrieval. A parent packet
        // may include other source types that this specialist did not select.
        const successorContext = { live_project: fresh.results.map(hit => ({ ...hit, id: hit.chunk_id })) };
        captureSourcePermissions(successorContext);
        const successorCitations = buildCitations(successorContext);
        const handoffPayload = JSON.parse(buildBoundedAgentPromptPayload({ mode: normalizedMode, prompt: normalizedPrompt, context: successorContext, citations: successorCitations, contextRoute: successorRoute, knowledgeRetrieval: fresh.retrieval }));
        let revalidatedFindings = handoffFindings;
        handoffPayload.previous_specialist_review = { agent_id: normalizedAgentId, findings: handoffFindings, provenance: 'untrusted_prior_model_review' };
        handoffPayload.completed_proposals = [...(result.artifacts || []), ...(handoff.refine_existing ? previousProposals : [])];
        handoffPayload.requested_outcome = { ...handoff, max_artifacts: 8 - (result.artifacts?.length || 0) };
        if (['test_case', 'automation'].includes(handoff.kind)) handoffPayload.application_contract = { test_case_types: await loadCaseTypes() };
        const successorIds = new Set(Object.values(handoffPayload.bounded_workspace_context).flat().map(item => item.citation?.id || item.id));
        const successorSupplied = successorCitations.filter(citation => successorIds.has(citation.id));
        handoffPayload.citation_contract = successorSupplied;
        const successorTargets = artifacts.storyTargets(handoffPayload.bounded_workspace_context);
        handoffPayload.story_targets = successorTargets.filter(target => target.kind !== 'test_case' && target.kind !== 'story_link');
        handoffPayload.story_link_targets = successorTargets.filter(target => target.kind === 'story_link');
        handoffPayload.test_case_targets = successorTargets.filter(target => target.kind === 'test_case');
        const successorPolicy = specialistPolicy({ agentId: followupId });
        const followupIntegration = integration_id ? integration : await agentRegistry.resolveModel(projectId, user?.id, definition?.integration_id, `ai.agentic.${followupId}`);
        const successorAgent = { configurationKey: `ai.agentic.${followupId}`, name: profile.name, objective: profile.description, outputInstructions: successorConfiguration.prompt,
          instructions: aiInstructionBlock("ai.agentic.workflow", "agenticAssistant.successor"), skills: successorPolicy.skills, guardrails: successorPolicy.guardrails, acceptance: { require_evidence: true }, limits: { max_model_calls: successorExecution.max_model_calls, max_output_tokens: Math.min(agent.limits.max_output_tokens, successorConfiguration.max_output_tokens) } };
        const successorContract = { ...artifacts.outcomeContract(followupId), context_scopes: successorScopes };
        handoffPayload.outcome_contract = successorContract;
        const successorDeadline = Math.min(deadline, Date.now() + successorExecution.timeout_ms);
        const callStart = budget.used, rejected = new Set();
        let next = baseline, candidate, correction = 0;
        while (budget.used < budget.max && budget.used - callStart < successorExecution.max_model_calls && correction <= successorExecution.max_revision_rounds && Date.now() < successorDeadline) {
          let issues = [];
          try {
            if (correction > 0) outcomeRevisionRounds += 1;
            candidate = await requestLlmResult({user,projectId,integration:followupIntegration,agent:successorAgent,mode:normalizedMode,prompt:normalizedPrompt,context:successorContext,citations:successorSupplied,history:[],contextRoute:successorRoute,knowledgeRetrieval:fresh.retrieval,promptPayload:JSON.stringify(handoffPayload),deadline:successorDeadline,budget,repair:correction > 0});
            contextReductionUsed ||= Boolean(candidate._model?.context_reduced);
            const retainedCitations = candidate._suppliedEvidenceIds ? successorSupplied.filter(citation=>candidate._suppliedEvidenceIds.has(citation.id)) : successorSupplied;
            next = normalizeResult(candidate,baseline,retainedCitations,{artifactTargets:successorTargets,requireMetadata:true,testCaseTypes,pinnedStoryId:evidenceScope.story_id});
            revalidatedFindings = handoffFindings.map(original => {
              const reviewed = next.findings?.find(finding => finding.id === original.id);
              return reviewed ? {...original,...reviewed,artifact_kind:original.artifact_kind,requires_proposal:original.requires_proposal} : original;
            });
            issues = next === baseline ? presentation.presentationIssues(candidate, retainedCitations) : artifacts.outcomeIssues({...next,findings:revalidatedFindings},successorContract);
            if (next !== baseline && next.findings.some(finding => !handoff.finding_ids.includes(finding.id))) {
              issues.push({path:'findings.id',issue:'successors_must_preserve_assigned_finding_identities'});
            }
            if (next !== baseline && next.artifacts.some(artifact => !artifact.addressed_finding_ids?.length
              || artifact.addressed_finding_ids.some(id => !handoff.finding_ids.includes(id)))) {
              issues.push({path:'artifacts.addressed_finding_ids',issue:'proposals_must_address_only_the_assigned_findings'});
            }
            if (next === baseline && !issues.length) issues = [{ path: 'citation_ids', issue: 'only_supplied_evidence_may_support_nonempty_claims' }];
            if (issues.length) next = baseline;
          } catch (error) {
            execution.assertActive();
            if (!correctableOutputError(error)) throw error;
            issues = outputErrorIssues(error); next = baseline;
          }
          if (next !== baseline) break;
          const hash = candidate ? fingerprint(candidate) : null;
          if (hash && rejected.has(hash)) break;
          if (hash) rejected.add(hash);
          correction += 1;
          handoffPayload.revision_feedback = revisionFeedback(candidate, issues, correction);
          if (budget.used < budget.max && correction <= successorExecution.max_revision_rounds) await appendEvent(transactionId,{phase:'outcome.revision',level:'warning',message:`${profile.name} is correcting the proposal against the original findings.`,details:{agent_id:followupId,issues,revision_round:correction,model_calls:budget.used,model_max_calls:budget.max,progress:80}});
        }
        suppliedCitations = [...new Map([...suppliedCitations, ...successorSupplied].map(citation => [citation.id, citation])).values()];
        citations.push(...successorSupplied.filter(citation => !citations.some(existing => existing.id === citation.id)));
        const retainedArtifacts = (result.artifacts || []).filter(artifact => !handoff.refine_existing || artifact.kind !== handoff.kind);
        if(next===baseline||!next.artifacts?.length||next.artifacts.some(a=>a.kind!==handoff.kind)||retainedArtifacts.length+next.artifacts.length>8)throw Object.assign(new Error("The follow-up returned no complete structured proposals addressing its findings."),{code:"AI_INVALID_RESPONSE"});
        result.artifacts=[...retainedArtifacts,...next.artifacts];authoredRecommendations.push(...next.recommendations);completedKinds.push(handoff.kind);result.deliverables=[...(result.deliverables||[]),...(next.deliverables||[])].slice(0,20);
        result.findings = result.findings.map(finding => revalidatedFindings.find(reviewed => reviewed.id === finding.id) || finding);
        result.citation_ids=[...new Set([...result.citation_ids,...next.citation_ids])];
        result.evidence_gaps=[...new Set([...result.evidence_gaps,...next.evidence_gaps])].slice(0,8);
        const successorVerification = agentContract.verify(next, successorSupplied, {require_evidence:true});
        result.agent_chain.push({agent_id:followupId,name:profile.name,status:"completed",kind:handoff.kind,reason:handoff.reason,artifact_count:next.artifacts.length,
          finding_ids:handoff.finding_ids,addressed_finding_ids:[...new Set(next.artifacts.flatMap(artifact=>artifact.addressed_finding_ids))],evidence_scope:evidenceScope,
          verification:successorVerification,trace_id:candidate._model?.trace_id||null});modelObservation=candidate._model;
        await appendEvent(transactionId,{phase:"handoff.completed",message:`${profile.name} prepared ${next.artifacts.length} structured proposals for review.`,details:{agent_id:followupId,artifact_count:next.artifacts.length,progress:84}});
        await emitOutcomePreview(result, `${profile.name} added reviewable proposals to the draft. Final checks are still in progress.`, 84);
      }catch(error){execution.assertActive();if(error.statusCode===403)throw error;result.agent_chain.push({agent_id:followupId,name:profile.name,status:"needs_input",kind:handoff.kind,reason:handoff.reason,detail:"The specialist did not return a valid, evidence-backed proposal."});result.evidence_gaps=[...new Set([...result.evidence_gaps,'The follow-up specialist could not produce a valid structured proposal within this run. Review the findings or retry with a narrower scope.'])].slice(0,8);}
    }
    result.recommendations = artifacts.remainingRecommendations(primaryReview.recommendations, authoredRecommendations, completedKinds);
    execution.assertActive();
    const generationMode = "llm", providerError = null;
    const limitations = [...contextLimitations, ...(contextReductionUsed ? ["The provider required a reduced context packet; the model used only retained excerpts. Omitted source content remains unknown."] : [])];
    result.readiness = buildEvidenceReadiness({ context, contextRoute, limitations });
    result.evidence_gaps = [...new Set([...(result.evidence_gaps || []), ...result.readiness.limitations])].slice(0, 8);
    result.verification = agentContract.verify(result, suppliedCitations, agent.acceptance);
    const finalOutcomeContract = {...outcomeContract, supplemental_artifact_kinds: [...new Set(completedKinds)]};
    const outcomeIssues = artifacts.outcomeIssues(result, finalOutcomeContract);
    result.outcome_contract = finalOutcomeContract;
    result.outcome_issues = outcomeIssues;
    result.verification.checks.push({ id: 'declared_outcome', passed: !outcomeIssues.length, label: 'The declared agent outcome has complete proposals or an evidence-backed no-change conclusion.' });
    if (outcomeIssues.length) {
      result.verification.status = 'needs_input';
      result.evidence_gaps = [...new Set([...result.evidence_gaps, ...outcomeIssues.map(issue => issue.message)])].slice(0, 12);
    }
    if (result.verification.status !== "passed") result.readiness.status = "insufficient_evidence";
    if (qualityAssessment) {
      result.quality_assessment = qualityAssessment;
      result.execution_status = "completed";
      result.publication_status = "proposal";
      if (!qualityAssessment.evidence_complete && result.readiness.status === "ready_for_review") result.readiness.status = "limited_evidence";
      result.verification.checks.push({ id: "domain_snapshot", passed: true, label: "Domain calculations are pinned to the recorded evidence snapshot; they do not approve release." });
    }
    if (repairContext) {
      result.automation_repair = await repairService.save(projectId,user,transactionId,repairContext,result.verification.status === "passed" ? repairPatch : null);
      result.execution_status = "completed"; result.publication_status = "proposal";
      const typed = Boolean(result.automation_repair.id);
      result.verification.checks.push({id:"typed_repair",passed:typed,label:typed?"A typed locator proposal preserves the authored assertions; runner verification is still required.":"No supported typed repair was produced. Supply current failure evidence or author the unsupported change."});
      if (!typed) { result.readiness.status="insufficient_evidence"; result.verification.status="needs_input"; }
    }
    result.model_call_records = modelCallRecords;
    result.agent_chain[0].verification = result.verification;
    if (result.verification.status !== 'passed') result.agent_chain[0].status = 'needs_input';
    result.model_execution = { ...modelObservation, ...aggregateUsage(modelCallRecords), context_reduced: contextReductionUsed, model_calls: budget.used, max_model_calls: budget.max, max_output_tokens: agent.limits.max_output_tokens, revision_rounds: outcomeRevisionRounds, execution_policy: executionPolicy,
      agent_version: registered?.version || 1, agent_definition_hash: registered?.definition_hash || fingerprint(specialistProfiles[normalizedAgentId] || {}), prompt_template_version: "agent-review/3", verifier_version: featureProfile?.verifier || "agent-contract/2", generation_mode: "llm" };
    if (!result.readiness.task_evidence_count) result.grounding_status = "insufficient_context";

    await appendEvent(transactionId, {
      phase: "outcome",
      message: result.readiness.status === "insufficient_evidence" ? "The review needs task-specific evidence before an outcome can be supported." : "Produced a specialist review; no project artifacts were changed.",
      details: {
        recommendation_count: result.recommendations.length,
        assumption_count: result.assumptions.length,
        suggested_handoffs: result.suggested_handoffs,
        progress: 86
      }
    });

    await appendEvent(transactionId, {
      level: result.readiness.status === "ready_for_review" ? "success" : "warning",
      phase: "evaluation",
      message: `Review readiness: ${result.readiness.status.replace(/_/g, " ")}.`,
      details: { evaluation: result.evaluation, verification: result.verification, model_execution: result.model_execution, progress: 100 }
    });

    await assertOutcomeEvidenceAccess();
    const completed = await workspaceTransactionService.updateTransaction(transactionId, {
      status: "completed",
      completed_at: new Date().toISOString(),
      metadata: {
        progress: 100,
        provider: integration?.name || "HelloTest evidence engine",
        model: integration?.model || null,
        generation_mode: generationMode,
        readiness: result.readiness,
        degraded: knowledgeRetrieval.degraded,
        fallback_reason: providerError,
        evidence_permissions: evidencePermissions,
        citations,
        knowledge_retrieval: knowledgeRetrieval,
        context_route: contextRoute,
        evidence_scope: evidenceScope,
        guardrails,
        result,
        evaluation: result.evaluation,
        requires_human_review: true
      }
    });
    const events = await workspaceTransactionService.listTransactionEvents(transactionId);
    const contextPacket = knowledgeRetrieval.context_packet;
    if (contextPacket?.retrieval?.context_graph?.status === 'recorded') {
      result.context_graph_outcome = await require('@hellotest/mcp/backend/contextGraph').rememberDecision({
        projectId, user, packet: contextPacket,
        event: { id: `agent-outcome:${transactionId}`, type: result.artifacts?.length ? 'PROPOSAL_PREPARED' : 'OUTCOME_RECORDED',
          status: result.verification?.status || result.readiness.status, reference_id: transactionId,
          rationale: 'The specialist result was persisted after native evidence and output checks. Artifact proposals still require their own review and do not establish an applied effect.' }
      });
    }

    return {
      transaction: completed,
      events,
      result,
      citations,
      guardrails,
      provenance: {
        provider: integration?.name || "HelloTest evidence engine",
        model: integration?.model || null,
        generation_mode: generationMode,
        degraded: knowledgeRetrieval.degraded,
        readiness: result.readiness,
        fallback_reason: providerError,
        context_route: contextRoute,
        input_fingerprint: fingerprint({ normalizedPrompt, normalizedAgentId, requestedScopes, evidence_scope: evidenceScope, smart_context: smartContext }),
        requires_human_review: true
      }
    };
  } catch (error) {
    const diagnostic = require('../workflows/runtimeEvents').failureInfo(error);
    await workspaceTransactionService.appendTransactionEvent(transactionId, {
      level: "error",
      phase: "failed",
      message: execution.current()?.signal?.aborted ? "The review was cancelled or exceeded its deadline." : "The agent review could not be completed. Retry the review.",
      status: "failed",
      metadata: { progress: 100, failure: true, error_code: error.code || "AGENT_EXECUTION_FAILED", error_message: diagnostic.message, error_details:diagnostic, validation_errors: diagnostic.validation_errors || [], cancelled: Boolean(execution.current()?.signal?.aborted) },
      details: { progress: 100 }
    }).catch(() => null);
    await workspaceTransactionService.updateTransaction(transactionId, {
      status: "failed", completed_at: new Date().toISOString(),
      metadata: { progress: 100, failure: true, error_code: error.code || "AGENT_EXECUTION_FAILED", error_message: diagnostic.message, error_details:diagnostic, validation_errors: diagnostic.validation_errors || [], cancelled: Boolean(execution.current()?.signal?.aborted) }
    }).catch(() => null);
    throw error;
  } finally { await automationBrowser?.close(); }
  }, { timeoutMs: agent.limits.timeout_ms - (Date.now() - startedAt) });
  }, { timeoutMs: (definition?.limits.timeout_ms || SESSION_TIMEOUT_MS) - (Date.now() - startedAt) }));
};

exports.respond = (input = {}) => execution.run({onProgress: typeof input.onProgress === "function" ? input.onProgress : undefined}, () => execution.bounded(() => require("@hellotest/platform/backend/src/utils/llmTraceContext").run(
  { project_id: input.project_id, actor_id: input.user?.id }, () => respond(input)), { timeoutMs: SESSION_TIMEOUT_MS, signal: input.signal }).catch((error) => {
  if (error?.code === "DEADLINE_EXCEEDED") throw agentContract.fail("The review reached its configured time limit. Retry with a narrower scope or check the model connection.", "AGENT_DEADLINE", 504);
  throw error;
}));

exports._internals = {
  assertPinnedCaseScope,
  resolveCaseEvidenceInput,
  buildBoundedAgentPromptPayload,
  suppliedInputEvidence,
  buildFallbackResult,
  buildCitations,
  buildEvidenceReadiness,
  loadWorkspaceContext,
  requestLlmResult,
  collectCandidateCitationIds,
  normalizeCitedItems,
  completionContent,
  normalizeResult,
  normalizeSmartContext,
  normalizeSavedReviewResult,
  revisionFeedback,
  aggregateUsage,
  resolveChatCompletionsUrl
};
