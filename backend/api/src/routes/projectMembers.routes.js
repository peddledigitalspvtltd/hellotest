const service = require("../services/projectMember.service");

const ensureMemberPermission = async (fastify, req, permissionCode, member = null) => {
  const target = member || await service.getProjectMember(req.params.id);
  await fastify.requirePermission(permissionCode, { projectId: target.project_id })(req);
  return target;
};

module.exports = async function (fastify) {
  fastify.post("/project-members", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      project_id: { required: true, type: "string" },
      user_id: { required: true, type: "string" },
      role_id: { required: true, type: "string" }
    }, req.body);

    await fastify.requirePermission("project_member.manage", { projectId: req.body.project_id })(req);

    return service.createProjectMember(req.body);
  });

  fastify.get("/project-members", { preHandler: [fastify.authenticate] }, async (req) => {
    const { project_id, user_id, role_id } = req.query;
    if (project_id) {
      await fastify.requirePermission("project_member.view", { projectId: project_id })(req);
    } else if (req.user.role !== "admin") {
      const error = new Error("project_id is required when listing project members");
      error.statusCode = 400;
      throw error;
    }
    return service.getProjectMembers({ project_id, user_id, role_id });
  });

  fastify.get("/project-members/:id", { preHandler: [fastify.authenticate] }, async (req) => {
    return ensureMemberPermission(fastify, req, "project_member.view");
  });

  fastify.put("/project-members/:id", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      project_id: { required: false, type: "string" },
      user_id: { required: false, type: "string" },
      role_id: { required: false, type: "string" }
    }, req.body);

    const member = await ensureMemberPermission(fastify, req, "project_member.manage");
    if (req.body.project_id && req.body.project_id !== member.project_id) {
      await fastify.requirePermission("project_member.manage", { projectId: req.body.project_id })(req);
    }

    return service.updateProjectMember(req.params.id, req.body);
  });

  fastify.delete("/project-members/:id", async (req) => {
    await fastify.authenticate(req);
    await ensureMemberPermission(fastify, req, "project_member.manage");
    return service.deleteProjectMember(req.params.id);
  });
};
