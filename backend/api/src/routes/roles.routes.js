const service = require("../services/role.service");

module.exports = async function (fastify) {
  fastify.post("/roles", async (req) => {
    fastify.validate({
      name: { required: true, type: "string", minLength: 2 },
      permission_codes: { required: false, type: "array", items: "string" }
    }, req.body);

    return service.createRole(req.body);
  });

  fastify.get("/roles", { preHandler: [fastify.authenticate] }, async () => {
    return service.getRoles();
  });

  fastify.get("/roles/:id", { preHandler: [fastify.authenticate] }, async (req) => {
    return service.getRole(req.params.id);
  });

  fastify.get("/permissions", { preHandler: [fastify.authenticate] }, async () => {
    return service.listPermissions();
  });

  fastify.get("/roles/:id/permissions", { preHandler: [fastify.authenticate] }, async (req) => {
    return service.getRolePermissions(req.params.id);
  });

  fastify.put("/roles/:id/permissions", async (req) => {
    fastify.validate({
      permission_codes: { required: true, type: "array", items: "string" }
    }, req.body);

    return service.replaceRolePermissions(req.params.id, req.body.permission_codes);
  });

  fastify.put("/roles/:id", async (req) => {
    fastify.validate({
      name: { required: false, type: "string", minLength: 2 },
      permission_codes: { required: false, type: "array", items: "string" }
    }, req.body);

    return service.updateRole(req.params.id, req.body);
  });

  fastify.delete("/roles/:id", async (req) => {
    return service.deleteRole(req.params.id);
  });
};
