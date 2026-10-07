const { normalizeText } = require("@hellotest/platform/backend/src/security/aiTextPolicy");
const createError = (message, statusCode, code) => Object.assign(new Error(message), { statusCode, code });
const asObject = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const normalizeId = value => normalizeText(value, 255);
const assertLlmIntegrationProjectScope = (integration, projectId) => {
  if (!integration) return null;
  if (integration.type !== "llm" || !integration.is_active) throw createError("Selected integration is not an active LLM integration.", 400);
  const configuredProjectId = normalizeId(asObject(integration.config).project_id);
  if (configuredProjectId && configuredProjectId !== projectId) {
    throw createError("Selected LLM integration belongs to another project.", 403, "LLM_PROJECT_SCOPE_MISMATCH");
  }
  return integration;
};

module.exports = { assertLlmIntegrationProjectScope };
