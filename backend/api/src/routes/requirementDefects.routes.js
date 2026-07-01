const service = require("../services/requirementDefect.service");

module.exports = async function (fastify) {
  fastify.get("/requirement-defects", async (req) => {
    await fastify.authenticate(req);
    const { requirement_id, issue_id } = req.query;
    return service.listMappings({ requirement_id, issue_id });
  });

  fastify.put("/requirement-defects/replace", async (req) => {
    await fastify.authenticate(req);

    fastify.validate({
      requirement_id: { required: true, type: "string" },
      issue_ids: { required: true, type: "array", items: "string" }
    }, req.body);

    return service.replaceMappingsForRequirement(req.body.requirement_id, req.body.issue_ids);
  });
};
