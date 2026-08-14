const service = require("../services/suiteTestCase.service");

module.exports = async function (fastify) {
  fastify.get("/suite-test-cases", async (req) => {
    const { suite_id, test_case_id } = req.query;
    return service.listMappings({ suite_id, test_case_id });
  });

  fastify.put("/suite-test-cases/reorder", async (req) => {
    fastify.validate({
      suite_id: { required: true, type: "string" },
      test_case_ids: { required: true, type: "array", items: "string" },
      expected_revision: { required: false, type: "number" }
    }, req.body);

    return service.reorderMappingsForSuite(req.body.suite_id, req.body.test_case_ids, {
      expectedRevision: req.body.expected_revision
    });
  });
};
