const service = require("../services/testCaseModule.service");
const appTypeService = require("../services/appType.service");
const projectService = require("../services/project.service");
const { paginate } = require("../utils/pagination");

const ensureAppTypeAccess = async (appTypeId, userId) => {
  if (!appTypeId) {
    return null;
  }

  const appType = await appTypeService.getAppType(appTypeId);
  await projectService.getProject(appType.project_id, userId);
  return appType;
};

const ensureModuleAccess = async (moduleId, userId) => {
  const module = await service.getModule(moduleId);
  await ensureAppTypeAccess(module.app_type_id, userId);
  return module;
};

const ensureModulePermission = async (fastify, req, permissionCode) => {
  const module = await ensureModuleAccess(req.params.id, req.user.id);
  const appType = await appTypeService.getAppType(module.app_type_id);
  await fastify.requirePermission(permissionCode, { projectId: appType.project_id })(req);
  return module;
};

module.exports = async function (fastify) {
  fastify.get("/test-case-modules", async (req) => {
    await fastify.authenticate(req);
    const { app_type_id, project_id } = req.query;
    let scopedProjectId = project_id || null;

    if (app_type_id) {
      const appType = await ensureAppTypeAccess(app_type_id, req.user.id);
      scopedProjectId = appType.project_id;
    }

    if (scopedProjectId) {
      await projectService.getProject(scopedProjectId, req.user.id);
      await fastify.requirePermission("testcase.view", { projectId: scopedProjectId })(req);
    } else if (req.user.role !== "admin") {
      const error = new Error("project_id or app_type_id is required when listing Test Case Modules");
      error.statusCode = 400;
      throw error;
    }

    return service.listModules({ app_type_id, project_id: scopedProjectId });
  });

  fastify.post("/test-case-modules", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      app_type_id: { required: true, type: "string" },
      name: { required: true, type: "string", minLength: 2 },
      description: { required: false, type: "string" },
      test_case_ids: { required: false, type: "array", items: "string" },
      requirement_ids: { required: false, type: "array", items: "string" }
    }, req.body || {});

    const appType = await ensureAppTypeAccess(req.body.app_type_id, req.user.id);
    await fastify.requirePermission("testcase.create", { projectId: appType.project_id })(req);
    if (req.body.test_case_ids?.length || req.body.requirement_ids?.length) {
      await fastify.requirePermission("testcase.update", { projectId: appType.project_id })(req);
    }
    if (req.body.requirement_ids?.length) {
      await fastify.requirePermission("requirement.view", { projectId: appType.project_id })(req);
    }

    return service.createModule({
      ...req.body,
      created_by: req.user.id
    });
  });

  fastify.get("/test-case-modules/:id", async (req) => {
    await fastify.authenticate(req);
    return ensureModulePermission(fastify, req, "testcase.view");
  });

  fastify.get("/test-case-modules/:id/test-cases", async (req) => {
    await fastify.authenticate(req);
    await ensureModulePermission(fastify, req, "testcase.view");
    return paginate(await service.getModuleCases(req.params.id), req.query);
  });

  fastify.put("/test-case-modules/:id", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      name: { required: false, type: "string", minLength: 2 },
      description: { required: false, type: "string" },
      test_case_ids: { required: false, type: "array", items: "string" },
      requirement_ids: { required: false, type: "array", items: "string" }
    }, req.body || {});

    const module = await ensureModulePermission(fastify, req, "testcase.update");
    const appType = await appTypeService.getAppType(module.app_type_id);
    if (req.body.requirement_ids?.length) {
      await fastify.requirePermission("requirement.view", { projectId: appType.project_id })(req);
    }

    return service.updateModule(req.params.id, {
      ...req.body,
      updated_by: req.user.id
    });
  });

  fastify.post("/test-case-modules/:id/test-cases", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      test_case_ids: { required: true, type: "array", items: "string" },
      append: { required: false, type: "boolean" }
    }, req.body || {});

    await ensureModulePermission(fastify, req, "testcase.update");

    return service.assignCases(req.params.id, req.body.test_case_ids, {
      append: req.body.append !== false
    });
  });

  fastify.put("/test-case-modules/:id/test-cases", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      test_case_ids: { required: true, type: "array", items: "string" },
      append: { required: false, type: "boolean" }
    }, req.body || {});
    await ensureModulePermission(fastify, req, "testcase.update");
    return service.assignCases(req.params.id, req.body.test_case_ids, {
      append: req.body.append !== false
    });
  });

  fastify.delete("/test-case-modules/:id/test-cases", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      test_case_ids: { required: true, type: "array", items: "string" }
    }, req.body || {});

    await ensureModulePermission(fastify, req, "testcase.update");

    return service.removeCases(req.params.id, req.body.test_case_ids);
  });

  fastify.delete("/test-case-modules/:id", async (req) => {
    await fastify.authenticate(req);
    await ensureModulePermission(fastify, req, "testcase.delete");
    return service.deleteModule(req.params.id);
  });
};
