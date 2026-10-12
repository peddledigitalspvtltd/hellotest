const { aiInstructionBlock } = require('@hellotest/platform/backend/src/utils/aiInstructionBlocks');
const { getCompletionContent } = require("@hellotest/platform/backend/src/utils/llmResponse");
const { storyAiSnapshot, testCaseAiSnapshot, object, text, list } = require("@hellotest/platform/backend/src/utils/aiArtifactContext");
const selection = require("@hellotest/integration/backend/services/aiLlmSelection.service");
const { fetchLlmWithRetry } = require("@hellotest/platform/backend/src/utils/llmHttpClient");
const { createLlmProviderError } = require("@hellotest/platform/backend/src/utils/upstreamLlmError");

const DIMENSIONS = {
  story: ["industry-standards", "usefulness", "design-maturity", "market-patterns"],
  "test-case": ["scenario-coverage", "execution-clarity", "data-reliability", "trace-maintainability"]
};
const ASSURANCE_REQUEST_TIMEOUT_MS = 60_000;
const ASSURANCE_REPAIR_TIMEOUT_MS = 60_000;
const ASSURANCE_MAX_OUTPUT_TOKENS = 6_144;

const normalizeBaseline = (value, allowedIds) => {
  const baseline = object(value);
  return {
    overall_score: Number.isFinite(baseline.overall_score) ? Math.max(0, Math.min(100, baseline.overall_score)) : null,
    dimensions: (Array.isArray(baseline.dimensions) ? baseline.dimensions : []).filter(item => allowedIds.includes(item?.id)).slice(0, 4).map(item => ({
      id: item.id, label: text(item.label, 100), score: Number.isFinite(item.score) ? Math.max(0, Math.min(100, item.score)) : null,
      explanation: text(item.explanation, 600), evidence: list(item.evidence, 4, 200), recommendation: text(item.recommendation, 600)
    }))
  };
};

const reviewItems = (value, idKey = "id") => Array.isArray(value)
  ? value
  : Object.entries(object(value)).map(([id, item]) => ({ ...object(item), [idKey]: object(item)[idKey] || id }));

const normalizeReview = (value, dimensionIds, allowedRefs) => {
  const raw = object(value?.assurance_review || value?.review || value?.response || value?.result || value);
  const allowedByLowerCase = new Map([...allowedRefs].map(ref => [ref.toLowerCase(), ref]));
  const evidence = value => {
    const values = Array.isArray(value) ? value : value == null ? [] : [value];
    return [...new Set(values.flatMap(item => {
      const candidate = typeof item === "string"
        ? item
        : text(item?.ref || item?.evidence_ref || item?.evidence_id || item?.citation_id || item?.source_ref || item?.id, 255);
      const cleaned = text(candidate, 255).replace(/^[\s`'"\[]+|[\s`'"\]]+$/g, "");
      if (!allowedByLowerCase.has(cleaned.toLowerCase())) throw Object.assign(new Error("AI assurance response cited unsupported evidence."), { code: "AI_ASSURANCE_REVIEW_INVALID" });
      return [allowedByLowerCase.get(cleaned.toLowerCase())];
    }))].slice(0, 6);
  };
  const itemEvidence = item => evidence(item?.evidence || item?.evidence_refs || item?.citation_ids || item?.citations || item?.source_refs || item?.sources);
  const seen = new Set();
  const dimensions = reviewItems(raw.dimensions).filter(item => {
    if (!dimensionIds.includes(item?.id) || seen.has(item.id)) return false;
    if (!text(item.explanation || item.analysis || item.finding, 1000) || !itemEvidence(item).length) return false;
    seen.add(item.id);
    return true;
  }).map(item => ({ id: item.id, explanation: text(item.explanation || item.analysis || item.finding, 1000), evidence: itemEvidence(item), recommendation: text(item.recommendation || item.action, 800) }))
    .filter(item => item.explanation && item.evidence.length);
  const insights = reviewItems(raw.insights || raw.findings).slice(0, 4).map((item, index) => ({
    id: text(item?.id, 80) || `review-${index + 1}`,
    priority: ["high", "medium", "opportunity"].includes(item?.priority) ? item.priority : "medium",
    title: text(item?.title || item?.label, 180), explanation: text(item?.explanation || item?.detail || item?.finding, 1000),
    evidence: itemEvidence(item), recommendation: text(item?.recommendation || item?.action, 800)
  })).filter(item => item.title && item.explanation && item.evidence.length);
  const summary = text(raw.summary || raw.executive_summary || raw.overview, 1200);
  if (!summary || (!dimensions.length && !insights.length)) {
    throw Object.assign(new Error("AI assurance response did not contain an evidence-grounded review"), { code: "AI_ASSURANCE_REVIEW_INVALID" });
  }
  return { summary, verdict: text(raw.verdict || raw.status, 240), dimensions, insights, limitations: list(raw.limitations || raw.evidence_gaps, 6, 500) };
};

const readReviewResponse = async (response) => {
  if (!response.ok) throw createLlmProviderError({ status: response.status, detail: await response.text() });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw Object.assign(new Error("The provider returned an invalid review payload."), { code: "AI_INVALID_JSON" });
  }
  const content = getCompletionContent(payload).trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  if (!content) throw Object.assign(new Error("The provider returned an empty assurance review."), { code: "AI_EMPTY_RESPONSE" });
  try {
    return { content, parsed: JSON.parse(content) };
  } catch (error) {
    error.reviewContent = content;
    throw error;
  }
};

async function reviewArtifact({ artifactType, savedArtifact, proposedChange, baseline, linkedEvidence = [], user, projectId, integrationId, promptGuidance, additionalContext, reviewPurpose = 'assurance' }) {
  const featureKey = reviewPurpose === 'change-impact'
    ? (artifactType === 'story' ? 'ai.requirement.change_impact' : 'ai.test_case.change_impact')
    : (artifactType === 'story' ? 'ai.quality.story_assurance' : 'ai.quality.test_case_assurance');
  const dimensionIds = DIMENSIONS[artifactType];
  const draft = { ...savedArtifact, ...object(proposedChange), id: savedArtifact.id,
    additional_fields: { ...object(savedArtifact.additional_fields), ...object(proposedChange?.additional_fields) } };
  const snapshot = artifactType === "story" ? storyAiSnapshot(draft) : testCaseAiSnapshot(draft);
  const draftRef = `draft:${artifactType}:${savedArtifact.id}`;
  const sources = [{ ref: draftRef, type: artifactType, content: snapshot }, ...linkedEvidence.slice(0, artifactType === "test-case" ? 6 : 20).map(item => ({
    ref: `${item.kind || "record"}:${item.id}`, type: item.kind || "record", title: text(item.title || item.name, 300), status: text(item.status, 100),
    ...(item.kind === "requirement" ? { content: storyAiSnapshot(item, { textLimit: 1200, itemLimit: 250, listLimit: 4 }) } : {})
  }))];
  const reviewedContext = text(additionalContext, 12000);
  if (reviewPurpose === 'change-impact') sources.push({ ref: `saved:${artifactType}:${savedArtifact.id}`, type: artifactType,
    content: artifactType === 'story' ? storyAiSnapshot(savedArtifact) : testCaseAiSnapshot(savedArtifact) });
  if (reviewedContext) sources.push({ ref: "review:context", type: "reviewed-context", content: reviewedContext });
  const lockedScores = normalizeBaseline(baseline, dimensionIds);
  const prompt = [
    [aiInstructionBlock("ai.quality.story_assurance", "artifactAssurance.service.prompt.segment.1"),String(artifactType === "story" ? "Story" : "Test Case"),aiInstructionBlock("ai.quality.story_assurance", "artifactAssurance.service.prompt.segment.2")].join(''),
    aiInstructionBlock("ai.quality.story_assurance", "artifactAssurance.prompt.1"),
    [aiInstructionBlock("ai.quality.story_assurance", "artifactAssurance.service.prompt.segment.3"),String(JSON.stringify(dimensionIds)),aiInstructionBlock("ai.quality.story_assurance", "artifactAssurance.service.prompt.segment.4")].join(''),
    aiInstructionBlock("ai.quality.story_assurance", "artifactAssurance.prompt.8"),
    [aiInstructionBlock("ai.quality.story_assurance", "artifactAssurance.service.prompt.segment.5"),String(JSON.stringify(text(promptGuidance, 12000))),""].join(''),
    [aiInstructionBlock("ai.quality.story_assurance", "artifactAssurance.service.prompt.segment.6"),String(JSON.stringify(lockedScores)),""].join(''),
    [aiInstructionBlock("ai.quality.story_assurance", "artifactAssurance.service.prompt.segment.7"),String(JSON.stringify(sources)),""].join('')
  ].join("\n");
  const deadline = Date.now() + ASSURANCE_REQUEST_TIMEOUT_MS;
  let modelCalls = 0;
  let integration;
  try {
    integration = await selection.resolveLlmIntegrationForUsage({ integrationId, userId: user?.id, projectId,
      usageKey: featureKey, fallback: "project-then-global", allowMissing: true });
    if (!integration) throw Object.assign(new Error("Configure an active LLM to run AI assurance."), { code: "AI_MODEL_REQUIRED", statusCode: 422 });
    const baseUrl = String(integration.base_url || "https://api.openai.com/v1").replace(/\/+$/, "");
    const url = /\/chat\/completions$/i.test(baseUrl) ? baseUrl : `${baseUrl}/chat/completions`;
    const headers = { "Content-Type": "application/json" };
    if (integration.api_key) headers.Authorization = `Bearer ${integration.api_key}`;
    const request = (messages, { operation, timeoutMs, maxOutputTokens }) => {
      const remaining = deadline - Date.now();
      if (remaining < 1000 || modelCalls >= 2) throw Object.assign(new Error("AI assurance exhausted its request budget."), { code: "AI_BUDGET_EXCEEDED", statusCode: 504 });
      modelCalls += 1;
      return fetchLlmWithRetry(url, { method: "POST", headers, body: JSON.stringify({
      model: integration.model,  response_format: { type: "json_object" }, messages
    }) }, { integration, operation, featureKey, timeoutMs: Math.min(timeoutMs, remaining), maxOutputTokens, maxAttempts: 1, compatibility: false, contextFallback: false });
    };
    const allowedRefs = new Set(sources.map(item => item.ref));
    let review;
    let repaired = false;
    let originalContent = "";
    try {
      const result = await readReviewResponse(await request([
        { role: "system", content: aiInstructionBlock("ai.quality.story_assurance", "artifactAssurance.result.9") },
        { role: "user", content: prompt }
      ], { operation: `quality-assurance.${artifactType}`, timeoutMs: ASSURANCE_REQUEST_TIMEOUT_MS, maxOutputTokens: ASSURANCE_MAX_OUTPUT_TOKENS }));
      originalContent = result.content;
      review = normalizeReview(result.parsed, dimensionIds, allowedRefs);
    } catch (error) {
      const repairable = error instanceof SyntaxError || error?.code === "AI_ASSURANCE_REVIEW_INVALID";
      if (!repairable) throw error;
      originalContent = originalContent || text(error?.reviewContent, 16_000);
      const repairPrompt = [
        aiInstructionBlock("ai.quality.story_assurance", "artifactAssurance.repairPrompt.10"),
        [aiInstructionBlock("ai.quality.story_assurance", "artifactAssurance.service.repairPrompt.segment.8"),String(JSON.stringify(dimensionIds)),aiInstructionBlock("ai.quality.story_assurance", "artifactAssurance.service.repairPrompt.segment.9")].join(''),
        [aiInstructionBlock("ai.quality.story_assurance", "artifactAssurance.service.repairPrompt.segment.10"),String(JSON.stringify([...allowedRefs])),aiInstructionBlock("ai.quality.story_assurance", "artifactAssurance.service.repairPrompt.segment.11")].join(''),
        aiInstructionBlock("ai.quality.story_assurance", "artifactAssurance.repairPrompt.11"),
        [aiInstructionBlock("ai.quality.story_assurance", "artifactAssurance.service.repairPrompt.segment.12"),String(text(JSON.stringify(sources), 32_000)),""].join(''),
        aiInstructionBlock("ai.quality.story_assurance", "artifactAssurance.repairPrompt.12"),
        [aiInstructionBlock("ai.quality.story_assurance", "artifactAssurance.service.repairPrompt.segment.13"),String(JSON.stringify(text(originalContent || error?.message, 16_000))),""].join('')
      ].join("\n");
      const repairedResult = await readReviewResponse(await request([
        { role: "system", content: aiInstructionBlock("ai.quality.story_assurance", "artifactAssurance.repairedResult.13") },
        { role: "user", content: repairPrompt }
      ], { operation: `quality-assurance.${artifactType}.repair`, timeoutMs: ASSURANCE_REPAIR_TIMEOUT_MS, maxOutputTokens: 3_072 }));
      review = normalizeReview(repairedResult.parsed, dimensionIds, allowedRefs);
      repaired = true;
    }
    return { assurance_review: review, generation_mode: "hybrid", fallback_used: false, fallback_reason: null,
      response_repaired: repaired,
      execution_status: "completed", publication_status: "proposal",
      verification: { status: "passed", verifier_version: "artifact-assurance/2", checks: ["output_shape", "evidence_references"], limitations: ["Citation matching does not verify factual correctness or readiness."] },
      model_execution: { model_calls: modelCalls, max_model_calls: 2, deadline_ms: ASSURANCE_REQUEST_TIMEOUT_MS },
      integration: { id: integration.id, name: integration.name, type: integration.type, model: integration.model, generation_mode: "hybrid", direct_model_invocation: true } };
  } catch (error) {
    const reasons = {
      AI_MODEL_REQUIRED: "Configure an active LLM in Integrations to run AI assurance.",
      AI_INPUT_BUDGET_EXCEEDED: "The review input exceeds the provider budget. Shorten the draft or guidance and retry.",
      AI_OUTPUT_TRUNCATED: "The provider stopped before completing its review. Retry with a smaller draft or shorter guidance.",
      AI_INVALID_JSON: "The provider returned an invalid review format. Check that the selected model supports JSON responses.",
      AI_EMPTY_RESPONSE: "The provider returned an empty review. Retry or select another configured model."
    };
    const reason = reasons[error?.code]
      || ([401, 403].includes(error?.upstreamStatusCode) ? "The provider rejected the configured credentials or model access. Check the selected LLM integration." : null)
      || (error?.upstreamStatusCode === 429 ? "The provider rate limit was reached. Retry after the limit resets." : null)
      || ([502, 503, 504].includes(error?.statusCode) || error?.name === "AbortError" ? "The AI provider is unavailable or timed out. Check its connection and retry." : null)
      || (error instanceof SyntaxError || /evidence-grounded review/.test(error?.message || "") ? "The provider returned a review without usable cited evidence. Retry or select another configured model." : null)
      || "The configured AI provider could not complete an evidence-grounded review.";
    throw Object.assign(new Error(reason), { code: error?.code || "AI_REVIEW_FAILED", statusCode: error?.statusCode || 502, publicMessage: reason, cause: error });
  }
}

module.exports = { reviewArtifact };
