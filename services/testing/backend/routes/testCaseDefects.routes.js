const service = require("../services/testCaseDefect.service");
const scopes = require("../services/testCaseScope.service");
const entityScopes = require("@hellotest/platform/backend/services/entityScope.service");

const scopeError = (message, statusCode) => Object.assign(new Error(message), { statusCode });
const authorizeMappings = async (fastify, req, { test_case_id, issue_id }, permission) => {
  const testCase = test_case_id ? (await scopes.resolveTestCaseScopes([test_case_id]))[0] : null;
  if (test_case_id && !testCase) throw scopeError("Test Case not found", 404);
  if (testCase && testCase.project_ids.length !== 1) throw scopeError("The Test Case does not have a single project scope", 409);
  const issue = issue_id ? await entityScopes.resolveEntityScope({ entityType: "issue", entityId: issue_id }) : null;
  const projectId = testCase?.project_ids[0] || issue?.projectId || null;
  if (!projectId && req.user.role !== "admin") throw scopeError("test_case_id or issue_id is required when listing Test Case defect mappings", 400);
  if (issue && issue.projectId !== projectId) throw scopeError("Test Case and Defect must belong to the same project", 403);
  await fastify.requirePermission("testcase.view", { projectId })(req);
  await fastify.requirePermission(permission, { projectId })(req);
};

module.exports = async function (fastify) {
  fastify.get("/test-case-defects", async (req) => {
    await fastify.authenticate(req);
    const { test_case_id, issue_id } = req.query;
    await authorizeMappings(fastify, req, { test_case_id, issue_id }, "feedback.view");
    return service.listMappings({ test_case_id, issue_id });
  });

  fastify.get("/test-case-defects/:testCaseId/issues", async (req) => {
    await fastify.authenticate(req);
    await authorizeMappings(fastify, req, { test_case_id: req.params.testCaseId }, "feedback.view");
    return service.getDefectsForTestCase(req.params.testCaseId);
  });

  fastify.put("/test-case-defects/replace", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      test_case_id: { required: true, type: "string" },
      issue_ids: { required: true, type: "array", items: "string", maxItems: 1000 }
    }, req.body);

    await authorizeMappings(fastify, req, req.body, "feedback.manage");
    return service.replaceMappingsForTestCase(req.body.test_case_id, req.body.issue_ids);
  });
};
