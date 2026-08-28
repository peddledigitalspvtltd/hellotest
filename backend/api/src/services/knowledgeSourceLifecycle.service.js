const db = require("../db");
const attachmentService = require("./attachment.service");
const knowledgeRagService = require("./knowledgeRag.service");

const createError = (message, statusCode) => Object.assign(new Error(message), { statusCode });

const list = async ({ projectId, allowedSourcePermissions = [] }) => {
  const permissions = [...new Set(allowedSourcePermissions.map((value) => String(value || "").trim()).filter(Boolean))];
  const aclClause = permissions.length
    ? `AND (sources.required_permission IS NULL OR sources.required_permission IN (${permissions.map(() => "?").join(", ")}))`
    : "AND sources.required_permission IS NULL";
  return db.prepare(`
    SELECT sources.id, sources.project_id, sources.app_type_id, sources.source_kind,
      sources.source_ref_id, sources.title, sources.source_uri, sources.file_name,
      sources.mime_type, sources.size_bytes, sources.attachment_id, sources.checksum_sha256,
      sources.extraction_status, sources.extraction_strategy, sources.risk_flags,
      sources.created_at, sources.updated_at,
      COUNT(DISTINCT documents.id)::INTEGER AS document_count,
      COUNT(DISTINCT chunks.id)::INTEGER AS chunk_count,
      ARRAY(SELECT collection_id FROM ai_knowledge_collection_sources links WHERE links.source_id = sources.id) AS collection_ids
    FROM ai_knowledge_sources sources
    LEFT JOIN ai_knowledge_documents documents ON documents.source_id = sources.id AND documents.is_active = TRUE
    LEFT JOIN ai_knowledge_chunks chunks ON chunks.document_id = documents.id
    WHERE sources.project_id = ? AND sources.extraction_status <> 'archived' ${aclClause}
    GROUP BY sources.id ORDER BY sources.updated_at DESC LIMIT 500
  `).all(projectId, ...permissions);
};

const get = async (id, { activeOnly = false } = {}) => {
  const source = await db.prepare(`
    SELECT id, project_id, app_type_id, app_scope_key, source_kind, source_ref_id,
      source_uri, file_name, mime_type, size_bytes, checksum_sha256, attachment_id,
      required_permission, extraction_status
    FROM ai_knowledge_sources
    WHERE id = ? ${activeOnly ? "AND extraction_status <> 'archived'" : ""}
  `).get(id);
  if (!source) throw createError("Knowledge source not found.", 404);
  return source;
};

const getDownload = async (id) => {
  const source = await get(id, { activeOnly: true });
  if (!source.attachment_id) throw createError("Knowledge source file not found.", 404);
  return source;
};

const archiveSourceAndCancelWork = (source) => db.transaction(async () => {
  const sourceStableKey = knowledgeRagService._internals.stableSourceKey(source);
  const canceledJobs = await db.prepare(`
    SELECT jobs.id
    FROM ai_knowledge_ingestion_jobs jobs
    WHERE (
      jobs.project_id = ? AND jobs.status IN ('queued', 'running')
        AND EXISTS (
          SELECT 1 FROM ai_knowledge_ingestion_inputs inputs
          WHERE inputs.job_id = jobs.id AND (
            inputs.payload->>'source_id' = ?
            OR (?::TEXT IS NOT NULL AND inputs.payload->>'stable_source_key' = ?)
          )
        )
    ) OR (
      jobs.project_id = ? AND jobs.status IN ('queued', 'running')
        AND ?::TEXT IS NOT NULL AND jobs.config->>'stable_source_key' = ?
    )
    FOR UPDATE
  `).all(
    source.project_id, source.id, sourceStableKey, sourceStableKey,
    source.project_id, sourceStableKey, sourceStableKey
  );
  if (canceledJobs.length) {
    const placeholders = canceledJobs.map(() => "?").join(", ");
    const jobIds = canceledJobs.map((job) => job.id);
    await db.prepare(`
      UPDATE ai_knowledge_ingestion_jobs jobs
      SET status = 'failed', failed_count = GREATEST(failed_count, 1),
        errors = errors || ?::jsonb, completed_at = CURRENT_TIMESTAMP,
        lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE jobs.id IN (${placeholders})
    `).run([{ code: "source_deleted" }], ...jobIds);
    await db.prepare(`
      DELETE FROM ai_knowledge_ingestion_inputs WHERE job_id IN (${placeholders})
    `).run(...jobIds);
  }
  await db.prepare(`
    UPDATE ai_knowledge_sources
    SET extraction_status = 'archived',
      revision_token = id || ':archived:' || EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)::TEXT || ':' || RANDOM()::TEXT,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND project_id = ?
  `).run(source.id, source.project_id);
  await db.prepare(`
    UPDATE ai_knowledge_documents
    SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
    WHERE source_id = ? AND is_active = TRUE
  `).run(source.id);
})();

const remove = async ({ source, user }) => {
  await archiveSourceAndCancelWork(source);
  const attachmentRows = await db.prepare(`
    SELECT id FROM attachments
    WHERE project_id = ? AND entity_type = 'knowledge_source' AND entity_id = ?
    ORDER BY created_at ASC, id ASC
  `).all(source.project_id, source.id);
  let attachmentsDeleted = 0;
  for (const attachmentRow of attachmentRows) {
    try {
      await attachmentService.remove({
        user,
        id: attachmentRow.id,
        permissionCode: "knowledge.manage"
      });
      attachmentsDeleted += 1;
    } catch (error) {
      if (Number(error?.statusCode) !== 404) throw error;
    }
  }
  const result = await db.prepare(`
    DELETE FROM ai_knowledge_sources WHERE id = ? AND project_id = ?
  `).run(source.id, source.project_id);
  if (!result.changes) throw createError("Knowledge source was not deleted.", 409);
  return {
    deleted: true,
    id: source.id,
    project_id: source.project_id,
    attachment_deleted: attachmentsDeleted > 0,
    attachments_deleted: attachmentsDeleted,
    dependent_documents_deleted: true,
    collection_links_deleted: true
  };
};

module.exports = {
  get,
  getDownload,
  list,
  remove
};
