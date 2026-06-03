const service = require("../services/projectMember.service");

module.exports = async function (fastify) {
  fastify.post("/project-members", async (req) => {
    fastify.validate({
      project_id: { required: true, type: "string" },
      user_id: { required: true, type: "string" },
      role_id: { required: true, type: "string" }
    }, req.body);

    return service.createProjectMember(req.body);
  });

  fastify.get("/project-members", { preHandler: [fastify.authenticate] }, async (req) => {
    const { project_id, user_id, role_id } = req.query;
    return service.getProjectMembers({ project_id, user_id, role_id });
  });

  fastify.get("/project-members/:id", { preHandler: [fastify.authenticate] }, async (req) => {
    return service.getProjectMember(req.params.id);
  });

  fastify.put("/project-members/:id", async (req) => {
    fastify.validate({
      project_id: { required: false, type: "string" },
      user_id: { required: false, type: "string" },
      role_id: { required: false, type: "string" }
    }, req.body);

    return service.updateProjectMember(req.params.id, req.body);
  });

  fastify.delete("/project-members/:id", async (req) => {
    return service.deleteProjectMember(req.params.id);
  });
};
