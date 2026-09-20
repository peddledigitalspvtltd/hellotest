const service = require("../services/requirementRelease.service");
const projectService = require("../services/project.service");

const ensureReleaseAccess = async (id, userId) => {
  const release = await service.getRelease(id);
  await projectService.getProject(release.project_id, userId);
  return release;
};

const requireReadinessSources = async (fastify, req, projectId) => {
  // A delivery role alone must not expose case, run or defect aggregates.
  // Use the same guard as direct resource reads, including API-key and flags.
  for (const permission of ["requirement_iteration.view", "requirement.view", "testcase.view", "run.view", "result.view", "feedback.view"]) {
    await fastify.requirePermission(permission, { projectId })(req);
  }
};

const withVisibleStoryScope = async (fastify, req, releases, projectId) => {
  try {
    await fastify.requirePermission('requirement.view', { projectId })(req);
  } catch (error) {
    if (error?.statusCode !== 403) throw error;
    return releases.map(release => {
      // Delivery metadata remains visible, but Story-derived scope and counts
      // require Story view just like the direct Story catalog.
      const visible = {};
      for (const key of ['id','display_id','project_id','name','description','fix_version','target_date_label','plan_date','target_date','external_link','state','persisted_state','sprint_ids','created_by','updated_by','created_at','updated_at']) {
        if (Object.prototype.hasOwnProperty.call(release,key)) visible[key] = release[key];
      }
      return { ...visible, requirements: [], requirement_ids: [], requirement_count: null, story_scope_visible: false };
    });
  }
  return releases;
};

const withVisibleReleaseMutation = async (fastify, req, result, projectId) => result?.release
  ? { ...result, release: (await withVisibleStoryScope(fastify, req, [result.release], projectId))[0] }
  : result;

const withVisibleStoryMetrics = async (fastify, req, releases, projectId) => {
  const visible = await withVisibleStoryScope(fastify, req, releases, projectId);
  if (visible !== releases) return visible;
  try {
    for (const permission of ['testcase.view', 'feedback.view']) await fastify.requirePermission(permission, { projectId })(req);
  } catch (error) { if (error?.statusCode === 403) return releases; throw error; }
  let includeExecution = true;
  try {
    for (const permission of ['run.view', 'result.view']) await fastify.requirePermission(permission, { projectId })(req);
  } catch (error) { if (error?.statusCode !== 403) throw error; includeExecution = false; }
  return service.withStoryMetrics(releases, { includeExecution });
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
    await fastify.requirePermission('requirement_iteration.view', { projectId: req.query.project_id })(req);
    const releases = await service.listReleases({ project_id: req.query.project_id });
    return withVisibleStoryMetrics(fastify, req, releases, req.query.project_id);
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
    return withVisibleReleaseMutation(fastify, req, await service.createRelease({ ...req.body, created_by: req.user.id }), req.body.project_id);
  });

  fastify.get("/requirement-releases/readiness", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({ project_id: { required: true, type: "string" } }, req.query || {});
    await projectService.getProject(req.query.project_id, req.user.id);
    await requireReadinessSources(fastify, req, req.query.project_id);
    return service.listReadiness({ project_id: req.query.project_id });
  });

  fastify.get("/requirement-releases/:id", async (req) => {
    await fastify.authenticate(req);
    const release = await ensureReleaseAccess(req.params.id, req.user.id);
    await fastify.requirePermission("requirement_iteration.view", { projectId: release.project_id })(req);
    return (await withVisibleStoryMetrics(fastify, req, [release], release.project_id))[0];
  });

  fastify.get("/requirement-releases/:id/readiness", async (req) => {
    await fastify.authenticate(req);
    const release = await ensureReleaseAccess(req.params.id, req.user.id);
    await requireReadinessSources(fastify, req, release.project_id);
    return service.getReadiness(req.params.id, { release });
  });

  fastify.post("/requirement-releases/:id/release-notes", async (req) => {
    await fastify.authenticate(req);
    const release = await ensureReleaseAccess(req.params.id, req.user.id);
    await requireReadinessSources(fastify, req, release.project_id);
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
    return withVisibleReleaseMutation(fastify, req, await service.updateRelease(req.params.id, { ...req.body, updated_by: req.user.id }), release.project_id);
  });

  fastify.post("/requirement-releases/:id/scope", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      requirement_ids: { required: false, type: "array", items: "string" },
      sprint_ids: { required: false, type: "array", items: "string" }
    }, req.body || {});
    const release = await ensureReleaseAccess(req.params.id, req.user.id);
    await fastify.requirePermission("requirement_iteration.update", { projectId: release.project_id })(req);
    return withVisibleReleaseMutation(fastify, req, await service.appendScope(req.params.id, { ...req.body, updated_by: req.user.id }), release.project_id);
  });

  fastify.delete("/requirement-releases/:id", async (req) => {
    await fastify.authenticate(req);
    const release = await ensureReleaseAccess(req.params.id, req.user.id);
    await fastify.requirePermission("requirement_iteration.delete", { projectId: release.project_id })(req);
    return service.deleteRelease(req.params.id);
  });
};
