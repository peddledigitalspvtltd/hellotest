const service = require("../services/testDataSet.service");
const appTypeService = require("../services/appType.service");
const projectService = require("../services/project.service");
const { TEST_DATA_SET_MODE_VALUES } = require("../domain/catalog");

module.exports = async function (fastify) {
  fastify.post("/test-data-sets/ai-generate-preview", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      project_id: { required: true, type: "string" },
      app_type_id: { required: false, type: "string" },
      prompt: { required: true, type: "string", minLength: 3, maxLength: 2000 },
      field_context: { required: false, type: "string" },
      sample_count: { required: false, type: "number" },
      prompt_instruction: { required: false, type: "string" }
    }, req.body || {});
    await projectService.getProject(req.body.project_id, req.user.id);
    await fastify.requirePermission("data.manage", { projectId: req.body.project_id })(req);
    await fastify.requirePermission("data.ai", { projectId: req.body.project_id })(req);
    if (req.body.app_type_id) {
      const appType = await appTypeService.getAppType(req.body.app_type_id);
      if (appType.project_id !== req.body.project_id) throw Object.assign(new Error("App type must belong to the selected project"), { statusCode: 403 });
    }
    const prompt = String(req.body.prompt).trim();
    const normalized = `${prompt} ${req.body.field_context || ""}`.toLowerCase();
    const count = Math.max(2, Math.min(12, Math.round(Number(req.body.sample_count || 6))));
    const serial = (index, width = 4) => String(index + 1).padStart(width, "0");
    let values;
    if (/email|mailbox/.test(normalized)) values = Array.from({ length: count }, (_, index) => `synthetic.user.${serial(index)}@example.test`);
    else if (/phone|mobile|telephone/.test(normalized)) values = Array.from({ length: count }, (_, index) => `+1-202-555-${String(1100 + index).padStart(4, "0")}`);
    else if (/full name|person|customer name|employee name|\bname\b/.test(normalized)) values = ["Avery Stone", "Maya Brooks", "Noah Chen", "Priya Shah", "Liam Rivera", "Zoe Martin", "Ethan Kim", "Leila Adams", "Owen Clarke", "Nina Patel", "Sam Taylor", "Iris Walker"].slice(0, count);
    else if (/address|street|postal/.test(normalized)) values = Array.from({ length: count }, (_, index) => `${100 + index} HelloTest Test Avenue, Sample City, TS ${10000 + index}`);
    else if (/uuid|guid/.test(normalized)) values = Array.from({ length: count }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
    else if (/order|invoice|reference|identifier|\bid\b/.test(normalized)) values = Array.from({ length: count }, (_, index) => `QA-${new Date().getUTCFullYear()}-${serial(index, 6)}`);
    else if (/amount|price|currency|balance/.test(normalized)) values = Array.from({ length: count }, (_, index) => (19.95 + index * 7.5).toFixed(2));
    else if (/date|day|time/.test(normalized)) values = Array.from({ length: count }, (_, index) => { const value = new Date(); value.setUTCDate(value.getUTCDate() + index); return value.toISOString().slice(0, 10); });
    else { const label = normalized.replace(/[^a-z0-9]+/g, " ").trim().split(" ").slice(0, 5).join(" ") || "synthetic value"; values = Array.from({ length: count }, (_, index) => `${label} ${serial(index)}`); }
    const suggestions = values.map((value, index) => ({ id: `candidate-${index + 1}`, value }));
    return {
      prompt,
      field_context: req.body.field_context || null,
      summary: `Prepared ${suggestions.length} fictional synthetic values for human review.`,
      suggestions,
      randomized_template: `{{oneOf:${Buffer.from(JSON.stringify(values), "utf8").toString("base64url")}}}`,
      randomization_strategy: "reviewed-value-pool",
      runtime_llm_invocation: false,
      generation_mode: "deterministic",
      fallback_used: false,
      fallback_reason: null,
      generated_at: new Date().toISOString(),
      requires_human_review: true
    };
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
