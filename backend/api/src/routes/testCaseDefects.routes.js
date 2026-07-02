const service = require("../services/testCaseDefect.service");

module.exports = async function (fastify) {
  fastify.get("/test-case-defects", async (req) => {
    await fastify.authenticate(req);
    const { test_case_id, issue_id } = req.query;
    return service.listMappings({ test_case_id, issue_id });
  });

  fastify.get("/test-case-defects/:testCaseId/issues", async (req) => {
    await fastify.authenticate(req);
    return service.getDefectsForTestCase(req.params.testCaseId);
  });

  fastify.put("/test-case-defects/replace", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      test_case_id: { required: true, type: "string" },
      issue_ids: { required: true, type: "array", items: "string" }
    }, req.body);

    return service.replaceMappingsForTestCase(req.body.test_case_id, req.body.issue_ids);
  });
};
