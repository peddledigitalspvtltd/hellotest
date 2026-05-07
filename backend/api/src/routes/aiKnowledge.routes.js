const aiKnowledgeService = require("../services/aiKnowledge.service");

module.exports = async function (fastify) {
  fastify.get("/api/projects/:project_id/knowledge", async (req, reply) => {
    await fastify.authenticate(req);
    const items = aiKnowledgeService.listKnowledge(req.params.project_id);
    return items;
  });

  fastify.post("/api/projects/:project_id/knowledge", async (req, reply) => {
    await fastify.authenticate(req);
    const item = aiKnowledgeService.createKnowledge(req.params.project_id, req.body);
    return item;
  });

  fastify.put("/api/projects/:project_id/knowledge/:id", async (req, reply) => {
    await fastify.authenticate(req);
    const item = aiKnowledgeService.updateKnowledgeItem(req.params.project_id, req.params.id, req.body);
    return item;
  });

  fastify.delete("/api/projects/:project_id/knowledge/:id", async (req, reply) => {
    await fastify.authenticate(req);
    return aiKnowledgeService.deleteKnowledgeItem(req.params.project_id, req.params.id);
  });
};
