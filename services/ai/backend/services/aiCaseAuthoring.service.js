const { aiInstructionBlock } = require('@hellotest/platform/backend/src/utils/aiInstructionBlocks');
const aiLlmSelectionService = require("@hellotest/integration/backend/services/aiLlmSelection.service");
const { normalizeRichText, normalizeTestStepType } = require("@hellotest/platform/backend/src/utils/testStepAutomation");
const { createLlmProviderError } = require("@hellotest/platform/backend/src/utils/upstreamLlmError");
const { fetchLlmWithRetry } = require("@hellotest/platform/backend/src/utils/llmHttpClient");
const { getCompletionContent } = require("@hellotest/platform/backend/src/utils/llmResponse");
const { parseAiJson } = require("@hellotest/platform/backend/src/utils/aiJsonResponse");
const { storyAiSnapshot, testCaseAiSnapshot } = require("@hellotest/platform/backend/src/utils/aiArtifactContext");

const DEFAULT_STEP_TYPE_BY_APP_TYPE = {
  api: "api",
  android: "android",
  ios: "ios",
  unified: "web",
  web: "web"
};

const TEST_CASE_AI_REFERENCE_IMAGE_LIMIT = 6;
const TEST_CASE_AI_REFERENCE_IMAGE_TOTAL_CHARS = 950_000;
const TEST_CASE_AI_REFERENCE_IMAGE_DATA_URL = /^data:image\/(?:png|jpe?g|webp);base64,[a-z0-9+/=\s]+$/i;

const normalizeText = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
};

const normalizeTextList = (values = [], limit = 20, itemLimit = 2000) =>
  (Array.isArray(values) ? values : [])
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .slice(0, limit)
    .map((value) => value.slice(0, itemLimit));

const invalidAiReferenceImage = (message) => Object.assign(new Error(message), {
  statusCode: 400,
  code: "INVALID_AI_REFERENCE_IMAGE"
});

const normalizeAiReferenceImages = (images) => {
  const collection = Array.isArray(images) ? images : [];

  if (collection.length > TEST_CASE_AI_REFERENCE_IMAGE_LIMIT) {
    throw invalidAiReferenceImage(`Reference images are limited to ${TEST_CASE_AI_REFERENCE_IMAGE_LIMIT}.`);
  }

  let totalChars = 0;
  return collection.map((image, index) => {
    const url = normalizeText(image?.url);

    if (!url || !TEST_CASE_AI_REFERENCE_IMAGE_DATA_URL.test(url)) {
      throw invalidAiReferenceImage(`Reference image ${index + 1} must be a PNG, JPEG, or WebP data URL.`);
    }

    totalChars += url.length;
    if (totalChars > TEST_CASE_AI_REFERENCE_IMAGE_TOTAL_CHARS) {
      throw invalidAiReferenceImage("Reference images exceed the supported compressed image budget.");
    }

    return {
      name: (normalizeText(image?.name) || `Reference image ${index + 1}`).slice(0, 255),
      url
    };
  });
};

const isPlainObject = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const normalizeParameterName = (value) => {
  const trimmed = String(value || "").trim().replace(/^@+/, "");

  if (!trimmed) {
    return null;
  }

  const scopedMatch = trimmed.match(/^([tsr])\.(.+)$/i);
  const rawName = String(scopedMatch?.[2] || trimmed).trim().toLowerCase();

  return rawName || null;
};

const normalizeParameterValues = (values = {}) => {
  if (!isPlainObject(values)) {
    return {};
  }

  return Object.entries(values).reduce((next, [key, value]) => {
    const normalizedKey = normalizeParameterName(key);

    if (!normalizedKey) {
      return next;
    }

    next[normalizedKey] = value === undefined || value === null ? "" : String(value);
    return next;
  }, {});
};

const normalizeSteps = (steps = [], fallbackStepType = "web") => {
  if (!Array.isArray(steps)) {
    return [];
  }

  return steps
    .map((step, index) => ({
      step_order: Number.isFinite(Number(step?.step_order)) ? Number(step.step_order) : index + 1,
      action: normalizeRichText(step?.action),
      expected_result: normalizeRichText(step?.expected_result || step?.expectedResult),
      step_type: normalizeTestStepType(step?.step_type || step?.stepType, fallbackStepType)
    }))
    .filter((step) => step.action || step.expected_result)
    .sort((left, right) => left.step_order - right.step_order)
    .map((step, index) => ({
      ...step,
      step_order: index + 1
    }));
};

const extractJsonPayload = parseAiJson;

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

  if (!normalizeText(integration.model)) {
    throw new Error("Selected LLM integration is missing a model");
  }

  return integration;
};

const resolveChatCompletionsUrl = (baseUrl) => {
  const normalizedBaseUrl = normalizeText(baseUrl) || "https://api.openai.com/v1";

  if (/\/chat\/completions\/?$/i.test(normalizedBaseUrl)) {
    return normalizedBaseUrl.replace(/\/+$/, "");
  }

  return `${normalizedBaseUrl.replace(/\/+$/, "")}/chat/completions`;
};

const requestChatCompletion = async ({ integration, prompt, images = [], fallbackContent, contextState, operation = "case-authoring.generate" }) => {
  const headers = {
    "Content-Type": "application/json"
  };
  const apiKey = normalizeText(integration.api_key);

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const userContent = images.length
    ? [
        { type: "text", text: prompt },
        ...images.map((image) => ({
          type: "image_url",
          image_url: {
            url: image.url,
            detail: "low"
          }
        }))
      ]
    : prompt;

  let response;

  try {
    response = await fetchLlmWithRetry(resolveChatCompletionsUrl(integration.base_url), {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: integration.model,

        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.requestChatCompletion.1")
          },
          {
            role: "user",
            content: userContent
          }
        ]
      })
    }, { integration, operation, contextFallbackContent: fallbackContent, onContextFallback: () => { if (contextState) contextState.reduced = true; } });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw Object.assign(new Error("AI authoring timed out while waiting for the LLM provider"), { statusCode: 504 });
    }

    if (error?.statusCode || error?.code) throw error;
    throw Object.assign(new Error("Unable to reach the AI authoring provider. Retry after checking the configured connection."), { statusCode: 502 });
  }

  if (!response.ok) {
    const raw = await response.text();
    throw createLlmProviderError({ status: response.status, detail: raw });
  }

  const payload = await response.json();
  const messageContent = getCompletionContent(payload);

  if (!messageContent) {
    throw new Error("LLM response did not include generated content");
  }

  return messageContent;
};

const buildPrompt = ({ requirement, appType, currentCase, authoringMode, additionalContext, externalLinks, images }) => {
  const prompt = [
    aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.prompt.4"),
    "",
    aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.prompt.5"),
    JSON.stringify(storyAiSnapshot(requirement)),
    "",
    [aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.service.prompt.segment.1"),String(appType.name),aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.service.prompt.segment.2"),String(appType.type),aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.service.prompt.segment.3")].join(''),
    "",
    aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.prompt.6"),
    [aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.service.prompt.segment.4"),String(currentCase.title || "Untitled draft"),""].join(''),
    [aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.service.prompt.segment.5"),String(currentCase.description || "No description yet."),""].join(''),
    [aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.service.prompt.segment.6"),String(JSON.stringify({ priority: currentCase.priority, status: currentCase.status, test_case_type: currentCase.test_case_type, labels: currentCase.labels, external_references: currentCase.external_references, automation_status: currentCase.automation_status, module_ids: currentCase.module_ids, reviewer_id: currentCase.reviewer_id, review_status: currentCase.review_status, test_data_set_ids: currentCase.test_data_set_ids, test_data_options: currentCase.test_data_options, context_limits: currentCase.context_limits, step_text_truncated: currentCase.step_text_truncated })),""].join(''),
    [aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.service.prompt.segment.7"),String(currentCase.authoring_mode === "gherkin" ? "Gherkin" : "Structured steps"),""].join(''),
    [aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.service.prompt.segment.8"),String(authoringMode === "gherkin" ? "Gherkin" : "Structured steps"),""].join('')
  ];

  if (currentCase.gherkin_document) {
    prompt.push("");
    prompt.push(aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.buildPrompt.7"));
    prompt.push(currentCase.gherkin_document);
  }

  if (Object.keys(currentCase.parameter_values).length) {
    prompt.push("");
    prompt.push(aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.buildPrompt.8"));
    Object.entries(currentCase.parameter_values).forEach(([key, value]) => {
      prompt.push(`- ${key}: ${value || "(empty)"}`);
    });
  } else {
    prompt.push("");
    prompt.push(aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.buildPrompt.9"));
  }

  prompt.push("");
  prompt.push(aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.buildPrompt.10"));

  if (currentCase.steps.length) {
    currentCase.steps.forEach((step) => {
      prompt.push(`- Step ${step.step_order} [${step.step_type}]: ${step.action || "No action written."}`);
      prompt.push(`  Expected: ${step.expected_result || "No expected result written."}`);
    });
  } else {
    prompt.push(aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.buildPrompt.11"));
  }

  if (additionalContext) {
    prompt.push("");
    prompt.push(aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.buildPrompt.12"));
    prompt.push(additionalContext);
  }

  if (externalLinks.length) {
    prompt.push("");
    prompt.push(aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.buildPrompt.13"));
    externalLinks.forEach((link, index) => {
      prompt.push(`- Link ${index + 1}: ${link}`);
    });
  }

  if (images.length) {
    prompt.push("");
    prompt.push(aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.buildPrompt.14"));
    images.forEach((image, index) => {
      prompt.push(`- Image ${index + 1}: ${image.name}`);
    });
  }

  prompt.push("");
  prompt.push(aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.buildPrompt.15"));
  prompt.push("{");
  prompt.push(aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.buildPrompt.16"));
  prompt.push(aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.buildPrompt.17"));
  prompt.push(aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.buildPrompt.18"));
  prompt.push(`  "authoring_mode": "${authoringMode}",`);
  prompt.push(`  "gherkin_document": ${authoringMode === "gherkin" ? '"Feature: ...\\n\\nBackground: ...\\n  Given ...\\n\\nScenario Outline: ...\\n  When ...\\n  Then ...\\n\\nExamples:\\n  | variable |\\n  | value |"' : "null"},`);
  prompt.push(aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.buildPrompt.19"));
  prompt.push(aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.buildPrompt.20"));
  prompt.push(aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.buildPrompt.21"));
  prompt.push(aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.buildPrompt.22"));
  prompt.push(aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.buildPrompt.23"));
  prompt.push(aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.buildPrompt.24"));
  prompt.push(aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.buildPrompt.25"));
  prompt.push(aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.buildPrompt.26"));
  prompt.push(aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.buildPrompt.27"));
  prompt.push(aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.buildPrompt.28"));
  prompt.push(aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.buildPrompt.29"));
  prompt.push("}");
  prompt.push("");
  prompt.push(aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.buildPrompt.30"));
  prompt.push(aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.buildPrompt.31"));
  prompt.push(aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.buildPrompt.32"));
  prompt.push(aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.buildPrompt.33"));
  prompt.push(aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.buildPrompt.34"));
  prompt.push(aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.buildPrompt.35"));
  prompt.push(aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.buildPrompt.36"));
  prompt.push(aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.buildPrompt.37"));
  prompt.push(aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.buildPrompt.38"));
  prompt.push(aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.buildPrompt.39"));
  prompt.push(aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.buildPrompt.40"));
  if (authoringMode === "gherkin") {
    prompt.push(aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.buildPrompt.41"));
    prompt.push(aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.buildPrompt.42"));
    prompt.push(aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.buildPrompt.43"));
    prompt.push(aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.buildPrompt.44"));
  } else {
    prompt.push(aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.buildPrompt.45"));
  }
  prompt.push(aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.buildPrompt.46"));
  prompt.push(aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.buildPrompt.47"));
  prompt.push(aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.buildPrompt.48"));

  return prompt.join("\n");
};

const buildStepRephrasePrompt = ({ requirement, appType, currentCase, step, additionalContext }) => {
  const prompt = [
    aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.prompt.49"),
    "",
    aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.prompt.50"),
    [aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.service.prompt.segment.9"),String(appType.name),aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.service.prompt.segment.10"),String(appType.type),aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.service.prompt.segment.11")].join(''),
    "",
    aiInstructionBlock("ai.case_authoring.full_case", "aiCaseAuthoring.prompt.51")
  ];

  if (requirement) {
    prompt.push(JSON.stringify(storyAiSnapshot(requirement, { textLimit: 1500, itemLimit: 250, listLimit: 4 })));
  } else {
    prompt.push(aiInstructionBlock("ai.case_authoring.step_rephrase", "aiCaseAuthoring.buildStepRephrasePrompt.52"));
  }

  prompt.push("");
  prompt.push(aiInstructionBlock("ai.case_authoring.step_rephrase", "aiCaseAuthoring.buildStepRephrasePrompt.53"));
  prompt.push(`- Title: ${currentCase.title || "Untitled draft"}`);
  prompt.push(`- Description: ${currentCase.description || "No description yet."}`);

  if (Object.keys(currentCase.parameter_values).length) {
    prompt.push("");
    prompt.push(aiInstructionBlock("ai.case_authoring.step_rephrase", "aiCaseAuthoring.buildStepRephrasePrompt.54"));
    Object.entries(currentCase.parameter_values).forEach(([key, value]) => {
      prompt.push(`- ${key}: ${value || "(empty)"}`);
    });
  }

  prompt.push("");
  prompt.push(aiInstructionBlock("ai.case_authoring.step_rephrase", "aiCaseAuthoring.buildStepRephrasePrompt.55"));
  prompt.push(`- Step ${step.step_order} [${step.step_type}]: ${step.action || "No action written."}`);
  prompt.push(`- Expected: ${step.expected_result || "No expected result written."}`);

  if (additionalContext) {
    prompt.push("");
    prompt.push(aiInstructionBlock("ai.case_authoring.step_rephrase", "aiCaseAuthoring.buildStepRephrasePrompt.56"));
    prompt.push(additionalContext);
  }

  prompt.push("");
  prompt.push(aiInstructionBlock("ai.case_authoring.step_rephrase", "aiCaseAuthoring.buildStepRephrasePrompt.57"));
  prompt.push("{");
  prompt.push(aiInstructionBlock("ai.case_authoring.step_rephrase", "aiCaseAuthoring.buildStepRephrasePrompt.58"));
  prompt.push(aiInstructionBlock("ai.case_authoring.step_rephrase", "aiCaseAuthoring.buildStepRephrasePrompt.59"));
  prompt.push(aiInstructionBlock("ai.case_authoring.step_rephrase", "aiCaseAuthoring.buildStepRephrasePrompt.60"));
  prompt.push(aiInstructionBlock("ai.case_authoring.step_rephrase", "aiCaseAuthoring.buildStepRephrasePrompt.61"));
  prompt.push("}");
  prompt.push("");
  prompt.push(aiInstructionBlock("ai.case_authoring.step_rephrase", "aiCaseAuthoring.buildStepRephrasePrompt.62"));
  prompt.push(aiInstructionBlock("ai.case_authoring.step_rephrase", "aiCaseAuthoring.buildStepRephrasePrompt.63"));
  prompt.push(aiInstructionBlock("ai.case_authoring.step_rephrase", "aiCaseAuthoring.buildStepRephrasePrompt.64"));
  prompt.push(aiInstructionBlock("ai.case_authoring.step_rephrase", "aiCaseAuthoring.buildStepRephrasePrompt.65"));
  prompt.push(aiInstructionBlock("ai.case_authoring.step_rephrase", "aiCaseAuthoring.buildStepRephrasePrompt.66"));

  return prompt.join("\n");
};

const normalizePreview = (payload, currentCase, fallbackStepType, authoringMode = "structured") => {
  const title = normalizeText(payload?.title) || currentCase.title || null;

  if (!title) {
    throw Object.assign(new Error("AI authoring response is missing a title"), { statusCode: 502 });
  }
  if (title.length > 255) throw Object.assign(new Error("AI authoring returned a title longer than 255 characters. Generate a shorter title."), { statusCode: 502 });

  const parameter_values = normalizeParameterValues(
    payload?.parameter_values || payload?.parameterValues || payload?.test_data || payload?.testData
  );

  if (authoringMode === "gherkin") {
    const gherkin_document = normalizeText(payload?.gherkin_document || payload?.gherkinDocument);

    if (!gherkin_document || !/^\s*Feature\s*:/im.test(gherkin_document) || !/^\s*Scenario(?: Outline| Template)?\s*:/im.test(gherkin_document)) {
      throw Object.assign(new Error("AI authoring response did not include a valid Gherkin Feature and Scenario"), { statusCode: 502 });
    }

    const stepCount = (gherkin_document.match(/^\s*(?:Given|When|Then|And|But|\*)(?:[ \t]+|$)/gim) || []).length;
    if (!stepCount || !/^\s*(?:Given|When)\b/im.test(gherkin_document) || !/^\s*Then\b/im.test(gherkin_document)) throw Object.assign(new Error("AI authoring Gherkin must include executable steps and a Then outcome"), { statusCode: 502 });
    if (stepCount > 30) throw Object.assign(new Error("AI authoring Gherkin must include at most thirty steps. Generate a smaller scenario."), { statusCode: 502 });
    return {
      summary: normalizeRichText(payload?.summary),
      title,
      description: normalizeRichText(payload?.description),
      authoring_mode: "gherkin",
      gherkin_document,
      parameter_values,
      steps: [],
      step_count: stepCount,
      parameter_count: Object.keys(parameter_values).length
    };
  }

  const steps = normalizeSteps(payload?.steps, fallbackStepType);

  if (!steps.length || steps.length > 30 || steps.some(step => !step.action || !step.expected_result)) {
    throw Object.assign(new Error("AI authoring must return one to thirty steps, each with an action and expected result"), { statusCode: 502 });
  }

  return {
    summary: normalizeRichText(payload?.summary),
    title,
    description: normalizeRichText(payload?.description),
    authoring_mode: "structured",
    gherkin_document: null,
    parameter_values,
    steps,
    step_count: steps.length,
    parameter_count: Object.keys(parameter_values).length
  };
};

const normalizeStepPreview = (payload, currentStep, fallbackStepType) => {
  const [step] = normalizeSteps([
    {
      step_order: currentStep.step_order,
      step_type: payload?.step_type || payload?.stepType || currentStep.step_type,
      action: payload?.action ?? currentStep.action,
      expected_result: payload?.expected_result ?? payload?.expectedResult ?? currentStep.expected_result
    }
  ], fallbackStepType);

  if (!step) {
    throw new Error("AI step rephrase response did not include a usable step");
  }

  return step;
};

exports.previewCaseAuthoring = async ({
  requirement,
  appType,
  integration_id,
  user_id,
  authoring_mode,
  test_case,
  additional_context,
  external_links,
  images
}) => {
  if (!requirement) {
    throw new Error("A linked requirement is required for AI authoring");
  }

  if (!appType) {
    throw new Error("An app type is required for AI authoring");
  }

  const fallbackStepType = DEFAULT_STEP_TYPE_BY_APP_TYPE[appType.type] || "web";
  const authoringMode = authoring_mode === "gherkin" ? "gherkin" : "structured";
  const boundedCase = testCaseAiSnapshot(test_case);
  const currentCase = {
    ...boundedCase,
    title: boundedCase.title,
    description: normalizeRichText(boundedCase.description) || "",
    parameter_values: normalizeParameterValues(boundedCase.parameter_values),
    steps: normalizeSteps(boundedCase.steps, fallbackStepType)
  };
  const additionalContext = normalizeRichText(additional_context);
  if (additionalContext?.length > 18_000) throw Object.assign(new Error("Shorten the authoring context to 18,000 characters before generating."), { statusCode: 422, code: "AI_INPUT_BUDGET_EXCEEDED" });
  const externalLinks = normalizeTextList(external_links, 10, 500);
  const safeImages = normalizeAiReferenceImages(images);
  const integration = await resolveIntegration(integration_id, {
    userId: user_id,
    projectId: appType.project_id || requirement?.project_id,
    usageKey: "ai.case_authoring.full_case"
  });
  const prompt = buildPrompt({
    requirement,
    appType,
    currentCase,
    authoringMode,
    additionalContext,
    externalLinks,
    images: safeImages
  });
  const contextState = { reduced: false };
  // A rejected optional-evidence budget may be reduced. The linked Story and
  // current authored artifact remain the source of truth for an improvement;
  // never degrade this operation into drafting from their titles alone.
  const fallbackContent = buildPrompt({
    requirement,
    appType,
    currentCase,
    authoringMode, additionalContext: undefined,
    externalLinks: [], images: []
  });
  const content = await requestChatCompletion({ integration, prompt, images: safeImages, fallbackContent, contextState });
  const preview = normalizePreview(extractJsonPayload(content), currentCase, fallbackStepType, authoringMode);

  return {
    integration: {
      id: integration.id,
      name: integration.name,
      type: integration.type,
      model: integration.model
    },
    requirement: {
      id: requirement.id,
      title: requirement.title
    },
    app_type: {
      id: appType.id,
      name: appType.name
    },
    context_reduced: contextState.reduced,
    context_reduction_reason: contextState.reduced ? "The provider rejected the full context size. Optional instructions, images and URL pointers were omitted; the Story and existing authored content were preserved. Review against the original requirements before applying." : null,
    case: preview
  };
};

exports.rephraseTestStep = async ({
  requirement,
  appType,
  integration_id,
  user_id,
  test_case,
  step,
  additional_context
}) => {
  if (!appType) {
    throw new Error("An app type is required for AI step rephrase");
  }

  if (!step || typeof step !== "object") {
    throw new Error("A test step is required for AI rephrase");
  }

  const fallbackStepType = DEFAULT_STEP_TYPE_BY_APP_TYPE[appType.type] || "web";
  const boundedCase = testCaseAiSnapshot(test_case);
  const currentCase = {
    title: boundedCase.title,
    description: normalizeRichText(boundedCase.description) || "",
    parameter_values: normalizeParameterValues(boundedCase.parameter_values),
    steps: []
  };
  const currentStep = {
    step_order: Number.isFinite(Number(step?.step_order)) ? Number(step.step_order) : 1,
    action: normalizeRichText(step?.action)?.slice(0, 4000),
    expected_result: normalizeRichText(step?.expected_result || step?.expectedResult)?.slice(0, 4000),
    step_type: normalizeTestStepType(step?.step_type || step?.stepType, fallbackStepType)
  };

  if (!currentStep.action && !currentStep.expected_result) {
    throw new Error("The selected step needs an action or expected result before AI can rephrase it");
  }

  const integration = await resolveIntegration(integration_id, {
    userId: user_id,
    projectId: appType.project_id || requirement?.project_id,
    usageKey: "ai.case_authoring.step_rephrase"
  });
  const prompt = buildStepRephrasePrompt({
    requirement,
    appType,
    currentCase,
    step: currentStep,
    additionalContext: normalizeRichText(additional_context)?.slice(0, 4000)
  });
  const content = await requestChatCompletion({ integration, prompt, operation: "case-authoring.step-rephrase" });
  const rephrasedStep = normalizeStepPreview(extractJsonPayload(content), currentStep, fallbackStepType);

  return {
    integration: {
      id: integration.id,
      name: integration.name,
      type: integration.type,
      model: integration.model
    },
    step: rephrasedStep
  };
};
