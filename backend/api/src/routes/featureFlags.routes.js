const featureFlagService = require("../services/featureFlag.service");

module.exports = async function (fastify) {
  fastify.get("/feature-flags", async (req, reply) => {
    await fastify.authenticate(req);
    reply.header("Cache-Control", "private, no-store");
    return featureFlagService.getSnapshot({ user: req.user });
  });

  fastify.put("/feature-flags", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      flags: { required: true, type: "object" }
    }, req.body || {});

    await require("../db").transaction(async () => {
      await featureFlagService.updateLocalFlags(req.body.flags);
      await require("../services/adminPortal.service").recordAudit({
        actorId: req.user.id,
        action: "feature_flags.update",
        targetType: "workspace",
        summary: "Updated workspace feature availability.",
        metadata: { changed_keys: Object.keys(req.body.flags), changes: req.body.flags },
        ipAddress: req.ip || null
      });
    })();
    return featureFlagService.getSnapshot({ user: req.user });
  });
};
