const integrationService = require("./integration.service");
const settingsService = require("./settings.service");

const AI_PROMPT_LLM_OVERRIDES_KEY = "ai_prompt_registry_llm_overrides";

const normalizeText = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
};

const normalizePromptLlmOverrides = (input) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(input)
      .map(([key, value]) => [normalizeText(key), normalizeText(value)])
      .filter(([key, value]) => key && value)
  );
};

const validateLlmIntegration = (integration) => {
  if (!integration) {
    return null;
  }

  if (integration.type !== "llm") {
    throw new Error("Selected integration is not an LLM integration");
  }

  if (!integration.is_active) {
    throw new Error("Selected LLM integration is inactive");
  }

  return integration;
};

const getConfiguredIntegrationId = async ({ userId, usageKey } = {}) => {
  const normalizedUserId = normalizeText(userId);
  const normalizedUsageKey = normalizeText(usageKey);

  if (!normalizedUserId || !normalizedUsageKey) {
    return null;
  }

  const preferences = await settingsService.getWorkspacePreferences(normalizedUserId);
  const overrides = normalizePromptLlmOverrides(preferences?.[AI_PROMPT_LLM_OVERRIDES_KEY]);
  return overrides[normalizedUsageKey] || null;
};

exports.AI_PROMPT_LLM_OVERRIDES_KEY = AI_PROMPT_LLM_OVERRIDES_KEY;
exports.normalizePromptLlmOverrides = normalizePromptLlmOverrides;

exports.resolveLlmIntegrationForUsage = async ({
  integrationId,
  userId,
  usageKey,
  projectId,
  fallback = "global",
  allowMissing = false
} = {}) => {
  const explicitIntegrationId = normalizeText(integrationId);
  const configuredIntegrationId = explicitIntegrationId
    ? null
    : await getConfiguredIntegrationId({ userId, usageKey });
  const selectedIntegrationId = explicitIntegrationId || configuredIntegrationId;

  if (selectedIntegrationId) {
    return validateLlmIntegration(await integrationService.getIntegration(selectedIntegrationId));
  }

  let integration = null;

  if (fallback === "project-then-global") {
    integration =
      await integrationService.getActiveIntegrationByTypeForProject("llm", projectId)
      || await integrationService.getActiveIntegrationByType("llm");
  } else if (fallback === "project-scoped") {
    integration = await integrationService.getActiveIntegrationByTypeForProject("llm", projectId);
  } else if (fallback === "none") {
    integration = null;
  } else {
    integration = await integrationService.getActiveIntegrationByType("llm");
  }

  if (!integration) {
    if (allowMissing) {
      return null;
    }

    throw new Error("No active LLM integration is configured");
  }

  return validateLlmIntegration(integration);
};
