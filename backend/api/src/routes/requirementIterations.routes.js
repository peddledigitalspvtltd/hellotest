const service = require("../services/requirementIteration.service");
const projectService = require("../services/project.service");

const ensureProjectAccess = async (projectId, userId) => {
  if (!projectId) {
    return null;
  }

  return projectService.getProject(projectId, userId);
};

const ensureIterationAccess = async (iterationId, userId) => {
  const iteration = await service.getIteration(iterationId);
  await ensureProjectAccess(iteration.project_id, userId);
  return iteration;
};

module.exports = async function (fastify) {
  fastify.get("/requirement-iterations", async (req) => {
    await fastify.authenticate(req);
    const { project_id } = req.query;

    if (project_id) {
      await ensureProjectAccess(project_id, req.user.id);
    }

    return service.listIterations({ project_id });
  });

  fastify.post("/requirement-iterations", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      project_id: { required: true, type: "string" },
      name: { required: true, type: "string", minLength: 2 },
      description: { required: false, type: "string" },
      goal: { required: false, type: "string" },
      state: { required: false, type: "string", enum: ["future", "active", "closed"] },
      start_date: { required: false, type: "string" },
      end_date: { required: false, type: "string" },
      requirement_ids: { required: false, type: "array", items: "string" }
    }, req.body || {});

    await ensureProjectAccess(req.body.project_id, req.user.id);

    return service.createIteration({
      ...req.body,
      created_by: req.user.id
    });
  });

  fastify.get("/requirement-iterations/:id", async (req) => {
    await fastify.authenticate(req);
    return ensureIterationAccess(req.params.id, req.user.id);
  });

  fastify.put("/requirement-iterations/:id", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      name: { required: false, type: "string", minLength: 2 },
      description: { required: false, type: "string" },
      goal: { required: false, type: "string" },
      state: { required: false, type: "string", enum: ["future", "active", "closed"] },
      start_date: { required: false, type: "string" },
      end_date: { required: false, type: "string" },
      requirement_ids: { required: false, type: "array", items: "string" }
    }, req.body || {});

    await ensureIterationAccess(req.params.id, req.user.id);

    return service.updateIteration(req.params.id, {
      ...req.body,
      updated_by: req.user.id
    });
  });

  fastify.post("/requirement-iterations/:id/requirements", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      requirement_ids: { required: true, type: "array", items: "string" },
      append: { required: false, type: "boolean" }
    }, req.body || {});

    await ensureIterationAccess(req.params.id, req.user.id);

    return service.assignRequirements(req.params.id, req.body.requirement_ids, {
      append: req.body.append !== false
    });
  });

  fastify.delete("/requirement-iterations/:id/requirements", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      requirement_ids: { required: true, type: "array", items: "string" }
    }, req.body || {});

    await ensureIterationAccess(req.params.id, req.user.id);
    return service.removeRequirements(req.params.id, req.body.requirement_ids);
  });

  fastify.delete("/requirement-iterations/:id", async (req) => {
    await fastify.authenticate(req);
    await ensureIterationAccess(req.params.id, req.user.id);
    return service.deleteIteration(req.params.id);
  });
};
