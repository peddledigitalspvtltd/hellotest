const service = require("../services/testStep.service");
const { TEST_STEP_GROUP_KIND_VALUES, TEST_STEP_TYPE_VALUES } = require("../domain/catalog");
const { requireEntityPermission } = require("../services/entityScope.service");

module.exports = async function (fastify) {
  fastify.post("/test-steps/bulk", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      test_case_id: { required: true, type: "string" },
      insertion_index: { required: true, type: "number" },
      steps: { required: true, type: "array" }
    }, req.body || {});
    await requireEntityPermission({ user: req.user, permissionCode: "testcase.update", entityType: "test_case", entityId: req.body.test_case_id });
    return service.createTestSteps(req.body);
  });

  fastify.post("/test-steps/bulk-delete", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      test_case_id: { required: true, type: "string" },
      step_ids: { required: true, type: "array", items: "string" }
    }, req.body || {});
    await requireEntityPermission({ user: req.user, permissionCode: "testcase.update", entityType: "test_case", entityId: req.body.test_case_id });
    return service.deleteTestSteps(req.body);
  });

  fastify.post("/test-steps", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      test_case_id: { required: true, type: "string" },
      step_order: { required: true, type: "number" },
      action: { required: false, type: "string" },
      expected_result: { required: false, type: "string" },
      step_type: { required: false, type: "string", enum: TEST_STEP_TYPE_VALUES },
      automation_code: { required: false, type: "string" },
      api_request: { required: false, type: "object" },
      group_id: { required: false, type: "string" },
      group_name: { required: false, type: "string" },
      group_kind: { required: false, enum: TEST_STEP_GROUP_KIND_VALUES },
      reusable_group_id: { required: false, type: "string" }
    }, req.body);

    return service.createTestStep(req.body);
  });

  fastify.get("/test-steps", async (req) => {
    await fastify.authenticate(req);
    const { test_case_id } = req.query;
    return service.getTestSteps({ test_case_id });
  });

  fastify.post("/test-steps/run-api-request", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      api_request: { required: true, type: "object" }
    }, req.body);

    return service.runApiRequestPreview(req.body.api_request);
  });

  fastify.get("/test-steps/:id", async (req) => {
    await fastify.authenticate(req);
    return service.getTestStep(req.params.id);
  });

  fastify.put("/test-steps/:id", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      test_case_id: { required: false, type: "string" },
      step_order: { required: false, type: "number" },
      action: { required: false, type: "string" },
      expected_result: { required: false, type: "string" },
      step_type: { required: false, type: "string", enum: TEST_STEP_TYPE_VALUES },
      automation_code: { required: false, type: "string" },
      api_request: { required: false, type: "object" },
      group_id: { required: false, type: "string" },
      group_name: { required: false, type: "string" },
      group_kind: { required: false, enum: TEST_STEP_GROUP_KIND_VALUES },
      reusable_group_id: { required: false, type: "string" }
    }, req.body);

    return service.updateTestStep(req.params.id, req.body);
  });

  fastify.post("/test-steps/move-automation", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      source_step_id: { required: true, type: "string" },
      target_step_id: { required: true, type: "string" }
    }, req.body);

    return service.moveTestStepAutomation(req.body);
  });

  fastify.post("/test-steps/duplicate", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      test_case_id: { required: true, type: "string" },
      step_ids: { required: true, type: "array", items: "string" },
      insert_after_step_id: { required: false, type: "string" }
    }, req.body);

    return service.duplicateTestSteps(req.body);
  });

  fastify.post("/test-steps/group", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      test_case_id: { required: true, type: "string" },
      step_ids: { required: true, type: "array", items: "string" },
      name: { required: true, type: "string", minLength: 2 },
      kind: { required: false, enum: TEST_STEP_GROUP_KIND_VALUES },
      group_id: { required: false, type: "string" },
      reusable_group_id: { required: false, type: "string" }
    }, req.body);

    return service.groupTestSteps(req.body);
  });

  fastify.post("/test-steps/ungroup", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      test_case_id: { required: true, type: "string" },
      group_id: { required: true, type: "string" }
    }, req.body);

    return service.ungroupTestSteps(req.body);
  });

  fastify.post("/test-steps/insert-shared-group", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      test_case_id: { required: true, type: "string" },
      shared_step_group_id: { required: true, type: "string" },
      insert_after_step_id: { required: false, type: "string" }
    }, req.body);

    return service.insertSharedStepGroup(req.body);
  });

  fastify.put("/test-cases/:id/test-steps/reorder", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      step_ids: { required: true, type: "array", items: "string" }
    }, req.body);

    return service.reorderTestSteps(req.params.id, req.body.step_ids);
  });

  fastify.put("/test-steps/reorder", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      test_case_id: { required: true, type: "string" },
      step_ids: { required: true, type: "array", items: "string" }
    }, req.body);

    return service.reorderTestSteps(req.body.test_case_id, req.body.step_ids);
  });

  fastify.delete("/test-steps/:id", async (req) => {
    await fastify.authenticate(req);
    return service.deleteTestStep(req.params.id);
  });
};
