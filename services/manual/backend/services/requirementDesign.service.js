const { aiInstructionBlock } = require('@hellotest/platform/backend/src/utils/aiInstructionBlocks');
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

const normalizeImageAssets = (images = []) => {
  if (!Array.isArray(images)) {
    return [];
  }

  if (images.length > 4) throw Object.assign(new Error("Provide at most four reference images per Test Case preview."), { statusCode: 400 });
  let totalChars = 0;
  return images
    .map((item, index) => ({
      name: normalizeText(item?.name) || `Reference image ${index + 1}`,
      url: normalizeText(item?.url)
    }))
    .filter((item) => item.url)
    .map(item => {
      totalChars += item.url.length;
      if (!/^data:image\/(?:png|jpe?g|webp);base64,[a-z0-9+/=\s]+$/i.test(item.url) || totalChars > 950000) {
        throw Object.assign(new Error("Reference images must be compressed PNG, JPEG, or WebP data URLs within the 950,000-character budget."), { statusCode: 400 });
      }
      return { ...item, name: item.name.slice(0, 255) };
    });
};

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
    description: normalizeText(item?.description),
    priority: Number.isFinite(Number(item?.priority)) ? Math.round(Math.max(1, Math.min(5, Number(item.priority)))) : 3,
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

  if (!collection.length) {
    throw new Error("LLM did not return any test cases");
  }

  const seen = new Set();
  return collection.slice(0, maxCases).map((item, index) => normalizeCaseDraft(item, index, {
    requirements,
    requireRequirementMapping: true,
    applicableDomain,
    authoringMode
  })).filter(candidate => {
    const key = JSON.stringify([candidate.title.toLowerCase(), candidate.gherkin_document, candidate.steps, candidate.parameter_values]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const buildPrompt = ({ requirements, appType, maxCases, additionalContext, externalLinks, images, knowledge, authoringMode }) => {
  const references = buildRequirementReferenceMap(requirements);
  const prompt = [
    aiInstructionBlock("ai.test_case.design", "requirementDesign.prompt.3"),
    aiInstructionBlock("ai.test_case.design", "requirementDesign.prompt.4"),
    aiInstructionBlock("ai.test_case.design", "requirementDesign.prompt.5"),
    aiInstructionBlock("ai.test_case.design", "requirementDesign.prompt.6"),
    "",
    aiInstructionBlock("ai.test_case.design", "requirementDesign.prompt.7")
  ];

  references.forEach((requirement) => {
    prompt.push(JSON.stringify(requirement));
  });

  prompt.push("");
  prompt.push(`Application type: ${appType.name} (${appType.type})`);

  if (additionalContext) {
    prompt.push("");
    prompt.push(aiInstructionBlock("ai.test_case.design", "requirementDesign.buildPrompt.8"));
    prompt.push(additionalContext);
  }

  const knowledgeItems = Array.isArray(knowledge) ? knowledge : Array.isArray(knowledge?.knowledge) ? knowledge.knowledge : [];

  if (knowledgeItems.length > 0) {
    prompt.push("");
    prompt.push(aiInstructionBlock("ai.test_case.design", "requirementDesign.buildPrompt.9"));
    knowledgeItems.slice(0, 6).forEach((k) => {
      prompt.push(`- [${boundedText(k.title, 180)}]: ${boundedText(k.content || k.description, 1200)}`);
    });
  }

  if (externalLinks.length) {
    prompt.push("");
    prompt.push(aiInstructionBlock("ai.test_case.design", "requirementDesign.buildPrompt.10"));
    externalLinks.forEach((link, index) => {
      prompt.push(`- Link ${index + 1}: ${link}`);
    });
  }

  if (images.length) {
    prompt.push("");
    prompt.push(aiInstructionBlock("ai.test_case.design", "requirementDesign.buildPrompt.11"));
    images.forEach((image, index) => {
      prompt.push(`- Image ${index + 1}: ${image.name}`);
    });
  }

  prompt.push("");
  prompt.push(`Return up to ${maxCases} test cases as strict JSON with this exact processable shape:`);
  prompt.push("{");
  prompt.push(aiInstructionBlock("ai.test_case.design", "requirementDesign.buildPrompt.12"));
  prompt.push(aiInstructionBlock("ai.test_case.design", "requirementDesign.buildPrompt.13"));
  prompt.push(aiInstructionBlock("ai.test_case.design", "requirementDesign.buildPrompt.14"));
  prompt.push(aiInstructionBlock("ai.test_case.design", "requirementDesign.buildPrompt.15"));
  prompt.push(aiInstructionBlock("ai.test_case.design", "requirementDesign.buildPrompt.16"));
  prompt.push(aiInstructionBlock("ai.test_case.design", "requirementDesign.buildPrompt.17"));
  prompt.push(aiInstructionBlock("ai.test_case.design", "requirementDesign.buildPrompt.18"));
  prompt.push(aiInstructionBlock("ai.test_case.design", "requirementDesign.buildPrompt.19"));
  prompt.push(`      "authoring_mode": "${authoringMode}",`);
  prompt.push(aiInstructionBlock("ai.test_case.design", "requirementDesign.buildPrompt.20"));
  if (authoringMode === "gherkin") {
    prompt.push(aiInstructionBlock("ai.test_case.design", "requirementDesign.buildPrompt.21"));
  }
  prompt.push(aiInstructionBlock("ai.test_case.design", "requirementDesign.buildPrompt.22"));
  prompt.push(aiInstructionBlock("ai.test_case.design", "requirementDesign.buildPrompt.23"));
  prompt.push(aiInstructionBlock("ai.test_case.design", "requirementDesign.buildPrompt.24"));
  prompt.push(aiInstructionBlock("ai.test_case.design", "requirementDesign.buildPrompt.25"));
  prompt.push(aiInstructionBlock("ai.test_case.design", "requirementDesign.buildPrompt.26"));
  prompt.push(aiInstructionBlock("ai.test_case.design", "requirementDesign.buildPrompt.27"));
  prompt.push(aiInstructionBlock("ai.test_case.design", "requirementDesign.buildPrompt.28"));
  prompt.push(aiInstructionBlock("ai.test_case.design", "requirementDesign.buildPrompt.29"));
  prompt.push("}");
  prompt.push("");
  prompt.push(aiInstructionBlock("ai.test_case.design", "requirementDesign.buildPrompt.30"));
  prompt.push(aiInstructionBlock("ai.test_case.design", "requirementDesign.buildPrompt.31"));
  prompt.push(aiInstructionBlock("ai.test_case.design", "requirementDesign.buildPrompt.32"));
  prompt.push(aiInstructionBlock("ai.test_case.design", "requirementDesign.buildPrompt.33"));
  prompt.push(aiInstructionBlock("ai.test_case.design", "requirementDesign.buildPrompt.34"));
  prompt.push(aiInstructionBlock("ai.test_case.design", "requirementDesign.buildPrompt.35"));
  prompt.push(aiInstructionBlock("ai.test_case.design", "requirementDesign.buildPrompt.36"));
  prompt.push(aiInstructionBlock("ai.test_case.design", "requirementDesign.buildPrompt.37"));
  prompt.push(aiInstructionBlock("ai.test_case.design", "requirementDesign.buildPrompt.38"));
  prompt.push(aiInstructionBlock("ai.test_case.design", "requirementDesign.buildPrompt.39"));
  prompt.push(aiInstructionBlock("ai.test_case.design", "requirementDesign.buildPrompt.40"));
  prompt.push(aiInstructionBlock("ai.test_case.design", "requirementDesign.buildPrompt.41"));
  prompt.push(aiInstructionBlock("ai.test_case.design", "requirementDesign.buildPrompt.42"));
  if (authoringMode === "gherkin") {
    prompt.push(aiInstructionBlock("ai.test_case.design", "requirementDesign.buildPrompt.43"));
    prompt.push(aiInstructionBlock("ai.test_case.design", "requirementDesign.buildPrompt.44"));
    prompt.push(aiInstructionBlock("ai.test_case.design", "requirementDesign.buildPrompt.45"));
    prompt.push(aiInstructionBlock("ai.test_case.design", "requirementDesign.buildPrompt.46"));
  } else {
    prompt.push(aiInstructionBlock("ai.test_case.design", "requirementDesign.buildPrompt.47"));
    prompt.push(aiInstructionBlock("ai.test_case.design", "requirementDesign.buildPrompt.48"));
  }
  prompt.push(aiInstructionBlock("ai.test_case.design", "requirementDesign.buildPrompt.49"));

  return prompt.join("\n");
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

const requestChatCompletion = async ({ integration, content, fallbackContent, contextState }) => {
  const baseUrl = (integration.base_url || "https://api.openai.com/v1").replace(/\/+$/, "");
  const url = /\/chat\/completions$/i.test(baseUrl) ? baseUrl : `${baseUrl}/chat/completions`;
  const response = await fetchLlmWithRetry(url, {
    method: "POST",
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
          content: aiInstructionBlock("ai.test_case.design", "requirementDesign.response.1")
        },
        {
          role: "user",
          content
        }
      ]
    })
  }, { integration, operation: "requirement-design.generate", contextFallbackContent: fallbackContent, onContextFallback: () => { if (contextState) contextState.reduced = true; } });

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
    throw new Error("LLM response did not include generated content");
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
  contextState
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
    contextState
  });

  const fallbackContent = buildPrompt({
    requirements: requirements.map(({ id, title }) => ({ id, title: String(title || "").slice(0, 500) })),
    appType: { name: "Selected application", type: appType.type }, maxCases,
    additionalContext: "Only Story titles are available after a provider size limit. Generate proposed test coverage for human review; do not claim omitted acceptance criteria or details were verified.",
    externalLinks: [], images: [], knowledge: null, authoringMode
  });
  try {
    const content = images.length
      ? await requestChatCompletion({
          integration,
          fallbackContent,
          contextState,
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
      : await requestChatCompletion({ integration, content: prompt, fallbackContent, contextState });

    return normalizeGeneratedCases(extractJsonPayload(content), maxCases, requirements, authoringMode);
  } catch (error) {
    if (contextState?.reduced || isContextSizeRejection(error?.upstreamStatusCode || error?.statusCode, error?.message)
      || !images.length || ![400, 415, 422].includes(Number(error?.statusCode || 0))) {
      throw error;
    }

    const fallbackPrompt = [
      prompt,
      "",
      aiInstructionBlock("ai.test_case.design", "requirementDesign.fallbackPrompt.2"),
      ...images.map((image, index) => `- Image ${index + 1}: ${image.name}`)
    ].join("\n");

    const content = await requestChatCompletion({ integration, content: fallbackPrompt, fallbackContent, contextState });
    return normalizeGeneratedCases(extractJsonPayload(content), maxCases, requirements, authoringMode);
  }
};

const normalizeAcceptedCases = (cases = [], requirements = []) => {
  if (!Array.isArray(cases) || !cases.length) {
    throw new Error("At least one generated test case is required");
  }

  return cases.map((item, index) => normalizeCaseDraft(item, index, {
    requirements,
    requireRequirementMapping: true,
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
  authoring_mode
}) => {
  const scopedRequirements = uniqueById(requirements);

  if (!scopedRequirements.length) {
    throw new Error("At least one requirement is required");
  }
  if (scopedRequirements.length > 10) throw Object.assign(new Error("Preview Test Cases for at most ten Stories at a time."), { statusCode: 400 });
  if (Number(max_cases) > 10) throw Object.assign(new Error("Generate at most ten Test Cases per preview; use smaller batches for additional coverage."), { statusCode: 400 });

  const maxCases = Number.isFinite(Number(max_cases))
    ? Math.max(1, Math.min(Math.round(Number(max_cases)), 10))
    : DEFAULT_CASE_LIMIT;
  const additionalContext = boundedText(additional_context, 8000);
  const externalLinks = boundedList(external_links, 10, 500);
  const normalizedImages = normalizeImageAssets(images);
  const authoringMode = normalizeAuthoringMode(authoring_mode);
  const integration = await resolveIntegration(integration_id, {
    userId: user_id,
    projectId: appType.project_id || scopedRequirements[0].project_id,
    usageKey: "ai.test_case.design"
  });
  const knowledge = await aiKnowledgeService.buildKnowledgeContextPackage(scopedRequirements[0].project_id, {
    app_type_id: appType.id,
    query: additionalContext,
    module_name: appType.module_name || null,
    feature_name: appType.feature_name || null,
    user: user_id ? { id: user_id } : undefined
  });

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
    contextState
  });

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
    context_reduction_reason: contextState.reduced ? "The provider rejected the full context size. Drafts were generated from Story titles only; review them against the full acceptance criteria." : null,
    generated: generatedCases.length,
    cases: generatedCases.map((candidate, index) => ({
      ...candidate,
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

    created.push({
      id: response.id,
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
