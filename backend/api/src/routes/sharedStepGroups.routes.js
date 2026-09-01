const service = require("../services/sharedStepGroup.service");
const appTypeService = require("../services/appType.service");
const projectService = require("../services/project.service");
const { containsMobileStepPayload, isMobileAppType } = require("../utils/mobileFeature");

const ensureSharedStepGroupPermission = async (fastify, req, permissionCode, appTypeId = null) => {
  const group = appTypeId ? null : await service.getSharedStepGroup(req.params.id);
  const appType = await appTypeService.getAppType(appTypeId || group.app_type_id);
  await projectService.getProject(appType.project_id, req.user.id);
  await fastify.requirePermission(permissionCode, { projectId: appType.project_id })(req);
  return group;
};

const requireMobileGroupWrite = async (fastify, req, projectId, appType, payload) => {
  if (isMobileAppType(appType?.type) || containsMobileStepPayload(payload)) {
    await fastify.requirePermission("mobile.manage", { projectId })(req);
  }
};

module.exports = async function (fastify) {
  fastify.post("/shared-step-groups", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      app_type_id: { required: true, type: "string" },
      name: { required: true, type: "string", minLength: 2 },
      description: { required: false, type: "string" },
      authoring_mode: { required: false, type: "string" },
      gherkin_document: { required: false, type: "string" },
      steps: { required: false, type: "array" },
      parameter_values: { required: false, type: "object" }
    }, req.body);

    const appType = await appTypeService.getAppType(req.body.app_type_id);
    await projectService.getProject(appType.project_id, req.user.id);
    await fastify.requirePermission("shared_step.manage", { projectId: appType.project_id })(req);
    await requireMobileGroupWrite(fastify, req, appType.project_id, appType, req.body.steps);

    return service.createSharedStepGroup({
      ...req.body,
      created_by: req.user.id
    });
  });

  fastify.get("/shared-step-groups", async (req) => {
    await fastify.authenticate(req);

    let scopedProjectId = req.query.project_id || null;
    if (req.query.app_type_id) {
      const appType = await appTypeService.getAppType(req.query.app_type_id);
      scopedProjectId = appType.project_id;
    }

    if (scopedProjectId) {
      await projectService.getProject(scopedProjectId, req.user.id);
      await fastify.requirePermission("shared_step.view", { projectId: scopedProjectId })(req);
    } else if (req.user.role !== "admin") {
      const error = new Error("project_id or app_type_id is required when listing Shared Step Groups");
      error.statusCode = 400;
      throw error;
    }

    return service.listSharedStepGroups({ ...req.query, project_id: scopedProjectId });
  });

  fastify.get("/shared-step-groups/:id", async (req) => {
    await fastify.authenticate(req);

    return ensureSharedStepGroupPermission(fastify, req, "shared_step.view");
  });

  fastify.put("/shared-step-groups/:id", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      app_type_id: { required: false, type: "string" },
      name: { required: false, type: "string", minLength: 2 },
      description: { required: false, type: "string" },
      authoring_mode: { required: false, type: "string" },
      gherkin_document: { required: false, type: "string" },
      steps: { required: false, type: "array" },
      parameter_values: { required: false, type: "object" }
    }, req.body);

    const existing = await service.getSharedStepGroup(req.params.id);
    await ensureSharedStepGroupPermission(fastify, req, "shared_step.manage", existing.app_type_id);
    const existingAppType = await appTypeService.getAppType(existing.app_type_id);
    await requireMobileGroupWrite(fastify, req, existingAppType.project_id, existingAppType, [existing.steps, req.body.steps]);
    if (req.body.app_type_id && req.body.app_type_id !== existing.app_type_id) {
      await ensureSharedStepGroupPermission(fastify, req, "shared_step.manage", req.body.app_type_id);
      const targetAppType = await appTypeService.getAppType(req.body.app_type_id);
      await requireMobileGroupWrite(fastify, req, targetAppType.project_id, targetAppType, req.body.steps);
    }

    return service.updateSharedStepGroup(req.params.id, {
      ...req.body,
      updated_by: req.user.id
    });
  });

  fastify.delete("/shared-step-groups/:id", async (req) => {
    await fastify.authenticate(req);

    await ensureSharedStepGroupPermission(fastify, req, "shared_step.manage");

    return service.deleteSharedStepGroup(req.params.id);
  });
};
