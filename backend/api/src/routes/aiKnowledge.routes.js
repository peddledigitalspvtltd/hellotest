const aiKnowledgeService = require("../services/aiKnowledge.service");
const projectService = require("../services/project.service");

module.exports = async function (fastify) {
  fastify.get("/projects/:project_id/knowledge", async (req) => {
    await fastify.authenticate(req);
    await projectService.getProject(req.params.project_id, req.user.id);
    const items = await aiKnowledgeService.listKnowledge(req.params.project_id);
    return items;
  });

  fastify.post("/projects/:project_id/knowledge", async (req) => {
    await fastify.authenticate(req);
    await projectService.getProject(req.params.project_id, req.user.id);
    const item = await aiKnowledgeService.createKnowledge(req.params.project_id, req.body);
    return item;
  });

  fastify.put("/projects/:project_id/knowledge/:id", async (req) => {
    await fastify.authenticate(req);
    await projectService.getProject(req.params.project_id, req.user.id);
    const item = await aiKnowledgeService.updateKnowledgeItem(req.params.project_id, req.params.id, req.body);
    return item;
  });

  fastify.delete("/projects/:project_id/knowledge/:id", async (req) => {
    await fastify.authenticate(req);
    await projectService.getProject(req.params.project_id, req.user.id);
    return aiKnowledgeService.deleteKnowledgeItem(req.params.project_id, req.params.id);
  });
};
