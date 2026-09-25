const service = require("../services/testSuite.service");
const appTypeService = require("@hellotest/platform/backend/public/applicationAccess");
const projectService = require("@hellotest/platform/backend/public/projectAccess");

const ensureSuitePermission = async (fastify, req, permissionCode) => {
  const suite = await service.getTestSuite(req.params.id);
  const appType = await appTypeService.getAppType(suite.app_type_id);
  await projectService.getProject(appType.project_id, req.user.id);
  await fastify.requirePermission(permissionCode, { projectId: appType.project_id })(req);
  return suite;
};

const ensureSuiteCaseAssignmentPermission = async (fastify, req, suite, testCaseIds = []) => {
  if (!Array.isArray(req.body?.test_case_ids)) return;
  const appType = await appTypeService.getAppType(suite.app_type_id);
  await fastify.requirePermission("testcase.update", { projectId: appType.project_id })(req);
};

module.exports = async function (fastify) {
  fastify.post("/test-suites", async (req) => {
    await fastify.authenticate(req);
    
    fastify.validate({
      app_type_id: { required: true, type: "string" },
      name: { required: true, type: "string", minLength: 2 },
      parent_id: { required: false, type: "string" },
      labels: { required: false, type: "array", items: "string" },
      parameter_values: { required: false, type: "object" },
      description: { required: false, type: "string" },
      test_data_set_id: { required: false, type: "string" },
      test_data_options: { required: false, type: "object" },
      test_case_ids: { required: false, type: "array", items: "string", maxItems: 5000 },
      parallel_enabled: { required: false, type: "boolean" },
      parallel_count: { required: false, type: "number" },
      expected_revision: { required: false, type: "number" }
    }, req.body);

    // Verify user has access to the app type's project
    const appType = await appTypeService.getAppType(req.body.app_type_id);
    await projectService.getProject(appType.project_id, req.user.id);
    await fastify.requirePermission("suite.create", { projectId: appType.project_id })(req);

    if (req.body.test_data_set_id) await fastify.requirePermission("data.view", { projectId: appType.project_id })(req);
    if (req.body.test_case_ids?.length) await fastify.requirePermission("testcase.update", { projectId: appType.project_id })(req);

    return service.createTestSuite({
      ...req.body,
      created_by: req.user.id
    });
  });

  fastify.get("/test-suites", async (req) => {
    await fastify.authenticate(req);
    const { app_type_id, project_id, parent_id } = req.query;
    let scopedProjectId = project_id || null;

    if (app_type_id) {
      const appType = await appTypeService.getAppType(app_type_id);
      scopedProjectId = appType.project_id;
    }

    if (scopedProjectId) {
      await projectService.getProject(scopedProjectId, req.user.id);
      await fastify.requirePermission("suite.view", { projectId: scopedProjectId })(req);
    } else if (req.user.role !== "admin") {
      const error = new Error("project_id or app_type_id is required when listing Test Suites");
      error.statusCode = 400;
      throw error;
    }

    const { case_search, module_id, requirement_id, label, shared_step_group_id, projection } = req.query;
    if (case_search || module_id || requirement_id || label || shared_step_group_id) {
      await fastify.requirePermission("testcase.view", { projectId: scopedProjectId })(req);
    }
    return service.getTestSuites({ project_id: scopedProjectId, app_type_id, parent_id, case_search, module_id, requirement_id, label, shared_step_group_id, projection });
  });

  fastify.get("/test-suites/:id", async (req) => {
    await fastify.authenticate(req);
    return ensureSuitePermission(fastify, req, "suite.view");
  });

  fastify.put("/test-suites/:id", async (req) => {
    await fastify.authenticate(req);
    
    fastify.validate({
      name: { required: false, type: "string", minLength: 2 },
      parent_id: { required: false, type: "string" },
      labels: { required: false, type: "array", items: "string" },
      parameter_values: { required: false, type: "object" },
      description: { required: false, type: "string" },
      test_data_set_id: { required: false, type: "string" },
      test_data_options: { required: false, type: "object" },
      test_case_ids: { required: false, type: "array", items: "string", maxItems: 5000 },
      parallel_enabled: { required: false, type: "boolean" },
      parallel_count: { required: false, type: "number" }
    }, req.body);

    const suite = await ensureSuitePermission(fastify, req, "suite.update");
    await ensureSuiteCaseAssignmentPermission(fastify, req, suite, req.body.test_case_ids);

    if (req.body.test_data_set_id) {
      const app = await appTypeService.getAppType(suite.app_type_id);
      await fastify.requirePermission("data.view", { projectId: app.project_id })(req);
    }

    return service.updateTestSuite(req.params.id, {
      ...req.body,
      updated_by: req.user.id
    });
  });

  fastify.post("/test-suites/:id/assign-test-cases", async (req) => {
    await fastify.authenticate(req);
    
    fastify.validate({
      test_case_ids: { required: true, type: "array", items: "string" },
      expected_revision: { required: false, type: "number" },
      append: { required: false, type: "boolean" }
    }, req.body);

    const suite = await ensureSuitePermission(fastify, req, "suite.update");
    await ensureSuiteCaseAssignmentPermission(fastify, req, suite, req.body.test_case_ids);

    return service.assignTestCases(req.params.id, req.body.test_case_ids, {
      append: req.body.append !== false,
      expectedRevision: req.body.expected_revision
    });
  });

  fastify.put("/test-suites/:id/assign-test-cases", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      test_case_ids: { required: true, type: "array", items: "string" },
      expected_revision: { required: false, type: "number" },
      append: { required: false, type: "boolean" }
    }, req.body || {});
    const suite = await ensureSuitePermission(fastify, req, "suite.update");
    await ensureSuiteCaseAssignmentPermission(fastify, req, suite, req.body.test_case_ids);
    return service.assignTestCases(req.params.id, req.body.test_case_ids, {
      append: req.body.append !== false,
      expectedRevision: req.body.expected_revision
    });
  });

  fastify.delete("/test-suites/:id", async (req) => {
    await fastify.authenticate(req);
    await ensureSuitePermission(fastify, req, "suite.delete");
    return service.deleteTestSuite(req.params.id);
  });
};
