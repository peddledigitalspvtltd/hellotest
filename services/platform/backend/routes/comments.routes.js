const commentService = require("../services/comment.service");

module.exports = async function (fastify) {
  fastify.get("/comments", async (req) => {
    await fastify.authenticate(req);
    return commentService.list({
      user: req.user,
      entityType: req.query.entity_type,
      entityId: req.query.entity_id,
      projectId: req.query.project_id
    });
  });

  fastify.post("/comments", async (req) => {
    await fastify.authenticate(req);
    fastify.validate({
      project_id: { required: true, type: "string" },
      entity_type: { required: true, type: "string" },
      entity_id: { required: true, type: "string" },
      body: { required: true, type: "string", minLength: 1 }
    }, req.body || {});
    return commentService.create({
      user: req.user,
      entityType: req.body.entity_type,
      entityId: req.body.entity_id,
      projectId: req.body.project_id,
      body: req.body.body
    });
  });
};
