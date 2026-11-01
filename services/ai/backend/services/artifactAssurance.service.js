const { aiInstructionBlock } = require('@hellotest/platform/backend/src/utils/aiInstructionBlocks');
const { getCompletionContent } = require("@hellotest/platform/backend/src/utils/llmResponse");
const { storyAiSnapshot, testCaseAiSnapshot, object, text, list } = require("@hellotest/platform/backend/src/utils/aiArtifactContext");
const selection = require("@hellotest/integration/backend/services/aiLlmSelection.service");
const { fetchLlmWithRetry } = require("@hellotest/platform/backend/src/utils/llmHttpClient");
const { createLlmProviderError } = require("@hellotest/platform/backend/src/utils/upstreamLlmError");
const { sanitizeAiText } = require('@hellotest/platform/backend/src/security/aiTextPolicy');

const DIMENSIONS = {
  story: ["industry-standards", "usefulness", "design-maturity", "market-patterns"],
  "test-case": ["scenario-coverage", "execution-clarity", "data-reliability", "trace-maintainability"]
};
const ASSURANCE_REQUEST_TIMEOUT_MS = 60_000;
const ASSURANCE_REPAIR_TIMEOUT_MS = 60_000;
const ASSURANCE_TOTAL_TIMEOUT_MS = ASSURANCE_REQUEST_TIMEOUT_MS + ASSURANCE_REPAIR_TIMEOUT_MS;
const ASSURANCE_MAX_OUTPUT_TOKENS = 6_144;
const READINESS_STATUSES = ['ready', 'needs_input', 'unknown', 'not_applicable'];
const READINESS_CONTEXT_KINDS = ['api_contract', 'authentication', 'test_data', 'fixture', 'application_context', 'other'];
const FINDING_KINDS = ['business_ambiguity', 'missing_context', 'artifact_quality', 'traceability', 'change_impact', 'automation_input'];
const REVIEW_FIELDS = {
  story: ['title', 'description', 'acceptance_criteria', 'gherkin_scenarios', 'specification_content', 'priority', 'scope', 'dependencies'],
  'test-case': ['title', 'description', 'steps', 'gherkin_document', 'parameter_values', 'test_data_set_ids', 'requirement_ids', 'preconditions']
};
const unknownReadiness = () => ({ status: 'unknown', summary: 'Automation suitability was not established by a complete, supported assessment.', evidence_refs: [], missing_context: [] });

// This describes a review, never a substitute artifact. Product authoring and
// execution keep their own contracts and approval boundaries.
const reviewContract = (dimensionIds, sourceRefs, fieldNames, stepRefs) => ({
  summary: 'Concise evidence-grounded review',
  dimensions: [{ id: dimensionIds[0], explanation: 'Supported assessment', evidence: sourceRefs.slice(0, 6), recommendation: 'Smallest useful action or preserve the supported behavior' }],
  insights: [{ id: 'finding-1', priority: 'medium', kind: 'artifact_quality',
    title: 'Specific issue', explanation: 'Observed gap or ambiguity and why it matters', evidence: sourceRefs.slice(0, 6),
    affected_fields: fieldNames.slice(0, 6), step_refs: stepRefs.slice(0, 10), recommendation: 'Concrete change and observable completion condition' }],
  limitations: ['Unknown, restricted or truncated evidence; no execution or approval implied']
});

// Only protocol diagnostics survive the service boundary. Candidates and raw
// provider bodies remain private to the bounded repair and retained trace.
const failureMetadata = error => {
  const result = {};
  for (const key of ['retryable', 'nonRetryable', 'generation_received', 'outcome_unknown']) {
    if (typeof error?.[key] === 'boolean') result[key] = error[key];
  }
  for (const key of ['upstreamStatusCode', 'upstreamStatus']) {
    if (Number.isInteger(error?.[key]) && error[key] >= 100 && error[key] <= 599) result[key] = error[key];
  }
  if (Number.isFinite(error?.retryAfterMs) && error.retryAfterMs >= 0) result.retryAfterMs = Math.min(error.retryAfterMs, 86400000);
  if (Array.isArray(error?.validation_errors)) result.validation_errors = error.validation_errors.slice(0, 8).map(item =>
    Object.fromEntries(['path', 'keyword', 'message', 'required_property'].flatMap(key =>
      typeof item?.[key] === 'string' ? [[key, sanitizeAiText(item[key]).text.slice(0, key === 'message' ? 500 : 200)]] : [])));
  if (error?.provider_error && typeof error.provider_error === 'object') {
    const provider = {};
    for (const key of ['code', 'type', 'param', 'request_id']) {
      const value = error.provider_error[key];
      if (value === null) provider[key] = null;
      else if (typeof value === 'string' && /^[A-Za-z0-9_.:[\]-]{1,160}$/.test(value) && sanitizeAiText(value).text === value) provider[key] = value;
    }
    if (Object.keys(provider).length) result.provider_error = provider;
  }
  return result;
};

const reviewOutputSchema = (dimensionIds, sourceRefs, fieldNames, stepRefs, includeReadiness) => {
  const string = maxLength => ({ type: 'string', minLength: 1, maxLength });
  const refs = { type: 'array', minItems: 1, maxItems: 6, uniqueItems: true, items: { type: 'string', enum: sourceRefs } };
  const locations = (values, maxItems) => ({ type: 'array', maxItems: Math.min(values.length, maxItems), uniqueItems: true,
    items: values.length ? { type: 'string', enum: values } : { type: 'string' } });
  return { type: 'object', additionalProperties: false, required: ['summary', 'dimensions', 'insights', 'limitations', ...(includeReadiness ? ['automation_readiness'] : [])],
    anyOf: [{ properties: { dimensions: { type: 'array', minItems: 1 } } }, { properties: { insights: { type: 'array', minItems: 1 } } }], properties: {
    summary: string(1200),
    dimensions: { type: 'array', maxItems: 4, items: { type: 'object', additionalProperties: false, required: ['id', 'explanation', 'evidence', 'recommendation'], properties: {
      id: { type: 'string', enum: dimensionIds }, explanation: string(1000), evidence: refs, recommendation: string(800)
    } } },
    insights: { type: 'array', maxItems: 4, items: { type: 'object', additionalProperties: false,
      required: ['id', 'priority', 'kind', 'title', 'explanation', 'evidence', 'affected_fields', 'step_refs', 'recommendation'], properties: {
        id: string(80), priority: { type: 'string', enum: ['high', 'medium', 'opportunity'] }, kind: { type: 'string', enum: FINDING_KINDS },
        title: string(180), explanation: string(1000), evidence: refs,
        affected_fields: locations(fieldNames, 6), step_refs: locations(stepRefs, 10), recommendation: string(800)
      } } },
    limitations: { type: 'array', maxItems: 6, items: string(500) },
    ...(includeReadiness ? { automation_readiness: readinessContract(sourceRefs, stepRefs) } : {})
  } };
};

const readinessContract = (sourceRefs, stepRefs) => {
  const refs = { type: 'array', maxItems: 6, uniqueItems: true, items: { type: 'string', enum: sourceRefs } };
  return { type: 'object', additionalProperties: false, required: ['status', 'summary', 'evidence_refs', 'missing_context'], properties: {
    status: { enum: READINESS_STATUSES }, summary: { type: 'string', minLength: 1, maxLength: 800 }, evidence_refs: refs,
    missing_context: { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false,
      required: ['kind', 'reason', 'evidence_refs', 'step_refs'], properties: {
        kind: { enum: READINESS_CONTEXT_KINDS }, reason: { type: 'string', minLength: 1, maxLength: 600 },
        evidence_refs: { ...refs, minItems: 1 }, step_refs: { type: 'array', maxItems: Math.min(10, stepRefs.length), uniqueItems: true,
          items: stepRefs.length ? { type: 'string', enum: stepRefs } : { type: 'string' } }
      } } }
  } };
};

// Suitability is distinct from verifying the review's schema/citations. A
// missing or malformed suitability assessment cannot become permission to
// generate automation, but it must not discard an otherwise usable review.
const normalizeAutomationReadiness = (value, allowedRefs, allowedStepRefs, productRefs) => {
  const raw = object(value);
  const supportedRefs = (values, allowed, max) => Array.isArray(values) && values.length <= max
    && values.every(ref => typeof ref === 'string' && allowed.has(ref)) ? [...new Set(values)] : null;
  const refs = supportedRefs(raw.evidence_refs, allowedRefs, 6);
  if (Object.keys(raw).some(key => !['status', 'summary', 'evidence_refs', 'missing_context'].includes(key))
    || !READINESS_STATUSES.includes(raw.status) || typeof raw.summary !== 'string' || !raw.summary.trim()
    || raw.summary.length > 800 || !refs || !Array.isArray(raw.missing_context) || raw.missing_context.length > 8) return unknownReadiness();
  const gaps = [];
  for (const item of raw.missing_context) {
    const evidence = supportedRefs(item?.evidence_refs, allowedRefs, 6);
    const steps = supportedRefs(item?.step_refs, allowedStepRefs, 10);
    if (Object.keys(object(item)).some(key => !['kind', 'reason', 'evidence_refs', 'step_refs'].includes(key))
      || !READINESS_CONTEXT_KINDS.includes(item?.kind) || typeof item.reason !== 'string' || !item.reason.trim()
      || item.reason.length > 600 || !evidence?.length || !steps) return unknownReadiness();
    gaps.push({ kind: item.kind, reason: item.reason.trim(), evidence_refs: evidence, step_refs: steps });
  }
  if ((raw.status !== 'unknown' && !refs.length) || (raw.status === 'ready' && (gaps.length || !refs.some(ref => productRefs.has(ref))))
    || (raw.status === 'needs_input' && !gaps.length)) return unknownReadiness();
  return { status: raw.status, summary: raw.summary.trim(), evidence_refs: refs, missing_context: gaps };
};

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

const normalizeReview = (value, dimensionIds, allowedRefs, { assessAutomationReadiness = false, stepRefs = [], productRefs = new Set(), fieldNames = [] } = {}) => {
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
  const findingLocation = item => {
    const result = {};
    // Older saved reviews lack these locations. When a provider supplies them,
    // reject forged fields and step identifiers rather than showing false links.
    if (item?.kind !== undefined) {
      if (!FINDING_KINDS.includes(item.kind)) throw Object.assign(new Error('AI assurance response used an unsupported finding category.'), { code: 'AI_ASSURANCE_REVIEW_INVALID' });
      result.kind = item.kind;
    }
    for (const [key, allowed, max] of [['affected_fields', fieldNames, 6], ['step_refs', stepRefs, 10]]) {
      if (item?.[key] === undefined) continue;
      if (!Array.isArray(item[key]) || item[key].length > max || item[key].some(ref => typeof ref !== 'string' || !allowed.includes(ref))) {
        throw Object.assign(new Error('AI assurance response cited an unsupported artifact field or step.'), { code: 'AI_ASSURANCE_REVIEW_INVALID' });
      }
      result[key] = [...new Set(item[key])];
    }
    return result;
  };
  const seen = new Set();
  const dimensions = reviewItems(raw.dimensions).filter(item => {
    if (!dimensionIds.includes(item?.id) || seen.has(item.id)) return false;
    if (!text(item.explanation || item.analysis || item.finding, 1000) || !itemEvidence(item).length) return false;
    seen.add(item.id);
    return true;
  }).map(item => ({ id: item.id, explanation: text(item.explanation || item.analysis || item.finding, 1000), evidence: itemEvidence(item), recommendation: text(item.recommendation || item.action, 800) }))
    .filter(item => item.explanation && item.evidence.length);
  const insightIds = new Set();
  const rawInsights = raw.insights ?? raw.findings;
  if (rawInsights != null && typeof rawInsights !== 'object' && String(rawInsights).trim()) {
    throw Object.assign(new Error('AI assurance findings must be structured objects, not unstructured prose.'), { code: 'AI_ASSURANCE_REVIEW_INVALID' });
  }
  const insights = reviewItems(rawInsights).flatMap((item, index) => {
    if (item != null && (Array.isArray(item) ? item.length > 0 : typeof item !== 'object' && String(item).trim())) {
      throw Object.assign(new Error('AI assurance findings must be structured objects, not unstructured prose.'), { code: 'AI_ASSURANCE_REVIEW_INVALID' });
    }
    const title = text(item?.title || item?.label, 180), explanation = text(item?.explanation || item?.detail || item?.finding, 1000);
    const recommendation = text(item?.recommendation || item?.action, 800), refs = itemEvidence(item);
    if (!title && !explanation && !recommendation && !refs.length) return [];
    const id = text(item?.id, 80) || `review-${index + 1}`;
    // A partial, meaningful finding must be repaired as a whole. Silently
    // dropping it or changing a supplied severity can conceal a model defect.
    if (!title || !explanation || !recommendation || !refs.length || insightIds.has(id)
      || (item?.priority !== undefined && !["high", "medium", "opportunity"].includes(item.priority))) {
      throw Object.assign(new Error('AI assurance finding requires a title, explanation, supported citations, actionable recommendation and valid priority.'), { code: 'AI_ASSURANCE_REVIEW_INVALID' });
    }
    insightIds.add(id);
    return [{ id, priority: item.priority === undefined ? 'medium' : item.priority, title, explanation, evidence: refs, recommendation, ...findingLocation(item) }];
  });
  if (insights.length > 4) throw Object.assign(new Error('AI assurance returned too many priority findings.'), { code: 'AI_ASSURANCE_REVIEW_INVALID' });
  const summary = text(raw.summary || raw.executive_summary || raw.overview, 1200);
  if (!summary || (!dimensions.length && !insights.length)) {
    throw Object.assign(new Error("AI assurance response did not contain an evidence-grounded review"), { code: "AI_ASSURANCE_REVIEW_INVALID" });
  }
  return { summary, verdict: text(raw.verdict || raw.status, 240), dimensions, insights, limitations: list(raw.limitations || raw.evidence_gaps, 6, 500),
    ...(assessAutomationReadiness ? { automation_readiness: normalizeAutomationReadiness(raw.automation_readiness, allowedRefs, new Set(stepRefs), productRefs) } : {}) };
};

const readReviewResponse = async (response) => {
  if (!response.ok) throw createLlmProviderError({ status: response.status, headers: response.headers, detail: await response.text() });
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

async function reviewArtifact({ artifactType, savedArtifact, proposedChange, baseline, linkedEvidence = [], evidenceBoundary, user, projectId, integrationId, promptGuidance, additionalContext, reviewPurpose = 'assurance', assessAutomationReadiness = false, signal }) {
  if (signal?.aborted) throw Object.assign(new Error('Workflow cancelled.'), { statusCode: 499, publicMessage: 'Workflow cancelled.' });
  const featureKey = reviewPurpose === 'change-impact'
    ? (artifactType === 'story' ? 'ai.requirement.change_impact' : 'ai.test_case.change_impact')
    : (artifactType === 'story' ? 'ai.quality.story_assurance' : 'ai.quality.test_case_assurance');
  const dimensionIds = DIMENSIONS[artifactType];
  const draft = { ...savedArtifact, ...object(proposedChange), id: savedArtifact.id,
    additional_fields: { ...object(savedArtifact.additional_fields), ...object(proposedChange?.additional_fields) } };
  const snapshot = artifactType === "story" ? storyAiSnapshot(draft) : testCaseAiSnapshot(draft);
  const draftRef = `draft:${artifactType}:${savedArtifact.id}`;
  const linkedLimit = artifactType === 'test-case' && reviewPurpose !== 'change-impact' && !evidenceBoundary ? 6 : 20;
  const sources = [{ ref: draftRef, type: artifactType, content: snapshot }, ...linkedEvidence.slice(0, linkedLimit).map(item => {
    // The public wrapper must use the same private-data projection as the
    // nested snapshot. Raw linked titles can themselves contain private data.
    const linkedCase = item.kind === 'test-case' ? testCaseAiSnapshot(item, { stepLimit: 8, itemLimit: 250 }) : null;
    const hasCaseContent = linkedCase && (item.description != null || Array.isArray(item.steps) || Boolean(linkedCase.gherkin_document));
    if (linkedCase && !Array.isArray(item.steps) && !(linkedCase.authoring_mode === 'gherkin' && linkedCase.gherkin_document)) {
      delete linkedCase.steps;
      linkedCase.context_limits = { ...linkedCase.context_limits, unavailable_fields: ['steps'] };
    }
    return {
      ref: `${item.kind || "record"}:${item.id}`, type: item.kind || "record",
      title: text(linkedCase ? linkedCase.title : item.title || item.name, 300), status: text(linkedCase ? linkedCase.status : item.status, 100),
      ...(item.kind === "requirement" ? { content: storyAiSnapshot(item) } : {}),
      ...(hasCaseContent ? { content: linkedCase } : {}),
      ...(linkedCase && !hasCaseContent ? { context: { content_scope: 'metadata_only', unavailable_fields: ['description', 'steps'] } } : {}),
      ...(item.kind !== 'test-case' && item.kind !== 'requirement' && item.context ? { context: object(item.context) } : {})
    };
  })];
  const reviewedContext = text(additionalContext, 12000);
  if (reviewPurpose === 'change-impact') sources.push({ ref: `saved:${artifactType}:${savedArtifact.id}`, type: artifactType,
    content: artifactType === 'story' ? storyAiSnapshot(savedArtifact) : testCaseAiSnapshot(savedArtifact) });
  if (reviewedContext) sources.push({ ref: "review:context", type: "reviewed-context", content: reviewedContext });
  const readinessRequested = artifactType === 'test-case' && assessAutomationReadiness === true;
  const stepReferences = artifactType === 'test-case' ? snapshot.steps.map((step, index) => ({ ref: `step:${index + 1}`, step_order: step.step_order,
    ...(text(draft.steps?.[index]?.id, 255) ? { step_id: text(draft.steps[index].id, 255) } : {}) })) : [];
  const stepRefs = [...new Set(stepReferences.map(step => step.ref))];
  // Only linked Story snapshots currently carry an independent product
  // contract. Reviewed context includes prior AI prose and user guidance;
  // titles/statuses of other linked records cannot establish implementation.
  const productRefs = new Set(sources.filter(source => source.type === 'requirement' && source.content).map(source => source.ref));
  const fieldNames = REVIEW_FIELDS[artifactType];
  const normalization = { assessAutomationReadiness: readinessRequested, stepRefs, productRefs, fieldNames };
  const sourceRefs = sources.map(source => source.ref);
  const outputContract = reviewContract(dimensionIds, sourceRefs, fieldNames, stepRefs);
  const outputSchema = reviewOutputSchema(dimensionIds, sourceRefs, fieldNames, stepRefs, readinessRequested);
  // Readiness is advisory and independently normalized to unknown when absent
  // or malformed. Its failure cannot discard an otherwise supported review.
  const transportSchema=readinessRequested?{...outputSchema,required:outputSchema.required.filter(key=>key!=='automation_readiness'),
    properties:{...outputSchema.properties,automation_readiness:{}}}:outputSchema;
  const lockedScores = normalizeBaseline(baseline, dimensionIds);
  const responseScope = JSON.stringify({ native_review_scope: {
    target_ref: sources[0].ref, artifact_type: artifactType, artifact_count: 1,
    response_shape: 'one_unwrapped_review_object', host_owns_case_and_story_iteration: true,
    example_is_structure_only: true, substantive_findings_must_come_from_supplied_evidence: true,
    dimension_ids: dimensionIds, finding_kinds: FINDING_KINDS, priorities: ['high', 'medium', 'opportunity'],
    allowed_evidence_refs: sourceRefs, allowed_affected_fields: fieldNames, allowed_step_refs: stepRefs,
    limits: { dimensions: 4, insights: 4, source_refs_per_item: 6, affected_fields_per_insight: 6, step_refs_per_insight: 10 }
  } });
  const prompt = [
    [aiInstructionBlock(featureKey, "artifactAssurance.service.prompt.segment.1"),String(artifactType === "story" ? "Story" : "Test Case"),aiInstructionBlock(featureKey, "artifactAssurance.service.prompt.segment.2")].join(''),
    aiInstructionBlock(featureKey, "artifactAssurance.prompt.1"),
    ...(artifactType === 'test-case' ? [aiInstructionBlock(featureKey, 'artifactAssurance.caseApplicability')] : []),
    [aiInstructionBlock(featureKey, "artifactAssurance.service.prompt.segment.3"),String(JSON.stringify(dimensionIds)),aiInstructionBlock(featureKey, "artifactAssurance.service.prompt.segment.4")].join(''),
    aiInstructionBlock(featureKey, "artifactAssurance.prompt.8"),
    [aiInstructionBlock(featureKey, "artifactAssurance.service.prompt.segment.5"),String(JSON.stringify(text(promptGuidance, 12000))),""].join(''),
    [aiInstructionBlock(featureKey, "artifactAssurance.service.prompt.segment.6"),String(JSON.stringify(lockedScores)),""].join(''),
    [aiInstructionBlock(featureKey, "artifactAssurance.service.prompt.segment.7"),String(JSON.stringify(sources)),""].join(''),
    aiInstructionBlock(featureKey, 'artifactAssurance.reviewFocus'),
    JSON.stringify({ review_contract: outputContract, step_references: stepReferences,
      evidence_boundary: { linked_records_available: linkedEvidence.length, linked_records_included: Math.min(linkedEvidence.length, linkedLimit),
        omitted_linked_records: Math.max(0, linkedEvidence.length - linkedLimit), content_scope: 'bounded_supplied_only',
        ...object(evidenceBoundary) } }),
    ...(readinessRequested ? [aiInstructionBlock(featureKey, 'artifactAssurance.automationReadiness'),
      JSON.stringify({ automation_readiness_contract: readinessContract(sources.map(source => source.ref), stepRefs), product_evidence_refs: [...productRefs], step_references: stepReferences })] : [])
  ].join("\n");
  const deadline = Date.now() + ASSURANCE_TOTAL_TIMEOUT_MS;
  let modelCalls = 0;
  let repairAttempted = false;
  let receivedGeneration = false;
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
      if (operation.endsWith('.repair')) repairAttempted = true;
      return fetchLlmWithRetry(url, { method: "POST", headers, signal, body: JSON.stringify({
      model: integration.model,  response_format: { type: "json_object" }, messages
    }) }, { integration, operation, featureKey, outputSchema:transportSchema, outputSchemaName:'artifact_assurance_review', timeoutMs: Math.min(timeoutMs, remaining), maxOutputTokens, maxAttempts: 1, compatibility: false, contextFallback: false })
        .then(response => { receivedGeneration ||= response.ok; return response; });
    };
    const allowedRefs = new Set(sources.map(item => item.ref));
    let review;
    let repaired = false;
    let originalContent = "";
    try {
      const result = await readReviewResponse(await request([
        { role: "system", content: [aiInstructionBlock(featureKey, "artifactAssurance.result.9"), responseScope].join('\n') },
        { role: "user", content: prompt }
      ], { operation: `quality-assurance.${artifactType}`, timeoutMs: ASSURANCE_REQUEST_TIMEOUT_MS, maxOutputTokens: ASSURANCE_MAX_OUTPUT_TOKENS }));
      originalContent = result.content;
      review = normalizeReview(result.parsed, dimensionIds, allowedRefs, normalization);
    } catch (error) {
      const repairable = error instanceof SyntaxError || ["AI_ASSURANCE_REVIEW_INVALID","AI_INVALID_JSON","AI_OUTPUT_SCHEMA_VIOLATION","AI_MANAGED_SCHEMA_INVALID"].includes(error?.code);
      if (!repairable) throw error;
      originalContent = originalContent || text(error?.reviewContent || error?.model_candidate, 16_000);
      const repairPrompt = [
        aiInstructionBlock(featureKey, "artifactAssurance.repairPrompt.10"),
        ...(artifactType === 'test-case' ? [aiInstructionBlock(featureKey, 'artifactAssurance.caseApplicability')] : []),
        [aiInstructionBlock(featureKey, "artifactAssurance.service.repairPrompt.segment.8"),String(JSON.stringify(dimensionIds)),aiInstructionBlock(featureKey, "artifactAssurance.service.repairPrompt.segment.9")].join(''),
        [aiInstructionBlock(featureKey, "artifactAssurance.service.repairPrompt.segment.10"),String(JSON.stringify([...allowedRefs])),aiInstructionBlock(featureKey, "artifactAssurance.service.repairPrompt.segment.11")].join(''),
        aiInstructionBlock(featureKey, "artifactAssurance.repairPrompt.11"),
        [aiInstructionBlock(featureKey, "artifactAssurance.service.repairPrompt.segment.12"),JSON.stringify(sources),""].join(''),
        aiInstructionBlock(featureKey, "artifactAssurance.repairPrompt.12"),
        aiInstructionBlock(featureKey, 'artifactAssurance.reviewFocus'),
        aiInstructionBlock(featureKey, 'artifactAssurance.validationFeedback'),
        JSON.stringify({ review_validation_error: { code: error.code || 'AI_INVALID_JSON', message: text(error.message, 500) },
          review_contract: outputContract, step_references: stepReferences, validation_errors:error.validation_errors || [] }),
        [aiInstructionBlock(featureKey, "artifactAssurance.service.repairPrompt.segment.13"),String(JSON.stringify(text(originalContent || error?.message, 16_000))),""].join(''),
        ...(readinessRequested ? [aiInstructionBlock(featureKey, 'artifactAssurance.automationReadiness'),
          JSON.stringify({ automation_readiness_contract: readinessContract([...allowedRefs], stepRefs), product_evidence_refs: [...productRefs], step_references: stepReferences })] : [])
      ].join("\n");
      const repairedResult = await readReviewResponse(await request([
        { role: "system", content: [aiInstructionBlock(featureKey, "artifactAssurance.repairedResult.13"), responseScope].join('\n') },
        { role: "user", content: repairPrompt }
      ], { operation: `quality-assurance.${artifactType}.repair`, timeoutMs: ASSURANCE_REPAIR_TIMEOUT_MS, maxOutputTokens: ASSURANCE_MAX_OUTPUT_TOKENS }));
      review = normalizeReview(repairedResult.parsed, dimensionIds, allowedRefs, normalization);
      repaired = true;
    }
    return { assurance_review: review, generation_mode: "hybrid", fallback_used: false, fallback_reason: null,
      response_repaired: repaired,
      execution_status: "completed", publication_status: "proposal",
      verification: { status: "passed", verifier_version: "artifact-assurance/2", checks: ["output_shape", "evidence_references"], limitations: ["Citation matching does not verify factual correctness or readiness."] },
      model_execution: { model_calls: modelCalls, max_model_calls: 2, deadline_ms: ASSURANCE_TOTAL_TIMEOUT_MS, format_repair_attempted: repairAttempted },
      integration: { id: integration.id, name: integration.name, type: integration.type, model: integration.model, generation_mode: "hybrid", direct_model_invocation: true } };
  } catch (error) {
    if (signal?.aborted) throw Object.assign(new Error('Workflow cancelled.'), { statusCode: 499, publicMessage: 'Workflow cancelled.' });
    const reasons = {
      AI_MODEL_REQUIRED: "Configure an active LLM in Integrations to run AI assurance.",
      AI_INPUT_BUDGET_EXCEEDED: "The review input exceeds the provider budget. Shorten the draft or guidance and retry.",
      AI_OUTPUT_TRUNCATED: "The provider stopped before completing its review. Retry with a smaller draft or shorter guidance.",
      AI_INVALID_JSON: "The provider returned an invalid review format. Check that the selected model supports JSON responses.",
      AI_ASSURANCE_REVIEW_INVALID: "The provider returned invalid review fields or unsupported citations after one format repair. Retry or select another configured model.",
      AI_OUTPUT_SCHEMA_VIOLATION: "The provider returned a review that did not match the required output contract after one format repair. Review the selected model and assurance instructions.",
      AI_MANAGED_SCHEMA_INVALID: "The configured assurance output contract is invalid. Review its published AI configuration before retrying.",
      AI_OUTPUT_SCHEMA_INVALID: "The assurance output schema is invalid. Correct its configuration before running this node again.",
      AI_BUDGET_EXCEEDED: "The assurance request and format repair exhausted their bounded time or model-call budget. Completed drafts are retained; review the node settings before starting a new attempt.",
      AI_EMPTY_RESPONSE: "The provider returned an empty review. Retry or select another configured model."
    };
    const reason = reasons[error?.code]
      || ([401, 403].includes(error?.upstreamStatusCode) ? "The provider rejected the configured credentials or model access. Check the selected LLM integration." : null)
      || (error?.upstreamStatusCode === 429 ? "The provider rate limit was reached. Retry after the limit resets." : null)
      || ([502, 503, 504].includes(error?.statusCode) || error?.name === "AbortError" ? "The AI provider is unavailable or timed out. Check its connection and retry." : null)
      || (error instanceof SyntaxError || /evidence-grounded review/.test(error?.message || "") ? "The provider returned a review without usable cited evidence. Retry or select another configured model." : null)
      || "The configured AI provider could not complete an evidence-grounded review.";
    throw Object.assign(new Error(reason), { ...failureMetadata(error),
      ...(receivedGeneration ? { generation_received:true, retryable:false, nonRetryable:true } : {}),
      code: error?.code || "AI_REVIEW_FAILED", statusCode: error?.statusCode || 502, publicMessage: reason,
      model_execution: { model_calls: modelCalls, max_model_calls: 2, deadline_ms: ASSURANCE_TOTAL_TIMEOUT_MS, format_repair_attempted: repairAttempted }, cause: error });
  }
}

module.exports = { reviewArtifact };
