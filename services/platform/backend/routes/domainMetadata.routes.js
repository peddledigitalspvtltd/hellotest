const service = require("../services/domainMetadata.service");
const workspaceScopes = require("../services/workspaceScope.service");

module.exports = async function (fastify) {
  fastify.get("/metadata/workspace-scopes", async (req) => {
    await fastify.authenticate(req);
    return workspaceScopes.getWorkspaceScopes(req.user);
  });

  fastify.get("/metadata/domain", async (req) => {
    await fastify.authenticate(req);
    return service.getDomainMetadata();
  });
};
