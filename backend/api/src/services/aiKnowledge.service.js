const { randomUUID: uuid } = require("crypto");
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
  INSERT INTO ai_knowledge_repo (
    id, project_id, app_type_id, asset_type, module_name, feature_name, priority, item_version, item_status, source,
    title, description, content_type, content, metadata, linked_test_cases, embedding, source_uri, is_active
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

const selectKnowledgeWithFilters = db.prepare(`
  SELECT * FROM ai_knowledge_repo
  WHERE project_id = ?
    AND is_active = TRUE
    AND (?::text IS NULL OR app_type_id = ?::text OR app_type_id IS NULL)
    AND (?::text IS NULL OR asset_type = ?::text)
    AND (?::text IS NULL OR module_name = ?::text)
    AND (?::text IS NULL OR feature_name = ?::text)
    AND (?::text IS NULL OR item_status = ?::text)
    AND (?::text IS NULL OR source = ?::text)
    AND (?::text IS NULL OR priority = ?::text)
    AND (?::text IS NULL OR item_version = ?::text)
    AND (?::text IS NULL OR content ILIKE '%' || ?::text || '%' OR title ILIKE '%' || ?::text || '%')
  ORDER BY
    CASE
      WHEN priority = 'high' THEN 1
      WHEN priority = 'medium' THEN 2
      WHEN priority = 'low' THEN 4
      ELSE 3
    END,
    created_at DESC
  LIMIT ?
`);

const insertKnowledgeRelation = db.prepare(`
  INSERT INTO ai_knowledge_relations (
    id, project_id, source_id, source_type, target_type, target_id, relation_type, metadata
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const selectKnowledgeRelationsBySource = db.prepare(`
  SELECT * FROM ai_knowledge_relations
  WHERE project_id = ? AND source_id = ?
  ORDER BY created_at DESC
`);

const selectKnowledgeRelationsByTarget = db.prepare(`
  SELECT * FROM ai_knowledge_relations
  WHERE project_id = ? AND target_id = ?
  ORDER BY created_at DESC
`);

const updateKnowledge = db.prepare(`
  UPDATE ai_knowledge_repo
  SET title = ?, description = ?, content_type = ?, content = ?, metadata = ?, source_uri = ?, is_active = ?, app_type_id = ?, asset_type = ?, module_name = ?, feature_name = ?, priority = ?, item_version = ?, item_status = ?, source = ?, linked_test_cases = ?, embedding = ?, updated_at = CURRENT_TIMESTAMP
  WHERE id = ? AND project_id = ?
`);

const deleteKnowledge = db.prepare(`
  DELETE FROM ai_knowledge_repo
  WHERE id = ? AND project_id = ?
`);

const normalizeAssetType = (value) => {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
};

const normalizeLinkedTestCases = (value) => {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string");
};

const normalizeSearchText = (value) => {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

exports.createKnowledge = async (projectId, data) => {
  const id = uuid();
  const record = {
    id,
    project_id: projectId,
    app_type_id: data.app_type_id || null,
    asset_type: normalizeAssetType(data.asset_type),
    module_name: data.module_name || null,
    feature_name: data.feature_name || null,
    priority: data.priority || null,
    item_version: data.item_version || null,
    item_status: data.item_status || null,
    source: data.source || null,
    title: data.title,
    description: data.description || null,
    content_type: normalizeContentType(data.content_type),
    content: data.content || "",
    metadata: data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata) ? data.metadata : {},
    linked_test_cases: normalizeLinkedTestCases(data.linked_test_cases),
    embedding: data.embedding || null,
    source_uri: data.source_uri || null,
    is_active: data.is_active !== undefined ? Boolean(data.is_active) : true
  };

  await insertKnowledge.run(
    record.id,
    record.project_id,
    record.app_type_id,
    record.asset_type,
    record.module_name,
    record.feature_name,
    record.priority,
    record.item_version,
    record.item_status,
    record.source,
    record.title,
    record.description,
    record.content_type,
    record.content,
    record.metadata,
    record.linked_test_cases,
    record.embedding,
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

exports.searchKnowledge = async (projectId, filters = {}) => {
  const typeFilter = normalizeAssetType(filters.asset_type);
  const text = normalizeSearchText(filters.query);
  const results = await safeKnowledgeRead(
    () =>
      selectKnowledgeWithFilters.all(
        projectId,
        filters.app_type_id || null,
        filters.app_type_id || null,
        typeFilter || null,
        typeFilter || null,
        filters.module_name || null,
        filters.module_name || null,
        filters.feature_name || null,
        filters.feature_name || null,
        filters.item_status || null,
        filters.item_status || null,
        filters.source || null,
        filters.source || null,
        filters.priority || null,
        filters.priority || null,
        filters.item_version || null,
        filters.item_version || null,
        text,
        text,
        text,
        Number(filters.limit || 20)
      ),
    []
  );

  return results;
};

exports.createKnowledgeRelation = async (projectId, relation) => {
  const id = uuid();
  await insertKnowledgeRelation.run(
    id,
    projectId,
    relation.source_id,
    relation.source_type,
    relation.target_type,
    relation.target_id,
    relation.relation_type,
    relation.metadata && typeof relation.metadata === "object" && !Array.isArray(relation.metadata) ? relation.metadata : {}
  );

  return { id, project_id: projectId, ...relation };
};

exports.getKnowledgeRelationsBySource = async (projectId, sourceId) => {
  return safeKnowledgeRead(() => selectKnowledgeRelationsBySource.all(projectId, sourceId), []);
};

exports.getKnowledgeRelationsByTarget = async (projectId, targetId) => {
  return safeKnowledgeRead(() => selectKnowledgeRelationsByTarget.all(projectId, targetId), []);
};

exports.buildKnowledgeContextPackage = async (projectId, options = {}) => {
  const knowledge = await exports.searchKnowledge(projectId, {
    app_type_id: options.app_type_id,
    asset_type: options.asset_type,
    module_name: options.module_name,
    feature_name: options.feature_name,
    item_version: options.item_version,
    query: options.query,
    priority: options.priority
  });

  const relatedContexts = [];
  if (options.source_id) {
    const relations = await exports.getKnowledgeRelationsBySource(projectId, options.source_id);
    for (const relation of relations) {
      relatedContexts.push(relation);
    }
  }

  return {
    project_id: projectId,
    query: options.query || null,
    filters: {
      app_type_id: options.app_type_id || null,
      asset_type: options.asset_type || null,
      module_name: options.module_name || null,
      feature_name: options.feature_name || null,
      item_version: options.item_version || null,
      priority: options.priority || null
    },
    knowledge,
    related_context: relatedContexts
  };
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
    normalizeAssetType(data.asset_type),
    data.module_name || null,
    data.feature_name || null,
    data.priority || null,
    data.item_version || null,
    data.item_status || null,
    data.source || null,
    normalizeLinkedTestCases(data.linked_test_cases),
    data.embedding || null,
    id,
    projectId
  );
  return { id, ...data };
};

exports.deleteKnowledgeItem = async (projectId, id) => {
  await deleteKnowledge.run(id, projectId);
  return { success: true };
};
