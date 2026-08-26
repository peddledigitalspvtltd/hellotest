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
    return ensureReleaseAccess(req.params.id, req.user.id);
  });

  fastify.get("/requirement-releases/:id/readiness", async (req) => {
    await fastify.authenticate(req);
    await ensureReleaseAccess(req.params.id, req.user.id);
    return service.getReadiness(req.params.id);
  });

  fastify.post("/requirement-releases/:id/release-notes", async (req) => {
    await fastify.authenticate(req);
    await ensureReleaseAccess(req.params.id, req.user.id);
    return service.generateReleaseNotes(req.params.id, { user_id: req.user.id });
  });

  fastify.put("/requirement-releases/:id", async (req) => {
    await fastify.authenticate(req);
    fastify.validate(releaseFields, req.body || {});
    await ensureReleaseAccess(req.params.id, req.user.id);
    return service.updateRelease(req.params.id, { ...req.body, updated_by: req.user.id });
  });

  fastify.delete("/requirement-releases/:id", async (req) => {
    await fastify.authenticate(req);
    await ensureReleaseAccess(req.params.id, req.user.id);
    return service.deleteRelease(req.params.id);
  });
};
