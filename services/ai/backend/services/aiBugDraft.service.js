const db = require("@hellotest/platform/backend/src/db");
const aiLlmSelectionService = require("@hellotest/integration/backend/services/aiLlmSelection.service");
const {normalizeReferenceList} = require("@hellotest/platform/backend/src/utils/externalReferences");
const {normalizeReferenceImages} = require('@hellotest/platform/backend/src/utils/aiReferenceImages');
const {requireAiAssessment} = require("@hellotest/platform/backend/src/utils/requireAiAssessment");
const {BUG_DRAFT_USAGE_KEY,DRAFT_FIELDS,normalizeText,normalizeImageAssets,normalizeExternalLinks,unique,loadEvidence,buildEvidenceSources,buildPromptContextSnapshot,deterministicDraft,normalizeCandidate,requestLlmDraft,hasWrittenIncident,buildProcessingSnapshot,fingerprint,extractLabeledSection,extractHeadedSection,BUG_DRAFT_CONTEXT_LIMITS} = require('./bugDraftGrounding');

exports.preview = async ({ user, project_id, intent, evidence, additional_context, external_links, reference_photos, linked_test_run_id, linked_execution_result_id, linked_test_case_ids, linked_test_suite_ids, linked_module_ids, linked_requirement_ids, integration_id, prompt_guidance, require_case_context = false } = {}) => {
  const projectId = normalizeText(project_id, 255);
  const normalizedIntent = normalizeText(intent, 4_000);
  if (!projectId) throw Object.assign(new Error("project_id is required"), { statusCode: 400 });
  if (linked_execution_result_id && !linked_test_run_id) throw Object.assign(new Error("Select the Test Run for the requested execution result."), { statusCode: 400 });
  const project = await db.prepare("SELECT id FROM projects WHERE id = ?").get(projectId);
  if (!project) throw new Error("Project not found");
  const requestedExternalLinks = normalizeReferenceList(external_links);
  const requestedReferenceImages = Array.isArray(reference_photos) ? reference_photos : [];
  const imageAssets = normalizeImageAssets(reference_photos);
  const input = {
    intent: normalizedIntent,
    evidence: normalizeText(evidence, 12_000),
    additional_context: normalizeText(additional_context, 12_000),
    external_links: normalizeExternalLinks(external_links),
    reference_photos: imageAssets.map((image) => ({ name: image.name, content_hash: image.content_hash })),
    linked_test_run_id: normalizeText(linked_test_run_id, 255),
    linked_execution_result_id: normalizeText(linked_execution_result_id, 255),
    linked_test_case_ids: unique(normalizeReferenceList(linked_test_case_ids)),
    linked_test_suite_ids: unique(normalizeReferenceList(linked_test_suite_ids)),
    linked_module_ids: unique(normalizeReferenceList(linked_module_ids)),
    linked_requirement_ids: unique(normalizeReferenceList(linked_requirement_ids)),
    prompt_guidance: normalizeText(prompt_guidance, 4_000)
  };
  const rawContext = await loadEvidence({
    user,
    projectId,
    runId: input.linked_test_run_id,
    resultId: input.linked_execution_result_id,
    testCaseIds: input.linked_test_case_ids,
    suiteIds: input.linked_test_suite_ids,
    moduleIds: input.linked_module_ids,
    requirementIds: input.linked_requirement_ids,
    referenceImages: imageAssets
  });
  if (require_case_context && !rawContext.cases.length) throw Object.assign(new Error("Selected Test Case context is unavailable in this project. Choose an accessible Test Case."), { statusCode: 400 });
  if (!input.intent && !input.evidence && !input.additional_context && !imageAssets.length && !rawContext.run && !rawContext.cases.length && !rawContext.requirements.length) {
    const message = "Describe the observed problem, attach a screenshot, or select accessible Test Case, Story or run evidence before drafting a Defect. External links alone are reference pointers; their content is not read.";
    throw Object.assign(new Error(message), { statusCode: 400, code: "AI_DEFECT_EVIDENCE_REQUIRED", publicMessage: message });
  }
  rawContext.boundaries.requested.external_links = requestedExternalLinks.length;
  rawContext.boundaries.requested.reference_images = requestedReferenceImages.length;
  rawContext.boundaries.included.external_links = input.external_links.length;
  const admittedImages = normalizeReferenceImages([...imageAssets, ...rawContext.execution_images]);
  const admittedExecutionImages = admittedImages.filter((image) => rawContext.execution_images.some((candidate) => candidate.content_hash === image.content_hash));
  rawContext.boundaries.included.reference_images = imageAssets.length;
  rawContext.boundaries.omitted.external_links = Math.max(0, requestedExternalLinks.length - input.external_links.length);
  rawContext.boundaries.omitted.reference_images = Math.max(0, requestedReferenceImages.length - imageAssets.length);
  rawContext.boundaries.included.execution_images = admittedExecutionImages.length;
  rawContext.boundaries.omitted.execution_images = Math.max(rawContext.boundaries.requested.execution_images - admittedExecutionImages.length, rawContext.boundaries.omitted.execution_images || 0);
  const evidenceSources = buildEvidenceSources({ input, context: { ...rawContext, execution_images: admittedExecutionImages }, imageAssets });
  const promptContext = buildPromptContextSnapshot(rawContext);
  const context = {
    run: promptContext.run,
    cases: promptContext.cases,
    requirements: promptContext.requirements,
    failures: promptContext.failures,
    execution_images: promptContext.execution_images,
    boundaries: {
      ...rawContext.boundaries,
      content_limits: promptContext.content_limits,
      content_omissions: promptContext.content_omissions,
      partial_sources: Object.values(rawContext.boundaries.omitted).some((count) => count > 0) || promptContext.partial_sources
    }
  };
  const deterministic = deterministicDraft({ input, context, evidenceSources });
  let normalized = { ...deterministic, fallback_fields: [...DRAFT_FIELDS] };
  let integration = null;
  let providerError = null;
  let providerFailure = null;
  try {
    integration = await aiLlmSelectionService.resolveLlmIntegrationForUsage({ integrationId: integration_id, userId: user?.id, usageKey: BUG_DRAFT_USAGE_KEY, projectId, fallback: "project-then-global", allowMissing: true });
    if (integration) {
      let candidate, restoredFields = [];
      try {
        candidate = await requestLlmDraft(integration, input, context, evidenceSources, admittedImages);
      } catch (error) {
        if (error?.code !== "AI_OUTPUT_TRUNCATED") throw error;
        const canonicalFields = Object.fromEntries(['steps_to_reproduce', 'expected_result']
          .filter(field => deterministic.draft[field] && deterministic.field_evidence[field]?.length)
          .map(field => [field, { value: `source:${deterministic.field_evidence[field][0]}`, evidence_refs: deterministic.field_evidence[field] }]));
        candidate = await requestLlmDraft(integration, input, context, evidenceSources, admittedImages, { compact: true, canonicalFields });
        if (candidate?.draft && typeof candidate.draft === 'object' && !Array.isArray(candidate.draft)) {
          restoredFields = Object.keys(canonicalFields);
          candidate = { ...candidate, draft: { ...candidate.draft }, field_evidence: { ...candidate.field_evidence } };
          for (const field of restoredFields) {
            candidate.draft[field] = deterministic.draft[field];
            candidate.field_evidence[field] = deterministic.field_evidence[field];
          }
        }
      }
      normalized = normalizeCandidate(candidate, deterministic, evidenceSources);
      normalized.fallback_fields = unique([...normalized.fallback_fields, ...restoredFields]);
    }
  } catch (error) {
    if (error?.code === "AI_OUTPUT_TRUNCATED") {
      const message = "The selected model reached its output limit, including on a compact retry. Select fewer linked records or increase this feature’s output-token limit, then try again. No Defect draft was generated.";
      throw Object.assign(new Error(message), { statusCode: 502, code: "AI_OUTPUT_TRUNCATED", publicMessage: message });
    }
    else {
      if (error?.publicMessage) {
        error.message = error.publicMessage;
        throw error;
      }
      if (['AI_VISION_UNSUPPORTED', 'AI_MCP_QUERY_REQUIRED', 'LLM_AUTHENTICATION_FAILED', 'LLM_QUOTA_EXCEEDED', 'LLM_RATE_LIMITED', 'LLM_RATE_LIMIT_REQUEST_TOO_LARGE', 'LLM_REQUEST_TOO_LARGE'].includes(error?.code)) throw error;
      if (admittedImages.length && !hasWrittenIncident(input, context) && error?.code === 'AI_NATIVE_CONTRACT_INVALID') {
        const message = "The screenshot did not provide enough evidence for a valid Defect proposal. Describe what is wrong and what should happen, or attach a clearer screenshot. No Defect was created.";
        throw Object.assign(new Error(message), { statusCode: 422, code: "AI_DEFECT_EVIDENCE_REQUIRED", publicMessage: message });
      }
      if (error?.code === 'AI_NATIVE_CONTRACT_INVALID') {
        const fields = unique((error.validation_errors || []).map(item => item?.field).filter(field => DRAFT_FIELDS.includes(field)));
        const message = `The model returned Defect details that still do not match the required format${fields.length ? ` (${fields.join(', ')})` : ''}. Retry or select another configured LLM. Your saved work is unchanged.`;
        throw Object.assign(new Error(message, { cause: error }), { statusCode: 502, code: 'AI_DEFECT_RESPONSE_INVALID', publicMessage: message });
      }
      providerFailure = error instanceof Error ? error : new Error('LLM generation failed.');
      providerError = error instanceof Error ? error.message : "LLM generation failed.";
      normalized = { ...deterministic, fallback_fields: [...DRAFT_FIELDS] };
    }
  }
  if (integration && !providerError && (!normalized.draft.title || normalized.fallback_fields.length === DRAFT_FIELDS.length)) {
    const message = admittedImages.length && !hasWrittenIncident(input, context)
      ? "The model did not identify a Defect supported by the screenshot and selected evidence. Describe the visible problem and expected outcome, or attach a clearer screenshot. No Defect was created."
      : "The model did not identify a Defect supported by the supplied evidence. Add an observed problem or relevant failure evidence and retry. No Defect was created.";
    throw Object.assign(new Error(message), { statusCode: 422, code: "AI_DEFECT_EVIDENCE_REQUIRED", publicMessage: message });
  }
  try {
    requireAiAssessment({ integration, failed: Boolean(providerError), accepted: normalized.fallback_fields.length < DRAFT_FIELDS.length });
  } catch (error) {
    if (providerFailure) error.cause = providerFailure;
    throw error;
  }
  const generationMode = !integration || providerError ? "deterministic" : normalized.fallback_fields.length ? "hybrid" : "llm";
  const fallbackReason = providerError
    || (!integration ? "No active LLM integration is configured." : normalized.fallback_fields.length ? "Some model fields were missing, invalid, or lacked allowed evidence refs and were replaced with evidence-bound deterministic values." : null);
  const now = new Date().toISOString();
  const citations = evidenceSources
    .filter((source) => ["test-run", "test-case", "requirement", "execution-result", "execution-screenshot"].includes(source.type))
    .map((source) => ({ type: source.type, id: source.id, title: source.title }));
  const evidenceSnapshot = {
    input,
    sources: evidenceSources.map(({ ref, type, id, title, excerpt, status, trust }) => ({ ref, type, id, title, excerpt, status, trust })),
    context: { run: context.run, cases: context.cases, requirements: context.requirements, failures: context.failures, execution_images: context.execution_images },
    boundaries: context.boundaries
  };
  const processing = buildProcessingSnapshot({
    evidenceSources,
    generationMode,
    gaps: normalized.gaps,
    fallbackFields: normalized.fallback_fields,
    partialSources: context.boundaries.partial_sources
  });
  const fallbackUsed = generationMode !== "llm";
  return {
    draft: {
      ...normalized.draft,
      linked_test_run_id: context.run?.id || "",
      linked_test_case_ids: context.cases.map((item) => item.id),
      linked_test_suite_ids: rawContext.linked_test_suite_ids,
      linked_module_ids: rawContext.linked_module_ids,
      linked_requirement_ids: context.requirements.map((item) => item.id)
    },
    citations,
    evidence_sources: evidenceSources,
    field_evidence: normalized.field_evidence,
    gaps: normalized.gaps,
    assumptions: normalized.assumptions,
    boundaries: context.boundaries,
    fallback_fields: normalized.fallback_fields,
    processing,
    provenance: {
      capability: "ai-bug-draft",
      generation_mode: generationMode,
      provider: integration?.name || "HelloTest evidence graph",
      model: integration?.model || null,
      request_id: `bug-draft-${Date.now()}`,
      input_fingerprint: fingerprint(evidenceSnapshot),
      generated_at: now,
      confidence: 0,
      confidence_basis: "not-scored; review evidence coverage and gaps",
      evidence: evidenceSources.map((item) => item.ref),
      fallback_used: fallbackUsed,
      fallback_reason: fallbackReason,
      fallback_fields: normalized.fallback_fields,
      partial_sources: context.boundaries.partial_sources,
      requires_human_review: true
    }
  };
};

exports._private = {
  BUG_DRAFT_USAGE_KEY,
  buildEvidenceSources,
  deterministicDraft,
  normalizeCandidate,
  extractLabeledSection,
  extractHeadedSection,
  buildPromptContextSnapshot,
  loadEvidence,
  BUG_DRAFT_CONTEXT_LIMITS
};
