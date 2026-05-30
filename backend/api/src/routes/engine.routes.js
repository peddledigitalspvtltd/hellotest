const service = require("../services/engine.service");

module.exports = async function (fastify) {
  fastify.post("/api/engine/runs/claim", async (req) => {
    await fastify.authenticateTestEngine(req);

    fastify.validate({
      engine_id: { required: true, type: "string" }
    }, req.body || {});

    const claim = await service.claimRun(req.body.engine_id);

    if (!claim) {
      return { runId: null, jobId: null };
    }

    return claim;
  });

  fastify.get("/api/engine/runs/:runId/snapshot", async (req) => {
    await fastify.authenticateTestEngine(req);
    return service.loadRunSnapshot(req.params.runId);
  });

  fastify.post("/api/engine/runs/:runId/heartbeat", async (req) => {
    await fastify.authenticateTestEngine(req);

    fastify.validate({
      engine_id: { required: true, type: "string" }
    }, req.body || {});

    return service.heartbeatRun(req.params.runId, req.body.engine_id);
  });

  fastify.get("/api/runs/:runId/status", async (req) => {
    await fastify.authenticate(req);
    return service.getRunStatus(req.params.runId);
  });

  fastify.get("/api/runs/:runId/results", async (req) => {
    await fastify.authenticate(req);
    return service.getRunResults(req.params.runId);
  });

  fastify.get("/api/runs/:runId/logs", async (req) => {
    await fastify.authenticate(req);
    return service.getRunLogs(req.params.runId);
  });

  fastify.get("/api/runs/:runId/artifacts", async (req) => {
    await fastify.authenticate(req);
    return service.getRunArtifacts(req.params.runId);
  });
};
