"use strict";

function createKnowledgeOverview({
  db, config, maxExtractedTextChars, nativeTextMimeTypes, supportedUploadMimeTypes,
  assistantGuardrails, processingVersion, productHelpVersion, authorization, vectorStore,
  isKnowledgeAdmin, resolveAllowedSourcePermissions, toPublicIngestionJob,
  resolveEmbeddingRuntime, getVectorCapability, getTikaUrl
} = {}) {
  const required = [db, config, authorization, vectorStore, isKnowledgeAdmin,
    resolveAllowedSourcePermissions, toPublicIngestionJob, resolveEmbeddingRuntime,
    getVectorCapability, getTikaUrl];
  if (required.some(value => value == null)) throw new Error("Knowledge overview requires its storage and authorization ports.");

  const getOverview = async ({ projectId, userId, user }) => {
    const allowedSourcePermissions = await resolveAllowedSourcePermissions(user, projectId);
    const sourcePermission = allowedSourcePermissions.length
      ? `(sources.required_permission IS NULL OR sources.required_permission IN (${allowedSourcePermissions.map(() => "?").join(", ")}))`
      : "sources.required_permission IS NULL";
    const sourceAcl = authorization.predicate({ user, projectId });
    const documentAcl = authorization.predicate({ user, projectId, document: "documents" });
    const fragmentAcl = authorization.predicate({ user, projectId, document: "documents", chunk: "chunks" });
    const visible = `WITH visible_sources AS (
        SELECT sources.id, sources.project_id, sources.extraction_status FROM ai_knowledge_sources sources
        WHERE sources.project_id = ? AND sources.extraction_status <> 'archived'
          AND ${sourcePermission} AND ${sourceAcl.sql}
      ), visible_documents AS (
        SELECT documents.id, documents.source_id, documents.metadata FROM ai_knowledge_documents documents
        JOIN visible_sources sources ON sources.id=documents.source_id AND sources.project_id=documents.project_id
        WHERE documents.is_active=TRUE AND ${documentAcl.sql}
      ), visible_fragments AS (
        SELECT chunks.id, chunks.document_id FROM ai_knowledge_chunks chunks
        JOIN visible_documents documents ON documents.id=chunks.document_id
        JOIN visible_sources sources ON sources.id=chunks.source_id AND sources.project_id=chunks.project_id
        WHERE ${fragmentAcl.sql}
      )`;
    const visibleParams = [projectId, ...allowedSourcePermissions, ...sourceAcl.params, ...documentAcl.params, ...fragmentAcl.params];
    const counts = await db.prepare(`${visible}
      SELECT
        (SELECT COUNT(*)::INTEGER FROM ai_knowledge_collections WHERE project_id = ?) AS collections,
        (SELECT COUNT(*)::INTEGER FROM visible_sources) AS sources,
        (SELECT COUNT(*)::INTEGER FROM visible_documents) AS documents,
        (SELECT COUNT(*)::INTEGER FROM visible_fragments) AS chunks,
        (SELECT COUNT(*)::INTEGER FROM visible_sources WHERE extraction_status = 'ready') AS ready_sources,
        (SELECT COUNT(*)::INTEGER FROM visible_sources WHERE extraction_status IN ('pending', 'processing', 'needs_extraction')) AS processing_sources,
        (SELECT COUNT(*)::INTEGER FROM visible_sources WHERE extraction_status = 'failed') AS failed_sources
    `).get(...visibleParams, projectId);
    const recentJobs = isKnowledgeAdmin(user)
      ? await db.prepare("SELECT * FROM ai_knowledge_ingestion_jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT 10").all(projectId)
      : await db.prepare("SELECT * FROM ai_knowledge_ingestion_jobs WHERE project_id = ? AND created_by = ? ORDER BY created_at DESC LIMIT 10").all(projectId, user?.id || "__no_user__");
    const embedding = await resolveEmbeddingRuntime({ userId, projectId });
    const pgvectorAvailable = await getVectorCapability();
    let contextQuality = { active_documents: 0, current_pipeline_documents: 0, review_required_documents: 0, average_score: null };
    try {
      const qualityRow = await db.prepare(`${visible}
        SELECT COUNT(*)::INTEGER AS active_documents,
          COUNT(*) FILTER (WHERE metadata->'processing_pipeline'->>'version' = ?)::INTEGER AS current_pipeline_documents,
          COUNT(*) FILTER (WHERE COALESCE((metadata->'context_quality'->>'requires_review')::BOOLEAN, FALSE))::INTEGER AS review_required_documents,
          ROUND(AVG(NULLIF(metadata->'context_quality'->>'score', '')::NUMERIC), 1) AS average_score
        FROM visible_documents documents
        WHERE NOT EXISTS (SELECT 1 FROM ai_knowledge_chunks all_fragments
          WHERE all_fragments.document_id=documents.id AND NOT EXISTS(
            SELECT 1 FROM visible_fragments permitted WHERE permitted.id=all_fragments.id))
      `).get(...visibleParams, processingVersion);
      contextQuality = {
        active_documents: Number(qualityRow?.active_documents || 0),
        current_pipeline_documents: Number(qualityRow?.current_pipeline_documents || 0),
        review_required_documents: Number(qualityRow?.review_required_documents || 0),
        average_score: qualityRow?.average_score === null || qualityRow?.average_score === undefined ? null : Number(qualityRow.average_score)
      };
    } catch {
      // Keep the overview readable during a rolling schema migration.
    }
    return {
      project_id: projectId,
      counts,
      recent_jobs: recentJobs.map(job => toPublicIngestionJob(job)),
      capabilities: {
        hybrid_search: true,
        vector_store: {
          engine: vectorStore.isConfigured() ? "Qdrant projection + PostgreSQL canonical hydration" : "PostgreSQL",
          pgvector_available: pgvectorAvailable,
          mode: vectorStore.isConfigured()
            ? "ACL-prefiltered Qdrant dense retrieval fused with PostgreSQL full-text search"
            : pgvectorAvailable ? "pgvector with JSONB fallback" : "JSONB cosine with PostgreSQL full-text search",
          fallback: "PostgreSQL tsvector + pgvector/JSONB cosine + deterministic local hash embeddings",
          ...vectorStore.getStatus()
        },
        embedding: {
          provider: embedding.provider,
          model: embedding.model,
          configured: embedding.configured,
          mode: embedding.configured ? "configured_semantic_embedding" : "degraded_local_lexical_hash",
          accuracy_note: embedding.configured
            ? "Semantic quality depends on the configured embedding model and indexed model compatibility."
            : "The local hash vector is a deterministic degraded retrieval fallback, not a semantic-accuracy substitute."
        },
        context_processing: {
          version: processingVersion,
          hierarchy_strategy: "document-title+section-lineage+content-type+content",
          ...contextQuality,
          refresh_recommended: contextQuality.active_documents > contextQuality.current_pipeline_documents
        },
        product_help: { version: productHelpVersion, source_id: "hellotest-product-help", citation_backed: true },
        extraction: {
          max_file_bytes: Math.min(Number(config.knowledge?.maxFileBytes || 50 * 1024 * 1024), Number(config.objectStorage.maxAttachmentBytes)),
          max_extractable_bytes: Number(config.knowledge?.extractionMaxBytes || 20 * 1024 * 1024),
          max_extracted_text_chars: maxExtractedTextChars,
          native_text_mime_types: [...nativeTextMimeTypes].sort(),
          supported_mime_types: [...supportedUploadMimeTypes].sort(),
          tika_configured: Boolean(getTikaUrl()),
          binary_requires_extracted_text: true,
          tika_documents_can_be_extracted_server_side: Boolean(getTikaUrl()),
          media_requires_caption_or_transcript: true
        },
        guardrails: assistantGuardrails
      }
    };
  };

  return { getOverview };
}

module.exports = { createKnowledgeOverview };
