const service = require("../services/requirementDefect.service");
const entityScopes = require("../services/entityScope.service");

const authorizeMappings = async (fastify, req, { requirement_id, issue_id }, permission) => {
  const scopes = [];
  if (requirement_id) scopes.push(await entityScopes.resolveEntityScope({ entityType: "requirement", entityId: requirement_id }));
  if (issue_id) scopes.push(await entityScopes.resolveEntityScope({ entityType: "issue", entityId: issue_id }));
  if (!scopes.length && req.user.role !== "admin") {
    throw Object.assign(new Error("requirement_id or issue_id is required when listing Story defect mappings"), { statusCode: 400 });
  }
  const projectId = scopes[0]?.projectId || null;
  if (scopes.some((scope) => scope.projectId !== projectId)) {
    throw Object.assign(new Error("Story and Defect must belong to the same project"), { statusCode: 403 });
  }
  await fastify.requirePermission("requirement.view", { projectId })(req);
  await fastify.requirePermission(permission, { projectId })(req);
};

module.exports = async function (fastify) {
  fastify.get("/requirement-defects", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      requirement_id: { required: false, type: "string", minLength: 1 },
      issue_id: { required: false, type: "string", minLength: 1 }
    }, req.query || {});
    const { requirement_id, issue_id } = req.query;
    await authorizeMappings(fastify, req, req.query, "feedback.view");
    return service.listMappings({ requirement_id, issue_id });
  });

  fastify.put("/requirement-defects/replace", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      requirement_id: { required: true, type: "string" },
      issue_ids: { required: true, type: "array", items: "string", maxItems: 1000 }
    }, req.body);
    await authorizeMappings(fastify, req, req.body, "feedback.manage");
    return service.replaceMappingsForRequirement(req.body.requirement_id, req.body.issue_ids);
  });
};
