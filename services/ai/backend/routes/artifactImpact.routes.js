const projectService = require("@hellotest/platform/backend/public/projectAccess");

const assistance = require("../services/qualityAssistance.service");
const requirementService = require("@hellotest/manual/backend/services/requirement.service");
const testCaseService = require("@hellotest/testing/backend/services/testCase.service");
const appTypeService = require("@hellotest/platform/backend/public/applicationAccess");

module.exports = async function artifactImpactRoutes(fastify) {
  const validateAssuranceInput = (body) => fastify.validate({
    project_id: { required: false, type: "string", maxLength: 255 },
    integration_id: { required: false, type: "string", maxLength: 255 },
    additional_context: { required: false, type: "string", maxLength: 12000 },
    review_purpose: { required: false, type: "string", enum: ["assurance", "change-impact"] },
    prompt_guidance: { required: false, type: "string", maxLength: 12000 },
    proposed_change: { required: false, type: "object" },
    assurance_baseline: { required: false, type: "object" }
  }, body || {});
  fastify.post("/requirements/:id/ai-impact-preview", async (req) => {
    await fastify.authenticate(req);
    validateAssuranceInput(req.body);
    const requirement = await requirementService.getRequirement(req.params.id, { includeLinkedRecords: false });
    if (req.body?.project_id && req.body.project_id !== requirement.project_id) throw Object.assign(new Error("Story belongs to a different project"), { statusCode: 400 });
    await projectService.getProject(requirement.project_id, req.user.id);
    await fastify.requirePermission("requirement.ai", { projectId: requirement.project_id })(req);
    return assistance.previewRequirementImpact({ user: req.user, requirementId: req.params.id, proposedChange: req.body?.proposed_change || req.body || {},
      integrationId: req.body?.integration_id, promptGuidance: req.body?.prompt_guidance, assuranceBaseline: req.body?.assurance_baseline, additionalContext: req.body?.additional_context, reviewPurpose: req.body?.review_purpose });
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
      integrationId: req.body?.integration_id, promptGuidance: req.body?.prompt_guidance, assuranceBaseline: req.body?.assurance_baseline, additionalContext: req.body?.additional_context, reviewPurpose: req.body?.review_purpose });
  });
};
