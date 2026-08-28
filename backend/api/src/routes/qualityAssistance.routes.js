const assistance = require("../services/qualityAssistance.service");
const projectService = require("../services/project.service");
const richTextAi = require("../services/richTextAi.service");
const requirementService = require("../services/requirement.service");
const testCaseService = require("../services/testCase.service");
const executionService = require("../services/execution.service");
const appTypeService = require("../services/appType.service");

module.exports = async function (fastify) {
  fastify.post("/ai/rich-text-rephrase", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      project_id: { required: true, type: "string" },
      content: { required: true, type: "string" },
      content_html: { required: false, type: "string" },
      entity_type: { required: false, type: "string" },
      entity_title: { required: false, type: "string" },
      field_label: { required: false, type: "string" },
      aria_label: { required: false, type: "string" }
    }, req.body || {});
    await projectService.getProject(req.body.project_id, req.user.id);
    return richTextAi.rephrase({
      user: req.user,
      projectId: req.body.project_id,
      content: req.body.content,
      contentHtml: req.body.content_html,
      entityType: req.body.entity_type,
      entityTitle: req.body.entity_title,
      fieldLabel: req.body.field_label,
      ariaLabel: req.body.aria_label
    });
  });

  fastify.post("/requirements/:id/ai-impact-preview", async (req) => {
    await fastify.authenticate(req);
    const requirement = await requirementService.getRequirement(req.params.id);
    await projectService.getProject(requirement.project_id, req.user.id);
    await fastify.requirePermission("requirement.ai", { projectId: requirement.project_id })(req);
    return assistance.previewRequirementImpact({ user: req.user, requirementId: req.params.id, proposedChange: req.body?.proposed_change || req.body || {} });
  });

  fastify.post("/test-cases/:id/ai-impact-preview", async (req) => {
    await fastify.authenticate(req);
    const testCase = await testCaseService.getTestCase(req.params.id);
    const appType = await appTypeService.getAppType(testCase.app_type_id);
    await projectService.getProject(appType.project_id, req.user.id);
    await fastify.requirePermission("testcase.ai", { projectId: appType.project_id })(req);
    return assistance.previewTestCaseImpact({ user: req.user, testCaseId: req.params.id, proposedChange: req.body?.proposed_change || req.body || {} });
  });

  fastify.post("/executions/:id/ai-failure-clusters", async (req) => {
    await fastify.authenticate(req);
    const execution = await executionService.getExecution(req.params.id);
    await projectService.getProject(execution.project_id, req.user.id);
    await fastify.requirePermission("run.ai", { projectId: execution.project_id })(req);
    return assistance.previewFailureClusters({ user: req.user, executionId: req.params.id, requestedScope: req.body?.scope });
  });
};
