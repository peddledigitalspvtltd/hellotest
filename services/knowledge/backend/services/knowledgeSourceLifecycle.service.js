const db = require("@hellotest/platform/backend/src/db");
const knowledgeRagService = require("./knowledgeRag.service");
const knowledgeVectorProjection = require("./knowledgeVectorProjection.service");
const authorization = require("./knowledgeAuthorization.service");
const permissionService = require("@hellotest/platform/backend/services/permission.service");
const contracts = require("./knowledgeContracts.service");
const { createHash } = require("crypto");

const createError = (message, statusCode) => Object.assign(new Error(message), { statusCode });

const list = async ({ projectId, allowedSourcePermissions = [], user, includeArchived = false }) => {
  if (includeArchived) await authorization.assertHistoricalAccess(user, projectId);
  const sourceAcl = authorization.predicate({ user, projectId });
  const permissions = [...new Set(allowedSourcePermissions.map((value) => String(value || "").trim()).filter(Boolean))];
  const aclClause = permissions.length
    ? `AND (sources.required_permission IS NULL OR sources.required_permission IN (${permissions.map(() => "?").join(", ")}))`
    : "AND sources.required_permission IS NULL";
  return db.prepare(`
    SELECT sources.id, sources.id AS canonical_id, sources.project_id, sources.app_type_id, sources.source_kind,
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
    WHERE sources.project_id = ? ${includeArchived ? "" : "AND sources.extraction_status <> 'archived'"} ${aclClause} AND ${sourceAcl.sql}
    GROUP BY sources.id ORDER BY sources.updated_at DESC LIMIT 500
  `).all(projectId, ...permissions, ...sourceAcl.params);
};

const get = async (id, { activeOnly = false } = {}) => {
  const source = await db.prepare(`
    SELECT id, project_id, app_type_id, app_scope_key, source_kind, source_ref_id, title,
      source_uri, file_name, mime_type, size_bytes, checksum_sha256, attachment_id,
      required_permission, extraction_status, extraction_strategy, created_at, updated_at
    FROM ai_knowledge_sources
    WHERE id = ? ${activeOnly ? "AND extraction_status <> 'archived'" : ""}
  `).get(id);
  if (!source) throw createError("Knowledge source not found.", 404);
  return source;
};

const assertSourceRead = async (source, user, { allowArchived = false } = {}) => {
  if (source.required_permission && !await permissionService.hasPermission(user, source.required_permission, source.project_id)) {
    throw createError("Knowledge source is outside current permissions.", 403);
  }
  const sourceAcl = authorization.predicate({ user, projectId: source.project_id });
  const allowed = await db.prepare(`SELECT sources.id FROM ai_knowledge_sources sources
    WHERE sources.id = ? ${allowArchived ? "" : "AND sources.extraction_status <> 'archived'"} AND ${sourceAcl.sql}`).get(source.id, ...sourceAcl.params);
  if (!allowed) throw createError("Knowledge source is unavailable under current permissions.", 404);
};

const getDownload = async (id, { user } = {}) => {
  const source = await get(id, { activeOnly: true });
  await assertSourceRead(source, user);
  const fragmentAcl = authorization.predicate({ user, projectId: source.project_id, document: "documents", chunk: "chunks" });
  const restricted = await db.prepare(`SELECT chunks.id FROM ai_knowledge_chunks chunks
    JOIN ai_knowledge_documents documents ON documents.id = chunks.document_id
    JOIN ai_knowledge_sources sources ON sources.id = chunks.source_id
    WHERE sources.id = ? AND documents.is_active = TRUE AND NOT (${fragmentAcl.sql}) LIMIT 1`
  ).get(source.id, ...fragmentAcl.params);
  if (restricted) throw createError("The original file contains restricted fragments and cannot be downloaded.", 403);
  if (!source.attachment_id) throw createError("Knowledge source file not found.", 404);
  return source;
};

const publicRevision = (row) => ({
  id: row.id, knowledge_id: row.id, canonical_id: row.source_id,
  version: row.version, title: row.title, checksum_sha256: row.checksum_sha256,
  is_current: row.is_active, effective_from: row.effective_from, effective_to: row.effective_to,
  token_count: row.token_count, char_count: row.char_count,
  index_state: {
    lexical_state: row.lexical_state || "pending", dense_state: row.dense_state || "pending",
    required_indexes_ready: Boolean(row.required_indexes_ready), vector_provider: row.vector_provider || "postgresql",
    indexed_chunk_count: Number(row.indexed_chunk_count || 0)
  }
});
const revisionProjection = `SELECT documents.*, indexes.lexical_state, indexes.dense_state,
  indexes.required_indexes_ready, indexes.vector_provider, indexes.indexed_chunk_count
  FROM ai_knowledge_documents documents
  JOIN ai_knowledge_sources sources ON sources.id = documents.source_id
  LEFT JOIN ai_knowledge_index_states indexes ON indexes.document_id = documents.id`;

const listRevisions = async (id, { user } = {}) => {
  const source = await get(id);
  await authorization.assertHistoricalAccess(user, source.project_id);
  await assertSourceRead(source, user, { allowArchived: true });
  const acl = authorization.predicate({ user, projectId: source.project_id, document: "documents" });
  const rows = await db.prepare(`${revisionProjection} WHERE documents.source_id = ? AND ${acl.sql}
    ORDER BY documents.version DESC LIMIT 100`).all(source.id, ...acl.params);
  return { source_id: source.id, canonical_id: source.id, revisions: rows.map(publicRevision), historical_access: true };
};

const getDetail = async (id, { user, revisionId, asOf } = {}) => {
  const source = await get(id);
  const archived = source.extraction_status === "archived";
  if (revisionId || asOf || archived) await authorization.assertHistoricalAccess(user, source.project_id);
  await assertSourceRead(source, user, { allowArchived: archived });
  if (asOf && !Number.isFinite(Date.parse(asOf))) throw createError("as_of must be a valid timestamp.", 400);
  const acl = authorization.predicate({ user, projectId: source.project_id, document: "documents" });
  const temporal = asOf ? "AND documents.effective_from <= ?::timestamptz AND (documents.effective_to IS NULL OR documents.effective_to > ?::timestamptz) AND indexes.required_indexes_ready = TRUE" : "";
  const revision = await db.prepare(`${revisionProjection} WHERE documents.source_id = ?
    ${revisionId ? "AND documents.id = ?" : ""} ${temporal} AND ${acl.sql}
    ORDER BY documents.is_active DESC, documents.version DESC LIMIT 1`
  ).get(source.id, ...(revisionId ? [revisionId] : []), ...(asOf ? [asOf, asOf] : []), ...acl.params);
  const latestJob = await db.prepare(`SELECT jobs.id, jobs.status FROM ai_knowledge_ingestion_results results
    JOIN ai_knowledge_ingestion_jobs jobs ON jobs.id = results.job_id
    WHERE results.source_id = ? ORDER BY jobs.created_at DESC LIMIT 1`).get(source.id);
  const result = {
    source: { ...source, canonical_id: source.id, latest_ingestion_id: latestJob?.id || null, latest_ingestion_status: latestJob?.status || null },
    revision: revision ? publicRevision(revision) : null,
    fragments: [], authorization: { partial: false }, historical: Boolean(asOf || revisionId || archived)
  };
  if (!revision) return result;
  if (["test_case", "execution"].includes(source.source_kind)
    && revision.metadata?.source_snapshot?.context_permission_profile !== authorization.APPLICATION_CONTEXT_PROFILE) {
    // Legacy application revisions may contain values from separately protected
    // data/config/result objects. Show their version metadata for reindexing,
    // while withholding the old passages from both UI and MCP source fetches.
    return { ...result, knowledge_object: null, authorization: { partial: true },
      context_unavailable_reason: "Refresh or reingest this application source to use permission-scoped context." };
  }
  if (!revision.is_active && !revisionId && !asOf) await authorization.assertHistoricalAccess(user, source.project_id);
  const fragmentAcl = authorization.predicate({ user, projectId: source.project_id, document: "documents", chunk: "chunks" });
  const fragments = await db.prepare(`SELECT chunks.id, chunks.document_id AS knowledge_id,
    chunks.source_id AS canonical_id, chunks.id AS fragment_id, chunks.chunk_index, chunks.heading,
    chunks.content, chunks.token_count, chunks.char_start, chunks.char_end, chunks.metadata
    FROM ai_knowledge_chunks chunks
    JOIN ai_knowledge_sources sources ON sources.id = chunks.source_id
    JOIN ai_knowledge_documents documents ON documents.id = chunks.document_id
    WHERE chunks.document_id = ? AND ${fragmentAcl.sql} ORDER BY chunks.chunk_index LIMIT 250`
  ).all(revision.id, ...fragmentAcl.params);
  const total = await db.prepare(`SELECT COUNT(*)::INTEGER AS count,
    COUNT(*) FILTER (WHERE ${fragmentAcl.sql})::INTEGER AS authorized_count FROM ai_knowledge_chunks chunks
    JOIN ai_knowledge_documents documents ON documents.id = chunks.document_id
    JOIN ai_knowledge_sources sources ON sources.id = chunks.source_id WHERE chunks.document_id = ?`
  ).get(...fragmentAcl.params, revision.id);
  result.fragments = fragments;
  result.authorization.partial = Number(total?.count || 0) > Number(total?.authorized_count || 0);
  result.truncated = Number(total?.authorized_count || 0) > fragments.length;
  const derived = result.authorization.partial || result.truncated;
  const visibleContent = (derived ? fragments.map((fragment) => fragment.content).join("\n\n") : revision.content).slice(0, 2_000_000);
  // Source metadata can remain visible while every fragment is denied. Do not
  // manufacture a content-bearing object or expose its original file in that case.
  if (!visibleContent.trim()) return { ...result, knowledge_object: null };
  const snapshot = revision.metadata?.source_snapshot || {};
  const policy = await db.prepare(`SELECT MAX(created_at) AS updated_at FROM ai_knowledge_security_bindings WHERE source_id = ?`).get(source.id);
  result.knowledge_object = contracts.buildKnowledgeObject({
    canonical_id: source.id, knowledge_id: revision.id, tenant_id: source.project_id,
    source: {
      type: source.source_kind.toUpperCase(), system_id: "hellotest", native_id: source.source_ref_id || source.id,
      source_version: String(revision.version), uri: snapshot.source_uri || source.source_uri || null
    },
    content: { content_type: "TEXT", text: visibleContent,
      original_object_ref: source.attachment_id && !archived && revision.is_active && !result.authorization.partial
        ? `/knowledge/sources/${source.id}/file` : null },
    structure: { parent_canonical_id: null, parent_knowledge_id: null, fragment_type: "DOCUMENT", fragment_key: null },
    security: {
      sensitivity: "INTERNAL", policy_id: `knowledge-source:${source.id}`,
      policy_version: policy?.updated_at ? new Date(policy.updated_at).toISOString() : "1",
      visibility: result.authorization.partial ? "PARTIAL" : "FULL"
    },
    lifecycle: {
      behavior: "VERSIONED", state: archived ? "ARCHIVED" : revision.required_indexes_ready ? "ACTIVE" : "UNAVAILABLE",
      is_current: Boolean(revision.is_active), effective_from: new Date(revision.effective_from).toISOString(),
      effective_to: revision.effective_to ? new Date(revision.effective_to).toISOString() : null,
      content_hash_algorithm: "SHA256", content_hash: createHash("sha256").update(visibleContent).digest("hex")
    },
    metadata: { fragment_ids: fragments.map((fragment) => fragment.id), revision_hash: revision.checksum_sha256,
      index_ready: Boolean(revision.required_indexes_ready), truncated: result.truncated },
    provenance: { representation_type: derived ? "DETERMINISTIC" : "SOURCE_DIRECT",
      derived_from: derived ? fragments.map((fragment) => fragment.id) : [] }
  });
  return result;
};

const archiveSourceAndCancelWork = (source, { skipBusyJobs = false } = {}) => db.transaction(async () => {
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
    ORDER BY jobs.id FOR UPDATE ${skipBusyJobs ? "SKIP LOCKED" : ""}
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
    SET is_active = FALSE, effective_to = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE source_id = ? AND is_active = TRUE
  `).run(source.id);
  await db.prepare(`
    UPDATE ai_knowledge_index_states
    SET is_current = FALSE, updated_at = CURRENT_TIMESTAMP
    WHERE source_id = ? AND is_current = TRUE
  `).run(source.id);
  await knowledgeVectorProjection.queueSource({ projectId: source.project_id, sourceId: source.id });
  await require("./knowledgeGraph.service").archiveSource({ projectId: source.project_id, sourceId: source.id });
})();

const remove = async ({ source, user }) => {
  // permissionCode: "knowledge.manage" governs tombstoning and historical audit.
  await authorization.assertHistoricalAccess(user, source.project_id);
  await archiveSourceAndCancelWork(source);
  return {
    deleted: true,
    archived: true,
    retained_history: true,
    id: source.id,
    project_id: source.project_id,
    attachment_deleted: false,
    attachments_deleted: 0,
    dependent_documents_deleted: false,
    collection_links_deleted: false,
    vector_cleanup_pending: true
  };
};

// Refresh scans extant records, so it cannot discover records removed since
// their last ingestion. Native existence is rechecked while locking the source;
// no model or optional vector provider participates in the visibility decision.
const archiveMissingApplicationSources = ({ limit = 20 } = {}) => db.transaction(async () => {
  const missing = await db.prepare(`SELECT sources.* FROM ai_knowledge_sources sources
    WHERE sources.extraction_status <> 'archived' AND sources.source_ref_id IS NOT NULL AND (
      (sources.source_kind = 'requirement' AND NOT EXISTS (
        SELECT 1 FROM requirements records WHERE records.id = sources.source_ref_id AND records.project_id = sources.project_id))
      OR (sources.source_kind = 'test_case' AND NOT EXISTS (
        SELECT 1 FROM test_cases records JOIN app_types apps ON apps.id = records.app_type_id
        WHERE records.id = sources.source_ref_id AND apps.project_id = sources.project_id))
      OR (sources.source_kind = 'bug' AND NOT EXISTS (
        SELECT 1 FROM feedback records WHERE records.id = sources.source_ref_id AND records.project_id = sources.project_id))
      OR (sources.source_kind = 'execution' AND NOT EXISTS (
        SELECT 1 FROM executions records WHERE records.id = sources.source_ref_id AND records.project_id = sources.project_id))
      OR (sources.source_kind = 'knowledge_item' AND NOT EXISTS (
        SELECT 1 FROM ai_knowledge_repo records WHERE records.id = sources.source_ref_id
          AND records.project_id = sources.project_id AND records.is_active = TRUE))
    ) ORDER BY sources.updated_at, sources.id LIMIT ? FOR UPDATE OF sources SKIP LOCKED`).all(
    Math.max(1, Math.min(100, Number(limit) || 20)));
  // This reconciler already holds source rows. Ingestion acquires its job
  // before the source, so never wait for a busy job in the opposite order.
  // Its stale revision guard still prevents publication after this tombstone.
  for (const source of missing) await archiveSourceAndCancelWork(source, { skipBusyJobs: true });
  return { archived: missing.length };
})();

module.exports = {
  get,
  getDownload,
  getDetail,
  listRevisions,
  list,
  remove,
  archiveMissingApplicationSources
};
