const { normalizeReferenceImages, imageUserContent } = require('@hellotest/platform/backend/src/utils/aiReferenceImages');
const dropdownCatalog = require('@hellotest/platform/backend/services/dropdownCatalog.service');
const { splitGenerationContext, generationRetrievalQuery } = require('@hellotest/platform/backend/src/utils/aiGenerationContext');
const { caseOutputSchema } = require('@hellotest/platform/backend/src/utils/aiGenerationContracts');
const { aiInstructionBlock } = require('@hellotest/platform/backend/src/utils/aiInstructionBlocks');
const { validateAuthoringIntent } = require('@hellotest/platform/backend/src/utils/aiAuthoringIntent');
const testCaseService = require("@hellotest/testing/backend/services/testCase.service");
const aiKnowledgeService = require("@hellotest/knowledge/backend/services/aiKnowledge.service");
const aiLlmSelectionService = require("@hellotest/integration/backend/services/aiLlmSelection.service");
const { normalizeStoredReferenceList } = require("@hellotest/platform/backend/src/utils/externalReferences");
const { createLlmProviderError } = require("@hellotest/platform/backend/src/utils/upstreamLlmError");
const { fetchLlmWithRetry } = require("@hellotest/platform/backend/src/utils/llmHttpClient");
const { getCompletionContent } = require("@hellotest/platform/backend/src/utils/llmResponse");
const { parseAiJson } = require("@hellotest/platform/backend/src/utils/aiJsonResponse");
const { isContextSizeRejection } = require("@hellotest/platform/backend/src/utils/llmContextFallback");
const { normalizeTestStepType } = require("@hellotest/platform/backend/src/utils/testStepAutomation");
const { storyAiSnapshot, text: boundedText, list: boundedList } = require("@hellotest/platform/backend/src/utils/aiArtifactContext");

const DEFAULT_CASE_LIMIT = 8;
const referenceEvidence = require('@hellotest/platform/backend/services/aiAttachmentAccess.service');

const normalizeText = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
};

const normalizeTextList = (values = []) => {
  const collection = Array.isArray(values) ? values : [values];
  return collection.map((value) => normalizeText(value)).filter(Boolean);
};

const uniqueById = (items = []) => Array.from(new Map(items.filter(Boolean).map((item) => [item.id, item])).values());
const normalizeAuthoringMode = (value) => String(value || "").trim().toLowerCase() === "gherkin" ? "gherkin" : "structured";

const normalizeParameterValues = (values = {}) => {
  if (!values || typeof values !== "object" || Array.isArray(values)) return {};

  return Object.entries(values).reduce((normalized, [name, value]) => {
    const rawName = String(name || "").trim().replace(/^@+/, "").replace(/^[tsr]\./i, "").toLowerCase();
    if (rawName) normalized[rawName] = value === null || value === undefined ? "" : String(value);
    return normalized;
  }, {});
};

const normalizeImageAssets = images => normalizeReferenceImages(images, { max_images: 4 });

const buildRequirementReferenceMap = (requirements = []) =>
  uniqueById(requirements).map((requirement, index) => ({
    ...storyAiSnapshot(requirement, { textLimit: Math.max(500, Math.floor(5000 / Math.max(requirements.length, 1))), itemLimit: Math.max(120, Math.floor(1000 / Math.max(requirements.length, 1))), listLimit: 4 }),
    ref: `R${index + 1}`
  }));

const extractJsonPayload = parseAiJson;

const normalizeSteps = (steps = []) => {
  if (!Array.isArray(steps)) {
    return [];
  }

  return steps
    .map((step, index) => ({
      step_order: Number.isFinite(Number(step?.step_order)) ? Number(step.step_order) : index + 1,
      step_type: normalizeTestStepType(step?.step_type || step?.stepType, "web"),
      action: normalizeText(step?.action),
      expected_result: normalizeText(step?.expected_result || step?.expectedResult)
    }))
    .filter((step) => step.action || step.expected_result)
    .map((step, index) => ({
      ...step,
      step_order: index + 1
    }));
};

const normalizeRequirementRefs = (item = {}) => {
  const raw =
    item?.requirement_ids ||
    item?.requirementIds ||
    item?.requirement_refs ||
    item?.requirementRefs ||
    [];

  if (Array.isArray(raw)) {
    return normalizeTextList(raw).map((value) => value.toUpperCase());
  }

  return normalizeTextList(String(raw).split(",")).map((value) => value.toUpperCase());
};

const normalizeRequirementTitles = (item = {}) => {
  const raw = item?.requirement_titles || item?.requirementTitles || item?.requirements || [];

  if (Array.isArray(raw)) {
    return normalizeTextList(raw).map((value) => value.toLowerCase());
  }

  return normalizeTextList(String(raw).split(",")).map((value) => value.toLowerCase());
};

const resolveCaseRequirements = (item, requirements = []) => {
  const uniqueRequirements = uniqueById(requirements);

  if (!uniqueRequirements.length) {
    return [];
  }

  const explicitIds = normalizeTextList(item?.requirement_ids || item?.requirementIds || []);
  const resolvedById = uniqueRequirements.filter((requirement) => explicitIds.includes(requirement.id));

  if (resolvedById.length) {
    return resolvedById;
  }

  const referenceMap = new Map(buildRequirementReferenceMap(uniqueRequirements).map((requirement) => [requirement.ref.toUpperCase(), requirement]));
  const resolvedByRef = normalizeRequirementRefs(item)
    .map((ref) => referenceMap.get(ref))
    .filter(Boolean)
    .map((match) => uniqueRequirements.find((requirement) => requirement.id === match.id))
    .filter(Boolean);

  if (resolvedByRef.length) {
    return uniqueById(resolvedByRef);
  }

  const titleMatches = normalizeRequirementTitles(item);
  const resolvedByTitle = uniqueRequirements.filter((requirement) => titleMatches.includes(String(requirement.title || "").trim().toLowerCase()));

  if (resolvedByTitle.length) {
    return resolvedByTitle;
  }

  if (uniqueRequirements.length === 1) {
    return [uniqueRequirements[0]];
  }

  return [];
};

const buildGherkinDocument = ({ title, steps }) => {
  const lines = [`Feature: ${title}`, "", `  Scenario: ${title}`];
  steps.forEach((step) => {
    if (step.action) lines.push(`    When ${step.action}`);
    if (step.expected_result) lines.push(`    Then ${step.expected_result}`);
  });
  return lines.join("\n");
};

const isValidGherkinDocument = (value) =>
  /^\s*Feature\s*:/im.test(String(value || ""))
  && /^\s*Scenario(?: Outline| Template)?\s*:/im.test(String(value || ""))
  && /^\s*(?:Given|When)\b/im.test(String(value || ""))
  && /^\s*Then\b/im.test(String(value || ""));

const countDraftSteps = (candidate) => candidate.authoring_mode === "gherkin"
  ? (String(candidate.gherkin_document || "").match(/^\s*(?:Given|When|Then|And|But|\*)(?:[ \t]+|$)/gim) || []).length
  : candidate.steps.length;

const normalizeCaseDraft = (item, index, {
  requirements = [],
  requireRequirementMapping = false,
  applicableDomain = null,
  acceptReferenceEvidence = false,
  authoringMode = "structured"
} = {}) => {
  const title = normalizeText(item?.title);

  if (!title) {
    throw Object.assign(new Error(`Generated test case ${index + 1} is missing a title`), { statusCode: 502 });
  }
  if (title.length > 255) throw Object.assign(new Error(`Generated test case ${index + 1} has a title longer than 255 characters`), { statusCode: 502 });

  const resolvedRequirements = resolveCaseRequirements(item, requirements);

  if (requireRequirementMapping && !resolvedRequirements.length) {
    throw Object.assign(new Error(`Generated test case ${index + 1} must be linked to at least one requirement`), { statusCode: 502 });
  }

  const steps = normalizeSteps(item?.steps);
  const resolvedAuthoringMode = normalizeAuthoringMode(authoringMode || item?.authoring_mode || item?.authoringMode);
  const gherkinDocument = resolvedAuthoringMode === "gherkin"
    ? normalizeText(item?.gherkin_document || item?.gherkinDocument || item?.gherkin) || buildGherkinDocument({ title, steps })
    : null;

  if (resolvedAuthoringMode === "gherkin" && !isValidGherkinDocument(gherkinDocument)) {
    throw Object.assign(new Error(`Generated test case ${index + 1} must include a Feature and at least one executable Scenario with a Then outcome`), { statusCode: 502 });
  }

  if (resolvedAuthoringMode === "structured" && (!steps.length || steps.length > 30 || steps.some(step => !step.action || !step.expected_result))) {
    throw Object.assign(new Error(`Generated test case ${index + 1} must include one to thirty executable steps with expected results`), { statusCode: 502 });
  }

  return {
    title,
    reference_attachment_ids: acceptReferenceEvidence ? referenceEvidence.referenceIds(item?.reference_attachment_ids) : [],
    description: normalizeText(item?.description),
    priority: Number.isFinite(Number(item?.priority)) ? Math.round(Math.max(1, Math.min(5, Number(item.priority)))) : 3,
    test_case_type: normalizeText(item?.test_case_type) || undefined,
    applicable_domain: normalizeText(item?.applicable_domain || item?.applicableDomain || item?.domain) || applicableDomain,
    requirement_ids: resolvedRequirements.map((requirement) => requirement.id),
    requirement_titles: resolvedRequirements.map((requirement) => requirement.title),
    authoring_mode: resolvedAuthoringMode,
    gherkin_document: gherkinDocument,
    parameter_values: normalizeParameterValues(item?.parameter_values || item?.parameterValues || item?.test_data || item?.testData),
    steps
  };
};

const normalizeGeneratedCases = (payload, maxCases, requirements, authoringMode) => {
  const applicableDomain = normalizeText(payload?.applicable_domain || payload?.applicableDomain || payload?.domain);
  const collection = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.testCases)
      ? payload.testCases
      : Array.isArray(payload?.test_cases)
        ? payload.test_cases
        : [];

  if (!collection.length) throw Object.assign(new Error('The model did not return a usable Test Case from the supplied evidence.'), { statusCode: 422, code: 'AI_TEST_CASE_EVIDENCE_REQUIRED' });

  const seen = new Set();
  return collection.slice(0, maxCases).map((item, index) => normalizeCaseDraft(item, index, {
    requirements,
    requireRequirementMapping: requirements.length > 0,
    applicableDomain,
    authoringMode
  })).filter(candidate => {
    const key = JSON.stringify([candidate.title.toLowerCase(), candidate.gherkin_document, candidate.steps, candidate.parameter_values]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const buildPrompt = ({ requirements, appType, maxCases, additionalContext, externalLinks, images, knowledge, authoringMode, testCaseTypes }) => {
  const stories=buildRequirementReferenceMap(requirements);
  const items=Array.isArray(knowledge)?knowledge:Array.isArray(knowledge?.knowledge)?knowledge.knowledge:[];
  return JSON.stringify({
    application_contract:{output_schema:caseOutputSchema(authoringMode,{count:maxCases,refs:stories.map(item=>item.ref),testCaseTypes}),max_cases:maxCases,authoring_mode:authoringMode},
    generation_request:splitGenerationContext(additionalContext),
    application:{id:appType.id,name:appType.name,type:appType.type},
    stories,
    knowledge:items.slice(0,6).map(item=>({title:boundedText(item.title,180),content:boundedText(item.content||item.description,1200)})),
    external_references:externalLinks.map(url=>({url,content_retrieved:false})),
    reference_images:images.map(image=>({name:image.name}))
  });
};

const resolveIntegration = async (integration_id, { userId, projectId, usageKey } = {}) => {
  const integration = await aiLlmSelectionService.resolveLlmIntegrationForUsage({
    integrationId: integration_id,
    userId,
    projectId,
    usageKey,
    fallback: "project-then-global"
  });

  if (!integration) {
    throw new Error("No active LLM integration is configured");
  }

  if (integration.type !== "llm") {
    throw new Error("Selected integration is not an LLM integration");
  }

  if (!integration.is_active) {
    throw new Error("Selected LLM integration is inactive");
  }

  return integration;
};

const requestChatCompletion = async ({ integration, content, fallbackContent, contextState, testCaseTypes, imageNames=[], imageOnly=false, authoringMode="structured", recovery=false, signal }) => {
  const baseUrl = (integration.base_url || "https://api.openai.com/v1").replace(/\/+$/, "");
  const url = /\/chat\/completions$/i.test(baseUrl) ? baseUrl : `${baseUrl}/chat/completions`;
  const response = await fetchLlmWithRetry(url, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(integration.api_key ? { Authorization: `Bearer ${integration.api_key}` } : {})
    },
    body: JSON.stringify({
      model: integration.model,

      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [aiInstructionBlock("ai.test_case.design","legacy.reviewed"),aiInstructionBlock("ai.test_case.design",`format.${authoringMode}`),...(imageOnly?[aiInstructionBlock("ai.test_case.design","evidence.imageOnly")]:[]),...(recovery?[aiInstructionBlock("ai.test_case.design","recovery.images")]:[])].join("\n\n")
        },
        {
          role: "user",
          content
        }
      ]
    })
  }, { integration, operation: "requirement-design.generate", persistReferenceImages:true, referenceImageNames:imageNames,
    onReferenceAttachments: items => { if (contextState) contextState.referenceAttachments = items; },
    nativeArtifactTestCaseTypes:testCaseTypes, contextRetrievalQuery:generationRetrievalQuery(content), contextFallbackContent: fallbackContent, contextFallbackInstructions: aiInstructionBlock("ai.test_case.design","recovery.context_size"), onContextFallback: () => { if (contextState) contextState.reduced = true; } });

  if (!response.ok) {
    const raw = await response.text();
    const retryAfter = Number(response.headers.get("retry-after"));
    throw createLlmProviderError({
      status: response.status,
      detail: raw,
      retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 60_000) : undefined
    });
  }

  const payload = await response.json();
  const messageContent = getCompletionContent(payload);

  if (!messageContent) {
    throw Object.assign(new Error('The model returned no Test Case content. Retry or select another configured model.'), { statusCode: 502, code: 'AI_TEST_CASE_RESPONSE_INVALID' });
  }

  return messageContent;
};

const requestGeneratedCases = async ({
  integration,
  requirements,
  appType,
  maxCases,
  additionalContext,
  externalLinks,
  images,
  knowledge,
  authoringMode,
  testCaseTypes,
  contextState,
  signal
}) => {
  const prompt = buildPrompt({
    requirements,
    appType,
    maxCases,
    additionalContext,
    externalLinks,
    images,
    knowledge,
    authoringMode,
    testCaseTypes,
    contextState,
    signal
  });

  const fallbackContent = buildPrompt({
    requirements: requirements.map(story => storyAiSnapshot(story, { textLimit: 600, itemLimit: 200, listLimit: 4 })),
    appType: { name: "Selected application", type: appType.type }, maxCases,
    additionalContext,
    externalLinks: [], images: [], knowledge: null, authoringMode, testCaseTypes
  });
  try {
    const content = images.length
      ? await requestChatCompletion({
          integration,
          imageNames:images.map(image=>image.name),
          imageOnly: !splitGenerationContext(additionalContext).user_request,
          fallbackContent,
          contextState, authoringMode, testCaseTypes, signal,
          content: [
            { type: "text", text: prompt },
            ...images.map((image) => ({
              type: "image_url",
              image_url: {
                url: image.url, detail: "low"
              }
            }))
          ]
        })
      : await requestChatCompletion({ integration, content: prompt, fallbackContent, contextState, authoringMode, testCaseTypes, signal });

    return normalizeGeneratedCases(extractJsonPayload(content), maxCases, requirements, authoringMode);
  } catch (error) {
    const emptyNativeResult = error?.code === 'AI_NATIVE_CONTRACT_INVALID'
      && error.validation_errors?.length === 1 && error.validation_errors[0].path === ''
      && ['testCases', 'test_cases'].includes(error.validation_errors[0].field);
    if (error?.code === 'AI_TEST_CASE_EVIDENCE_REQUIRED' || emptyNativeResult) {
      const message = images.length
        ? 'The model did not return a usable Test Case from the supplied image evidence. Try a clearer screenshot or add the behavior and expected outcome to test. You can also select another vision-capable model.'
        : 'The model did not return a usable Test Case from the supplied evidence. Add the behavior and expected outcome to test, or select another configured model.';
      throw Object.assign(new Error(message), { statusCode: 422, code: 'AI_TEST_CASE_EVIDENCE_REQUIRED', publicMessage: message });
    }
    if (error?.code !== 'AI_INVALID_OUTPUT' && (error?.statusCode || error?.code)) throw error;
    const message = 'The model returned an invalid Test Case response. Retry or select another configured model; no Test Cases were saved.';
    throw Object.assign(new Error(message), { statusCode: 502, code: 'AI_TEST_CASE_RESPONSE_INVALID', publicMessage: message });
  }
};

const normalizeAcceptedCases = (cases = [], requirements = []) => {
  if (!Array.isArray(cases) || !cases.length) {
    throw new Error("At least one generated test case is required");
  }

  return cases.map((item, index) => normalizeCaseDraft(item, index, {
    requirements,
    acceptReferenceEvidence:true,
    requireRequirementMapping: requirements.length > 0,
    authoringMode: item?.authoring_mode || item?.authoringMode
  }));
};

exports.previewRequirementsTestCases = async ({
  requirements,
  appType,
  integration_id,
  user_id,
  max_cases,
  additional_context,
  external_links,
  images,
  authoring_mode,
  evidence_scope,
  signal
}) => {
  if (signal?.aborted) throw Object.assign(new Error("Workflow cancelled."), { statusCode: 499, publicMessage: "Workflow cancelled." });
  const scopedRequirements = uniqueById(requirements);

  if (scopedRequirements.length > 10) throw Object.assign(new Error("Preview Test Cases for at most ten Stories at a time."), { statusCode: 400 });
  if (Number(max_cases) > 10) throw Object.assign(new Error("Generate at most ten Test Cases per preview; use smaller batches for additional coverage."), { statusCode: 400 });

  const maxCases = Number.isFinite(Number(max_cases))
    ? Math.max(1, Math.min(Math.round(Number(max_cases)), 10))
    : DEFAULT_CASE_LIMIT;
  if (String(additional_context || '').length > 18000) throw Object.assign(new Error('Shorten generation instructions to 18,000 characters before generating Test Cases.'), { statusCode: 422, code: 'AI_INPUT_BUDGET_EXCEEDED' });
  const additionalContext = boundedText(additional_context, 18000);
  const externalLinks = boundedList(external_links, 10, 500);
  const normalizedImages = normalizeImageAssets(images);
  const authoringMode = normalizeAuthoringMode(authoring_mode);
  const typeField = await dropdownCatalog.getField('test_cases.types');
  const testCaseTypes = typeField.options.filter(option=>option.active!==false).map(option=>option.value);
  const integration = await resolveIntegration(integration_id, {
    userId: user_id,
    projectId: appType.project_id || scopedRequirements[0]?.project_id,
    usageKey: "ai.test_case.design"
  });
  await validateAuthoringIntent({ featureKey: 'ai.test_case.design', integration, additionalContext,
    requirements: scopedRequirements, images: normalizedImages, externalLinks, fetchCompletion: (url, init, options) => fetchLlmWithRetry(url, { ...init, signal }, options) });
  // A screenshot has no textual retrieval query. An empty query otherwise
  // adds unrelated project knowledge to a request grounded only in that image.
  const knowledgeQuery = splitGenerationContext(additionalContext).user_request
    || scopedRequirements.map(story => storyAiSnapshot(story)).map(story => [story.title, story.description, ...(story.acceptance_criteria || [])].filter(Boolean).join('\n')).join('\n');
  const knowledge = knowledgeQuery ? await aiKnowledgeService.buildKnowledgeContextPackage(appType.project_id || scopedRequirements[0]?.project_id, {
    app_type_id: appType.id,
    query: knowledgeQuery,
    module_name: appType.module_name || null,
    feature_name: appType.feature_name || null,
    evidence_scope,
    signal,
    user: user_id ? { id: user_id } : undefined
  }) : { knowledge: [] };

  const contextState = { reduced: false };
  const generatedCases = await requestGeneratedCases({
    integration,
    requirements: scopedRequirements,
    appType,
    maxCases,
    additionalContext,
    externalLinks,
    images: normalizedImages,
    knowledge,
    authoringMode,
    testCaseTypes,
    contextState,
    signal
  });
  for (const candidate of generatedCases) {
    candidate.test_case_type ||= typeField.default_value;
    if (!testCaseTypes.includes(candidate.test_case_type)) throw Object.assign(new Error('Generated Test Case uses an unavailable type configured by the administrator.'),{statusCode:502,code:'AI_NATIVE_CONTRACT_INVALID'});
  }

  return {
    integration: {
      id: integration.id,
      name: integration.name,
      type: integration.type,
      model: integration.model
    },
    requirements: scopedRequirements.map((requirement) => ({
      id: requirement.id,
      title: requirement.title
    })),
    app_type: {
      id: appType.id,
      name: appType.name
    },
    context_reduced: contextState.reduced,
    context_reduction_reason: contextState.reduced ? "The provider rejected the full context size. Drafts used bounded Story excerpts and user guidance; review them against the full acceptance criteria and omitted evidence." : null,
    generated: generatedCases.length,
    cases: generatedCases.map((candidate, index) => ({
      ...candidate,
      reference_attachment_ids: (contextState.referenceAttachments || []).map(item => item.id),
      client_id: `draft-${index + 1}`,
      step_count: countDraftSteps(candidate),
      parameter_count: Object.keys(candidate.parameter_values).length
    }))
  };
};

exports.previewRequirementTestCases = async ({
  requirement,
  appType,
  integration_id,
  user_id,
  max_cases,
  additional_context,
  external_links,
  images,
  authoring_mode
}) => {
  const preview = await exports.previewRequirementsTestCases({
    requirements: [requirement],
    appType,
    integration_id,
    user_id,
    max_cases,
    additional_context,
    external_links,
    images,
    authoring_mode
  });

  return {
    ...preview,
    requirement: {
      id: requirement.id,
      title: requirement.title
    }
  };
};

exports.acceptGeneratedTestCases = async ({
  requirements,
  appType,
  status = "draft",
  cases = [],
  created_by
}) => {
  const scopedRequirements = uniqueById(requirements);
  const acceptedCases = normalizeAcceptedCases(cases, scopedRequirements);
  // Validate every supplied source before creating any case. Model-produced
  // IDs never confer access or cross the project boundary.
  for (const candidate of acceptedCases) await referenceEvidence.verifyReferences({ userId:created_by, projectId:appType.project_id, ids:candidate.reference_attachment_ids });
  const created = [];

  for (const candidate of acceptedCases) {
    const candidateRequirements = scopedRequirements.filter((requirement) => candidate.requirement_ids.includes(requirement.id));
    const externalReferences = [
      ...new Set(candidateRequirements.flatMap((requirement) => normalizeStoredReferenceList(requirement.external_references)))
    ];
    const response = await testCaseService.createTestCase({
      app_type_id: appType.id,
      title: candidate.title,
      description: candidate.description || undefined,
      external_references: externalReferences,
      priority: candidate.priority,
      test_case_type: candidate.test_case_type,
      status,
      requirement_ids: candidate.requirement_ids,
      authoring_mode: candidate.authoring_mode,
      gherkin_document: candidate.gherkin_document,
      parameter_values: candidate.parameter_values,
      steps: candidate.steps,
      // Accepting a generated draft into the library is separate from its
      // formal review. The person saving it owns that review by default.
      ai_generation_source: "interactive",
      ai_generation_review_status: "pending",
      reviewer_id: created_by,
      review_status: "pending",
      created_by
    });

    const evidence = [], pendingEvidence = [];
    for (const id of candidate.reference_attachment_ids) {
      try { evidence.push(...await referenceEvidence.retainReferences({ userId:created_by, projectId:appType.project_id, entityId:response.id, ids:[id] })); }
      catch { pendingEvidence.push(id); }
    }
    created.push({
      id: response.id,
      attachment_ids: evidence.map(item => item.id),
      pending_reference_attachment_ids:pendingEvidence,
      title: candidate.title,
      step_count: countDraftSteps(candidate),
      requirement_ids: candidate.requirement_ids
    });
  }

  return {
    accepted: created.length,
    created
  };
};

exports.acceptRequirementTestCases = async ({
  requirement,
  appType,
  status = "draft",
  cases = [],
  created_by
}) => {
  return exports.acceptGeneratedTestCases({
    requirements: [requirement],
    appType,
    status,
    created_by,
    cases: cases.map((candidate) => ({
      ...candidate,
      requirement_ids: [requirement.id]
    }))
  });
};

exports.generateRequirementTestCases = async ({
  requirement,
  appType,
  integration_id,
  user_id,
  max_cases,
  status = "draft",
  additional_context,
  external_links,
  images,
  authoring_mode
}) => {
  const preview = await exports.previewRequirementTestCases({
    requirement,
    appType,
    integration_id,
    user_id,
    max_cases,
    additional_context,
    external_links,
    images,
    authoring_mode
  });

  const accepted = await exports.acceptRequirementTestCases({
    requirement,
    appType,
    status,
    created_by: user_id,
    cases: preview.cases
  });

  return {
    integration: preview.integration,
    generated: accepted.accepted,
    created: accepted.created
  };
};

exports._promptBuilders={buildPrompt};
