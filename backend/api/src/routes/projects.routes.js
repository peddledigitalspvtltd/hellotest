const service = require("../services/project.service");

module.exports = async function (fastify) {

  fastify.post("/projects", async (req) => {
    await fastify.authenticate(req);
    return service.createProject({
      ...req.body,
      created_by: req.user.id
    });
  });

  // Get only projects user is a member of
  fastify.get("/projects", async (req) => {
    await fastify.authenticate(req);
    return service.getProjects(req.user.id);
  });

  // Get project details with access control
  fastify.get("/projects/:id", async (req) => {
    await fastify.authenticate(req);
    return service.getProject(req.params.id, req.user.id);
  });

  fastify.put("/projects/:id", async (req) => {
    await fastify.authenticate(req);
    // Verify access
    await service.getProject(req.params.id, req.user.id);
    return service.updateProject(req.params.id, req.body);
  });

  fastify.delete("/projects/:id", async (req) => {
    await fastify.authenticate(req);
    await service.getProject(req.params.id, req.user.id);
    await fastify.requirePermission("project.delete", { projectId: req.params.id })(req);
    return service.deleteProject(req.params.id);
  });

};
