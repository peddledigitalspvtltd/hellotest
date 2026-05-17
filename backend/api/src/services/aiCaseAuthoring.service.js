const integrationService = require("./integration.service");
const { normalizeRichText, normalizeTestStepType } = require("../utils/testStepAutomation");
const { createLlmProviderError } = require("../utils/upstreamLlmError");

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

const extractJsonPayload = (content) => {
  const trimmed = String(content || "").trim();

  if (!trimmed) {
    throw new Error("LLM response was empty");
  }

  const withoutFence = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim()
    : trimmed;
  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");

  const jsonCandidate =
    firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace
      ? withoutFence.slice(firstBrace, lastBrace + 1)
      : withoutFence;

  try {
    return JSON.parse(jsonCandidate);
  } catch {
    throw new Error("Unable to parse JSON from the LLM response");
  }
};

const resolveIntegration = async (integration_id) => {
  const integration = integration_id
    ? await integrationService.getIntegration(integration_id)
    : await integrationService.getActiveIntegrationByType("llm");

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

const requestChatCompletion = async ({ integration, prompt }) => {
  const baseUrl = (integration.base_url || "https://api.openai.com/v1").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${integration.api_key}`
    },
    body: JSON.stringify({
      model: integration.model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: "You are a senior QA test author. Return strict JSON only."
        },
        {
          role: "user",
          content: prompt
        }
      ]
    })
  });

  if (!response.ok) {
    const raw = await response.text();
    throw createLlmProviderError({ status: response.status, detail: raw });
  }

  const payload = await response.json();
  const messageContent = payload?.choices?.[0]?.message?.content;

  if (!messageContent) {
    throw new Error("LLM response did not include generated content");
  }

  return messageContent;
};

const buildPrompt = ({ requirement, appType, currentCase, additionalContext }) => {
  const prompt = [
    "Complete and improve the following QA test case draft.",
    "",
    "Primary requirement to cover:",
    `- Title: ${requirement.title}`,
    `- Description: ${requirement.description || "No description provided."}`,
    "",
    `Application type: ${appType.name} (${appType.type})`,
    "",
    "Current test case draft:",
    `- Title: ${currentCase.title || "Untitled draft"}`,
    `- Description: ${currentCase.description || "No description yet."}`
  ];

  if (Object.keys(currentCase.parameter_values).length) {
    prompt.push("");
    prompt.push("Current test data declarations:");
    Object.entries(currentCase.parameter_values).forEach(([key, value]) => {
      prompt.push(`- ${key}: ${value || "(empty)"}`);
    });
  } else {
    prompt.push("");
    prompt.push("Current test data declarations: none yet.");
  }

  prompt.push("");
  prompt.push("Current drafted steps:");

  if (currentCase.steps.length) {
    currentCase.steps.forEach((step) => {
      prompt.push(`- Step ${step.step_order} [${step.step_type}]: ${step.action || "No action written."}`);
      prompt.push(`  Expected: ${step.expected_result || "No expected result written."}`);
    });
  } else {
    prompt.push("- No drafted steps yet.");
  }

  if (additionalContext) {
    prompt.push("");
    prompt.push("Additional author guidance from the user:");
    prompt.push(additionalContext);
  }

  prompt.push("");
  prompt.push("Return strict JSON with this shape:");
  prompt.push("{");
  prompt.push('  "summary": "string",');
  prompt.push('  "title": "string",');
  prompt.push('  "description": "string",');
  prompt.push('  "parameter_values": {');
  prompt.push('    "variable_name": "example or declaration"');
  prompt.push("  },");
  prompt.push('  "steps": [');
  prompt.push("    {");
  prompt.push('      "step_order": 1,');
  prompt.push('      "step_type": "web",');
  prompt.push('      "action": "string",');
  prompt.push('      "expected_result": "string"');
  prompt.push("    }");
  prompt.push("  ]");
  prompt.push("}");
  prompt.push("");
  prompt.push("Guidance:");
  prompt.push("- Rephrase unclear existing steps into concise, executable QA language.");
  prompt.push("- Add missing steps only when needed to complete the case against the requirement.");
  prompt.push("- Use @t.variable_name tokens anywhere reusable test data appears in the title, description, or steps.");
  prompt.push("- In parameter_values, return only raw variable names without the @t. prefix.");
  prompt.push("- Prefer intelligent, realistic test data declarations over placeholders like value1 or test123 unless the requirement truly gives no better clue.");
  prompt.push("- Keep the case reusable, avoid redundant steps, and preserve the likely platform context with step_type values from web, api, android, or ios.");
  prompt.push("- Do not include markdown or commentary outside the JSON.");

  return prompt.join("\n");
};

const buildStepRephrasePrompt = ({ requirement, appType, currentCase, step, additionalContext }) => {
  const prompt = [
    "Rephrase one QA test step so it is concise, executable, and high quality.",
    "",
    "Application context:",
    `- Type: ${appType.name} (${appType.type})`,
    "",
    "Linked requirement:"
  ];

  if (requirement) {
    prompt.push(`- Title: ${requirement.title}`);
    prompt.push(`- Description: ${requirement.description || "No description provided."}`);
  } else {
    prompt.push("- No linked requirement was supplied. Preserve the current test case intent.");
  }

  prompt.push("");
  prompt.push("Current test case:");
  prompt.push(`- Title: ${currentCase.title || "Untitled draft"}`);
  prompt.push(`- Description: ${currentCase.description || "No description yet."}`);

  if (Object.keys(currentCase.parameter_values).length) {
    prompt.push("");
    prompt.push("Available test data declarations:");
    Object.entries(currentCase.parameter_values).forEach(([key, value]) => {
      prompt.push(`- ${key}: ${value || "(empty)"}`);
    });
  }

  prompt.push("");
  prompt.push("Step to rephrase:");
  prompt.push(`- Step ${step.step_order} [${step.step_type}]: ${step.action || "No action written."}`);
  prompt.push(`- Expected: ${step.expected_result || "No expected result written."}`);

  if (additionalContext) {
    prompt.push("");
    prompt.push("Additional author guidance from the user:");
    prompt.push(additionalContext);
  }

  prompt.push("");
  prompt.push("Return strict JSON with this shape:");
  prompt.push("{");
  prompt.push('  "step_order": 1,');
  prompt.push('  "step_type": "web",');
  prompt.push('  "action": "string",');
  prompt.push('  "expected_result": "string"');
  prompt.push("}");
  prompt.push("");
  prompt.push("Guidance:");
  prompt.push("- Preserve the business intent, data tokens such as @t.email, and platform step_type unless a correction is clearly needed.");
  prompt.push("- Use one observable user or system action and one clear expected result.");
  prompt.push("- Do not add unrelated preconditions or extra steps.");
  prompt.push("- Do not include markdown or commentary outside the JSON.");

  return prompt.join("\n");
};

const normalizePreview = (payload, currentCase, fallbackStepType) => {
  const title = normalizeText(payload?.title) || currentCase.title || null;

  if (!title) {
    throw new Error("AI authoring response is missing a title");
  }

  const steps = normalizeSteps(payload?.steps, fallbackStepType);

  if (!steps.length) {
    throw new Error("AI authoring response did not include any usable test steps");
  }

  const parameter_values = normalizeParameterValues(
    payload?.parameter_values || payload?.parameterValues || payload?.test_data || payload?.testData
  );

  return {
    summary: normalizeRichText(payload?.summary),
    title,
    description: normalizeRichText(payload?.description),
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
  test_case,
  additional_context
}) => {
  if (!requirement) {
    throw new Error("A linked requirement is required for AI authoring");
  }

  if (!appType) {
    throw new Error("An app type is required for AI authoring");
  }

  const fallbackStepType = DEFAULT_STEP_TYPE_BY_APP_TYPE[appType.type] || "web";
  const currentCase = {
    title: normalizeText(test_case?.title) || "",
    description: normalizeRichText(test_case?.description) || "",
    parameter_values: normalizeParameterValues(test_case?.parameter_values),
    steps: normalizeSteps(test_case?.steps, fallbackStepType)
  };
  const integration = await resolveIntegration(integration_id);
  const prompt = buildPrompt({
    requirement,
    appType,
    currentCase,
    additionalContext: normalizeRichText(additional_context)
  });
  const content = await requestChatCompletion({ integration, prompt });
  const preview = normalizePreview(extractJsonPayload(content), currentCase, fallbackStepType);

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
    case: preview
  };
};

exports.rephraseTestStep = async ({
  requirement,
  appType,
  integration_id,
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
  const currentCase = {
    title: normalizeText(test_case?.title) || "",
    description: normalizeRichText(test_case?.description) || "",
    parameter_values: normalizeParameterValues(test_case?.parameter_values),
    steps: []
  };
  const currentStep = {
    step_order: Number.isFinite(Number(step?.step_order)) ? Number(step.step_order) : 1,
    action: normalizeRichText(step?.action),
    expected_result: normalizeRichText(step?.expected_result || step?.expectedResult),
    step_type: normalizeTestStepType(step?.step_type || step?.stepType, fallbackStepType)
  };

  if (!currentStep.action && !currentStep.expected_result) {
    throw new Error("The selected step needs an action or expected result before AI can rephrase it");
  }

  const integration = await resolveIntegration(integration_id);
  const prompt = buildStepRephrasePrompt({
    requirement,
    appType,
    currentCase,
    step: currentStep,
    additionalContext: normalizeRichText(additional_context)
  });
  const content = await requestChatCompletion({ integration, prompt });
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
