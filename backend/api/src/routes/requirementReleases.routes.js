const service = require("../services/requirementRelease.service");
const projectService = require("../services/project.service");

const ensureReleaseAccess = async (id, userId) => {
  const release = await service.getRelease(id);
  await projectService.getProject(release.project_id, userId);
  return release;
};

const releaseFields = {
  name: { required: false, type: "string", minLength: 2, maxLength: 255 },
  description: { required: false, type: "string", maxLength: 20000 },
  fix_version: { required: false, type: "string", maxLength: 255 },
  target_date_label: { required: false, type: "string", maxLength: 255 },
  plan_date: { required: false, type: "string" },
  target_date: { required: false, type: "string" },
  external_link: { required: false, type: "string", maxLength: 2000 },
  state: { required: false, type: "string", enum: ["planned", "in_progress", "released"] },
  sprint_ids: { required: false, type: "array", items: "string" },
  requirement_ids: { required: false, type: "array", items: "string" }
};

module.exports = async function (fastify) {
  fastify.get("/requirement-releases", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({ project_id: { required: true, type: "string" } }, req.query || {});
    await projectService.getProject(req.query.project_id, req.user.id);
    return service.listReleases({ project_id: req.query.project_id });
  });

  fastify.post("/requirement-releases", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      project_id: { required: true, type: "string" },
      ...releaseFields,
      name: { ...releaseFields.name, required: true },
      fix_version: { ...releaseFields.fix_version, required: true }
    }, req.body || {});
    await projectService.getProject(req.body.project_id, req.user.id);
    await fastify.requirePermission("requirement_iteration.create", { projectId: req.body.project_id })(req);
    if (req.body.sprint_ids?.length || req.body.requirement_ids?.length) {
      await fastify.requirePermission("requirement_iteration.update", { projectId: req.body.project_id })(req);
    }
    return service.createRelease({ ...req.body, created_by: req.user.id });
  });

  fastify.get("/requirement-releases/readiness", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({ project_id: { required: true, type: "string" } }, req.query || {});
    await projectService.getProject(req.query.project_id, req.user.id);
    return service.listReadiness({ project_id: req.query.project_id });
  });

  fastify.get("/requirement-releases/:id", async (req) => {
    await fastify.authenticate(req);
    const release = await ensureReleaseAccess(req.params.id, req.user.id);
    await fastify.requirePermission("requirement_iteration.view", { projectId: release.project_id })(req);
    return release;
  });

  fastify.get("/requirement-releases/:id/readiness", async (req) => {
    await fastify.authenticate(req);
    const release = await ensureReleaseAccess(req.params.id, req.user.id);
    await fastify.requirePermission("requirement_iteration.view", { projectId: release.project_id })(req);
    return service.getReadiness(req.params.id);
  });

  fastify.post("/requirement-releases/:id/release-notes", async (req) => {
    await fastify.authenticate(req);
    const release = await ensureReleaseAccess(req.params.id, req.user.id);
    await fastify.requirePermission("requirement_iteration.view", { projectId: release.project_id })(req);
    let allowAi = false;
    try {
      await fastify.requirePermission("requirement.ai", { projectId: release.project_id })(req);
      allowAi = true;
    } catch (error) {
      if (error?.statusCode !== 403) throw error;
    }
    return service.generateReleaseNotes(req.params.id, { user_id: req.user.id, allow_ai: allowAi });
  });

  fastify.put("/requirement-releases/:id", async (req) => {
    await fastify.authenticate(req);
    fastify.validate(releaseFields, req.body || {});
    const release = await ensureReleaseAccess(req.params.id, req.user.id);
    await fastify.requirePermission("requirement_iteration.update", { projectId: release.project_id })(req);
    return service.updateRelease(req.params.id, { ...req.body, updated_by: req.user.id });
  });

  fastify.post("/requirement-releases/:id/scope", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      requirement_ids: { required: false, type: "array", items: "string" },
      sprint_ids: { required: false, type: "array", items: "string" }
    }, req.body || {});
    const release = await ensureReleaseAccess(req.params.id, req.user.id);
    await fastify.requirePermission("requirement_iteration.update", { projectId: release.project_id })(req);
    return service.appendScope(req.params.id, { ...req.body, updated_by: req.user.id });
  });

  fastify.delete("/requirement-releases/:id", async (req) => {
    await fastify.authenticate(req);
    const release = await ensureReleaseAccess(req.params.id, req.user.id);
    await fastify.requirePermission("requirement_iteration.delete", { projectId: release.project_id })(req);
    return service.deleteRelease(req.params.id);
  });
};
