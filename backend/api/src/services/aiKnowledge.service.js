const { v4: uuid } = require("uuid");
const db = require("../db");

const isMissingKnowledgeRepo = (error) =>
  error?.code === "42P01" || /relation ["']?ai_knowledge_repo["']? does not exist/i.test(String(error?.message || ""));

const safeKnowledgeRead = async (operation, fallback = []) => {
  try {
    return await operation();
  } catch (error) {
    if (isMissingKnowledgeRepo(error)) {
      console.warn("[aiKnowledge] ai_knowledge_repo is not available yet; continuing without knowledge context.");
      return fallback;
    }

    throw error;
  }
};

const normalizeContentType = (value) => {
  const normalized = String(value || "text").trim().toLowerCase();
  return ["text", "url", "video_url", "file", "pdf", "image", "markdown"].includes(normalized) ? normalized : "text";
};

const insertKnowledge = db.prepare(`
  INSERT INTO ai_knowledge_repo (id, project_id, app_type_id, title, description, content_type, content, metadata, source_uri, is_active)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  LIMIT 20
`);

const updateKnowledge = db.prepare(`
  UPDATE ai_knowledge_repo
  SET title = ?, description = ?, content_type = ?, content = ?, metadata = ?, source_uri = ?, is_active = ?, app_type_id = ?, updated_at = CURRENT_TIMESTAMP
  WHERE id = ? AND project_id = ?
`);

const deleteKnowledge = db.prepare(`
  DELETE FROM ai_knowledge_repo
  WHERE id = ? AND project_id = ?
`);

exports.createKnowledge = async (projectId, data) => {
  const id = uuid();
  const record = {
    id,
    project_id: projectId,
    app_type_id: data.app_type_id || null,
    title: data.title,
    description: data.description || null,
    content_type: normalizeContentType(data.content_type),
    content: data.content || "",
    metadata: data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata) ? data.metadata : {},
    source_uri: data.source_uri || null,
    is_active: data.is_active !== undefined ? Boolean(data.is_active) : true
  };

  await insertKnowledge.run(
    record.id,
    record.project_id,
    record.app_type_id,
    record.title,
    record.description,
    record.content_type,
    record.content,
    record.metadata,
    record.source_uri,
    record.is_active
  );
  return record;
};

exports.listKnowledge = async (projectId) => {
  return safeKnowledgeRead(() => selectKnowledgeForProject.all(projectId), []);
};

exports.getActiveKnowledgeForLLM = async (projectId, appTypeId) => {
  return safeKnowledgeRead(() => selectActiveKnowledgeForAppType.all(projectId, appTypeId), []);
};

exports.updateKnowledgeItem = async (projectId, id, data) => {
  await updateKnowledge.run(
    data.title,
    data.description || null,
    normalizeContentType(data.content_type),
    data.content || "",
    data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata) ? data.metadata : {},
    data.source_uri || null,
    data.is_active !== undefined ? Boolean(data.is_active) : true,
    data.app_type_id || null,
    id,
    projectId
  );
  return { id, ...data };
};

exports.deleteKnowledgeItem = async (projectId, id) => {
  await deleteKnowledge.run(id, projectId);
  return { success: true };
};
