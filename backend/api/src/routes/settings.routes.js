const settingsService = require("../services/settings.service");
const apiKeyService = require("../services/apiKey.service");

const AI_PROMPT_PREFERENCE_KEYS = new Set([
  "ai_prompt_registry_overrides",
  "ai_prompt_registry_llm_overrides"
]);

module.exports = async function (fastify) {
  fastify.get("/settings/localization", async (req) => {
    await fastify.authenticate(req);
    return {
      strings: await settingsService.getLocalizationStrings()
    };
  });

  fastify.put("/settings/localization", async (req) => {
    await fastify.authenticate(req);
    await fastify.requirePermission("localization.manage")(req);

    fastify.validate({
      strings: { required: true, type: "object" }
    }, req.body);

    return settingsService.updateLocalizationStrings(req.body.strings);
  });

  fastify.get("/settings/workspace-preferences", async (req) => {
    await fastify.authenticate(req);
    return {
      preferences: await settingsService.getWorkspacePreferences(req.user.id)
    };
  });

  fastify.put("/settings/workspace-preferences", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      preferences: { required: true, type: "object" }
    }, req.body);

    const preferenceKeys = Object.keys(req.body.preferences || {});

    if (preferenceKeys.some((key) => AI_PROMPT_PREFERENCE_KEYS.has(key))) {
      await fastify.requirePermission("ai_prompt.manage")(req);
    }

    return settingsService.updateWorkspacePreferences(req.user.id, req.body.preferences);
  });

  fastify.get("/settings/api-keys", async (req) => {
    await fastify.authenticate(req);
    await fastify.requirePermission("api_key.manage")(req);
    return {
      api_keys: await apiKeyService.listApiKeys(req.user.id),
      scopes: apiKeyService.API_KEY_SCOPES
    };
  });

  fastify.post("/settings/api-keys", async (req) => {
    await fastify.authenticate(req);
    await fastify.requirePermission("api_key.manage")(req);

    fastify.validate({
      name: { required: true, type: "string", minLength: 2 },
      scope: { required: false, type: "string" }
    }, req.body);

    return apiKeyService.createApiKey({
      user_id: req.user.id,
      name: req.body.name,
      scope: req.body.scope
    });
  });

  fastify.delete("/settings/api-keys/:id", async (req) => {
    await fastify.authenticate(req);
    await fastify.requirePermission("api_key.manage")(req);
    return apiKeyService.revokeApiKey({
      user_id: req.user.id,
      id: req.params.id
    });
  });
};
