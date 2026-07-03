const service = require("../services/user.service");
const batchProcessService = require("../services/batchProcess.service");
const permissionService = require("../services/permission.service");

module.exports = async function (fastify) {
  const createError = (message, statusCode) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
  };

  fastify.post("/users", async (req) => {
    fastify.validate({
      email: { required: true, type: "string", minLength: 3 },
      password: { required: false, type: "string", minLength: 6 },
      password_hash: { required: false, type: "string", minLength: 3 },
      name: { required: false, type: "string" },
      role_id: { required: true, type: "string" }
    }, req.body);

    if (!req.body.password && !req.body.password_hash) {
      throw createError("Password is required", 400);
    }

    return service.createUser(req.body);
  });

  fastify.post("/users/import", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      rows: { required: true, type: "array" },
      default_role_id: { required: false, type: "string" }
    }, req.body);

    if (!req.body.rows.every((row) => row && typeof row === "object" && !Array.isArray(row))) {
      throw new Error("rows must contain user objects");
    }

    return batchProcessService.queueUserImport({
      ...req.body,
      created_by: req.user.id
    });
  });

  fastify.get("/users", { preHandler: [fastify.authenticate] }, async () => {
    return service.getUsers();
  });

  fastify.get("/users/:id", { preHandler: [fastify.authenticate] }, async (req) => {
    return service.getUser(req.params.id);
  });

  fastify.put("/users/:id", { preHandler: [fastify.authenticate] }, async (req) => {
    fastify.validate({
      email: { required: false, type: "string", minLength: 3 },
      password: { required: false, type: "string", minLength: 6 },
      password_hash: { required: false, type: "string", minLength: 3 },
      name: { required: false, type: "string" },
      role_id: { required: false, type: "string" },
      avatar_data_url: { required: false, type: "string" }
    }, req.body);

    const isSelfUpdate = req.user?.id === req.params.id;
    const isPrivilegedUserManager = req.user?.role === "admin" || await permissionService.hasPermission(req.user, "user.manage");

    if (!isSelfUpdate && !isPrivilegedUserManager) {
      throw createError("You can only update your own profile.", 403);
    }

    if (!isPrivilegedUserManager && (req.body?.role_id !== undefined || req.body?.password_hash !== undefined || req.body?.password !== undefined)) {
      throw createError("Permission required: user.manage", 403);
    }

    return service.updateUser(req.params.id, req.body);
  });

  fastify.put("/users/:id/password", { preHandler: [fastify.authenticate] }, async (req) => {
    fastify.validate({
      current_password: { required: true, type: "string", minLength: 1 },
      new_password: { required: true, type: "string", minLength: 6 }
    }, req.body);

    if (req.user?.id !== req.params.id) {
      throw createError("You can only change your own password.", 403);
    }

    return service.changeOwnPassword({
      id: req.params.id,
      current_password: req.body.current_password,
      new_password: req.body.new_password
    });
  });

  fastify.delete("/users/:id", async (req) => {
    return service.deleteUser(req.params.id);
  });
};
