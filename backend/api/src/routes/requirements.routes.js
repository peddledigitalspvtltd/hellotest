const service = require("../services/requirement.service");
const appTypeService = require("../services/appType.service");
const projectService = require("../services/project.service");
const requirementDesignService = require("../services/requirementDesign.service");
const batchProcessService = require("../services/batchProcess.service");

module.exports = async function (fastify) {
  fastify.post("/requirements", async (req) => {
    await fastify.authenticate(req);
    
    fastify.validate({
      project_id: { required: true, type: "string" },
      title: { required: true, type: "string", minLength: 2 },
      description: { required: false, type: "string" },
      external_references: { required: false, type: "array", items: "string" },
      priority: { required: false, type: "number" },
      status: { required: false, type: "string" }
    }, req.body);

    // Verify user is member of project
    await projectService.getProject(req.body.project_id, req.user.id);

    return service.createRequirement({
      ...req.body,
      created_by: req.user.id
    });
  });

  fastify.post("/requirements/import", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      project_id: { required: true, type: "string" },
      rows: { required: true, type: "array" }
    }, req.body);

    if (!req.body.rows.every((row) => row && typeof row === "object" && !Array.isArray(row))) {
      throw new Error("rows must contain requirement objects");
    }

    await projectService.getProject(req.body.project_id, req.user.id);

    return batchProcessService.queueRequirementImport({
      ...req.body,
      created_by: req.user.id
    });
  });

  fastify.get("/requirements/alm/projects", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      integration_id: { required: true, type: "string" }
    }, req.query);

    return service.listAlmProjects({
      integration_id: req.query.integration_id
    });
  });

  fastify.get("/requirements/alm/requirements", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      integration_id: { required: true, type: "string" },
      alm_project_key: { required: true, type: "string" },
      query: { required: false, type: "string" }
    }, req.query);

    return service.listAlmRequirements({
      integration_id: req.query.integration_id,
      alm_project_key: req.query.alm_project_key,
      query: req.query.query
    });
  });

  fastify.post("/requirements/import/alm", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      project_id: { required: true, type: "string" },
      integration_id: { required: true, type: "string" },
      alm_project_key: { required: true, type: "string" },
      requirement_keys: { required: true, type: "array", items: "string" }
    }, req.body);

    if (!req.body.requirement_keys.length) {
      throw new Error("Select at least one ALM requirement to import");
    }

    await projectService.getProject(req.body.project_id, req.user.id);

    return batchProcessService.queueAlmRequirementImport({
      ...req.body,
      created_by: req.user.id
    });
  });

  fastify.get("/requirements", async (req) => {
    await fastify.authenticate(req);
    const { project_id, status, priority } = req.query;
    
    // If filtering by project, verify access
    if (project_id) {
      await projectService.getProject(project_id, req.user.id);
    }
    
    return service.getRequirements({
      project_id,
      status,
      priority: priority !== undefined ? Number(priority) : undefined
    });
  });

  fastify.get("/requirements/:id", async (req) => {
    await fastify.authenticate(req);
    const requirement = await service.getRequirement(req.params.id);
    // Verify user is member of the requirement's project
    await projectService.getProject(requirement.project_id, req.user.id);
    return requirement;
  });

  fastify.put("/requirements/:id", async (req) => {
    await fastify.authenticate(req);
    
    fastify.validate({
      project_id: { required: false, type: "string" },
      title: { required: false, type: "string", minLength: 2 },
      description: { required: false, type: "string" },
      external_references: { required: false, type: "array", items: "string" },
      priority: { required: false, type: "number" },
      status: { required: false, type: "string" }
    }, req.body);

    const requirement = await service.getRequirement(req.params.id);
    // Verify user is member of the requirement's project
    await projectService.getProject(requirement.project_id, req.user.id);

    return service.updateRequirement(req.params.id, {
      ...req.body,
      updated_by: req.user.id
    });
  });

  fastify.post("/requirements/:id/ai-optimize-preview", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      integration_id: { required: false, type: "string" },
      additional_context: { required: false, type: "string" }
    }, req.body || {});

    const requirement = await service.getRequirement(req.params.id);
    await projectService.getProject(requirement.project_id, req.user.id);

    return service.previewRequirementOptimization({
      id: req.params.id,
      integration_id: req.body?.integration_id,
      user_id: req.user.id,
      additional_context: req.body?.additional_context
    });
  });

  fastify.post("/requirements/:id/generate-test-cases", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      app_type_id: { required: true, type: "string" },
      integration_id: { required: false, type: "string" },
      max_cases: { required: false, type: "number" },
      status: { required: false, type: "string" },
      additional_context: { required: false, type: "string" },
      external_links: { required: false, type: "array", items: "string" },
      images: { required: false, type: "array" }
    }, req.body);

    const requirement = await service.getRequirement(req.params.id);
    await projectService.getProject(requirement.project_id, req.user.id);

    const appType = await appTypeService.getAppType(req.body.app_type_id);

    if (appType.project_id !== requirement.project_id) {
      throw new Error("App type must belong to the same project as the requirement");
    }

    return requirementDesignService.generateRequirementTestCases({
      requirement,
      appType,
      integration_id: req.body.integration_id,
      user_id: req.user.id,
      max_cases: req.body.max_cases,
      status: req.body.status,
      additional_context: req.body.additional_context,
      external_links: req.body.external_links,
      images: req.body.images
    });
  });

  fastify.post("/requirements/:id/design-test-cases-preview", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      app_type_id: { required: true, type: "string" },
      integration_id: { required: false, type: "string" },
      max_cases: { required: false, type: "number" },
      additional_context: { required: false, type: "string" },
      external_links: { required: false, type: "array", items: "string" },
      images: { required: false, type: "array" }
    }, req.body);

    const requirement = await service.getRequirement(req.params.id);
    await projectService.getProject(requirement.project_id, req.user.id);

    const appType = await appTypeService.getAppType(req.body.app_type_id);

    if (appType.project_id !== requirement.project_id) {
      throw new Error("App type must belong to the same project as the requirement");
    }

    return requirementDesignService.previewRequirementTestCases({
      requirement,
      appType,
      integration_id: req.body.integration_id,
      user_id: req.user.id,
      max_cases: req.body.max_cases,
      additional_context: req.body.additional_context,
      external_links: req.body.external_links,
      images: req.body.images
    });
  });

  fastify.post("/requirements/:id/design-test-cases-accept", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      app_type_id: { required: true, type: "string" },
      status: { required: false, type: "string" },
      cases: { required: true, type: "array" }
    }, req.body);

    if (!req.body.cases.every((item) => item && typeof item === "object" && !Array.isArray(item))) {
      throw new Error("cases must contain test case objects");
    }

    const requirement = await service.getRequirement(req.params.id);
    await projectService.getProject(requirement.project_id, req.user.id);

    const appType = await appTypeService.getAppType(req.body.app_type_id);

    if (appType.project_id !== requirement.project_id) {
      throw new Error("App type must belong to the same project as the requirement");
    }

    return requirementDesignService.acceptRequirementTestCases({
      requirement,
      appType,
      status: req.body.status,
      cases: req.body.cases
    });
  });

  fastify.delete("/requirements/:id", async (req) => {
    await fastify.authenticate(req);
    const requirement = await service.getRequirement(req.params.id);
    // Verify user is member of the requirement's project
    await projectService.getProject(requirement.project_id, req.user.id);
    return service.deleteRequirement(req.params.id);
  });
};
