const service = require("../services/requirementTestCase.service");
const scopes = require("../services/testCaseScope.service");

const error = (message, statusCode) => Object.assign(new Error(message), { statusCode });

const resolveMappingProject = async ({ requirement_id, test_case_id }) => {
  const requirement = requirement_id ? await scopes.getRequirementScope(requirement_id) : null;
  if (requirement_id && !requirement) throw error("Story not found", 404);
  const testCase = test_case_id ? (await scopes.resolveTestCaseScopes([test_case_id]))[0] : null;
  if (test_case_id && !testCase) throw error("Test Case not found", 404);
  if (testCase && testCase.project_ids.length !== 1) {
    throw error("The Test Case does not have a single project scope", 409);
  }
  if (requirement && testCase && requirement.project_id !== testCase.project_ids[0]) {
    throw error("Story and Test Case must belong to the same project", 403);
  }
  return requirement?.project_id || testCase?.project_ids[0] || null;
};

const authorizeMapping = async (fastify, req, projectId, permission) => {
  await fastify.requirePermission("requirement.view", { projectId })(req);
  await fastify.requirePermission(permission, { projectId })(req);
};

module.exports = async function (fastify) {
  fastify.get("/requirement-test-cases", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      requirement_id: { required: false, type: "string", minLength: 1 },
      test_case_id: { required: false, type: "string", minLength: 1 }
    }, req.query || {});
    const { requirement_id, test_case_id } = req.query;
    const projectId = await resolveMappingProject({ requirement_id, test_case_id });
    if (!projectId && req.user.role !== "admin") {
      throw error("requirement_id or test_case_id is required when listing traceability mappings", 400);
    }
    await authorizeMapping(fastify, req, projectId, "testcase.view");
    return service.listMappings({ requirement_id, test_case_id });
  });

  fastify.put("/requirement-test-cases/replace", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      requirement_id: { required: true, type: "string" },
      test_case_ids: { required: true, type: "array", items: "string", maxItems: 1000 }
    }, req.body);
    const projectId = await resolveMappingProject({ requirement_id: req.body.requirement_id });
    await authorizeMapping(fastify, req, projectId, "testcase.update");
    return service.replaceMappingsForRequirement(req.body.requirement_id, req.body.test_case_ids);
  });
};
