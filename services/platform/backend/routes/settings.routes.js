const settingsService = require("../services/settings.service");
const apiKeyService = require("../services/apiKey.service");

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

    // Persistence canonicalizes preference keys. Authorize the same keys so
    // whitespace cannot route a governed setting through the personal path.
    const preferenceKeys = Object.keys(req.body.preferences || {}).map((key) => key.trim());

    if (preferenceKeys.some(key => ["ai_metric_criteria_overrides", "ai_metric_formula_values"].includes(key))) {
      throw Object.assign(new Error("Metric governance has moved to Administration → Metric governance."), { statusCode: 409, code: "METRIC_GOVERNANCE_MOVED" });
    }
    if (preferenceKeys.some(key => ["ai_prompt_registry_overrides", "ai_prompt_registry_llm_overrides"].includes(key))) {
      throw Object.assign(new Error("AI prompt configuration has moved to Administration → AI Controls."), { statusCode: 409, code: "AI_CONFIGURATION_MOVED" });
    }

    return settingsService.updateWorkspacePreferences(req.user.id, req.body.preferences);
  });

  fastify.get("/settings/api-keys", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    await fastify.authenticate(req);
    await fastify.requirePermission("api_key.manage")(req);
    return {
      api_keys: await apiKeyService.listApiKeys(req.user.id),
      scopes: apiKeyService.API_KEY_SCOPES
    };
  });

  fastify.post("/settings/api-keys", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    await fastify.authenticate(req);
    await fastify.requirePermission("api_key.manage")(req);

    fastify.validate({
      name: { required: true, type: "string", minLength: 2 },
      scope: { required: false, type: "string", enum: apiKeyService.API_KEY_SCOPES.map(({ value }) => value) }
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

  fastify.delete("/settings/api-keys/:id/permanent", async (req) => {
    await fastify.authenticate(req);
    await fastify.requirePermission("api_key.manage")(req);
    return apiKeyService.deleteApiKey({
      user_id: req.user.id,
      id: req.params.id
    });
  });
};
