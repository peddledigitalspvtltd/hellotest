const projectService = require("../services/project.service");
const opsTelemetryService = require("../services/opsTelemetry.service");

module.exports = async function (fastify) {
  fastify.get("/ops-telemetry/snapshot", async (req) => {
    const { project_id } = req.query || {};
    if (!project_id) {
      const error = new Error("project_id is required");
      error.statusCode = 400;
      throw error;
    }

    await projectService.getProject(project_id, req.user.id);
    return opsTelemetryService.getTelemetrySnapshot(req.query);
  });

  fastify.delete("/ops-telemetry/logs", async (req) => {
    const { project_id } = req.query || {};

    if (!project_id) {
      const error = new Error("project_id is required");
      error.statusCode = 400;
      throw error;
    }
    await projectService.getProject(project_id, req.user.id);

    return opsTelemetryService.clearTelemetryLogs({
      project_id
    });
  });
};
