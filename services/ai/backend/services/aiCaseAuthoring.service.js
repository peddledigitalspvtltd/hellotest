const { normalizeReferenceImages, imageUserContent } = require('@hellotest/platform/backend/src/utils/aiReferenceImages');
const { splitGenerationContext, generationRetrievalQuery } = require('@hellotest/platform/backend/src/utils/aiGenerationContext');
const { caseOutputSchema, stepOutputSchema } = require('@hellotest/platform/backend/src/utils/aiGenerationContracts');
const { aiInstructionBlock } = require('@hellotest/platform/backend/src/utils/aiInstructionBlocks');
const { validateAuthoringIntent } = require('@hellotest/platform/backend/src/utils/aiAuthoringIntent');
const aiLlmSelectionService = require("@hellotest/integration/backend/services/aiLlmSelection.service");
const { normalizeRichText, normalizeTestStepType } = require("@hellotest/platform/backend/src/utils/testStepAutomation");
const { createLlmProviderError } = require("@hellotest/platform/backend/src/utils/upstreamLlmError");
const { fetchLlmWithRetry } = require("@hellotest/platform/backend/src/utils/llmHttpClient");
const { getCompletionContent } = require("@hellotest/platform/backend/src/utils/llmResponse");
const { parseAiJson } = require("@hellotest/platform/backend/src/utils/aiJsonResponse");
const { storyAiSnapshot, testCaseAiSnapshot } = require("@hellotest/platform/backend/src/utils/aiArtifactContext");
const dropdownCatalog = require('@hellotest/platform/backend/services/dropdownCatalog.service');

const DEFAULT_STEP_TYPE_BY_APP_TYPE = {
  api: "api",
  android: "android",
  ios: "ios",
  unified: "web",
  web: "web"
};


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


const normalizeAiReferenceImages = images => normalizeReferenceImages(images);

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

const requestChatCompletion = async ({ integration, prompt, images = [], imageOnly = false, fallbackContent, contextState, testCaseTypes, featureKey = "ai.case_authoring.full_case", authoringMode = "structured", operation = "case-authoring.generate" }) => {
  const headers = {
    "Content-Type": "application/json"
  };
  const apiKey = normalizeText(integration.api_key);

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const userContent = imageUserContent(prompt, images);

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
            content: [aiInstructionBlock(featureKey,"legacy.reviewed"),...(featureKey==="ai.case_authoring.full_case"?[aiInstructionBlock(featureKey,`format.${authoringMode}`),...(imageOnly ? [aiInstructionBlock(featureKey,"evidence.imageOnly")] : [])]:[])].join("\n\n")
          },
          {
            role: "user",
            content: userContent
          }
        ]
      })
    }, { integration, operation, featureKey, persistReferenceImages:featureKey === 'ai.case_authoring.full_case', referenceImageNames:images.map(item=>item.name),
      onReferenceAttachments: items => { if (contextState) contextState.referenceAttachments = items; },
      nativeArtifactTestCaseTypes:testCaseTypes, contextRetrievalQuery:generationRetrievalQuery(userContent), contextFallbackContent: fallbackContent, contextFallbackInstructions: aiInstructionBlock(featureKey,"recovery.context_size"), onContextFallback: () => { if (contextState) contextState.reduced = true; } });
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
    throw Object.assign(new Error('The model returned no Test Case content. Retry or select another configured model.'), { statusCode: 502, code: 'AI_TEST_CASE_RESPONSE_INVALID' });
  }

  return messageContent;
};

const buildPrompt = ({ requirement, appType, currentCase, authoringMode, additionalContext, externalLinks, images, testCaseTypes }) => JSON.stringify({
  application_contract:{output_schema:caseOutputSchema(authoringMode,{testCaseTypes}),authoring_mode:authoringMode},
  generation_request:splitGenerationContext(additionalContext),
  application:{id:appType.id,name:appType.name,type:appType.type},
  story:requirement ? storyAiSnapshot(requirement) : null,
  current_case:currentCase,
  external_references:externalLinks.map(url=>({url,content_retrieved:false})),
  reference_images:images.map(image=>({name:image.name}))
});

const buildStepRephrasePrompt = ({ requirement, appType, currentCase, step, additionalContext }) => JSON.stringify({
  application_contract:{output_schema:stepOutputSchema(),step_type:step.step_type},
  generation_request:splitGenerationContext(additionalContext),
  application:{id:appType.id,name:appType.name,type:appType.type},
  story:requirement?storyAiSnapshot(requirement,{textLimit:1500,itemLimit:250,listLimit:4}):null,
  current_case:{title:currentCase.title,description:currentCase.description,parameter_values:currentCase.parameter_values},
  selected_step:step
});

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
      priority: payload?.priority ?? currentCase.priority ?? 3,
      test_case_type: payload?.test_case_type ?? currentCase.test_case_type,
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
    priority: payload?.priority ?? currentCase.priority ?? 3,
    test_case_type: payload?.test_case_type ?? currentCase.test_case_type,
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
  const typeField = await dropdownCatalog.getField('test_cases.types');
  const testCaseTypes = [...new Set([...typeField.options.filter(option=>option.active!==false).map(option=>option.value), ...(currentCase.test_case_type?[currentCase.test_case_type]:[])])];
  const integration = await resolveIntegration(integration_id, {
    userId: user_id,
    projectId: appType.project_id || requirement?.project_id,
    usageKey: "ai.case_authoring.full_case"
  });
  await validateAuthoringIntent({ featureKey: 'ai.case_authoring.full_case', integration, additionalContext,
    requirements: requirement ? [requirement] : [], currentCase, images: safeImages, externalLinks, fetchCompletion: fetchLlmWithRetry });
  const prompt = buildPrompt({
    requirement,
    appType,
    currentCase,
    authoringMode,
    additionalContext,
    externalLinks,
    images: safeImages,
    testCaseTypes
  });
  const contextState = { reduced: false };
  // A rejected optional-evidence budget may be reduced. The linked Story and
  // current authored artifact remain the source of truth for an improvement;
  // never degrade this operation into drafting from their titles alone.
  const fallbackContent = buildPrompt({
    requirement,
    appType,
    currentCase,
    authoringMode, additionalContext,
    externalLinks: [], images: [], testCaseTypes
  });
  const content = await requestChatCompletion({ integration, prompt, authoringMode, images: safeImages, imageOnly: safeImages.length > 0 && !splitGenerationContext(additionalContext).user_request, fallbackContent, contextState, testCaseTypes });
  let parsed;
  try { parsed = extractJsonPayload(content); }
  catch {
    throw Object.assign(new Error('The model returned an invalid Test Case response. Retry or select another configured model; your existing Test Case is unchanged.'), { statusCode: 502, code: 'AI_TEST_CASE_RESPONSE_INVALID' });
  }
  const preview = normalizePreview(parsed, currentCase, fallbackStepType, authoringMode);
  preview.reference_attachment_ids = (contextState.referenceAttachments || []).map(item => item.id);
  preview.test_case_type ||= currentCase.test_case_type || typeField.default_value;
  if (!testCaseTypes.includes(preview.test_case_type)) throw Object.assign(new Error('AI authoring selected an unavailable Test Case type. Choose an active type configured by an administrator.'),{statusCode:502,code:'AI_NATIVE_CONTRACT_INVALID'});
  if (!Number.isSafeInteger(preview.priority)||preview.priority<1||preview.priority>5) throw Object.assign(new Error('AI authoring returned an invalid priority.'),{statusCode:502,code:'AI_NATIVE_CONTRACT_INVALID'});

  return {
    integration: {
      id: integration.id,
      name: integration.name,
      type: integration.type,
      model: integration.model
    },
    requirement: requirement ? { id: requirement.id, title: requirement.title } : null,
    app_type: {
      id: appType.id,
      name: appType.name
    },
    context_reduced: contextState.reduced,
    context_reduction_reason: contextState.reduced ? "The provider rejected the full context size. URL pointers were omitted; user instructions, the Story and existing authored content were preserved. Review against the original requirements before applying." : null,
    case: preview
  };
};

exports.rephraseTestStep = async ({
  requirement,
  appType,
  integration_id,
  ai_feature,
  user_id,
  test_case,
  step,
  additional_context
}) => {
  if (ai_feature != null && !["ai.case_authoring.step_rephrase", "ai.automation.step_rephrase"].includes(ai_feature)) throw Object.assign(new Error("Unsupported step-rephrase feature."), { statusCode: 400 });
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
    usageKey: ai_feature || "ai.case_authoring.step_rephrase"
  });
  const additionalContext = normalizeRichText(additional_context) || '';
  if (additionalContext.length > 18000) throw Object.assign(new Error('Shorten step guidance to 18,000 characters.'), { statusCode: 422, code: 'AI_INPUT_BUDGET_EXCEEDED' });
  await validateAuthoringIntent({ featureKey: ai_feature || 'ai.case_authoring.step_rephrase', integration, additionalContext,
    requirements: requirement ? [requirement] : [], currentCase: { ...currentCase, steps: [currentStep] }, fetchCompletion: fetchLlmWithRetry });
  const prompt = buildStepRephrasePrompt({
    requirement,
    appType,
    currentCase,
    step: currentStep,
    additionalContext
  });
  const fallbackContent = buildStepRephrasePrompt({ requirement: requirement ? storyAiSnapshot(requirement, { textLimit: 600, itemLimit: 200, listLimit: 4 }) : null,
    appType, currentCase: { ...currentCase, description: currentCase.description.slice(0, 500) }, step: currentStep, additionalContext });
  const content = await requestChatCompletion({ integration, prompt, fallbackContent, featureKey: ai_feature || "ai.case_authoring.step_rephrase", operation: "case-authoring.step-rephrase" });
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

exports._promptBuilders={buildPrompt,buildStepRephrasePrompt};
