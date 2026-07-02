const service = require("../services/testCaseModule.service");
const appTypeService = require("../services/appType.service");
const projectService = require("../services/project.service");

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

module.exports = async function (fastify) {
  fastify.get("/test-case-modules", async (req) => {
    await fastify.authenticate(req);
    const { app_type_id } = req.query;

    if (app_type_id) {
      await ensureAppTypeAccess(app_type_id, req.user.id);
    }

    return service.listModules({ app_type_id });
  });

  fastify.post("/test-case-modules", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      app_type_id: { required: true, type: "string" },
      name: { required: true, type: "string", minLength: 2 },
      description: { required: false, type: "string" },
      test_case_ids: { required: false, type: "array", items: "string" }
    }, req.body || {});

    await ensureAppTypeAccess(req.body.app_type_id, req.user.id);

    return service.createModule({
      ...req.body,
      created_by: req.user.id
    });
  });

  fastify.get("/test-case-modules/:id", async (req) => {
    await fastify.authenticate(req);
    return ensureModuleAccess(req.params.id, req.user.id);
  });

  fastify.get("/test-case-modules/:id/test-cases", async (req) => {
    await fastify.authenticate(req);
    await ensureModuleAccess(req.params.id, req.user.id);
    return service.getModuleCases(req.params.id);
  });

  fastify.put("/test-case-modules/:id", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      name: { required: false, type: "string", minLength: 2 },
      description: { required: false, type: "string" },
      test_case_ids: { required: false, type: "array", items: "string" }
    }, req.body || {});

    await ensureModuleAccess(req.params.id, req.user.id);

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

    await ensureModuleAccess(req.params.id, req.user.id);

    return service.assignCases(req.params.id, req.body.test_case_ids, {
      append: req.body.append !== false
    });
  });

  fastify.delete("/test-case-modules/:id/test-cases", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      test_case_ids: { required: true, type: "array", items: "string" }
    }, req.body || {});

    await ensureModuleAccess(req.params.id, req.user.id);

    return service.removeCases(req.params.id, req.body.test_case_ids);
  });

  fastify.delete("/test-case-modules/:id", async (req) => {
    await fastify.authenticate(req);
    await ensureModuleAccess(req.params.id, req.user.id);
    return service.deleteModule(req.params.id);
  });
};
