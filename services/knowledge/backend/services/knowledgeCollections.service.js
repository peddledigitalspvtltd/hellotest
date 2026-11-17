"use strict";

function createKnowledgeCollections({
  db, uuid, normalizeText, normalizeId, normalizeFilterIds,
  resolveAllowedSourcePermissions, permissionService
} = {}) {
  if (!db || typeof uuid !== "function" || typeof normalizeText !== "function"
      || typeof normalizeId !== "function" || typeof normalizeFilterIds !== "function"
      || typeof resolveAllowedSourcePermissions !== "function" || !permissionService) {
    throw new Error("Knowledge collection operations require their storage and authorization ports.");
  }

  const buildCollectionCountsSql = allowedSourcePermissions => {
    const aclScoped = Array.isArray(allowedSourcePermissions);
    const sourceAcl = !aclScoped ? "" : allowedSourcePermissions.length
      ? `AND (sources.required_permission IS NULL OR sources.required_permission IN (${allowedSourcePermissions.map(() => "?").join(", ")}))`
      : "AND sources.required_permission IS NULL";
    return `
      SELECT collections.*,
        COUNT(DISTINCT sources.id)::INTEGER AS source_count,
        COUNT(DISTINCT documents.id)::INTEGER AS document_count,
        COUNT(DISTINCT chunks.id)::INTEGER AS chunk_count
      FROM ai_knowledge_collections collections
      LEFT JOIN ai_knowledge_collection_sources links ON links.collection_id = collections.id
      LEFT JOIN ai_knowledge_sources sources ON sources.id = links.source_id ${sourceAcl}
      LEFT JOIN ai_knowledge_documents documents ON documents.source_id = sources.id AND documents.is_active = TRUE
      LEFT JOIN ai_knowledge_chunks chunks ON chunks.document_id = documents.id
    `;
  };
  const asObject = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};

  const listCollections = async (projectId, { allowedSourcePermissions } = {}) => db.prepare(`${buildCollectionCountsSql(allowedSourcePermissions)}
    WHERE collections.project_id = ? GROUP BY collections.id ORDER BY collections.updated_at DESC
  `).all(...(Array.isArray(allowedSourcePermissions) ? allowedSourcePermissions : []), projectId);

  const getCollection = async (id, { allowedSourcePermissions } = {}) => {
    const collection = await db.prepare(`${buildCollectionCountsSql(allowedSourcePermissions)}
      WHERE collections.id = ? GROUP BY collections.id
    `).get(...(Array.isArray(allowedSourcePermissions) ? allowedSourcePermissions : []), id);
    if (!collection) throw Object.assign(new Error("Knowledge collection not found."), { statusCode: 404 });
    return collection;
  };

  const createCollection = async ({ projectId, appTypeId, name, description, color, retrievalConfig, userId }) => {
    const id = uuid(), normalizedName = normalizeText(name, 240);
    if (!projectId || !normalizedName) throw Object.assign(new Error("project_id and name are required."), { statusCode: 400 });
    await db.prepare(`INSERT INTO ai_knowledge_collections
      (id, project_id, app_type_id, name, description, color, retrieval_config, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, projectId, appTypeId || null, normalizedName, normalizeText(description, 4_000) || null,
      normalizeText(color, 40) || null, asObject(retrievalConfig), userId || null);
    return getCollection(id);
  };

  const updateCollection = async (id, data = {}) => {
    const current = await getCollection(id);
    const status = data.status === "archived" ? "archived" : data.status === "active" ? "active" : current.status;
    await db.prepare(`UPDATE ai_knowledge_collections SET app_type_id = ?, name = ?, description = ?, color = ?, status = ?,
      retrieval_config = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
      Object.prototype.hasOwnProperty.call(data, "app_type_id") ? normalizeId(data.app_type_id) || null : current.app_type_id,
      normalizeText(data.name, 240) || current.name,
      Object.prototype.hasOwnProperty.call(data, "description") ? normalizeText(data.description, 4_000) || null : current.description,
      Object.prototype.hasOwnProperty.call(data, "color") ? normalizeText(data.color, 40) || null : current.color,
      status,
      Object.prototype.hasOwnProperty.call(data, "retrieval_config") ? asObject(data.retrieval_config) : asObject(current.retrieval_config), id);
    return getCollection(id);
  };

  const deleteCollection = async id => {
    const collection = await getCollection(id);
    await db.prepare("DELETE FROM ai_knowledge_collections WHERE id = ?").run(id);
    return { deleted: true, id, project_id: collection.project_id, sources_retained: true };
  };

  const assertSourceRowsVisible = async (projectId, rows, user) => {
    const permissions = [...new Set(rows.map(row => row.required_permission).filter(Boolean))];
    for (const permissionCode of permissions) {
      if (!user || !await permissionService.hasPermission(user, permissionCode, projectId)) {
        throw Object.assign(new Error(`Permission required for selected knowledge source: ${permissionCode}`), {
          statusCode: 403, code: "KNOWLEDGE_SOURCE_PERMISSION_REQUIRED"
        });
      }
    }
  };

  const linkCollectionSources = async (collectionId, sourceIds, user) => {
    const collection = await getCollection(collectionId), ids = normalizeFilterIds(sourceIds, 500);
    if (!ids.length) throw Object.assign(new Error("source_ids must include at least one source."), { statusCode: 400 });
    const rows = await db.prepare(`SELECT id, required_permission FROM ai_knowledge_sources
      WHERE project_id = ? AND id IN (${ids.map(() => "?").join(", ")})`).all(collection.project_id, ...ids);
    if (rows.length !== ids.length) throw Object.assign(new Error("One or more knowledge sources do not belong to this project."), { statusCode: 403 });
    await assertSourceRowsVisible(collection.project_id, rows, user);
    await db.transaction(async () => {
      for (const id of ids) await db.prepare(`INSERT INTO ai_knowledge_collection_sources (collection_id, source_id)
        VALUES (?, ?) ON CONFLICT DO NOTHING`).run(collectionId, id);
    })();
    return getCollection(collectionId, { allowedSourcePermissions: await resolveAllowedSourcePermissions(user, collection.project_id) });
  };

  const unlinkCollectionSources = async (collectionId, sourceIds, user) => {
    const collection = await getCollection(collectionId), ids = normalizeFilterIds(sourceIds, 500);
    if (ids.length) {
      const placeholders = ids.map(() => "?").join(", ");
      const rows = await db.prepare(`SELECT sources.id, sources.required_permission FROM ai_knowledge_collection_sources links
        JOIN ai_knowledge_sources sources ON sources.id = links.source_id
        WHERE links.collection_id = ? AND sources.project_id = ? AND sources.id IN (${placeholders})
      `).all(collectionId, collection.project_id, ...ids);
      if (rows.length !== ids.length) throw Object.assign(new Error("One or more knowledge sources are not linked to this project collection."), { statusCode: 404 });
      await assertSourceRowsVisible(collection.project_id, rows, user);
      await db.transaction(async () => {
        await db.prepare(`DELETE FROM ai_knowledge_collection_sources WHERE collection_id = ? AND source_id IN (${placeholders})`).run(collectionId, ...ids);
      })();
    }
    return getCollection(collectionId, { allowedSourcePermissions: await resolveAllowedSourcePermissions(user, collection.project_id) });
  };

  return { buildCollectionCountsSql, listCollections, getCollection, createCollection, updateCollection,
    deleteCollection, linkCollectionSources, unlinkCollectionSources };
}

module.exports = { createKnowledgeCollections };
