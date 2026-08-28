const { randomUUID: uuid } = require("crypto");
const db = require("../db");
const knowledgeRagService = require("./knowledgeRag.service");
const permissionService = require("./permission.service");
const featureFlagService = require("./featureFlag.service");
const { fingerprint, sanitizeKnowledgeText } = require("./knowledgeProcessing.service");

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
  SELECT id, project_id, app_type_id, asset_type, module_name, feature_name, priority,
    item_version, item_status, source, title, description, content_type, content, metadata,
    linked_test_cases, source_uri, is_active, created_at, updated_at
  FROM ai_knowledge_repo
  WHERE project_id = ?
  ORDER BY created_at DESC
`);

const selectKnowledgeById = db.prepare(`
  SELECT id, project_id, app_type_id, asset_type, module_name, feature_name, priority,
    item_version, item_status, source, title, description, content_type, content, metadata,
    linked_test_cases, source_uri, is_active, created_at, updated_at
  FROM ai_knowledge_repo
  WHERE id = ? AND project_id = ?
`);

const selectActiveKnowledgeForAppType = db.prepare(`
  SELECT id, project_id, app_type_id, asset_type, module_name, feature_name, priority,
    item_version, item_status, source, title, description, content_type, content, metadata,
    linked_test_cases, source_uri, is_active, created_at, updated_at
  FROM ai_knowledge_repo
  WHERE project_id = ? AND (app_type_id = ? OR app_type_id IS NULL) AND is_active = TRUE
  ORDER BY created_at DESC
  LIMIT 20
`);

const selectKnowledgeWithFilters = db.prepare(`
  SELECT id, project_id, app_type_id, asset_type, module_name, feature_name, priority,
    item_version, item_status, source, title, description, content_type, content, metadata,
    linked_test_cases, source_uri, is_active, created_at, updated_at
  FROM ai_knowledge_repo
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

const normalizeRelationEntityType = (value) => {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const aliases = {
    story: "requirement",
    test_run: "execution",
    run: "execution",
    feedback: "bug",
    issue: "bug",
    knowledge: "knowledge_item"
  };
  const resolved = aliases[normalized] || normalized;
  return ["knowledge_item", "requirement", "test_case", "execution", "bug"].includes(resolved) ? resolved : null;
};

const RELATION_PERMISSION_BY_TYPE = Object.freeze({
  requirement: "requirement.view",
  test_case: "testcase.view",
  execution: "run.view",
  bug: "feedback.view",
  knowledge_item: "knowledge.view"
});

const canAccessRelationEntityType = async (projectId, user, type) => {
  const normalizedType = normalizeRelationEntityType(type);
  const permission = RELATION_PERMISSION_BY_TYPE[normalizedType];
  return Boolean(permission && user && await permissionService.hasPermission(user, permission, projectId));
};

const assertRelationEntityPermission = async (projectId, user, type) => {
  if (await canAccessRelationEntityType(projectId, user, type)) return;
  const error = new Error("You do not have permission to link this project record as Knowledge context.");
  error.statusCode = 403;
  throw error;
};

const filterRelationsForUser = async (projectId, relations, user) => {
  if (!user) return [];
  const visible = [];
  for (const relation of relations) {
    const [canReadSource, canReadTarget] = await Promise.all([
      canAccessRelationEntityType(projectId, user, relation.source_type),
      canAccessRelationEntityType(projectId, user, relation.target_type)
    ]);
    if (canReadSource && canReadTarget) visible.push(relation);
  }
  return visible;
};

const assertRelationEntityInProject = async (projectId, type, id) => {
  const normalizedType = normalizeRelationEntityType(type);
  const normalizedId = String(id || "").trim();
  if (!normalizedType || !normalizedId) {
    const error = new Error("Knowledge relations require supported source/target types and IDs.");
    error.statusCode = 400;
    throw error;
  }
  const queries = {
    knowledge_item: "SELECT id FROM ai_knowledge_repo WHERE id = ? AND project_id = ?",
    requirement: "SELECT id FROM requirements WHERE id = ? AND project_id = ?",
    test_case: "SELECT test_cases.id FROM test_cases JOIN app_types ON app_types.id = test_cases.app_type_id WHERE test_cases.id = ? AND app_types.project_id = ?",
    execution: "SELECT id FROM executions WHERE id = ? AND project_id = ?",
    bug: "SELECT id FROM feedback WHERE id = ? AND project_id = ?"
  };
  const row = await db.prepare(queries[normalizedType]).get(normalizedId, projectId);
  if (!row) {
    const error = new Error(`Knowledge relation ${normalizedType} record was not found in this project.`);
    error.statusCode = 404;
    throw error;
  }
  return { type: normalizedType, id: normalizedId };
};

const sanitizeLegacyKnowledgeForContext = (item = {}) => {
  const sanitizedFields = {};
  let redactionCount = 0;
  const riskFlags = new Set();
  const sanitizeField = (field, maxLength) => {
    const sanitized = sanitizeKnowledgeText(String(item[field] || "").slice(0, maxLength));
    sanitizedFields[field] = sanitized.text || null;
    redactionCount += sanitized.redaction_count;
    for (const flag of sanitized.risk_flags) riskFlags.add(flag);
  };
  sanitizeField("title", 500);
  sanitizeField("description", 4_000);
  sanitizeField("content", 40_000);
  sanitizeField("module_name", 500);
  sanitizeField("feature_name", 500);

  return {
    id: item.id,
    project_id: item.project_id,
    app_type_id: item.app_type_id || null,
    asset_type: normalizeAssetType(item.asset_type) || "knowledge_item",
    module_name: sanitizedFields.module_name,
    feature_name: sanitizedFields.feature_name,
    priority: normalizeSearchText(item.priority),
    item_version: normalizeSearchText(item.item_version),
    item_status: normalizeSearchText(item.item_status),
    source: normalizeSearchText(item.source),
    title: sanitizedFields.title || "Knowledge context",
    description: sanitizedFields.description,
    content_type: normalizeContentType(item.content_type),
    content: sanitizedFields.content || "",
    metadata: {
      legacy_source_id: item.id,
      sanitized_for_context: true,
      content_fingerprint: fingerprint(sanitizedFields.content || ""),
      redaction_count: redactionCount,
      risk_flags: [...riskFlags]
    },
    linked_test_cases: normalizeLinkedTestCases(item.linked_test_cases),
    source_uri: null,
    is_active: item.is_active !== false
  };
};

const normalizeSearchText = (value) => {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

exports.createKnowledge = async (projectId, data, userId) => {
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
    embedding: null,
    source_uri: data.source_uri || null,
    is_active: data.is_active !== undefined ? Boolean(data.is_active) : true
  };

  await db.transaction(async () => {
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
    await knowledgeRagService.queueLegacyKnowledgeSync({ projectId, sourceRefId: record.id, userId, action: record.is_active ? "upsert" : "archive" });
  })();
  const { embedding, ...publicRecord } = record;
  return publicRecord;
};

exports.listKnowledge = async (projectId) => {
  return safeKnowledgeRead(() => selectKnowledgeForProject.all(projectId), []);
};

exports.getActiveKnowledgeForLLM = async (projectId, appTypeId) => {
  const rows = await safeKnowledgeRead(() => selectActiveKnowledgeForAppType.all(projectId, appTypeId), []);
  return rows.map(sanitizeLegacyKnowledgeForContext);
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

exports.createKnowledgeRelation = async (projectId, relation, user) => {
  const [source, target] = await Promise.all([
    assertRelationEntityInProject(projectId, relation?.source_type, relation?.source_id),
    assertRelationEntityInProject(projectId, relation?.target_type, relation?.target_id)
  ]);
  await Promise.all([
    assertRelationEntityPermission(projectId, user, source.type),
    assertRelationEntityPermission(projectId, user, target.type)
  ]);
  const relationType = String(relation?.relation_type || "").trim().slice(0, 120);
  if (!relationType) {
    const error = new Error("relation_type is required.");
    error.statusCode = 400;
    throw error;
  }
  const id = uuid();
  await insertKnowledgeRelation.run(
    id,
    projectId,
    source.id,
    source.type,
    target.type,
    target.id,
    relationType,
    {}
  );

  return { id, project_id: projectId, source_id: source.id, source_type: source.type, target_type: target.type, target_id: target.id, relation_type: relationType, metadata: {} };
};

exports.getKnowledgeRelationsBySource = async (projectId, sourceId, user) => {
  const relations = await safeKnowledgeRead(() => selectKnowledgeRelationsBySource.all(projectId, sourceId), []);
  return filterRelationsForUser(projectId, relations, user);
};

exports.getKnowledgeRelationsByTarget = async (projectId, targetId, user) => {
  const relations = await safeKnowledgeRead(() => selectKnowledgeRelationsByTarget.all(projectId, targetId), []);
  return filterRelationsForUser(projectId, relations, user);
};

exports.buildKnowledgeContextPackage = async (projectId, options = {}) => {
  const [canViewKnowledge, knowledgeFeatureEnabled] = options.user ? await Promise.all([
    permissionService.hasPermission(options.user, "knowledge.view", projectId),
    featureFlagService.isEnabled("hellotest.ai.knowledge", { user: options.user })
  ]) : [false, false];
  if (!canViewKnowledge || !knowledgeFeatureEnabled) {
    return {
      project_id: projectId,
      query: options.query || null,
      filters: {},
      knowledge: [],
      related_context: [],
      access_restricted: true,
      restriction_reason: !knowledgeFeatureEnabled ? "feature_disabled" : "permission_denied"
    };
  }
  const legacyKnowledge = await exports.searchKnowledge(projectId, {
    app_type_id: options.app_type_id,
    asset_type: options.asset_type,
    module_name: options.module_name,
    feature_name: options.feature_name,
    item_version: options.item_version,
    query: options.query,
    priority: options.priority,
    limit: Math.min(20, Number(options.limit || 20))
  });
  const sanitizedLegacyKnowledge = legacyKnowledge.map(sanitizeLegacyKnowledgeForContext);
  let ragKnowledge = [];
  if (normalizeSearchText(options.query)) {
    const retrieval = await knowledgeRagService.search({
      projectId,
      query: options.query,
      limit: Math.min(12, Number(options.limit || 12)),
      filters: {
        app_type_id: options.app_type_id || undefined
      },
      user: options.user,
      allowedSourcePermissions: options.allowed_source_permissions
    });
    ragKnowledge = retrieval.results.map((hit) => ({
      id: hit.source_id,
      project_id: projectId,
      app_type_id: options.app_type_id || null,
      asset_type: hit.source_kind,
      source: "rag_retrieval",
      title: hit.title,
      description: hit.excerpt,
      content_type: "text",
      content: hit.content,
      source_uri: null,
      is_active: true,
      metadata: {
        retrieval_score: hit.score,
        citation: hit.citation,
        document_id: hit.document_id,
        chunk_id: hit.chunk_id,
        legacy_source_id: hit.source_kind === "knowledge_item" ? hit.source_ref_id : null,
        sanitized_for_context: true
      }
    }));
  }
  const seenChunks = new Set();
  const knowledge = [...ragKnowledge, ...sanitizedLegacyKnowledge].filter((item) => {
    const key = item.metadata?.legacy_source_id
      ? `legacy:${item.metadata.legacy_source_id}`
      : item.metadata?.chunk_id || `legacy:${item.id}`;
    if (seenChunks.has(key)) return false;
    seenChunks.add(key);
    return true;
  }).slice(0, Math.min(20, Number(options.limit || 20)));

  const relatedContexts = [];
  if (options.source_id) {
    const relations = await exports.getKnowledgeRelationsBySource(projectId, options.source_id, options.user);
    for (const relation of relations) {
      relatedContexts.push({
        id: relation.id,
        project_id: relation.project_id,
        source_id: relation.source_id,
        source_type: relation.source_type,
        target_type: relation.target_type,
        target_id: relation.target_id,
        relation_type: relation.relation_type,
        metadata: { sanitized_for_context: true }
      });
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

exports.updateKnowledgeItem = async (projectId, id, data, userId) => {
  return db.transaction(async () => {
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
    null,
    id,
    projectId
    );
    const record = await selectKnowledgeById.get(id, projectId);
    if (!record) {
      const error = new Error("Knowledge item not found.");
      error.statusCode = 404;
      throw error;
    }
    await knowledgeRagService.queueLegacyKnowledgeSync({ projectId, sourceRefId: record.id, userId, action: record.is_active ? "upsert" : "archive" });
    return record;
  })();
};

exports.deleteKnowledgeItem = async (projectId, id) => {
  return db.transaction(async () => {
    // Retrieval is deactivated in the same transaction as the legacy delete;
    // binary/provider work is never performed while this mutation holds a lock.
    await knowledgeRagService.archiveLegacyKnowledgeSource(projectId, id);
    await knowledgeRagService.queueLegacyKnowledgeSync({ projectId, sourceRefId: id, action: "archive" });
    await db.prepare(`
      DELETE FROM ai_knowledge_relations
      WHERE project_id = ? AND (
        (source_id = ? AND source_type = 'knowledge_item')
        OR (target_id = ? AND target_type = 'knowledge_item')
      )
    `).run(projectId, id, id);
    const result = await deleteKnowledge.run(id, projectId);
    if (!result.changes) {
      const error = new Error("Knowledge item not found.");
      error.statusCode = 404;
      throw error;
    }
    return { success: true };
  })();
};

exports._internals = {
  assertRelationEntityInProject,
  canAccessRelationEntityType,
  filterRelationsForUser,
  normalizeRelationEntityType,
  sanitizeLegacyKnowledgeForContext
};
