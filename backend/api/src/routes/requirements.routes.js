const service = require("../services/requirement.service");
const appTypeService = require("../services/appType.service");
const projectService = require("../services/project.service");
const requirementDesignService = require("../services/requirementDesign.service");
const batchProcessService = require("../services/batchProcess.service");
const requirementWorkspaceService = require("../services/requirementWorkspace.service");
const richTextAiService = require("../services/richTextAi.service");
const { requirementMetadata } = require("../utils/nativeIssueMetadata");
const { paginate, shouldPaginate } = require("../utils/pagination");

module.exports = async function (fastify) {
  fastify.get("/requirements/create-metadata", async (req) => {
    await fastify.authenticate(req);
    const project = await projectService.getProject(req.query.project_id, req.user.id);
    return requirementMetadata({ project });
  });

  fastify.get("/requirements/:id/edit-metadata", async (req) => {
    await fastify.authenticate(req);
    const requirement = await service.getRequirement(req.params.id);
    const project = await projectService.getProject(requirement.project_id, req.user.id);
    return requirementMetadata({ project, mode: "edit", currentValues: requirement });
  });

  fastify.post("/requirements/:id/ai-groom-preview", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      project_id: { required: false, type: "string", maxLength: 255 },
      integration_id: { required: false, type: "string", maxLength: 255 },
      prompt_guidance: { required: false, type: "string", maxLength: 4000 }
    }, req.body || {});
    const requirement = await service.getRequirement(req.params.id);
    const project = await projectService.getProject(requirement.project_id, req.user.id);
    if (req.body?.project_id && req.body.project_id !== project.id) throw Object.assign(new Error("Story does not belong to the selected project"), { statusCode: 403 });
    await fastify.requirePermission("requirement.ai", { projectId: project.id })(req);
    return requirementWorkspaceService.previewGrooming({
      requirement,
      project,
      userId: req.user.id,
      integrationId: req.body?.integration_id,
      promptGuidance: req.body?.prompt_guidance
    });
  });

  fastify.post("/requirements/ai-description-rephrase", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({ project_id: { required: true, type: "string" }, description: { required: false, type: "string" }, description_html: { required: false, type: "string" }, requirement: { required: false, type: "object" } }, req.body || {});
    await projectService.getProject(req.body.project_id, req.user.id);
    await fastify.requirePermission("requirement.ai", { projectId: req.body.project_id })(req);
    const content = String(req.body.description || req.body.description_html || "").trim();
    if (!content) throw Object.assign(new Error("A Story description is required for AI rephrase"), { statusCode: 400 });
    const result = await richTextAiService.rephrase({ user: req.user, projectId: req.body.project_id, content: req.body.description || content, contentHtml: req.body.description_html, entityType: "requirement", entityTitle: req.body.requirement?.title, fieldLabel: "Description" });
    return { integration: result.integration, requirement: { id: req.body.requirement?.id || null, display_id: req.body.requirement?.display_id || null, title: req.body.requirement?.title || null }, description: result.content, provenance: result.provenance };
  });

  fastify.post("/requirements/export", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({ project_id: { required: true, type: "string" }, requirement_ids: { required: false, type: "array", items: "string" }, format: { required: false, type: "string", enum: ["csv", "json"] } }, req.body || {});
    await projectService.getProject(req.body.project_id, req.user.id);
    await fastify.requirePermission("requirement.export", { projectId: req.body.project_id })(req);
    return requirementWorkspaceService.exportRequirements({ projectId: req.body.project_id, requirementIds: req.body.requirement_ids || [], userId: req.user.id, format: req.body.format || "csv" });
  });

  fastify.post("/requirements/ai-gherkin-preview", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({ project_id: { required: true, type: "string", maxLength: 255 }, requirements: { required: true, type: "array", maxItems: 20 } }, req.body || {});
    await projectService.getProject(req.body.project_id, req.user.id);
    await fastify.requirePermission("requirement.ai", { projectId: req.body.project_id })(req);
    return requirementWorkspaceService.previewGherkin(req.body);
  });

  fastify.post("/requirements/ai-create-jobs", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      project_id: { required: true, type: "string", maxLength: 255 },
      integration_id: { required: false, type: "string", maxLength: 255 },
      additional_context: { required: false, type: "string", maxLength: 20000 },
      external_links: { required: false, type: "array", items: "string", maxItems: 20 },
      images: { required: false, type: "array", maxItems: 4 },
      max_requirements: { required: false, type: "number" },
      priority: { required: false, type: "number" },
      status: { required: false, type: "string", maxLength: 100 }
    }, req.body || {});
    await projectService.getProject(req.body.project_id, req.user.id);
    await fastify.requirePermission("requirement.ai", { projectId: req.body.project_id })(req);
    return requirementWorkspaceService.createGenerationJob({ input: req.body, userId: req.user.id });
  });

  fastify.get("/requirements/ai-create-jobs/:jobId", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({ project_id: { required: true, type: "string", maxLength: 255 } }, req.query || {});
    const project = await projectService.getProject(req.query.project_id, req.user.id);
    await fastify.requirePermission("requirement.ai", { projectId: project.id })(req);
    return requirementWorkspaceService.getGenerationJob(req.params.jobId, project.id);
  });

  fastify.get("/requirements/ai-create-jobs", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({ project_id: { required: true, type: "string", maxLength: 255 }, status: { required: false, type: "string", enum: ["queued", "running", "completed", "failed"] }, limit: { required: false, type: "string", maxLength: 3 } }, req.query || {});
    const project = await projectService.getProject(req.query.project_id, req.user.id);
    await fastify.requirePermission("requirement.ai", { projectId: project.id })(req);
    return requirementWorkspaceService.listGenerationJobs(project.id, req.query.status, req.query.limit);
  });

  fastify.post("/requirements", async (req) => {
    await fastify.authenticate(req);
    
    fastify.validate({
      project_id: { required: true, type: "string" },
      title: { required: true, type: "string", minLength: 2 },
      description: { required: false, type: "string" },
      gherkin_scenarios: { required: false, type: "array", items: "string", maxItems: 20 },
      additional_fields: { required: false, type: "object" },
      ai_review: { required: false, type: "object" },
      external_references: { required: false, type: "array", items: "string" },
      labels: { required: false, type: "array", items: "string" },
      sprint: { required: false, type: "string" },
      fix_version: { required: false, type: "string" },
      release: { required: false, type: "string" },
      iteration_id: { required: false, type: "string" },
      dev_completion_target_date: { required: false, type: "string" },
      qa_completion_target_date: { required: false, type: "string" },
      scrum_team: { required: false, type: "string", maxLength: 255 },
      specification_format: { required: false, type: "string", enum: ["gherkin", "speckit"] },
      specification_content: { required: false, type: "string", maxLength: 40000 },
      priority: { required: false, type: "number" },
      status: { required: false, type: "string", maxLength: 100 },
      related_requirement_ids: { required: false, type: "array", items: "string", maxItems: 100 }
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

  fastify.post("/requirements/ai-create-preview", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      project_id: { required: true, type: "string" },
      integration_id: { required: false, type: "string", maxLength: 255 },
      additional_context: { required: false, type: "string", maxLength: 20000 },
      external_links: { required: false, type: "array", items: "string", maxItems: 20 },
      images: { required: false, type: "array", maxItems: 4 },
      max_requirements: { required: false, type: "number" },
      priority: { required: false, type: "number" },
      status: { required: false, type: "string" }
    }, req.body || {});

    await projectService.getProject(req.body.project_id, req.user.id);
    await fastify.requirePermission("requirement.ai", { projectId: req.body.project_id })(req);

    return service.previewRequirementCreation({
      ...req.body,
      user_id: req.user.id
    });
  });

  fastify.get("/requirements", async (req) => {
    await fastify.authenticate(req);
    const { project_id, status, priority, sprint_id, unassigned } = req.query;
    
    // If filtering by project, verify access
    if (project_id) {
      await projectService.getProject(project_id, req.user.id);
    }
    
    const items = await service.getRequirements({
      project_id,
      status,
      priority: priority !== undefined ? Number(priority) : undefined
    });
    const scoped = sprint_id
      ? items.filter((item) => String(item.iteration_id || "") === String(sprint_id))
      : unassigned === "true"
        ? items.filter((item) => !item.iteration_id)
        : items;
    return shouldPaginate(req.query) ? paginate(scoped, req.query) : scoped;
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
      gherkin_scenarios: { required: false, type: "array", items: "string", maxItems: 20 },
      additional_fields: { required: false, type: "object" },
      ai_review: { required: false, type: "object" },
      external_references: { required: false, type: "array", items: "string" },
      labels: { required: false, type: "array", items: "string" },
      sprint: { required: false, type: "string" },
      fix_version: { required: false, type: "string" },
      release: { required: false, type: "string" },
      iteration_id: { required: false, type: "string" },
      dev_completion_target_date: { required: false, type: "string" },
      qa_completion_target_date: { required: false, type: "string" },
      scrum_team: { required: false, type: "string", maxLength: 255 },
      specification_format: { required: false, type: "string", enum: ["gherkin", "speckit"] },
      specification_content: { required: false, type: "string", maxLength: 40000 },
      priority: { required: false, type: "number" },
      status: { required: false, type: "string" },
      expected_revision: { required: false, type: "number" }
    }, req.body);

    const requirement = await service.getRequirement(req.params.id);
    // Verify user is member of the requirement's project
    await projectService.getProject(requirement.project_id, req.user.id);

    return service.updateRequirement(req.params.id, {
      ...req.body,
      updated_by: req.user.id
    });
  });

  fastify.put("/requirements/:id/related-requirements", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({ requirement_ids: { required: true, type: "array", items: "string" } }, req.body || {});
    const requirement = await service.getRequirement(req.params.id);
    await projectService.getProject(requirement.project_id, req.user.id);
    return service.replaceRelatedRequirements(req.params.id, req.body.requirement_ids);
  });

  fastify.post("/requirements/:id/ai-optimize-preview", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      integration_id: { required: false, type: "string", maxLength: 255 },
      additional_context: { required: false, type: "string", maxLength: 20000 },
      external_links: { required: false, type: "array", items: "string", maxItems: 20 },
      images: { required: false, type: "array", maxItems: 6 }
    }, req.body || {});

    const requirement = await service.getRequirement(req.params.id);
    await projectService.getProject(requirement.project_id, req.user.id);
    await fastify.requirePermission("requirement.ai", { projectId: requirement.project_id })(req);

    return service.previewRequirementOptimization({
      id: req.params.id,
      integration_id: req.body?.integration_id,
      user_id: req.user.id,
      additional_context: req.body?.additional_context,
      external_links: req.body?.external_links,
      images: req.body?.images
    });
  });

  fastify.post("/requirements/:id/generate-test-cases", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      app_type_id: { required: true, type: "string" },
      integration_id: { required: false, type: "string" },
      max_cases: { required: false, type: "number" },
      authoring_mode: { required: false, type: "string", enum: ["structured", "gherkin"] },
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
      authoring_mode: req.body.authoring_mode,
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
      authoring_mode: { required: false, type: "string", enum: ["structured", "gherkin"] },
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
      authoring_mode: req.body.authoring_mode,
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
