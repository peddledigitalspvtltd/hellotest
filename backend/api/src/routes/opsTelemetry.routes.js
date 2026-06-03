const projectService = require("../services/project.service");
const opsTelemetryService = require("../services/opsTelemetry.service");

module.exports = async function (fastify) {
  fastify.delete("/ops-telemetry/logs", async (req) => {
    const { project_id } = req.query || {};

    if (project_id) {
      await projectService.getProject(project_id);
    }

    return opsTelemetryService.clearTelemetryLogs({
      project_id
    });
  });
};
