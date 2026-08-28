const service = require("../services/engine.service");
const projectService = require("../services/project.service");

const ensureRunReadAccess = async (fastify, req, dependencies = {}) => {
  const engineService = dependencies.engineService || service;
  const projects = dependencies.projectService || projectService;
  const scope = await engineService.getRunScope(req.params.runId);
  await projects.getProject(scope.project_id, req.user.id);
  await fastify.requirePermission("run.view", { projectId: scope.project_id })(req);
  return scope;
};

async function engineRoutes(fastify) {
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
    const scope = await ensureRunReadAccess(fastify, req);
    return service.getRunStatus(req.params.runId, scope.project_id);
  });

  fastify.get("/api/runs/:runId/results", async (req) => {
    await fastify.authenticate(req);
    const scope = await ensureRunReadAccess(fastify, req);
    return service.getRunResults(req.params.runId, scope.project_id);
  });

  fastify.get("/api/runs/:runId/logs", async (req) => {
    await fastify.authenticate(req);
    const scope = await ensureRunReadAccess(fastify, req);
    return service.getRunLogs(req.params.runId, scope.project_id);
  });

  fastify.get("/api/runs/:runId/artifacts", async (req) => {
    await fastify.authenticate(req);
    const scope = await ensureRunReadAccess(fastify, req);
    return service.getRunArtifacts(req.params.runId, scope.project_id);
  });
}

module.exports = engineRoutes;
module.exports._internals = { ensureRunReadAccess };
