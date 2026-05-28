const service = require("../services/localAgent.service");

module.exports = async function (fastify) {
  fastify.get("/local-agent/status", async (req) => {
    await fastify.authenticate(req);
    return service.getStatus();
  });

  fastify.post("/local-agent/start", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      target: { required: false, type: "string" }
    }, req.body || {});

    return service.start(req.body || {});
  });
};
