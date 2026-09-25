const assistance = require("../services/qualityAssistance.service");
const projectService = require("@hellotest/platform/backend/public/projectAccess");
const richTextAi = require("../services/richTextAi.service");
const requirementService = require("@hellotest/manual/backend/services/requirement.service");
const testCaseService = require("@hellotest/testing/backend/services/testCase.service");
const executionService = require("@hellotest/testing/backend/services/execution.service");
const appTypeService = require("@hellotest/platform/backend/public/applicationAccess");

module.exports = async function (fastify) {
  const validateAssuranceInput = (body) => fastify.validate({
    project_id: { required: false, type: "string", maxLength: 255 },
    integration_id: { required: false, type: "string", maxLength: 255 },
    additional_context: { required: false, type: "string", maxLength: 12000 },
    prompt_guidance: { required: false, type: "string", maxLength: 12000 },
    proposed_change: { required: false, type: "object" },
    assurance_baseline: { required: false, type: "object" }
  }, body || {});
  fastify.post("/ai/rich-text-rephrase", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      project_id: { required: true, type: "string" },
      content: { required: true, type: "string" },
      content_html: { required: false, type: "string" },
      entity_type: { required: false, type: "string" },
      entity_title: { required: false, type: "string" },
      field_label: { required: false, type: "string" },
      aria_label: { required: false, type: "string" },
      additional_context: { required: false, type: "string", maxLength: 12000 }
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
      ariaLabel: req.body.aria_label,
      additionalContext: req.body.additional_context
    });
  });

  fastify.post("/requirements/:id/ai-impact-preview", async (req) => {
    await fastify.authenticate(req);
    validateAssuranceInput(req.body);
    const requirement = await requirementService.getRequirement(req.params.id, { includeLinkedRecords: false });
    if (req.body?.project_id && req.body.project_id !== requirement.project_id) throw Object.assign(new Error("Story belongs to a different project"), { statusCode: 400 });
    await projectService.getProject(requirement.project_id, req.user.id);
    await fastify.requirePermission("requirement.ai", { projectId: requirement.project_id })(req);
    return assistance.previewRequirementImpact({ user: req.user, requirementId: req.params.id, proposedChange: req.body?.proposed_change || req.body || {},
      integrationId: req.body?.integration_id, promptGuidance: req.body?.prompt_guidance, assuranceBaseline: req.body?.assurance_baseline, additionalContext: req.body?.additional_context });
  });

  fastify.post("/test-cases/:id/ai-impact-preview", async (req) => {
    await fastify.authenticate(req);
    validateAssuranceInput(req.body);
    const testCase = await testCaseService.getTestCase(req.params.id);
    const appType = await appTypeService.getAppType(testCase.app_type_id);
    if (req.body?.project_id && req.body.project_id !== appType.project_id) throw Object.assign(new Error("Test Case belongs to a different project"), { statusCode: 400 });
    await projectService.getProject(appType.project_id, req.user.id);
    await fastify.requirePermission("testcase.ai", { projectId: appType.project_id })(req);
    return assistance.previewTestCaseImpact({ user: req.user, testCaseId: req.params.id, proposedChange: req.body?.proposed_change || req.body || {},
      integrationId: req.body?.integration_id, promptGuidance: req.body?.prompt_guidance, assuranceBaseline: req.body?.assurance_baseline, additionalContext: req.body?.additional_context });
  });

  fastify.post("/executions/:id/ai-failure-clusters", async (req) => {
    await fastify.authenticate(req);
    const execution = await executionService.getExecution(req.params.id);
    await projectService.getProject(execution.project_id, req.user.id);
    await fastify.requirePermission("run.ai", { projectId: execution.project_id })(req);
    return assistance.previewFailureClusters({ user: req.user, executionId: req.params.id, requestedScope: req.body?.scope });
  });
};
