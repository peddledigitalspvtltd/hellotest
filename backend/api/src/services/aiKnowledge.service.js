const { v4: uuid } = require("uuid");
const db = require("../db");

const insertKnowledge = db.prepare(`
  INSERT INTO ai_knowledge_repo (id, project_id, app_type_id, title, description, content_type, content, is_active)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const selectKnowledgeForProject = db.prepare(`
  SELECT * FROM ai_knowledge_repo
  WHERE project_id = ?
  ORDER BY created_at DESC
`);

const selectActiveKnowledgeForAppType = db.prepare(`
  SELECT * FROM ai_knowledge_repo
  WHERE project_id = ? AND (app_type_id = ? OR app_type_id IS NULL) AND is_active = TRUE
  ORDER BY created_at DESC
`);

const updateKnowledge = db.prepare(`
  UPDATE ai_knowledge_repo
  SET title = ?, description = ?, content_type = ?, content = ?, is_active = ?, app_type_id = ?
  WHERE id = ? AND project_id = ?
`);

const deleteKnowledge = db.prepare(`
  DELETE FROM ai_knowledge_repo
  WHERE id = ? AND project_id = ?
`);

exports.createKnowledge = (projectId, data) => {
  const id = uuid();
  insertKnowledge.run(
    id,
    projectId,
    data.app_type_id || null,
    data.title,
    data.description || null,
    data.content_type || "text",
    data.content,
    data.is_active !== undefined ? (data.is_active ? 1 : 0) : 1
  );
  return { id, ...data };
};

exports.listKnowledge = (projectId) => {
  return selectKnowledgeForProject.all(projectId);
};

exports.getActiveKnowledgeForLLM = (projectId, appTypeId) => {
  return selectActiveKnowledgeForAppType.all(projectId, appTypeId);
};

exports.updateKnowledgeItem = (projectId, id, data) => {
  updateKnowledge.run(
    data.title,
    data.description || null,
    data.content_type || "text",
    data.content,
    data.is_active ? 1 : 0,
    data.app_type_id || null,
    id,
    projectId
  );
  return { id, ...data };
};

exports.deleteKnowledgeItem = (projectId, id) => {
  deleteKnowledge.run(id, projectId);
  return { success: true };
};
