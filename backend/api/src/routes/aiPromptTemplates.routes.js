const service = require("../services/aiPromptTemplate.service");
const appTypeService = require("../services/appType.service");
const projectService = require("../services/project.service");

const resolvePromptTemplateScope = async (req, input = {}) => {
  const appTypeId = input.app_type_id || req.query?.app_type_id;
  const projectId = input.project_id || req.query?.project_id;

  if (appTypeId) {
    const appType = await appTypeService.getAppType(appTypeId);
    await projectService.getProject(appType.project_id, req.user.id);
    return { project_id: appType.project_id, app_type_id: appType.id };
  }

  if (!projectId) {
    throw new Error("Project or app type scope is required.");
  }

  await projectService.getProject(projectId, req.user.id);
  return { project_id: projectId, app_type_id: null };
};

const ensureTemplateAccess = async (req, template) => {
  if (!template?.project_id) {
    return;
  }

  await projectService.getProject(template.project_id, req.user.id);
};

module.exports = async function (fastify) {
  fastify.get("/ai-prompt-templates", async (req) => {
    await fastify.authenticate(req);

    const scope = await resolvePromptTemplateScope(req);
    return service.listPromptTemplates({
      project_id: scope.project_id,
      app_type_id: scope.app_type_id,
      scope: req.query?.scope
    });
  });

  fastify.post("/ai-prompt-templates", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      project_id: { required: false, type: "string" },
      app_type_id: { required: false, type: "string" },
      scope: { required: false, type: "string" },
      name: { required: true, type: "string", minLength: 2 },
      description: { required: false, type: "string" },
      domain: { required: false, type: "string" },
      role: { required: false, type: "string" },
      test_type: { required: false, type: "string" },
      test_format: { required: false, type: "string" },
      test_count: { required: false, type: "number" },
      prompt_text: { required: true, type: "string", minLength: 2 },
      applies_to: { required: false, type: "array", items: "string" },
      tags: { required: false, type: "array", items: "string" }
    }, req.body || {});

    const scope = await resolvePromptTemplateScope(req, req.body || {});
    return service.createPromptTemplate({
      ...req.body,
      project_id: scope.project_id,
      app_type_id: req.body?.app_type_id || scope.app_type_id,
      created_by: req.user.id
    });
  });

  fastify.put("/ai-prompt-templates/:id", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      app_type_id: { required: false, type: "string" },
      scope: { required: false, type: "string" },
      name: { required: false, type: "string" },
      description: { required: false, type: "string" },
      domain: { required: false, type: "string" },
      role: { required: false, type: "string" },
      test_type: { required: false, type: "string" },
      test_format: { required: false, type: "string" },
      test_count: { required: false, type: "number" },
      prompt_text: { required: false, type: "string" },
      applies_to: { required: false, type: "array", items: "string" },
      tags: { required: false, type: "array", items: "string" }
    }, req.body || {});

    const existing = await service.getPromptTemplate(req.params.id);
    await ensureTemplateAccess(req, existing);

    if (req.body?.app_type_id) {
      const appType = await appTypeService.getAppType(req.body.app_type_id);
      if (appType.project_id !== existing.project_id) {
        throw new Error("Prompt template app scope must belong to the same project.");
      }
    }

    return service.updatePromptTemplate(req.params.id, req.body || {});
  });

  fastify.delete("/ai-prompt-templates/:id", async (req) => {
    await fastify.authenticate(req);

    const existing = await service.getPromptTemplate(req.params.id);
    await ensureTemplateAccess(req, existing);
    return service.deletePromptTemplate(req.params.id);
  });
};
