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

  fastify.get("/projects/:project_id/knowledge/search", async (req) => {
    await fastify.authenticate(req);
    await projectService.getProject(req.params.project_id, req.user.id);
    const filters = {
      app_type_id: req.query.app_type_id,
      asset_type: req.query.asset_type,
      module_name: req.query.module_name,
      feature_name: req.query.feature_name,
      item_status: req.query.item_status,
      source: req.query.source,
      priority: req.query.priority,
      item_version: req.query.item_version,
      query: req.query.query,
      limit: Number(req.query.limit || 20)
    };
    return aiKnowledgeService.searchKnowledge(req.params.project_id, filters);
  });

  fastify.get("/projects/:project_id/knowledge/context-package", async (req) => {
    await fastify.authenticate(req);
    await projectService.getProject(req.params.project_id, req.user.id);
    const options = {
      app_type_id: req.query.app_type_id,
      asset_type: req.query.asset_type,
      module_name: req.query.module_name,
      feature_name: req.query.feature_name,
      item_version: req.query.item_version,
      priority: req.query.priority,
      query: req.query.query,
      source_id: req.query.source_id
    };
    return aiKnowledgeService.buildKnowledgeContextPackage(req.params.project_id, options);
  });

  fastify.post("/projects/:project_id/knowledge/relations", async (req) => {
    await fastify.authenticate(req);
    await projectService.getProject(req.params.project_id, req.user.id);
    return aiKnowledgeService.createKnowledgeRelation(req.params.project_id, req.body);
  });

  fastify.get("/projects/:project_id/knowledge/relations/source/:source_id", async (req) => {
    await fastify.authenticate(req);
    await projectService.getProject(req.params.project_id, req.user.id);
    return aiKnowledgeService.getKnowledgeRelationsBySource(req.params.project_id, req.params.source_id);
  });

  fastify.get("/projects/:project_id/knowledge/relations/target/:target_id", async (req) => {
    await fastify.authenticate(req);
    await projectService.getProject(req.params.project_id, req.user.id);
    return aiKnowledgeService.getKnowledgeRelationsByTarget(req.params.project_id, req.params.target_id);
  });

  fastify.delete("/projects/:project_id/knowledge/:id", async (req) => {
    await fastify.authenticate(req);
    await projectService.getProject(req.params.project_id, req.user.id);
    return aiKnowledgeService.deleteKnowledgeItem(req.params.project_id, req.params.id);
  });
};
