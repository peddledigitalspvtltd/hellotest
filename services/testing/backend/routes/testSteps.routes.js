const service = require("../services/testStep.service");
const sharedStepGroupService = require("../services/sharedStepGroup.service");
const mobileFeatureService = require("@hellotest/platform/backend/services/mobileFeature.service");
const { TEST_STEP_GROUP_KIND_VALUES, TEST_STEP_TYPE_VALUES } = require("@hellotest/platform/backend/src/domain/catalog");
const { resolveEntityScope } = require("@hellotest/platform/backend/services/entityScope.service");
const { containsMobileStepPayload } = require("@hellotest/platform/backend/src/utils/mobileFeature");

const requireCasePermission = async (fastify, req, permissionCode, testCaseId) => {
  const scope = await resolveEntityScope({ entityType: "test_case", entityId: testCaseId });
  await fastify.requirePermission(permissionCode, { projectId: scope.projectId })(req);
  return scope;
};

const requireStepPermission = async (fastify, req, permissionCode, stepId) => {
  const step = await service.getTestStep(stepId);
  const scope = await requireCasePermission(fastify, req, permissionCode, step.test_case_id);
  return { step, scope };
};

const requireMobileStepWrite = async (fastify, req, scope, payload, existing = null) => {
  const usesMobile = containsMobileStepPayload(payload)
    || containsMobileStepPayload(existing)
    || await mobileFeatureService.testCaseUsesMobile(scope.entityId);

  if (usesMobile) {
    await fastify.requirePermission("mobile.manage", { projectId: scope.projectId })(req);
  }
};

module.exports = async function (fastify) {
  fastify.post("/test-steps/bulk", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      test_case_id: { required: true, type: "string" },
      insertion_index: { required: true, type: "number" },
      steps: { required: true, type: "array" }
    }, req.body || {});
    const scope = await requireCasePermission(fastify, req, "step.manage", req.body.test_case_id);
    await requireMobileStepWrite(fastify, req, scope, req.body.steps);
    return service.createTestSteps(req.body);
  });

  fastify.post("/test-steps/bulk-delete", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      test_case_id: { required: true, type: "string" },
      step_ids: { required: true, type: "array", items: "string" }
    }, req.body || {});
    await requireCasePermission(fastify, req, "step.manage", req.body.test_case_id);
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

    const scope = await requireCasePermission(fastify, req, "step.manage", req.body.test_case_id);
    await requireMobileStepWrite(fastify, req, scope, req.body);

    return service.createTestStep(req.body);
  });

  fastify.get("/test-steps", async (req) => {
    await fastify.authenticate(req);
    const { test_case_id } = req.query;
    if (test_case_id) {
      await requireCasePermission(fastify, req, "testcase.view", test_case_id);
    } else if (req.user.role !== "admin") {
      const error = new Error("test_case_id is required when listing Test Steps");
      error.statusCode = 400;
      throw error;
    }
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
    const { step } = await requireStepPermission(fastify, req, "testcase.view", req.params.id);
    return step;
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

    const { step, scope } = await requireStepPermission(fastify, req, "step.manage", req.params.id);
    await requireMobileStepWrite(fastify, req, scope, req.body, step);
    if (req.body.test_case_id && req.body.test_case_id !== step.test_case_id) {
      const targetScope = await requireCasePermission(fastify, req, "step.manage", req.body.test_case_id);
      await requireMobileStepWrite(fastify, req, targetScope, req.body, step);
    }

    return service.updateTestStep(req.params.id, req.body);
  });

  fastify.post("/test-steps/move-automation", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      source_step_id: { required: true, type: "string" },
      target_step_id: { required: true, type: "string" }
    }, req.body);

    const source = await requireStepPermission(fastify, req, "step.manage", req.body.source_step_id);
    const target = await requireStepPermission(fastify, req, "step.manage", req.body.target_step_id);
    await requireMobileStepWrite(fastify, req, source.scope, source.step);
    if (target.scope.projectId !== source.scope.projectId) {
      await requireMobileStepWrite(fastify, req, target.scope, target.step);
    }

    return service.moveTestStepAutomation(req.body);
  });

  fastify.post("/test-steps/duplicate", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      test_case_id: { required: true, type: "string" },
      step_ids: { required: true, type: "array", items: "string" },
      insert_after_step_id: { required: false, type: "string" }
    }, req.body);

    const scope = await requireCasePermission(fastify, req, "step.manage", req.body.test_case_id);
    const selectedSteps = await Promise.all(req.body.step_ids.map((stepId) => service.getTestStep(stepId)));
    await requireMobileStepWrite(fastify, req, scope, selectedSteps);

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

    await requireCasePermission(fastify, req, "step.manage", req.body.test_case_id);

    return service.groupTestSteps(req.body);
  });

  fastify.post("/test-steps/ungroup", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      test_case_id: { required: true, type: "string" },
      group_id: { required: true, type: "string" }
    }, req.body);

    await requireCasePermission(fastify, req, "step.manage", req.body.test_case_id);

    return service.ungroupTestSteps(req.body);
  });

  fastify.post("/test-steps/insert-shared-group", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      test_case_id: { required: true, type: "string" },
      shared_step_group_id: { required: true, type: "string" },
      insert_after_step_id: { required: false, type: "string" }
    }, req.body);

    const caseScope = await requireCasePermission(fastify, req, "step.manage", req.body.test_case_id);
    const groupScope = await resolveEntityScope({ entityType: "shared_step_group", entityId: req.body.shared_step_group_id });
    await fastify.requirePermission("shared_step.view", { projectId: groupScope.projectId })(req);
    if (groupScope.projectId !== caseScope.projectId) {
      const error = new Error("Shared Step Group must belong to the Test Case project");
      error.statusCode = 403;
      throw error;
    }
    const sharedGroup = await sharedStepGroupService.getSharedStepGroup(req.body.shared_step_group_id);
    await requireMobileStepWrite(fastify, req, caseScope, sharedGroup.steps);

    return service.insertSharedStepGroup(req.body);
  });

  fastify.put("/test-cases/:id/test-steps/reorder", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      step_ids: { required: true, type: "array", items: "string" }
    }, req.body);

    await requireCasePermission(fastify, req, "step.manage", req.params.id);

    return service.reorderTestSteps(req.params.id, req.body.step_ids);
  });

  fastify.put("/test-steps/reorder", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      test_case_id: { required: true, type: "string" },
      step_ids: { required: true, type: "array", items: "string" }
    }, req.body);

    await requireCasePermission(fastify, req, "step.manage", req.body.test_case_id);

    return service.reorderTestSteps(req.body.test_case_id, req.body.step_ids);
  });

  fastify.delete("/test-steps/:id", async (req) => {
    await fastify.authenticate(req);
    await requireStepPermission(fastify, req, "step.manage", req.params.id);
    return service.deleteTestStep(req.params.id);
  });
};
