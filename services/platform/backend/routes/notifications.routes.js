const service = require("../services/notification.service");

module.exports = async function (fastify) {
  fastify.get("/notifications", async (req) => {
    await fastify.authenticate(req);
    return service.getNotificationPage({
      ...req.query,
      user_id: req.user.id,
      status: req.query?.status
    });
  });

  fastify.get("/notifications/unread-count", async (req) => {
    await fastify.authenticate(req);
    return service.getUnreadSummary(req.user.id);
  });

  fastify.put("/notifications/read-all", async (req) => {
    await fastify.authenticate(req);
    return service.clearForUser(req.user.id);
  });

  fastify.put("/notifications/:id/read", async (req) => {
    await fastify.authenticate(req);
    return service.markRead(req.params.id, req.user.id);
  });

  fastify.delete("/notifications/:id", async (req) => {
    await fastify.authenticate(req);
    return service.deleteForUser(req.params.id, req.user.id);
  });

  fastify.delete("/notifications", async (req) => {
    await fastify.authenticate(req);
    return service.deleteAllForUser(req.user.id);
  });
};
