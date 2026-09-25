const service = require("../services/testDataSet.service");
const appTypeService = require("@hellotest/platform/backend/public/applicationAccess");
const projectService = require("@hellotest/platform/backend/public/projectAccess");
const aiTestDataGenerationService = require("@hellotest/ai/backend/services/aiTestDataGeneration.service");
const { TEST_DATA_SET_MODE_VALUES } = require("@hellotest/platform/backend/src/domain/catalog");

module.exports = async function (fastify) {
  fastify.post("/test-data-sets/ai-generate-preview", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      project_id: { required: true, type: "string" },
      app_type_id: { required: false, type: "string" },
      prompt: { required: true, type: "string", minLength: 3, maxLength: 2000 },
      field_context: { required: false, type: "string" },
      sample_count: { required: false, type: "number" },
      prompt_instruction: { required: false, type: "string" },
      integration_id: { required: false, type: "string", maxLength: 255 },
      additional_context: { required: false, type: "string", maxLength: 12000 }
    }, req.body || {});
    await projectService.getProject(req.body.project_id, req.user.id);
    await fastify.requirePermission("data.manage", { projectId: req.body.project_id })(req);
    await fastify.requirePermission("data.ai", { projectId: req.body.project_id })(req);
    if (req.body.app_type_id) {
      const appType = await appTypeService.getAppType(req.body.app_type_id);
      if (appType.project_id !== req.body.project_id) throw Object.assign(new Error("App type must belong to the selected project"), { statusCode: 403 });
    }
    return aiTestDataGenerationService.preview({
      projectId: req.body.project_id,
      appTypeId: req.body.app_type_id,
      prompt: req.body.prompt,
      fieldContext: req.body.field_context,
      sampleCount: req.body.sample_count,
      promptInstruction: req.body.prompt_instruction,
      integrationId: req.body.integration_id,
      additionalContext: req.body.additional_context,
      userId: req.user.id
    });
  });

  fastify.post("/test-data-sets", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      project_id: { required: true, type: "string" },
      app_type_id: { required: false, type: "string" },
      name: { required: true, type: "string", minLength: 2 },
      description: { required: false, type: "string" },
      mode: { required: true, enum: TEST_DATA_SET_MODE_VALUES },
      columns: { required: false, type: "array" },
      rows: { required: false, type: "array" }
    }, req.body);

    await projectService.getProject(req.body.project_id, req.user.id);

    if (req.body.app_type_id) {
      const appType = await appTypeService.getAppType(req.body.app_type_id);

      if (appType.project_id !== req.body.project_id) {
        throw new Error("App type must belong to the selected project");
      }
    }

    return service.createTestDataSet(req.body);
  });

  fastify.get("/test-data-sets", async (req) => {
    await fastify.authenticate(req);
    const { project_id, app_type_id } = req.query;
    let scopedProjectId = project_id || null;

    if (project_id) {
      await projectService.getProject(project_id, req.user.id);
    } else if (app_type_id) {
      const appType = await appTypeService.getAppType(app_type_id);
      await projectService.getProject(appType.project_id, req.user.id);
      scopedProjectId = appType.project_id;
    } else if (req.user.role !== "admin") {
      const error = new Error("project_id or app_type_id is required when listing Test Data Sets");
      error.statusCode = 400;
      throw error;
    }

    if (scopedProjectId) await fastify.requirePermission("data.view", { projectId: scopedProjectId })(req);

    return service.getTestDataSets({ project_id: scopedProjectId, app_type_id });
  });

  fastify.get("/test-data-sets/:id", async (req) => {
    await fastify.authenticate(req);
    const dataSet = await service.getTestDataSet(req.params.id);
    await projectService.getProject(dataSet.project_id, req.user.id);
    await fastify.requirePermission("data.view", { projectId: dataSet.project_id })(req);
    return dataSet;
  });

  fastify.put("/test-data-sets/:id", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      project_id: { required: false, type: "string" },
      app_type_id: { required: false, type: "string" },
      name: { required: false, type: "string", minLength: 2 },
      description: { required: false, type: "string" },
      mode: { required: false, enum: TEST_DATA_SET_MODE_VALUES },
      columns: { required: false, type: "array" },
      rows: { required: false, type: "array" }
    }, req.body);

    const dataSet = await service.getTestDataSet(req.params.id);
    await projectService.getProject(dataSet.project_id, req.user.id);
    await fastify.requirePermission("data.manage", { projectId: dataSet.project_id })(req);

    const targetProjectId = req.body.project_id || dataSet.project_id;
    if (targetProjectId !== dataSet.project_id) {
      await projectService.getProject(targetProjectId, req.user.id);
      await fastify.requirePermission("data.manage", { projectId: targetProjectId })(req);
    }

    const effectiveAppTypeId = Object.prototype.hasOwnProperty.call(req.body, "app_type_id")
      ? req.body.app_type_id
      : dataSet.app_type_id;
    if (effectiveAppTypeId) {
      const appType = await appTypeService.getAppType(effectiveAppTypeId);
      if (appType.project_id !== targetProjectId) {
        const error = new Error("App type must belong to the target project");
        error.statusCode = 400;
        throw error;
      }
    }

    return service.updateTestDataSet(req.params.id, req.body);
  });

  fastify.delete("/test-data-sets/:id", async (req) => {
    await fastify.authenticate(req);
    const dataSet = await service.getTestDataSet(req.params.id);
    await projectService.getProject(dataSet.project_id, req.user.id);
    await fastify.requirePermission("data.manage", { projectId: dataSet.project_id })(req);
    return service.deleteTestDataSet(req.params.id);
  });
};
