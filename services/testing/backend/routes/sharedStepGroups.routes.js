const service = require("../services/sharedStepGroup.service");
const metricsService = require("../services/sharedStepMetrics.service");
const appTypeService = require("@hellotest/platform/backend/public/applicationAccess");
const projectService = require("@hellotest/platform/backend/public/projectAccess");
const { containsMobileStepPayload, isMobileAppType } = require("@hellotest/platform/backend/src/utils/mobileFeature");

const withVisibleUsage = async (fastify, req, groups, projectId) => {
  let visibleGroups = groups;
  try { await fastify.requirePermission("testcase.view", { projectId })(req); }
  catch (error) {
    if (error?.statusCode !== 403) throw error;
    visibleGroups = visibleGroups.map(group => {
      const { usage_count, used_test_cases, ...metadata } = group;
      return metadata;
    });
  }
  try { await fastify.requirePermission("data.view", { projectId })(req); }
  catch (error) {
    if (error?.statusCode !== 403) throw error;
    visibleGroups = visibleGroups.map(({ test_data_set, ...metadata }) => metadata);
  }
  return visibleGroups;
};

const requireDataLinkPermission = async (fastify, req, projectId) => {
  if (req.body.test_data_set_id !== undefined || req.body.test_data_row_index !== undefined) {
    await fastify.requirePermission("data.view", { projectId })(req);
  }
};

const ensureSharedStepGroupPermission = async (fastify, req, permissionCode, appTypeId = null) => {
  const group = appTypeId ? null : await service.getSharedStepGroup(req.params.id);
  const appType = await appTypeService.getAppType(appTypeId || group.app_type_id);
  await projectService.getProject(appType.project_id, req.user.id);
  await fastify.requirePermission(permissionCode, { projectId: appType.project_id })(req);
  return permissionCode === "shared_step.view"
    ? (await withVisibleUsage(fastify, req, [group], appType.project_id))[0]
    : group;
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
      parameter_values: { required: false, type: "object" },
      test_data_set_id: { required: false, type: "string" },
      test_data_row_index: { required: false, type: "number" }
    }, req.body);

    const appType = await appTypeService.getAppType(req.body.app_type_id);
    await projectService.getProject(appType.project_id, req.user.id);
    await fastify.requirePermission("shared_step.manage", { projectId: appType.project_id })(req);
    await requireDataLinkPermission(fastify, req, appType.project_id);
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

    return withVisibleUsage(fastify, req, await service.listSharedStepGroups({ ...req.query, project_id: scopedProjectId }), scopedProjectId);
  });

  fastify.get("/shared-step-groups/metrics", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({ app_type_id: { required: true, type: "string" } }, req.query || {});
    const app = await appTypeService.getAppType(req.query.app_type_id);
    await projectService.getProject(app.project_id, req.user.id);
    for (const permission of ["shared_step.view", "testcase.view"]) {
      await fastify.requirePermission(permission, { projectId: app.project_id })(req);
    }
    let includeExecution = true;
    try {
      for (const permission of ["run.view", "result.view"]) await fastify.requirePermission(permission, { projectId: app.project_id })(req);
    } catch (error) { if (error?.statusCode !== 403) throw error; includeExecution = false; }
    let includeDefects = includeExecution;
    if (includeDefects) {
      try { await fastify.requirePermission("feedback.view", { projectId: app.project_id })(req); }
      catch (error) { if (error?.statusCode !== 403) throw error; includeDefects = false; }
    }
    return metricsService.getSharedStepMetrics({ app_type_id: app.id, project_id: app.project_id, include_execution: includeExecution, include_defects: includeDefects });
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
      parameter_values: { required: false, type: "object" },
      test_data_set_id: { required: false, type: "string" },
      test_data_row_index: { required: false, type: "number" }
    }, req.body);

    const existing = await service.getSharedStepGroup(req.params.id);
    await ensureSharedStepGroupPermission(fastify, req, "shared_step.manage", existing.app_type_id);
    const existingAppType = await appTypeService.getAppType(existing.app_type_id);
    await requireDataLinkPermission(fastify, req, existingAppType.project_id);
    await requireMobileGroupWrite(fastify, req, existingAppType.project_id, existingAppType, [existing.steps, req.body.steps]);
    if (req.body.app_type_id && req.body.app_type_id !== existing.app_type_id) {
      await ensureSharedStepGroupPermission(fastify, req, "shared_step.manage", req.body.app_type_id);
      const targetAppType = await appTypeService.getAppType(req.body.app_type_id);
      if (existing.test_data_set_id || req.body.test_data_set_id) {
        await fastify.requirePermission("data.view", { projectId: targetAppType.project_id })(req);
      }
      await requireMobileGroupWrite(fastify, req, targetAppType.project_id, targetAppType, req.body.steps);
    }

    const updated = await service.updateSharedStepGroup(req.params.id, {
      ...req.body,
      updated_by: req.user.id
    });
    return (await withVisibleUsage(fastify, req, [updated], existingAppType.project_id))[0];
  });

  fastify.delete("/shared-step-groups/:id", async (req) => {
    await fastify.authenticate(req);

    await ensureSharedStepGroupPermission(fastify, req, "shared_step.manage");

    return service.deleteSharedStepGroup(req.params.id);
  });
};
