const projectService = require("@hellotest/platform/backend/public/projectAccess");

const assistance = require("../services/qualityAssistance.service");
const executionService = require("@hellotest/testing/backend/services/execution.service");

module.exports = async function executionAnalysisRoutes(fastify) {
  fastify.post("/executions/:id/ai-failure-clusters", async (req) => {
    await fastify.authenticate(req);
    const execution = await executionService.getExecution(req.params.id);
    await projectService.getProject(execution.project_id, req.user.id);
    await fastify.requirePermission("run.ai", { projectId: execution.project_id })(req);
    return assistance.previewFailureClusters({ user: req.user, executionId: req.params.id, requestedScope: req.body?.scope, integrationId: req.body?.integration_id });
  });
};
