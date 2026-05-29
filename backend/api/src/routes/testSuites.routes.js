const service = require("../services/testSuite.service");
const appTypeService = require("../services/appType.service");
const projectService = require("../services/project.service");

module.exports = async function (fastify) {
  fastify.post("/test-suites", async (req) => {
    await fastify.authenticate(req);
    
    fastify.validate({
      app_type_id: { required: true, type: "string" },
      name: { required: true, type: "string", minLength: 2 },
      parent_id: { required: false, type: "string" },
      parameter_values: { required: false, type: "object" },
      parallel_enabled: { required: false, type: "boolean" },
      parallel_count: { required: false, type: "number" }
    }, req.body);

    // Verify user has access to the app type's project
    const appType = await appTypeService.getAppType(req.body.app_type_id);
    await projectService.getProject(appType.project_id, req.user.id);

    return service.createTestSuite({
      ...req.body,
      created_by: req.user.id
    });
  });

  fastify.get("/test-suites", async (req) => {
    await fastify.authenticate(req);
    const { app_type_id, parent_id } = req.query;
    
    // If filtering by app_type, verify access to its project
    if (app_type_id) {
      const appType = await appTypeService.getAppType(app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);
    }
    
    return service.getTestSuites({ app_type_id, parent_id });
  });

  fastify.get("/test-suites/:id", async (req) => {
    await fastify.authenticate(req);
    const testSuite = await service.getTestSuite(req.params.id);
    const appType = await appTypeService.getAppType(testSuite.app_type_id);
    await projectService.getProject(appType.project_id, req.user.id);
    return testSuite;
  });

  fastify.put("/test-suites/:id", async (req) => {
    await fastify.authenticate(req);
    
    fastify.validate({
      name: { required: false, type: "string", minLength: 2 },
      parent_id: { required: false, type: "string" },
      parameter_values: { required: false, type: "object" },
      parallel_enabled: { required: false, type: "boolean" },
      parallel_count: { required: false, type: "number" }
    }, req.body);

    const testSuite = await service.getTestSuite(req.params.id);
    const appType = await appTypeService.getAppType(testSuite.app_type_id);
    await projectService.getProject(appType.project_id, req.user.id);

    return service.updateTestSuite(req.params.id, {
      ...req.body,
      updated_by: req.user.id
    });
  });

  fastify.post("/test-suites/:id/assign-test-cases", async (req) => {
    await fastify.authenticate(req);
    
    fastify.validate({
      test_case_ids: { required: true, type: "array", items: "string" }
    }, req.body);

    const testSuite = await service.getTestSuite(req.params.id);
    const appType = await appTypeService.getAppType(testSuite.app_type_id);
    await projectService.getProject(appType.project_id, req.user.id);

    return service.assignTestCases(req.params.id, req.body.test_case_ids);
  });

  fastify.delete("/test-suites/:id", async (req) => {
    await fastify.authenticate(req);
    const testSuite = await service.getTestSuite(req.params.id);
    const appType = await appTypeService.getAppType(testSuite.app_type_id);
    await projectService.getProject(appType.project_id, req.user.id);
    return service.deleteTestSuite(req.params.id);
  });
};
