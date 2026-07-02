const featureFlagService = require("../services/featureFlag.service");

module.exports = async function (fastify) {
  fastify.get("/feature-flags", async (req) => {
    await fastify.authenticate(req);
    return featureFlagService.getSnapshot({ user: req.user });
  });

  fastify.put("/feature-flags", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      flags: { required: true, type: "object" }
    }, req.body || {});

    await featureFlagService.updateLocalFlags(req.body.flags);
    return featureFlagService.getSnapshot({ user: req.user });
  });
};
