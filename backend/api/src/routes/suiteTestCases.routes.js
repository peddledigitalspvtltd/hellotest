const service = require("../services/suiteTestCase.service");
const { resolveEntityScope } = require("../services/entityScope.service");

const requireScopedPermission = async (fastify, req, permissionCode, entityType, entityId) => {
  const scope = await resolveEntityScope({ entityType, entityId });
  await fastify.requirePermission(permissionCode, { projectId: scope.projectId })(req);
  return scope;
};

module.exports = async function (fastify) {
  fastify.get("/suite-test-cases", async (req) => {
    const { suite_id, test_case_id } = req.query;
    const scopes = [];
    if (suite_id) scopes.push(await requireScopedPermission(fastify, req, "suite.view", "test_suite", suite_id));
    if (test_case_id) scopes.push(await requireScopedPermission(fastify, req, "suite.view", "test_case", test_case_id));
    if (!scopes.length && req.user.role !== "admin") {
      const error = new Error("suite_id or test_case_id is required when listing Test Suite mappings");
      error.statusCode = 400;
      throw error;
    }
    if (scopes.some((scope) => scope.projectId !== scopes[0].projectId)) {
      const error = new Error("Test Suite mappings must belong to the same project");
      error.statusCode = 403;
      throw error;
    }
    return service.listMappings({ suite_id, test_case_id });
  });

  fastify.put("/suite-test-cases/reorder", async (req) => {
    fastify.validate({
      suite_id: { required: true, type: "string" },
      test_case_ids: { required: true, type: "array", items: "string" },
      expected_revision: { required: false, type: "number" }
    }, req.body);

    await requireScopedPermission(fastify, req, "suite.update", "test_suite", req.body.suite_id);

    return service.reorderMappingsForSuite(req.body.suite_id, req.body.test_case_ids, {
      expectedRevision: req.body.expected_revision
    });
  });
};
