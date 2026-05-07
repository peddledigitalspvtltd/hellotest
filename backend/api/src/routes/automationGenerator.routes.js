const service = require("../services/automationGenerator.service");

module.exports = async function (fastify) {
  fastify.post("/automation-generator/internal/jobs/lease", async (req) => {
    await fastify.authenticateTestEngine(req);

    fastify.validate({
      worker_id: { required: false, type: "string" },
      lease_seconds: { required: false, type: "number" }
    }, req.body || {});

    const job = await service.leaseNextJob(req.body || {});
    return { job };
  });

  fastify.get("/automation-generator/internal/jobs/:id", async (req) => {
    await fastify.authenticateTestEngine(req);
    return service.getJob(req.params.id);
  });

  fastify.post("/automation-generator/internal/jobs/:id/run", async (req) => {
    await fastify.authenticateTestEngine(req);

    fastify.validate({
      worker_id: { required: false, type: "string" },
      agent_plan: { required: false, type: "string" },
      llm_model: { required: false, type: "string" }
    }, req.body || {});

    return service.runLeasedJob({
      job_id: req.params.id,
      worker_id: req.body?.worker_id,
      agent_plan: req.body?.agent_plan,
      llm_model: req.body?.llm_model
    });
  });
};
