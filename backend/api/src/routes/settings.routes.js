const settingsService = require("../services/settings.service");

module.exports = async function (fastify) {
  fastify.get("/settings/localization", async (req) => {
    await fastify.authenticate(req);
    return {
      strings: await settingsService.getLocalizationStrings()
    };
  });

  fastify.put("/settings/localization", async (req) => {
    await fastify.authenticate(req);

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

    return settingsService.updateWorkspacePreferences(req.user.id, req.body.preferences);
  });
};
