const service = require("../services/issues.service");
const { ISSUE_STATUS_VALUES } = require("../domain/catalog");

module.exports = async function (fastify) {
  fastify.post("/issues", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      user_id: { required: true, type: "string" },
      title: { required: true, type: "string", minLength: 2 },
      message: { required: true, type: "string", minLength: 2 },
      status: { required: false, type: "string", enum: ISSUE_STATUS_VALUES }
    }, req.body);

    return service.createIssue(req.body);
  });

  fastify.get("/issues", async (req) => {
    await fastify.authenticate(req);
    const { user_id, status } = req.query;
    return service.getIssues({ user_id, status });
  });

  fastify.get("/issues/:id", async (req) => {
    await fastify.authenticate(req);
    return service.getIssueItem(req.params.id);
  });

  fastify.put("/issues/:id", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      user_id: { required: false, type: "string" },
      title: { required: false, type: "string", minLength: 2 },
      message: { required: false, type: "string", minLength: 2 },
      status: { required: false, type: "string", enum: ISSUE_STATUS_VALUES }
    }, req.body);

    return service.updateIssue(req.params.id, req.body);
  });

  fastify.delete("/issues/:id", async (req) => {
    await fastify.authenticate(req);
    return service.deleteIssue(req.params.id);
  });
};
