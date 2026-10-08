const integrationService = require("./integration.service");
const settingsService = require("@hellotest/platform/backend/services/settings.service");

const AI_PROMPT_LLM_OVERRIDES_KEY = "ai_prompt_registry_llm_overrides";
const AI_LAST_SUCCESSFUL_LLM_KEY = "ai_last_successful_llm";
const selectionContexts = new WeakMap();
const pendingWrites = new Map();

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

const normalizeSuccessfulSelections = (value) => (Array.isArray(value) ? value : [])
  .filter((entry) => entry && normalizeText(entry.integration_id) && Number.isFinite(Date.parse(entry.succeeded_at)))
  .map((entry) => ({ integration_id: entry.integration_id.trim(), project_id: normalizeText(entry.project_id), usage_key: normalizeText(entry.usage_key), succeeded_at: entry.succeeded_at }))
  .sort((left, right) => Date.parse(right.succeeded_at) - Date.parse(left.succeeded_at))
  .slice(0, 100);

// A provider selection is only remembered after the shared HTTP client confirms
// a usable response. Failed attempts and merely opening a selector never write.
exports.recordSuccessfulLlmIntegration = async (integration) => {
  const context = integration && selectionContexts.get(integration);
  if (!context?.userId || !integration.id) return;
  const previous = pendingWrites.get(context.userId) || Promise.resolve();
  const write = previous.catch(() => {}).then(async () => {
    const preferences = await settingsService.getWorkspacePreferences(context.userId);
    const entries = normalizeSuccessfulSelections(preferences?.[AI_LAST_SUCCESSFUL_LLM_KEY])
      .filter((entry) => entry.project_id !== context.projectId || entry.usage_key !== context.usageKey);
    await settingsService.updateWorkspacePreferences(context.userId, {
      [AI_LAST_SUCCESSFUL_LLM_KEY]: [{ integration_id: integration.id, project_id: context.projectId, usage_key: context.usageKey, succeeded_at: new Date().toISOString() }, ...entries].slice(0, 100)
    });
  });
  pendingWrites.set(context.userId, write);
  try { await write; } catch { /* Preference storage must not turn a working response into a failed request. */ }
  finally { if (pendingWrites.get(context.userId) === write) pendingWrites.delete(context.userId); }
};

exports.AI_PROMPT_LLM_OVERRIDES_KEY = AI_PROMPT_LLM_OVERRIDES_KEY;
exports.AI_LAST_SUCCESSFUL_LLM_KEY = AI_LAST_SUCCESSFUL_LLM_KEY;
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
  const context = { userId: normalizeText(userId), usageKey: normalizeText(usageKey), projectId: normalizeText(projectId), explicit: Boolean(explicitIntegrationId), fallback };
  const remember = (integration) => {
    const validated = validateLlmIntegration(integration);
    if (validated) {
      const providerProject = normalizeText(validated.config?.project_id);
      if (providerProject && providerProject !== context.projectId) throw Object.assign(new Error("The selected model belongs to another project."), { statusCode: 403, code: "LLM_PROJECT_SCOPE_DENIED" });
      selectionContexts.set(validated, context);
      require("@hellotest/platform/backend/src/utils/llmTraceContext").bindIntegration(validated, context);
    }
    return validated;
  };
  if (explicitIntegrationId) {
    return remember(await integrationService.getIntegration(explicitIntegrationId));
  }
  const preferences = context.userId ? await settingsService.getWorkspacePreferences(context.userId) : {};
  const configuredIntegrationId = normalizePromptLlmOverrides(preferences?.[AI_PROMPT_LLM_OVERRIDES_KEY])[context.usageKey];
  const successfulSelections = normalizeSuccessfulSelections(preferences?.[AI_LAST_SUCCESSFUL_LLM_KEY])
    .filter((entry) => entry.project_id === context.projectId);
  const candidates = [...new Set([
    configuredIntegrationId,
    ...successfulSelections.filter((entry) => entry.usage_key === context.usageKey).map((entry) => entry.integration_id),
    ...successfulSelections.map((entry) => entry.integration_id)
  ].filter(Boolean))];
  for (const id of candidates) {
    // Implicit preferences can become stale after an integration is retired.
    // They must not prevent a remaining active provider from working.
    let candidate;
    try { candidate = await integrationService.getIntegration(id); }
    catch (error) { if (error?.message === "Integration not found") continue; throw error; }
    const candidateProject = normalizeText(candidate?.config?.project_id);
    if (candidate?.type !== "llm" || !candidate.is_active || (candidateProject && candidateProject !== context.projectId)) continue;
    return remember(candidate);
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

  return remember(integration);
};
