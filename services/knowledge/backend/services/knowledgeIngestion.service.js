"use strict";

function createKnowledgeIngestionService(ports = {}) {
  const { FAILED_INPUT_RETENTION_DAYS, KNOWLEDGE_WORKER_ID, LOCAL_EMBEDDING_MODEL, MAX_INPUTS, MAX_MANUAL_INGESTION_RETRIES, NATIVE_OUTBOX_PRINCIPAL, NATIVE_TEXT_MIME_TYPES, Readable, SOURCE_PERMISSION_BY_KIND, SUPPORTED_UPLOAD_MIME_TYPES, TIKA_MIME_TYPES, applicationSnapshotFingerprint, asArray, asObject, assertCollectionScope, assertRecordSourcePermissions, assessContextQuality, attachmentService, buildRelationshipChunks, canReuseSourceVersion, chunkText, claimFairQueueRow, classifyIngestionError, config, createError, createHash, db, decodeNativeText, embedTexts, extractWithTika, featureFlagService, fingerprint, getTikaUrl, getVectorCapability, isKnowledgeAdmin, knowledgeVectorProjection, lexicalProseConfig, lexicalQuery, loadApplicationRecord, localEmbedding, normalizeChunkingOptions, normalizeId, normalizeSelectedRecordInputs, normalizeSourceKind, normalizeText, permissionService, processingProfile, requiredPermissionForSourceKind, resolveEmbeddingRuntime, sanitizeAiText, sanitizeClientMetadata, sanitizeSourceUri, stableSourceKey, stripRelationshipLines, syncLegacyKnowledgeItem, toPublicDocument, toPublicSource, uuid, validateEmbeddingVector, validateUploadSignature, vectorLiteral } = ports;
  const required = [FAILED_INPUT_RETENTION_DAYS, KNOWLEDGE_WORKER_ID, LOCAL_EMBEDDING_MODEL, MAX_INPUTS, MAX_MANUAL_INGESTION_RETRIES, NATIVE_OUTBOX_PRINCIPAL, NATIVE_TEXT_MIME_TYPES, Readable, SOURCE_PERMISSION_BY_KIND, SUPPORTED_UPLOAD_MIME_TYPES, TIKA_MIME_TYPES, applicationSnapshotFingerprint, asArray, asObject, assertCollectionScope, assertRecordSourcePermissions, assessContextQuality, attachmentService, buildRelationshipChunks, canReuseSourceVersion, chunkText, claimFairQueueRow, classifyIngestionError, config, createError, createHash, db, decodeNativeText, embedTexts, extractWithTika, featureFlagService, fingerprint, getTikaUrl, getVectorCapability, isKnowledgeAdmin, knowledgeVectorProjection, lexicalProseConfig, lexicalQuery, loadApplicationRecord, localEmbedding, normalizeChunkingOptions, normalizeId, normalizeSelectedRecordInputs, normalizeSourceKind, normalizeText, permissionService, processingProfile, requiredPermissionForSourceKind, resolveEmbeddingRuntime, sanitizeAiText, sanitizeClientMetadata, sanitizeSourceUri, stableSourceKey, stripRelationshipLines, toPublicDocument, toPublicSource, uuid, validateEmbeddingVector, validateUploadSignature, vectorLiteral];
  if (required.some(value => value === undefined || value === null)) {
    throw new Error("Knowledge ingestion requires its storage, queue and content-processing ports.");
  }

  const normalizeInput = async (projectId, input) => {
    const source = asObject(input);
    const kind = normalizeSourceKind(source.kind || source.type || source.entity_type || source.source_kind);
    const entityId = normalizeId(source.entity_id || source.source_ref_id || source.record_id);
    if (["requirement", "test_case", "execution", "execution_result", "bug", "test_suite", "test_module", "release", "sprint"].includes(kind)) {
      if (!entityId) throw createError(`${kind} entity_id is required.`);
      const record = await loadApplicationRecord(projectId, kind, entityId);
      // Parent timestamps do not necessarily move when linked steps, datasets,
      // modules, or execution results change. Fingerprint the complete bounded
      // evidence snapshot so activation can reject a mixed/stale child view.
      record.metadata = {
        ...asObject(record.metadata),
        snapshot_fingerprint: applicationSnapshotFingerprint(record)
      };
      return record;
    }
  
    const supplied = normalizeText(source.content || source.text || source.extracted_text || source.transcript || source.caption);
    const title = normalizeText(source.title || source.file_name || (kind === "chat" ? "Chat context" : "Text context"), 500);
    if (!title) throw createError("Every context input requires a title.");
    return {
      source_kind: kind,
      source_ref_id: entityId || null,
      // Only the route-validated top-level app_type_id may scope client-authored
      // text/chat/URL inputs; nested IDs are discarded to prevent cross-project scope injection.
      app_type_id: null,
      title,
      content: supplied,
      source_uri: normalizeText(source.source_uri || source.url, 4_000) || null,
      file_name: normalizeText(source.file_name, 500) || null,
      mime_type: normalizeText(source.mime_type, 255) || null,
      size_bytes: Number.isFinite(Number(source.size_bytes)) ? Math.max(0, Number(source.size_bytes)) : null,
      extraction_strategy: supplied ? (source.extraction_strategy || "client_supplied") : "metadata_only",
      metadata: sanitizeClientMetadata({
        ...asObject(source.metadata),
        chat_role: kind === "chat" ? (source.role === "assistant" ? "assistant" : "user") : undefined
      }, kind)
    };
  };
  
  const isApplicationRecordSnapshotCurrent = async (projectId, input) => {
    const kind = input?.source_kind;
    const id = normalizeId(input?.source_ref_id);
    if (!SOURCE_PERMISSION_BY_KIND[kind] || !id) return true;
    // Re-serialize the same bounded, identity-free evidence immediately before
    // activation. This covers child tables whose writes do not touch the parent
    // updated_at (steps, links, datasets, modules, and run results).
    const expectedFingerprint = normalizeText(input?.metadata?.snapshot_fingerprint, 128);
    if (expectedFingerprint) {
      try {
        const fresh = await loadApplicationRecord(projectId, kind, id);
        return applicationSnapshotFingerprint(fresh) === expectedFingerprint;
      } catch {
        return false;
      }
    }
    let row;
    if (kind === "requirement") {
      row = await db.prepare("SELECT updated_at FROM requirements WHERE id = ? AND project_id = ?").get(id, projectId);
    } else if (kind === "test_case") {
      row = await db.prepare(`
        SELECT test_cases.updated_at FROM test_cases
        JOIN app_types ON app_types.id = test_cases.app_type_id
        WHERE test_cases.id = ? AND app_types.project_id = ?
      `).get(id, projectId);
    } else if (kind === "bug") {
      row = await db.prepare("SELECT updated_at FROM feedback WHERE id = ? AND project_id = ?").get(id, projectId);
    } else if (kind === "execution") {
      row = await db.prepare(`
        SELECT status, ended_at, started_at, created_at
        FROM executions WHERE id = ? AND project_id = ?
      `).get(id, projectId);
      if (row?.status !== input.metadata?.status) return false;
      row = row ? { updated_at: row.ended_at || row.started_at || row.created_at } : null;
    }
    return Boolean(row)
      && String(row.updated_at || "") === String(input.metadata?.source_updated_at || "");
  };
  
  const createJob = async ({ projectId, collectionId, inputCount, config: jobConfig, userId, status = "running", idempotencyKey }) => {
    const id = uuid();
    const normalizedStatus = status === "queued" ? "queued" : "running";
    const result = await db.prepare(`
      INSERT INTO ai_knowledge_ingestion_jobs (
        id, project_id, collection_id, status, input_count, config, idempotency_key,
        created_by, started_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      id,
      projectId,
      collectionId || null,
      normalizedStatus,
      inputCount,
      jobConfig,
      normalizeText(idempotencyKey, 255) || null,
      userId || null,
      normalizedStatus === "running" ? new Date().toISOString() : null
    );
    return getIngestionJob(id);
  };
  
  const getIngestionJob = async (id, { user } = {}) => {
    const job = await db.prepare("SELECT * FROM ai_knowledge_ingestion_jobs WHERE id = ?").get(id);
    if (!job) throw createError("Knowledge ingestion job not found.", 404);
    // Job titles, result source IDs and errors can reveal domain activity. Non-admin
    // users may inspect only jobs they initiated; null-owner jobs fail closed.
    if (user && !isKnowledgeAdmin(user) && (!job.created_by || job.created_by !== user.id)) {
      throw createError("This knowledge ingestion belongs to another workspace member.", 403, "KNOWLEDGE_JOB_ACCESS_DENIED");
    }
    const results = await db.prepare(`
      SELECT input_index, source_id, document_id, outcome, reused, warning_codes,
        error_fingerprint, created_at, updated_at
      FROM ai_knowledge_ingestion_results
      WHERE job_id = ? ORDER BY input_index ASC
    `).all(id);
    return toPublicIngestionJob(job, results);
  };
  
  const toPublicIngestionJob = (job, results = []) => {
    const rawConfig = asObject(job?.config);
    const safeConfig = {
      title: normalizeText(rawConfig.title, 500) || null,
      app_type_id: normalizeId(rawConfig.app_type_id) || null,
      chunking: asObject(rawConfig.chunking),
      upload: Boolean(rawConfig.upload),
      queue_version: Number(rawConfig.queue_version || 0) || null,
      retry_count: Math.max(0, Number(rawConfig.retry_count || 0) || 0),
      max_retries: MAX_MANUAL_INGESTION_RETRIES
    };
    const publicErrors = asArray(job.errors).map((entry) => ({
      input_index: Number.isInteger(entry?.input_index) ? entry.input_index : undefined,
      code: normalizeText(entry?.code, 120) || "ingestion_failed",
      message: normalizeText(entry?.message, 1_000) || "Knowledge processing needs attention.",
      retryable: entry?.retryable !== false,
      stage: normalizeText(entry?.stage, 120) || "processing",
      error_fingerprint: normalizeText(entry?.error_fingerprint, 128) || null
    }));
    return {
      id: job.id,
      project_id: job.project_id,
      collection_id: job.collection_id || null,
      status: job.status,
      input_count: Number(job.input_count || 0),
      processed_count: Number(job.processed_count || 0),
      failed_count: Number(job.failed_count || 0),
      chunk_count: Number(job.chunk_count || 0),
      warnings: asArray(job.warnings),
      errors: publicErrors,
      can_retry: job.status === "failed"
        && safeConfig.retry_count < MAX_MANUAL_INGESTION_RETRIES
        && (!publicErrors.length || publicErrors.some((entry) => entry.retryable)),
      config: safeConfig,
      created_at: job.created_at,
      started_at: job.started_at || null,
      completed_at: job.completed_at || null,
      updated_at: job.updated_at,
      results
    };
  };
  
  const recordIngestionResult = async (jobId, inputIndex, {
    sourceId,
    documentId,
    outcome,
    reused = false,
    warningCodes = [],
    errorFingerprint = null
  }, { leaseOwner } = {}) => {
    const result = leaseOwner ? await db.prepare(`
      WITH owned_job AS (
        SELECT id FROM ai_knowledge_ingestion_jobs
        WHERE id = ? AND status = 'running' AND lease_owner = ?
          AND lease_expires_at > CURRENT_TIMESTAMP
        FOR UPDATE
      )
      INSERT INTO ai_knowledge_ingestion_results (
        job_id, input_index, source_id, document_id, outcome, reused, warning_codes, error_fingerprint
      )
      SELECT owned_job.id, ?, ?, ?, ?, ?, ?, ? FROM owned_job
      ON CONFLICT (job_id, input_index) DO UPDATE SET
        source_id = EXCLUDED.source_id, document_id = EXCLUDED.document_id,
        outcome = EXCLUDED.outcome, reused = EXCLUDED.reused,
        warning_codes = EXCLUDED.warning_codes, error_fingerprint = EXCLUDED.error_fingerprint,
        updated_at = CURRENT_TIMESTAMP
      RETURNING job_id
    `).get(jobId, leaseOwner, inputIndex, sourceId || null, documentId || null, outcome, Boolean(reused), warningCodes, errorFingerprint)
      : await db.prepare(`
        INSERT INTO ai_knowledge_ingestion_results (
          job_id, input_index, source_id, document_id, outcome, reused, warning_codes, error_fingerprint
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (job_id, input_index) DO UPDATE SET
          source_id = EXCLUDED.source_id, document_id = EXCLUDED.document_id,
          outcome = EXCLUDED.outcome, reused = EXCLUDED.reused,
          warning_codes = EXCLUDED.warning_codes, error_fingerprint = EXCLUDED.error_fingerprint,
          updated_at = CURRENT_TIMESTAMP
        RETURNING job_id
      `).get(jobId, inputIndex, sourceId || null, documentId || null, outcome, Boolean(reused), warningCodes, errorFingerprint);
    if (leaseOwner && !result) throw createError("Knowledge ingestion lease was lost before recording provenance.", 409, "KNOWLEDGE_LEASE_LOST");
    return result;
  };
  
  const createSource = async ({ projectId, collectionId, input, userId, jobId, leaseOwner, _leaseLocked = false }) => {
    if (jobId && !_leaseLocked) {
      return db.transaction(async () => {
        const ownedJob = leaseOwner ? await db.prepare(`
          SELECT id FROM ai_knowledge_ingestion_jobs
          WHERE id = ? AND project_id = ? AND status = 'running' AND lease_owner = ?
            AND lease_expires_at > CURRENT_TIMESTAMP
          FOR UPDATE
        `).get(jobId, projectId, leaseOwner) : await db.prepare(`
          SELECT id FROM ai_knowledge_ingestion_jobs
          WHERE id = ? AND project_id = ? AND status IN ('queued', 'running')
          FOR UPDATE
        `).get(jobId, projectId);
        if (!ownedJob) throw createError("Knowledge ingestion lease was lost before source persistence.", 409, "KNOWLEDGE_LEASE_LOST");
        return createSource({ projectId, collectionId, input, userId, jobId, leaseOwner, _leaseLocked: true });
      })();
    }
    const sanitizedContent = sanitizeAiText(input.content || "").text;
    const safeTitle = sanitizeAiText(input.title).text || "Untitled knowledge source";
    const safeFileName = input.file_name ? sanitizeAiText(input.file_name).text : null;
    const safeSourceUri = sanitizeSourceUri(input.source_uri);
    const contentHash = normalizeText(input.checksum_sha256, 128) || (sanitizedContent ? fingerprint(sanitizedContent) : null);
    const documentHash = sanitizedContent ? fingerprint(sanitizedContent) : null;
    const requiredPermission = requiredPermissionForSourceKind(input.source_kind);
    const appScopeKey = normalizeId(input.app_type_id) || "";
    const revisionToken = uuid();
    let existing = null;
    if (input.source_ref_id) {
      existing = await db.prepare(`
        SELECT * FROM ai_knowledge_sources
        WHERE project_id = ? AND source_kind = ? AND source_ref_id = ?
        ORDER BY updated_at DESC LIMIT 1
      `).get(projectId, input.source_kind, input.source_ref_id);
    } else if (contentHash) {
      existing = await db.prepare(`
        SELECT * FROM ai_knowledge_sources
        WHERE project_id = ? AND app_scope_key = ?
          AND source_kind = ? AND checksum_sha256 = ?
        ORDER BY updated_at DESC LIMIT 1
      `).get(projectId, appScopeKey, input.source_kind, contentHash);
    }
    if (existing) {
      await db.prepare(`INSERT INTO ai_knowledge_security_bindings
        (id, project_id, source_id, principal_type, principal_id, effect, inherited)
        VALUES (?, ?, ?, 'PROJECT', ?, 'ALLOW', TRUE) ON CONFLICT (id) DO NOTHING`
      ).run(`${existing.id}:project-read`, projectId, existing.id, projectId);
      if (collectionId) {
        await db.prepare(`
          INSERT INTO ai_knowledge_collection_sources (collection_id, source_id)
          VALUES (?, ?) ON CONFLICT (collection_id, source_id) DO NOTHING
        `).run(collectionId, existing.id);
      }
      const readyDocument = await db.prepare(`
        SELECT id, checksum_sha256, metadata FROM ai_knowledge_documents
        WHERE source_id = ? AND is_active = TRUE LIMIT 1
      `).get(existing.id);
      const reusable = canReuseSourceVersion({ existing, readyDocument, contentHash, documentHash, processingFingerprint: input.processing_fingerprint,
        metadataFingerprint: input.metadata_fingerprint, snapshotFingerprint: asObject(input.metadata).snapshot_fingerprint });
      const graphReady = !reusable || !input.graph_projection_required || Boolean((await db.prepare(`SELECT 1 AS ready
        FROM ai_knowledge_graph_nodes nodes JOIN ai_knowledge_graph_projection_states projections ON projections.project_id = nodes.project_id
        WHERE nodes.source_id = ? AND nodes.project_id = ? AND nodes.tombstoned_at IS NULL AND projections.document_id = ?
          AND EXISTS(SELECT 1 FROM ai_knowledge_graph_chunk_entities fragments WHERE fragments.project_id = nodes.project_id
            AND fragments.node_id = nodes.source_id AND fragments.source_id = nodes.source_id AND fragments.document_id = projections.document_id)
        LIMIT 1`).get(existing.id, projectId, readyDocument.id))?.ready);
      if (reusable && graphReady) {
        return { ...existing, _reused: true, _new: false, _had_ready_version: true };
      }
      // Reserve only an index attempt. Visible source metadata changes atomically
      // with promotion after every required index is ready.
      await db.prepare(`UPDATE ai_knowledge_sources SET revision_token = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(revisionToken, existing.id);
      return {
        ...existing,
        app_type_id: input.app_type_id || null,
        title: safeTitle,
        source_uri: safeSourceUri,
        file_name: safeFileName || existing.file_name || null,
        mime_type: input.mime_type || existing.mime_type || null,
        size_bytes: input.size_bytes ?? existing.size_bytes ?? null,
        extraction_strategy: input.extraction_strategy || (input.content ? "structured_record" : "metadata_only"),
        metadata: asObject(input.metadata),
        required_permission: requiredPermission,
        revision_token: revisionToken,
        _pending_checksum: contentHash,
        _pending_source_update: true,
        _new: false,
        _had_ready_version: Boolean(readyDocument)
      };
    }
  
    const id = uuid();
    const status = input.content ? "processing" : "needs_extraction";
    try {
      await db.prepare(`
        INSERT INTO ai_knowledge_sources (
          id, project_id, app_type_id, app_scope_key, source_kind, source_ref_id, title, source_uri,
          file_name, mime_type, size_bytes, checksum_sha256, required_permission, extraction_status,
          extraction_strategy, metadata, risk_flags, created_by, revision_token
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, projectId, input.app_type_id || null, appScopeKey, input.source_kind, input.source_ref_id || null,
        safeTitle, safeSourceUri, safeFileName, input.mime_type || null,
        input.size_bytes ?? null, contentHash, requiredPermission, status,
        input.extraction_strategy || (input.content ? "structured_record" : "metadata_only"),
        asObject(input.metadata), [], userId || null, revisionToken
      );
    } catch (error) {
      if (error?.code !== "23505") throw error;
      // A concurrent request won the stable-reference/content-hash insert. Re-read
      // that winner and apply the normal version/dedup logic instead of failing or
      // creating duplicate chunks.
      return createSource({ projectId, collectionId, input, userId, jobId, leaseOwner, _leaseLocked: true });
    }
    if (collectionId) {
      await db.prepare(`
        INSERT INTO ai_knowledge_collection_sources (collection_id, source_id)
        VALUES (?, ?) ON CONFLICT (collection_id, source_id) DO NOTHING
      `).run(collectionId, id);
    }
    await db.prepare(`INSERT INTO ai_knowledge_security_bindings
      (id, project_id, source_id, principal_type, principal_id, effect, inherited)
      VALUES (?, ?, ?, 'PROJECT', ?, 'ALLOW', TRUE) ON CONFLICT (id) DO NOTHING`
    ).run(`${id}:project-read`, projectId, id, projectId);
    return {
      ...await db.prepare("SELECT * FROM ai_knowledge_sources WHERE id = ?").get(id),
      _new: true,
      _had_ready_version: false
    };
  };
  
  const markSourcePersistenceFailed = async (source, { jobId, leaseOwner } = {}) => {
    if (!source?.id || source._reused || source._had_ready_version) return;
    if (leaseOwner) {
      const result = await db.transaction(async () => {
        const owned = await db.prepare(`
          SELECT id FROM ai_knowledge_ingestion_jobs
          WHERE id = ? AND status = 'running' AND lease_owner = ?
            AND lease_expires_at > CURRENT_TIMESTAMP
          FOR UPDATE
        `).get(jobId, leaseOwner);
        if (!owned) return { owned: false };
        const updated = await db.prepare(`
          UPDATE ai_knowledge_sources
          SET extraction_status = 'failed', updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND (?::TEXT IS NULL OR revision_token = ?)
            AND NOT EXISTS (
              SELECT 1 FROM ai_knowledge_documents
              WHERE source_id = ai_knowledge_sources.id AND is_active = TRUE
            )
          RETURNING id
        `).get(source.id, source.revision_token || null, source.revision_token || null);
        return { owned: true, updated: Boolean(updated) };
      })();
      if (!result?.owned) throw createError("Knowledge ingestion lease was lost.", 409, "KNOWLEDGE_LEASE_LOST");
      return;
    }
    await db.prepare(`
      UPDATE ai_knowledge_sources
      SET extraction_status = 'failed', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND (?::TEXT IS NULL OR revision_token = ?)
        AND NOT EXISTS (
          SELECT 1 FROM ai_knowledge_documents
          WHERE source_id = ai_knowledge_sources.id AND is_active = TRUE
        )
    `).run(source.id, source.revision_token || null, source.revision_token || null);
  };
  
  const markSourceNeedsExtraction = async (source, { jobId, leaseOwner } = {}) => {
    if (!source?.id) return;
    if (leaseOwner) {
      const result = await db.transaction(async () => {
        const owned = await db.prepare(`
          SELECT id FROM ai_knowledge_ingestion_jobs
          WHERE id = ? AND status = 'running' AND lease_owner = ?
            AND lease_expires_at > CURRENT_TIMESTAMP
          FOR UPDATE
        `).get(jobId, leaseOwner);
        if (!owned) return false;
        await db.prepare(`
          UPDATE ai_knowledge_sources
          SET extraction_status = 'needs_extraction', updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND revision_token = ? AND extraction_status <> 'ready'
        `).run(source.id, source.revision_token);
        return true;
      })();
      if (!result) throw createError("Knowledge ingestion lease was lost.", 409, "KNOWLEDGE_LEASE_LOST");
      return;
    }
    await db.prepare(`
      UPDATE ai_knowledge_sources
      SET extraction_status = 'needs_extraction', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND revision_token = ? AND extraction_status <> 'ready'
    `).run(source.id, source.revision_token);
  };
  
  const removeUnactivatedNewSourceAfterLeaseLoss = async (source) => {
    if (!source?._new || !source.id || !source.revision_token) return;
    await db.prepare(`
      UPDATE ai_knowledge_sources sources
      SET extraction_status = 'archived',
        revision_token = id || ':lease-lost:' || EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)::TEXT || ':' || RANDOM()::TEXT,
        updated_at = CURRENT_TIMESTAMP
      WHERE sources.id = ? AND sources.revision_token = ? AND sources.attachment_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM ai_knowledge_documents documents
          WHERE documents.source_id = sources.id AND documents.is_active = TRUE
        )
    `).run(source.id, source.revision_token);
  };
  
  const persistEmbeddingVector = async (chunkId, vector) => {
    if (!await getVectorCapability()) return false;
    try {
      await db.prepare("UPDATE ai_knowledge_chunks SET embedding_vector = ?::vector WHERE id = ?").run(vectorLiteral(vector), chunkId);
      return true;
    } catch {
      // A malformed row or provider-dimension mismatch must degrade this row only;
      // extension capability is independently probed and remains available.
      return false;
    }
  };
  
  const buildChunkRetrievalText = ({ title, chunk } = {}) => [
    normalizeText(title, 500) ? `Document: ${normalizeText(title, 500)}` : null,
    asArray(chunk?.heading_path).length
      ? `Section path: ${chunk.heading_path.map((item) => normalizeText(item, 240)).filter(Boolean).join(" > ")}`
      : normalizeText(chunk?.heading, 500) ? `Section: ${normalizeText(chunk.heading, 500)}` : null,
    normalizeText(chunk?.section_type, 80) && chunk.section_type !== "body"
      ? `Content type: ${normalizeText(chunk.section_type, 80).replace(/_/g, " ")}`
      : null,
    normalizeText(chunk?.content, 100_000)
  ].filter(Boolean).join("\n");
  
  const buildDocumentContextProfile = ({ title, chunks } = {}) => ({
    title: normalizeText(title, 500) || "Untitled knowledge source",
    headings: [...new Set(asArray(chunks).map((chunk) => normalizeText(chunk?.heading, 500)).filter(Boolean))].slice(0, 80),
    section_paths: [...new Set(asArray(chunks).map((chunk) => asArray(chunk?.heading_path).map((item) => normalizeText(item, 240)).filter(Boolean).join(" > ")).filter(Boolean))].slice(0, 120),
    section_types: [...new Set(asArray(chunks).map((chunk) => normalizeText(chunk?.section_type, 80)).filter(Boolean))].slice(0, 20),
    chunk_count: asArray(chunks).length,
    hierarchy_strategy: "document-title+section-lineage+content-type+content"
  });
  
  const embeddingConfigurationHash = runtime => runtime?.configured ? fingerprint(JSON.stringify({
    integration_id: runtime.integration?.id || null,
    endpoint: String(runtime.baseUrl || "").replace(/\/+$/, ""),
    model: runtime.model
  })) : null;
  
  const enqueueSemanticWork = async ({ projectId, sourceId, documentId, revisionToken, integrationId = null, targetConfigurationHash = null } = {}) => {
    if (!projectId || !sourceId || !documentId || !revisionToken) return false;
    await db.prepare(`INSERT INTO ai_knowledge_semantic_jobs(project_id,source_id,document_id,revision_token,integration_id,target_configuration_hash,status)
      VALUES(?,?,?,?,?,?,'queued') ON CONFLICT(document_id) DO UPDATE SET project_id=EXCLUDED.project_id,source_id=EXCLUDED.source_id,
        revision_token=EXCLUDED.revision_token,integration_id=EXCLUDED.integration_id,target_configuration_hash=EXCLUDED.target_configuration_hash,status='queued',attempts=0,
        next_attempt_at=CURRENT_TIMESTAMP,lease_owner=NULL,lease_expires_at=NULL,last_error_fingerprint=NULL,last_warning_code=NULL,
        completed_at=NULL,updated_at=CURRENT_TIMESTAMP
      WHERE ai_knowledge_semantic_jobs.status='failed' OR ai_knowledge_semantic_jobs.revision_token<>EXCLUDED.revision_token
        OR ai_knowledge_semantic_jobs.target_configuration_hash IS DISTINCT FROM EXCLUDED.target_configuration_hash
        OR ai_knowledge_semantic_jobs.integration_id IS DISTINCT FROM EXCLUDED.integration_id`).run(
      projectId, sourceId, documentId, revisionToken, integrationId, targetConfigurationHash);
    return true;
  };
  
  const claimSemanticWork = (leaseMinutes = 20) => claimFairQueueRow({
    stage: "semantic_work",
    sql: `SELECT jobs.* FROM ai_knowledge_semantic_jobs jobs
      LEFT JOIN ai_knowledge_worker_project_fairness fairness ON fairness.queue_stage='semantic_work' AND fairness.project_id=jobs.project_id
      WHERE jobs.next_attempt_at<=CURRENT_TIMESTAMP
        AND (jobs.status='queued' OR (jobs.status='running' AND jobs.lease_expires_at<CURRENT_TIMESTAMP))
      ORDER BY fairness.last_served_at ASC NULLS FIRST,jobs.next_attempt_at,jobs.created_at,jobs.document_id
      LIMIT 1 FOR UPDATE OF jobs SKIP LOCKED`,
    claim: (job) => db.prepare(`UPDATE ai_knowledge_semantic_jobs SET status='running',attempts=attempts+1,
      lease_owner=?,lease_expires_at=CURRENT_TIMESTAMP+(?::INTEGER*INTERVAL '1 minute'),updated_at=CURRENT_TIMESTAMP
      WHERE document_id=? RETURNING *`).get(KNOWLEDGE_WORKER_ID, leaseMinutes, job.document_id)
  });
  
  const enqueueStaleEmbeddingBackfill = async ({ limit = 500 } = {}) => {
    const max = Math.max(1, Math.min(2_000, Number.parseInt(limit, 10) || 500));
    const projects = await db.prepare(`SELECT DISTINCT documents.project_id FROM ai_knowledge_documents documents
      JOIN ai_knowledge_sources sources ON sources.id=documents.source_id AND sources.extraction_status='ready'
      WHERE documents.is_active=TRUE ORDER BY documents.project_id LIMIT 200`).all();
    let queued = 0, inspected = 0;
    for (const project of projects) {
      if (queued >= max) break;
      let runtime;
      try { runtime = await resolveEmbeddingRuntime({ projectId: project.project_id }); }
      catch { continue; }
      const targetHash = embeddingConfigurationHash(runtime);
      if (!targetHash) continue;
      const rows = await db.prepare(`SELECT documents.id AS document_id,documents.project_id,sources.id AS source_id,sources.revision_token
        FROM ai_knowledge_documents documents JOIN ai_knowledge_sources sources ON sources.id=documents.source_id
        WHERE documents.project_id=? AND documents.is_active=TRUE AND sources.extraction_status='ready'
          AND EXISTS(SELECT 1 FROM ai_knowledge_chunks chunks WHERE chunks.document_id=documents.id)
          AND NOT EXISTS(SELECT 1 FROM ai_knowledge_chunks chunks WHERE chunks.document_id=documents.id
            AND chunks.embedding_model=? AND chunks.metadata->>'embedding_configuration_hash'=? )
        ORDER BY documents.created_at,documents.id LIMIT ?`).all(project.project_id,runtime.model,targetHash,Math.min(100,max-queued));
      inspected += rows.length;
      for (const row of rows) {
        await enqueueSemanticWork({ projectId:row.project_id,sourceId:row.source_id,documentId:row.document_id,
          revisionToken:row.revision_token,integrationId:runtime.integration?.id||null,targetConfigurationHash:targetHash });
        queued++;
      }
    }
    const pending = await db.prepare(`SELECT COUNT(*)::INTEGER AS count FROM ai_knowledge_semantic_jobs WHERE status IN('queued','running')`).get();
    return { queued, inspected, pending: Number(pending?.count || 0) };
  };
  
  const finishSemanticWork = async (job, { warningCode = null, failed = false, errorFingerprint = null, retry = false } = {}) => {
    const attempt = Number(job.attempts || 1);
    if (retry && attempt < 8) {
      const delaySeconds = Math.min(6 * 60 * 60, 30 * (2 ** Math.max(0,attempt - 1)));
      await db.prepare(`UPDATE ai_knowledge_semantic_jobs SET status='queued',next_attempt_at=CURRENT_TIMESTAMP+(?::INTEGER*INTERVAL '1 second'),
        lease_owner=NULL,lease_expires_at=NULL,last_error_fingerprint=?,last_warning_code=?,updated_at=CURRENT_TIMESTAMP
        WHERE document_id=? AND status='running' AND lease_owner=?`).run(delaySeconds,errorFingerprint,warningCode,job.document_id,job.lease_owner);
      return { retried: true, delay_seconds: delaySeconds };
    }
    await db.prepare(`UPDATE ai_knowledge_semantic_jobs SET status=?,completed_at=CURRENT_TIMESTAMP,lease_owner=NULL,lease_expires_at=NULL,
      last_error_fingerprint=?,last_warning_code=?,updated_at=CURRENT_TIMESTAMP
      WHERE document_id=? AND status='running' AND lease_owner=?`).run(failed?'failed':'completed',errorFingerprint,warningCode,job.document_id,job.lease_owner);
    return { completed: !failed, failed };
  };
  
  const processSemanticWork = async ({ limit = 1, signal } = {}) => {
    const max = Math.max(1,Math.min(4,Number.parseInt(limit,10)||1));
    const outcomes=[];
    for(let index=0;index<max;index++){
      if(signal?.aborted)break;
      const job=await claimSemanticWork();
      if(!job)break;
      try{
        const current=await db.prepare(`SELECT sources.*,documents.title AS document_title,documents.metadata AS document_metadata
          FROM ai_knowledge_sources sources JOIN ai_knowledge_documents documents ON documents.source_id=sources.id
          WHERE sources.id=? AND sources.project_id=? AND sources.revision_token=? AND sources.extraction_status='ready'
            AND documents.id=? AND documents.is_active=TRUE`).get(job.source_id,job.project_id,job.revision_token,job.document_id);
        if(!current){await db.prepare("DELETE FROM ai_knowledge_semantic_jobs WHERE document_id=? AND lease_owner=?").run(job.document_id,job.lease_owner);outcomes.push({document_id:job.document_id,status:'superseded'});continue;}
        const chunks=await db.prepare(`SELECT id,chunk_index AS index,heading,content,metadata,embedding_model
          FROM ai_knowledge_chunks WHERE document_id=? ORDER BY chunk_index`).all(job.document_id);
        if(!chunks.length){await finishSemanticWork(job,{warningCode:'NO_CURRENT_CHUNKS'});outcomes.push({document_id:job.document_id,status:'empty'});continue;}
        const runtime=await resolveEmbeddingRuntime({userId:current.created_by||undefined,projectId:job.project_id,integrationId:job.integration_id||undefined,signal});
        if(!runtime.configured){await finishSemanticWork(job,{warningCode:'EMBEDDING_NOT_CONFIGURED'});outcomes.push({document_id:job.document_id,status:'local_only'});continue;}
        const retrievalTexts=chunks.map(chunk=>buildChunkRetrievalText({title:current.document_title,chunk:{...chunk,heading_path:asArray(chunk.metadata?.section_path)}}));
        const profileEligible=!SOURCE_PERMISSION_BY_KIND[current.source_kind]&&chunks.reduce((total,chunk)=>total+String(chunk.content||'').length,0)>=3_000;
        const semanticProfile=profileEligible
          ? await require('./knowledgeEnrichment.service').enrichDocument({projectId:job.project_id,source:{...current,title:current.document_title},chunks,signal})
          : {mode:'standard',reason:SOURCE_PERMISSION_BY_KIND[current.source_kind]?'NATIVE_RECORD':'SHORT_SOURCE',sections:[]};
        const embeddingResult=await embedDocumentTexts({projectId:job.project_id,sourceId:current.id,runtime,texts:retrievalTexts,signal});
        if(signal?.aborted)throw createError('Knowledge semantic worker lease was cancelled.',409,'KNOWLEDGE_LEASE_LOST');
        if(embeddingResult.model===LOCAL_EMBEDDING_MODEL){
          const warning=embeddingResult.warning_reason_code||embeddingResult.warning_code||'EMBEDDING_UNAVAILABLE';
          const result=await finishSemanticWork(job,{warningCode:warning,errorFingerprint:fingerprint(embeddingResult.warning||warning),retry:true});
          outcomes.push({document_id:job.document_id,status:result.retried?'retrying':'degraded',warning_code:warning});
          continue;
        }
        const configurationHash=embeddingConfigurationHash(runtime);
        const chunkByIndex=new Map(chunks.map((chunk,index)=>[chunk.index,{chunk,index}]));
        await db.transaction(async()=>{
          const locked=await db.prepare(`SELECT sources.id FROM ai_knowledge_sources sources JOIN ai_knowledge_documents documents ON documents.source_id=sources.id
            WHERE sources.id=? AND sources.project_id=? AND sources.revision_token=? AND sources.extraction_status='ready'
              AND documents.id=? AND documents.is_active=TRUE FOR UPDATE OF sources,documents`).get(current.id,job.project_id,job.revision_token,job.document_id);
          if(!locked)throw createError('Knowledge source revision changed before semantic activation.',409,'KNOWLEDGE_VERSION_SUPERSEDED');
          await db.prepare(`UPDATE ai_knowledge_documents SET metadata=metadata||?::jsonb WHERE id=? AND is_active=TRUE`)
            .run({llm_context_profile:semanticProfile,embedding_configuration_hash:configurationHash},job.document_id);
          for(const section of asArray(semanticProfile.sections)){
            const found=chunkByIndex.get(Number(section.chunk_index));if(!found)continue;
            await db.prepare(`UPDATE ai_knowledge_chunks SET metadata=metadata||?::jsonb,
              search_vector=${lexicalQuery.weightedVectorSql('simple')},search_vector_prose=${lexicalQuery.weightedVectorSql(lexicalProseConfig())},
              lexical_version=${lexicalQuery.LEXICAL_VERSION} WHERE id=? AND document_id=?`).run(
              {llm_context_hint:{...section,generated:true,authoritative:false}},
              ...lexicalQuery.vectorParams(lexicalQuery.lexicalFields({title:current.document_title,chunk:found.chunk,hint:section.excerpt})),found.chunk.id,job.document_id);
          }
          const vectors=chunks.map((chunk,index)=>({id:chunk.id,embedding:embeddingResult.vectors[index]}));
          await db.prepare(`UPDATE ai_knowledge_chunks chunks SET embedding=vector_rows.embedding,embedding_model=?,
            metadata=chunks.metadata||jsonb_build_object('embedding_configuration_hash',?)
            FROM jsonb_to_recordset(?::jsonb) AS vector_rows(id TEXT,embedding JSONB)
            WHERE chunks.id=vector_rows.id AND chunks.document_id=?`).run(embeddingResult.model,configurationHash,vectors,job.document_id);
          await db.prepare(`UPDATE ai_knowledge_index_states SET embedding_model=?,embedding_dimensions=?,updated_at=CURRENT_TIMESTAMP
            WHERE document_id=? AND is_current=TRUE`).run(embeddingResult.model,embeddingResult.vectors[0]?.length||null,job.document_id);
          await knowledgeVectorProjection.queueSource({projectId:job.project_id,sourceId:current.id,documentId:job.document_id,revisionToken:job.revision_token});
          await db.prepare(`UPDATE ai_knowledge_semantic_jobs SET status='completed',attempts=0,completed_at=CURRENT_TIMESTAMP,
            lease_owner=NULL,lease_expires_at=NULL,last_error_fingerprint=NULL,last_warning_code=NULL,updated_at=CURRENT_TIMESTAMP
            WHERE document_id=? AND status='running' AND lease_owner=?`).run(job.document_id,job.lease_owner);
        })();
        for(let vectorIndex=0;vectorIndex<chunks.length;vectorIndex++)await persistEmbeddingVector(chunks[vectorIndex].id,embeddingResult.vectors[vectorIndex]);
        outcomes.push({document_id:job.document_id,status:'completed',chunk_count:chunks.length});
      }catch(error){
        const superseded=error?.code==='KNOWLEDGE_VERSION_SUPERSEDED';
        const result=await finishSemanticWork(job,{warningCode:error?.code||'SEMANTIC_WORK_FAILED',errorFingerprint:fingerprint(error instanceof Error?error.message:String(error)),retry:!superseded,failed:superseded});
        outcomes.push({document_id:job.document_id,status:result.retried?'retrying':superseded?'superseded':'failed',error_code:error?.code||'SEMANTIC_WORK_FAILED'});
      }
    }
    const pending=await db.prepare(`SELECT COUNT(*)::INTEGER AS count FROM ai_knowledge_semantic_jobs WHERE status IN('queued','running')`).get();
    const failed=await db.prepare(`SELECT COUNT(*)::INTEGER AS count FROM ai_knowledge_semantic_jobs WHERE status='failed'`).get();
    return {processed:outcomes.filter(item=>item.status==='completed').length,queued:outcomes.filter(item=>item.status==='retrying').length,
      pending:Number(pending?.count||0),failed:Number(failed?.count||0),outcomes};
  };
  
  // A changed source receives a new immutable revision/citations, while unchanged
  // embedding inputs can reuse canonical vectors from this source only. Hash the
  // complete title/section/content input, not just the visible paragraph.
  const embedDocumentTexts = async ({ projectId, sourceId, runtime, texts, signal }) => {
    if (!runtime?.configured) return embedTexts({ configured: false, ...runtime }, texts, { signal });
    const hashes = texts.map(fingerprint);
    const configurationHash = embeddingConfigurationHash(runtime);
    const rows = await db.prepare(`SELECT chunks.embedding, chunks.metadata->>'embedding_input_hash' AS input_hash
      FROM ai_knowledge_chunks chunks JOIN ai_knowledge_documents documents ON documents.id = chunks.document_id
      WHERE chunks.project_id = ? AND chunks.source_id = ? AND chunks.embedding_model = ?
        AND jsonb_exists(chunks.metadata, 'embedding_input_hash')
        AND chunks.metadata->>'embedding_configuration_hash' = ?
        AND chunks.metadata->>'embedding_input_hash' IN (SELECT jsonb_array_elements_text(?::jsonb))
      ORDER BY documents.version DESC, chunks.chunk_index LIMIT 10000`).all(projectId, sourceId, runtime.model, configurationHash, [...new Set(hashes)]);
    if (signal?.aborted) throw createError("Knowledge indexing lease was lost.", 409, "KNOWLEDGE_LEASE_LOST");
    const reused = new Map();
    for (const row of rows) {
      if (reused.has(row.input_hash)) continue;
      try {
        const vector = validateEmbeddingVector(row.embedding);
        if (vector.length >= 8) reused.set(row.input_hash, vector);
      } catch { /* Recompute invalid canonical vectors. */ }
    }
    if (new Set([...reused.values()].map(vector => vector.length)).size > 1) reused.clear();
    const reusedCount = hashes.filter(hash => reused.has(hash)).length;
    const inputByHash = new Map(hashes.map((hash, index) => [hash, texts[index]]));
    const missing = [...inputByHash.keys()].filter(hash => !reused.has(hash));
    const missingTexts = missing.map(hash => inputByHash.get(hash));
    const fallback = texts.map(localEmbedding);
    const generated = missing.length ? await embedTexts(runtime, missingTexts, { signal }) : null;
    if (generated && (generated.model !== runtime.model
        || (reused.size && generated.vectors[0]?.length !== reused.values().next().value.length))) {
      // Never mix provider/local dimensions or silently combine an old model
      // deployment with a new dimension under the same provider model name.
      return { ...(generated || {}), vectors: fallback, fallback, model: LOCAL_EMBEDDING_MODEL,
        warning_code: "embedding_fallback", warning: generated.warning || "The embedding model changed dimensions; complete local indexes were retained.",
        reused_chunk_count: 0 };
    }
    missing.forEach((hash, index) => reused.set(hash, generated.vectors[index]));
    return { vectors: hashes.map(hash => reused.get(hash)), fallback, model: runtime.model,
      provider: runtime.provider, warning: null, reused_chunk_count: reusedCount };
  };
  
  const persistDocument = async ({ projectId, source, content, chunking, embeddingRuntime, integrationId, metadata = {}, activationGuard, signal }) => {
    const sanitized = sanitizeAiText(content);
    if (!sanitized.text) return { document: null, chunks: [], warning: "No extractable text was available; the source was retained for a caption, transcript, or extraction step." };
    const documentId = uuid();
    const checksum = fingerprint(sanitized.text);
    let version = null;
    const bodyChunks = chunkText(stripRelationshipLines(sanitized.text, source), chunking);
    const chunks = [...bodyChunks, ...buildRelationshipChunks(source, bodyChunks.length)];
    if (!chunks.length) return { document: null, chunks: [], warning: "No searchable chunks could be produced from this source." };
    const contextQuality = assessContextQuality({ text: sanitized.text, chunks, redactionCount: sanitized.redaction_count });
    const documentContext = buildDocumentContextProfile({ title: source.title, chunks });
    const pipeline = processingProfile(chunking);
    const retrievalTexts = chunks.map((chunk) => buildChunkRetrievalText({ title: source.title, chunk }));
    let embeddingResult = await embedTexts({ configured: false }, retrievalTexts, { signal });
    if (signal?.aborted) throw createError("Knowledge indexing lease was lost.", 409, "KNOWLEDGE_LEASE_LOST");
  
    const persistedChunks = [];
    const commitDocumentVersion = db.transaction(async () => {
      const lockedSource = await db.prepare(`
        SELECT id, revision_token FROM ai_knowledge_sources
        WHERE id = ? AND project_id = ? AND extraction_status <> 'archived'
        FOR UPDATE
      `).get(source.id, projectId);
      if (!lockedSource) throw createError("Knowledge source no longer exists in this project.", 404);
      if (!source.revision_token || lockedSource.revision_token !== source.revision_token) {
        throw createError("Knowledge source changed while indexing; this stale version was not activated.", 409, "KNOWLEDGE_VERSION_SUPERSEDED");
      }
      if (activationGuard && !await activationGuard()) {
        throw createError("Knowledge source changed or was archived while indexing; this version was not activated.", 409, "KNOWLEDGE_VERSION_SUPERSEDED");
      }
      const versionRow = await db.prepare(`
        SELECT COALESCE(MAX(version), 0)::INTEGER + 1 AS version
        FROM ai_knowledge_documents WHERE source_id = ?
      `).get(source.id);
      version = Number(versionRow?.version || 1);
      await db.prepare(`
        INSERT INTO ai_knowledge_documents (
          id, project_id, source_id, title, content, version, token_count, char_count,
          checksum_sha256, metadata, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE)
      `).run(
        documentId, projectId, source.id, source.title, sanitized.text, version,
        Math.ceil(sanitized.text.length / 4), sanitized.text.length, checksum,
        { ...metadata, ...(source.metadata?.snapshot_fingerprint ? { snapshot_fingerprint: source.metadata.snapshot_fingerprint } : {}),
          source_snapshot: { source_kind: source.source_kind, source_ref_id: source.source_ref_id || null,
          title: source.title, source_uri: sanitizeSourceUri(source.source_uri), attachment_id: source.attachment_id || null,
          checksum_sha256: source._pending_checksum || source.checksum_sha256 || null,
          context_permission_profile: source.metadata?.context_permission_profile || null },
          processing_pipeline: pipeline, context_quality: contextQuality, document_context: documentContext, redactions: sanitized.redactions, redaction_count: sanitized.redaction_count, control_character_count: sanitized.control_character_count, risk_flags: sanitized.risk_flags }
      );
  
      for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index];
        const id = uuid();
        // Title (A), headings (B) and body (C) are weighted separately; the literal
        // "Document:/Section path:" prefixes used for embeddings are not indexed.
        const lexicalFieldValues = lexicalQuery.lexicalFields({ title: source.title, chunk });
        await db.prepare(`
          INSERT INTO ai_knowledge_chunks (
            id, project_id, document_id, source_id, chunk_index, heading, content, token_count,
            char_start, char_end, search_vector, search_vector_prose, lexical_version,
            embedding, fallback_embedding, embedding_model, metadata
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${lexicalQuery.weightedVectorSql("simple")},
            ${lexicalQuery.weightedVectorSql(lexicalProseConfig())}, ${lexicalQuery.LEXICAL_VERSION}, ?, ?, ?, ?)
        `).run(
          id, projectId, documentId, source.id, chunk.index, chunk.heading, chunk.content,
          chunk.token_count, chunk.char_start, chunk.char_end, ...lexicalQuery.vectorParams(lexicalFieldValues),
          embeddingResult.vectors[index], embeddingResult.fallback[index], embeddingResult.model,
          { fragment_key: `${(chunk.heading_path || []).join("/") || "body"}:${chunk.index}`, embedding_input_hash: fingerprint(retrievalTexts[index]),
            document_title: documentContext.title, section_heading: chunk.heading || null, section_path: chunk.heading_path || [], section_type: chunk.section_type || "body", section_level: chunk.section_level || null,
            relationship_records: asArray(chunk.relationship_records), hierarchy_strategy: documentContext.hierarchy_strategy, context_quality_grade: contextQuality.grade, context_quality_score: contextQuality.score, risk_flags: sanitized.risk_flags, redaction_count: sanitized.redaction_count }
        );
        persistedChunks.push({ id, ...chunk, document_id: documentId, source_id: source.id });
      }
  
      // Re-check after all potentially long chunk writes and immediately before
      // the active-version flip. Child evidence writers do not share this source
      // row lock, so the first pre-insert check alone is not a sufficient guard.
      if (activationGuard && !await activationGuard()) {
        throw createError("Knowledge evidence changed while indexing; the stale document was not activated.", 409, "KNOWLEDGE_VERSION_SUPERSEDED");
      }
      await db.prepare(`
        INSERT INTO ai_knowledge_index_states (
          document_id, project_id, source_id, document_version, is_current,
          lexical_state, dense_state, vector_provider, embedding_model,
          embedding_dimensions, indexed_chunk_count, indexed_at
        ) VALUES (?, ?, ?, ?, FALSE, 'ready', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT (document_id) DO UPDATE SET
          is_current = FALSE,
          lexical_state = 'ready',
          dense_state = EXCLUDED.dense_state,
          vector_provider = EXCLUDED.vector_provider,
          embedding_model = EXCLUDED.embedding_model,
          embedding_dimensions = EXCLUDED.embedding_dimensions,
          indexed_chunk_count = EXCLUDED.indexed_chunk_count,
          error_fingerprint = NULL,
          indexed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      `).run(
        documentId, projectId, source.id, version,
        "ready", "postgresql",
        embeddingResult.model, embeddingResult.vectors[0]?.length || null, persistedChunks.length
      );
    });
    await commitDocumentVersion();
  
    const activateDocumentVersion = db.transaction(async () => {
      const current = await db.prepare(`SELECT id, revision_token FROM ai_knowledge_sources
        WHERE id = ? AND project_id = ? AND extraction_status <> 'archived' FOR UPDATE`).get(source.id, projectId);
      if (!current || current.revision_token !== source.revision_token || (activationGuard && !await activationGuard())) {
        throw createError("Knowledge source changed before index promotion.", 409, "KNOWLEDGE_VERSION_SUPERSEDED");
      }
      const ready = await db.prepare(`SELECT document_id FROM ai_knowledge_index_states
        WHERE document_id = ? AND lexical_state = 'ready' AND dense_state = 'ready'`).get(documentId);
      if (!ready) throw createError("Required knowledge indexes are not ready.", 409, "ERR_INDEX_NOT_READY");
      await require("./knowledgeGraph.service").syncDocument({ projectId, source,
        document: { id: documentId, version, checksum_sha256: checksum }, chunks: persistedChunks });
      await db.prepare(`
        UPDATE ai_knowledge_documents SET is_active = FALSE, effective_to = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE source_id = ? AND id <> ? AND is_active = TRUE
      `).run(source.id, documentId);
      await db.prepare(`UPDATE ai_knowledge_index_states SET is_current = FALSE, updated_at = CURRENT_TIMESTAMP
        WHERE source_id = ? AND document_id <> ? AND is_current = TRUE`).run(source.id, documentId);
      await db.prepare(`UPDATE ai_knowledge_documents SET is_active = TRUE, effective_from = CURRENT_TIMESTAMP,
        effective_to = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(documentId);
      await db.prepare(`UPDATE ai_knowledge_index_states SET is_current = TRUE, required_indexes_ready = TRUE,
        updated_at = CURRENT_TIMESTAMP WHERE document_id = ?`).run(documentId);
      await db.prepare(`
        UPDATE ai_knowledge_sources
        SET app_type_id = ?, title = ?, source_uri = ?, file_name = ?, mime_type = ?, size_bytes = ?,
          extraction_strategy = ?, metadata = ?, required_permission = ?,
          extraction_status = 'ready', checksum_sha256 = COALESCE(?, checksum_sha256),
          risk_flags = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        source.app_type_id || null, source.title, sanitizeSourceUri(source.source_uri), source.file_name || null,
        source.mime_type || null, source.size_bytes ?? null, source.extraction_strategy || null,
        asObject(source.metadata), source.required_permission || null,
        source._pending_checksum || null, sanitized.risk_flags, source.id
      );
      await knowledgeVectorProjection.queueSource({ projectId, sourceId: source.id, documentId, revisionToken: source.revision_token });
    });
    // Publish a complete canonical revision before contacting optional providers.
    // Provider embedding and enrichment are durable low-priority work; they never
    // hold the source ingestion lease or delay native refresh.
    await activateDocumentVersion();
    await enqueueSemanticWork({ projectId, sourceId: source.id, documentId, revisionToken: source.revision_token, integrationId });
    const document = await db.prepare("SELECT * FROM ai_knowledge_documents WHERE id = ?").get(documentId);
    const warning = [embeddingResult.warning, contextQuality.requires_review ? `Context quality ${contextQuality.score}/100 requires review before relying on this source.` : null].filter(Boolean).join(" ") || null;
    return {
      document,
      chunks: persistedChunks,
      context_quality: contextQuality,
      warning_code: embeddingResult.warning_code || (contextQuality.requires_review ? "context_quality_review" : null),
      warning
    };
  };
  
  const completeJob = async (jobId, { processed, failed, chunkCount, warnings, errors }, { leaseOwner } = {}) => {
    const status = failed && !processed ? "failed" : warnings.length || failed ? "completed_with_warnings" : "completed";
    const result = await db.prepare(`
      UPDATE ai_knowledge_ingestion_jobs
      SET status = ?, processed_count = ?, failed_count = ?, chunk_count = ?, warnings = ?, errors = ?,
        completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
        lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL
      WHERE id = ? ${leaseOwner ? "AND status = 'running' AND lease_owner = ?" : ""}
    `).run(status, processed, failed, chunkCount, warnings, errors, jobId, ...(leaseOwner ? [leaseOwner] : []));
    if (leaseOwner && !result.changes) throw createError("Knowledge ingestion lease was lost before completion.", 409, "KNOWLEDGE_LEASE_LOST");
    return getIngestionJob(jobId);
  };
  
  const ingest = async ({ projectId, collectionId, appTypeId, title, inputs, selectedRecords, chunking, integrationId, user, existingJobId, leaseOwner, signal, internalPrincipal }) => {
    const normalizedProjectId = normalizeId(projectId);
    if (!normalizedProjectId) throw createError("project_id is required.");
    await assertCollectionScope(normalizedProjectId, collectionId);
    const rawInputs = [...asArray(inputs), ...normalizeSelectedRecordInputs(selectedRecords)];
    if (!rawInputs.length) throw createError("Choose at least one Story, Test Case, Test Run, Defect, text, chat, URL, or file input.");
    if (rawInputs.length > MAX_INPUTS) throw createError(`A single ingestion can contain at most ${MAX_INPUTS} inputs.`);
    if (internalPrincipal !== NATIVE_OUTBOX_PRINCIPAL) await assertRecordSourcePermissions(normalizedProjectId, rawInputs, user);
    const chunkingOptions = normalizeChunkingOptions(asObject(chunking));
    // Validate explicit selections before writes; discover the optional default
    // only after the canonical document has become searchable.
    if (integrationId) await resolveEmbeddingRuntime({ userId: user?.id, projectId: normalizedProjectId, integrationId, signal });
    const job = existingJobId
      ? await getIngestionJob(existingJobId)
      : await createJob({
          projectId: normalizedProjectId,
          collectionId,
          inputCount: rawInputs.length,
          config: { title: normalizeText(title, 500) || null, app_type_id: normalizeId(appTypeId) || null, chunking: chunkingOptions, integration_id: normalizeId(integrationId) || null },
          userId: user?.id
        });
    if (job.project_id !== normalizedProjectId || (existingJobId && job.status !== "running")) {
      throw createError("Queued knowledge ingestion job is not in a processable project state.", 409);
    }
    const sources = [];
    const documents = [];
    const warnings = [];
    const errors = [];
    let chunkCount = 0;
    let processed = 0;
    let failed = 0;
    let deduplicatedCount = 0;
  
    for (let index = 0; index < rawInputs.length; index += 1) {
      let source = null;
      try {
        const input = await normalizeInput(normalizedProjectId, rawInputs[index]);
        input.app_type_id = input.app_type_id || normalizeId(appTypeId) || null;
        input.processing_fingerprint = processingProfile(chunkingOptions).fingerprint;
        source = await createSource({
          projectId: normalizedProjectId,
          collectionId,
          input,
          userId: user?.id,
          jobId: job.id,
          leaseOwner
        });
        sources.push(source);
        if (source._reused) {
          deduplicatedCount += 1;
          warnings.push({ input_index: index, source_id: source.id, code: "deduplicated", message: "An identical current source was already indexed and was reused." });
          await recordIngestionResult(job.id, index, { sourceId: source.id, outcome: "reused", reused: true, warningCodes: ["deduplicated"] }, { leaseOwner });
          processed += 1;
          continue;
        }
        const persisted = await persistDocument({
          projectId: normalizedProjectId,
          source,
          content: input.content,
          chunking: chunkingOptions,
          integrationId,
          metadata: { source_kind: input.source_kind, source_ref_id: input.source_ref_id },
          signal,
          activationGuard: async () => {
            if (!await isApplicationRecordSnapshotCurrent(normalizedProjectId, input)) return false;
            if (!leaseOwner) return true;
            const lease = await db.prepare(`
              SELECT 1 AS owned FROM ai_knowledge_ingestion_jobs
              WHERE id = ? AND status = 'running' AND lease_owner = ?
                AND lease_expires_at > CURRENT_TIMESTAMP
            `).get(job.id, leaseOwner);
            return Boolean(lease?.owned) && !signal?.aborted;
          }
        });
        if (persisted.document) documents.push(toPublicDocument(persisted.document));
        if (!persisted.document) {
          await markSourceNeedsExtraction(source, { jobId: job.id, leaseOwner });
        }
        chunkCount += persisted.chunks.length;
        if (persisted.warning) warnings.push({ input_index: index, source_id: source.id, code: persisted.warning_code || "indexing_warning", message: persisted.warning });
        await recordIngestionResult(job.id, index, {
          sourceId: source.id,
          documentId: persisted.document?.id,
          outcome: persisted.document ? "indexed" : "needs_extraction",
          warningCodes: persisted.warning ? [persisted.warning_code || "indexing_warning"] : []
        }, { leaseOwner });
        processed += 1;
      } catch (error) {
        try {
          await markSourcePersistenceFailed(source, { jobId: job.id, leaseOwner });
        } catch (persistenceError) {
          if (persistenceError?.code === "KNOWLEDGE_LEASE_LOST") {
            await removeUnactivatedNewSourceAfterLeaseLoss(source);
          }
          throw persistenceError;
        }
        failed += 1;
        const classifiedError = classifyIngestionError(error, { stage: "indexing" });
        errors.push({ input_index: index, ...classifiedError });
        await recordIngestionResult(job.id, index, {
          sourceId: source?.id,
          outcome: "failed",
          errorFingerprint: classifiedError.error_fingerprint
        }, { leaseOwner });
      }
      if (existingJobId) {
        const progress = await db.prepare(`
          UPDATE ai_knowledge_ingestion_jobs SET updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND status = 'running' AND lease_owner = ?
        `).run(job.id, leaseOwner);
        if (!progress.changes) throw createError("Knowledge ingestion lease was lost.", 409, "KNOWLEDGE_LEASE_LOST");
      }
    }
    const completedJob = await completeJob(job.id, { processed, failed, chunkCount, warnings, errors }, { leaseOwner });
    return { job: completedJob, sources: sources.map(toPublicSource), documents, chunk_count: chunkCount, deduplicated_count: deduplicatedCount, warnings };
  };
  
  const claimNativeOutboxEvent = (leaseMinutes = 20) => db.transaction(async () => {
    const event = await db.prepare(`SELECT events.* FROM ai_knowledge_native_outbox events
      LEFT JOIN ai_knowledge_outbox_project_fairness fairness ON fairness.project_id=events.project_id
      WHERE (events.status='queued' AND events.next_attempt_at<=CURRENT_TIMESTAMP)
        OR (events.status='running' AND events.lease_expires_at<=CURRENT_TIMESTAMP)
      ORDER BY fairness.last_served_at ASC NULLS FIRST,events.next_attempt_at,events.created_at,events.source_kind,events.source_ref_id
      LIMIT 1 FOR UPDATE OF events SKIP LOCKED`).get();
    if (!event) return null;
    const claimed = await db.prepare(`UPDATE ai_knowledge_native_outbox SET status='running',attempts=attempts+1,
      lease_owner=?,lease_expires_at=CURRENT_TIMESTAMP+(?::INTEGER*INTERVAL '1 minute'),updated_at=CURRENT_TIMESTAMP
      WHERE source_kind=? AND source_ref_id=? RETURNING *`).get(KNOWLEDGE_WORKER_ID,leaseMinutes,event.source_kind,event.source_ref_id);
    await db.prepare(`INSERT INTO ai_knowledge_outbox_project_fairness(project_id,last_served_at) VALUES(?,CURRENT_TIMESTAMP)
      ON CONFLICT(project_id) DO UPDATE SET last_served_at=CURRENT_TIMESTAMP`).run(event.project_id);
    return claimed;
  })();
  
  const processNativeChangeOutbox = async ({ limit = 2, leaseMinutes = 20 } = {}) => {
    const batchSize=Math.max(1,Math.min(12,Number.parseInt(limit,10)||2));
    const lease=Math.max(5,Math.min(60,Number.parseInt(leaseMinutes,10)||20));
    const outcomes=[];
    for(let index=0;index<batchSize;index++){
      const event=await claimNativeOutboxEvent(lease);
      if(!event)break;
      const controller=new AbortController();
      const heartbeat=setInterval(async()=>{
        try{
          const renewed=await db.prepare(`UPDATE ai_knowledge_native_outbox SET lease_expires_at=CURRENT_TIMESTAMP+(?::INTEGER*INTERVAL '1 minute'),updated_at=CURRENT_TIMESTAMP
            WHERE source_kind=? AND source_ref_id=? AND revision=? AND status='running' AND lease_owner=?`).run(lease,event.source_kind,event.source_ref_id,event.revision,KNOWLEDGE_WORKER_ID);
          if(!renewed.changes)controller.abort(new Error('Native indexing lease was superseded.'));
        }catch{controller.abort(new Error('Native indexing lease could not be renewed.'));}
      },30_000);
      heartbeat.unref?.();
      try{
        if(event.action==='archive'){
          await require('./knowledgeSourceLifecycle.service').archiveNativeSource({projectId:event.project_id,sourceKind:event.source_kind,sourceRefId:event.source_ref_id});
        }else{
          const indexed=await ingest({projectId:event.project_id,inputs:[{kind:event.source_kind,entity_id:event.source_ref_id}],
            internalPrincipal:NATIVE_OUTBOX_PRINCIPAL,signal:controller.signal});
          if(indexed.job.status==='failed')throw Object.assign(new Error('Native Knowledge indexing did not produce an active revision.'),{code:'KNOWLEDGE_NATIVE_INDEX_FAILED'});
        }
        const removed=await db.prepare(`DELETE FROM ai_knowledge_native_outbox WHERE source_kind=? AND source_ref_id=? AND project_id=?
          AND revision=? AND status='running' AND lease_owner=?`).run(event.source_kind,event.source_ref_id,event.project_id,event.revision,KNOWLEDGE_WORKER_ID);
        outcomes.push({kind:event.source_kind,action:event.action,status:removed.changes?'completed':'superseded'});
      }catch(error){
        const attempt=Number(event.attempts||1),delay=Math.min(3600,15*2**Math.min(Math.max(0,attempt-1),8));
        const status=attempt>=12?'failed':'queued';
        await db.prepare(`UPDATE ai_knowledge_native_outbox SET status=?,next_attempt_at=CURRENT_TIMESTAMP+(?::INTEGER*INTERVAL '1 second'),
          lease_owner=NULL,lease_expires_at=NULL,last_error_fingerprint=?,updated_at=CURRENT_TIMESTAMP
          WHERE source_kind=? AND source_ref_id=? AND revision=? AND status='running' AND lease_owner=?`)
          .run(status,delay,fingerprint(error instanceof Error?error.message:'native indexing failed'),event.source_kind,event.source_ref_id,event.revision,KNOWLEDGE_WORKER_ID);
        outcomes.push({kind:event.source_kind,action:event.action,status:status==='failed'?'failed':'retry_scheduled'});
      }finally{clearInterval(heartbeat);}
    }
    const lag=await db.prepare(`SELECT COUNT(*)::INTEGER AS queued,
      EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP-MIN(created_at)))::INTEGER AS oldest_lag_seconds
      FROM ai_knowledge_native_outbox WHERE status IN('queued','running')`).get();
    return {processed:outcomes.length,outcomes,queue:{queued:Number(lag?.queued||0),oldest_lag_seconds:Number(lag?.oldest_lag_seconds||0)}};
  };
  
  const reconcileNativeIndexGaps = async ({ limit = 2_000 } = {}) => {
    const size=Math.max(1,Math.min(20_000,Number.parseInt(limit,10)||2_000));
    const inserted=await db.prepare(`WITH native_records AS (
        SELECT 'requirement'::TEXT AS source_kind,records.id AS source_ref_id,records.project_id FROM requirements records
        UNION ALL SELECT 'test_case',records.id,apps.project_id FROM test_cases records JOIN app_types apps ON apps.id=records.app_type_id
        UNION ALL SELECT 'execution',records.id,records.project_id FROM executions records
        UNION ALL SELECT 'execution_result',results.id,runs.project_id FROM execution_results results JOIN executions runs ON runs.id=results.execution_id
        UNION ALL SELECT 'bug',records.id,records.project_id FROM feedback records
        UNION ALL SELECT 'test_suite',records.id,apps.project_id FROM test_suites records JOIN app_types apps ON apps.id=records.app_type_id
        UNION ALL SELECT 'test_module',records.id,apps.project_id FROM test_case_modules records JOIN app_types apps ON apps.id=records.app_type_id
        UNION ALL SELECT 'release',records.id,records.project_id FROM requirement_releases records
        UNION ALL SELECT 'sprint',records.id,records.project_id FROM requirement_iterations records
      ), missing AS (
        SELECT records.* FROM native_records records WHERE NOT EXISTS (
          SELECT 1 FROM ai_knowledge_sources sources JOIN ai_knowledge_documents documents ON documents.source_id=sources.id AND documents.project_id=sources.project_id
          JOIN ai_knowledge_index_states indexes ON indexes.document_id=documents.id AND indexes.project_id=documents.project_id
          WHERE sources.project_id=records.project_id AND sources.source_kind=records.source_kind AND sources.source_ref_id=records.source_ref_id
            AND sources.extraction_status='ready' AND documents.is_active=TRUE AND indexes.is_current=TRUE AND indexes.required_indexes_ready=TRUE
        ) ORDER BY records.project_id,records.source_kind,records.source_ref_id LIMIT ?
      ) INSERT INTO ai_knowledge_native_outbox(source_kind,source_ref_id,project_id,action,status,next_attempt_at)
        SELECT source_kind,source_ref_id,project_id,'upsert','queued',CURRENT_TIMESTAMP FROM missing
        ON CONFLICT(source_kind,source_ref_id) DO UPDATE SET project_id=EXCLUDED.project_id,action='upsert',revision=ai_knowledge_native_outbox.revision+1,
          status='queued',attempts=0,next_attempt_at=CURRENT_TIMESTAMP,lease_owner=NULL,lease_expires_at=NULL,last_error_fingerprint=NULL,updated_at=CURRENT_TIMESTAMP
        WHERE ai_knowledge_native_outbox.status='failed' RETURNING source_kind`).all(size);
    return {queued:inserted.length,scanned_limit:size};
  };
  
  const prepareQueuedInput = async (projectId, rawInput, appTypeId) => {
    const source = asObject(rawInput);
    const kind = normalizeSourceKind(source.kind || source.type || source.entity_type || source.source_kind);
    const entityId = normalizeId(source.entity_id || source.source_ref_id || source.record_id);
    if (SOURCE_PERMISSION_BY_KIND[kind]) {
      if (!entityId) throw createError(`${kind} entity_id is required.`);
      return {
        kind,
        entity_id: entityId,
        stable_source_key: stableSourceKey({ source_kind: kind, source_ref_id: entityId })
      };
    }
    const normalized = await normalizeInput(projectId, source);
    const scopedAppTypeId = normalizeId(appTypeId) || null;
    const sanitizedContent = sanitizeAiText(normalized.content || "").text;
    const contentChecksum = sanitizedContent ? fingerprint(sanitizedContent) : null;
    return {
      kind: normalized.source_kind,
      entity_id: normalized.source_ref_id || undefined,
      app_type_id: scopedAppTypeId || undefined,
      title: sanitizeAiText(normalized.title).text,
      content: sanitizedContent,
      source_uri: sanitizeSourceUri(normalized.source_uri),
      file_name: normalized.file_name ? sanitizeAiText(normalized.file_name).text : undefined,
      mime_type: normalized.mime_type || undefined,
      size_bytes: normalized.size_bytes ?? undefined,
      extraction_strategy: normalized.extraction_strategy,
      metadata: normalized.metadata,
      stable_source_key: stableSourceKey({
        source_kind: normalized.source_kind,
        app_type_id: scopedAppTypeId,
        checksum_sha256: contentChecksum
      }) || undefined
    };
  };
  
  const enqueueIngestion = async ({
    projectId,
    collectionId,
    appTypeId,
    title,
    inputs,
    selectedRecords,
    chunking,
    integrationId,
    idempotencyKey,
    user
  }) => {
    const normalizedProjectId = normalizeId(projectId);
    if (!normalizedProjectId) throw createError("project_id is required.");
    await assertCollectionScope(normalizedProjectId, collectionId);
    const rawInputs = [...asArray(inputs), ...normalizeSelectedRecordInputs(selectedRecords)];
    if (!rawInputs.length) throw createError("Choose at least one Story, Test Case, Test Run, Defect, text, chat, URL, or file input.");
    if (rawInputs.length > MAX_INPUTS) throw createError(`A single ingestion can contain at most ${MAX_INPUTS} inputs.`);
    await assertRecordSourcePermissions(normalizedProjectId, rawInputs, user);
    if (integrationId) await resolveEmbeddingRuntime({ userId: user?.id, projectId: normalizedProjectId, integrationId });
    const preparedInputs = [];
    for (const rawInput of rawInputs) preparedInputs.push(await prepareQueuedInput(normalizedProjectId, rawInput, appTypeId));
    const chunkingOptions = normalizeChunkingOptions(asObject(chunking));
    const normalizedIdempotencyKey = normalizeText(idempotencyKey, 255) || null;
    const requestFingerprint = fingerprint(JSON.stringify({
      project_id: normalizedProjectId,
      collection_id: normalizeId(collectionId),
      app_type_id: normalizeId(appTypeId),
      integration_id: normalizeId(integrationId),
      title: normalizeText(title, 500),
      chunking: chunkingOptions,
      inputs: preparedInputs
    }));
  
    if (normalizedIdempotencyKey) {
      const existing = await db.prepare(`
        SELECT * FROM ai_knowledge_ingestion_jobs
        WHERE project_id = ? AND created_by = ? AND idempotency_key = ?
        ORDER BY created_at DESC LIMIT 1
      `).get(normalizedProjectId, user?.id, normalizedIdempotencyKey);
      if (existing) {
        if (asObject(existing.config).request_fingerprint !== requestFingerprint) {
          throw createError("Idempotency-Key was already used for a different knowledge ingestion request.", 409, "IDEMPOTENCY_KEY_REUSED");
        }
        return {
          accepted: ["queued", "running"].includes(existing.status),
          idempotent_replay: true,
          job: toPublicIngestionJob(existing),
          sources: [],
          documents: [],
          chunk_count: Number(existing.chunk_count || 0),
          deduplicated_count: 0,
          warnings: asArray(existing.warnings),
          status_url: `/knowledge/ingestions/${existing.id}`
        };
      }
    }
  
    let job;
    try {
      job = await db.transaction(async () => {
        const created = await createJob({
        projectId: normalizedProjectId,
        collectionId,
        inputCount: preparedInputs.length,
        config: {
          title: normalizeText(title, 500) || null,
          app_type_id: normalizeId(appTypeId) || null,
          integration_id: normalizeId(integrationId) || null,
          chunking: chunkingOptions,
          request_fingerprint: requestFingerprint,
          queue_version: 1
        },
        userId: user?.id,
        status: "queued",
        idempotencyKey: normalizedIdempotencyKey
      });
        for (let index = 0; index < preparedInputs.length; index += 1) {
          await db.prepare(`
            INSERT INTO ai_knowledge_ingestion_inputs (job_id, input_index, payload)
            VALUES (?, ?, ?)
          `).run(created.id, index, preparedInputs[index]);
        }
        return created;
      })();
    } catch (error) {
      if (error?.code !== "23505" || !normalizedIdempotencyKey) throw error;
      const existing = await db.prepare(`
        SELECT * FROM ai_knowledge_ingestion_jobs
        WHERE project_id = ? AND created_by = ? AND idempotency_key = ?
      `).get(normalizedProjectId, user?.id, normalizedIdempotencyKey);
      if (!existing || asObject(existing.config).request_fingerprint !== requestFingerprint) {
        throw createError("Idempotency-Key was already used for a different knowledge ingestion request.", 409, "IDEMPOTENCY_KEY_REUSED");
      }
      return {
        accepted: ["queued", "running"].includes(existing.status),
        idempotent_replay: true,
        job: toPublicIngestionJob(existing),
        sources: [],
        documents: [],
        chunk_count: Number(existing.chunk_count || 0),
        deduplicated_count: 0,
        warnings: asArray(existing.warnings),
        status_url: `/knowledge/ingestions/${existing.id}`
      };
    }
    return {
      accepted: true,
      idempotent_replay: false,
      job,
      sources: [],
      documents: [],
      chunk_count: 0,
      deduplicated_count: 0,
      warnings: [],
      status_url: `/knowledge/ingestions/${job.id}`
    };
  };
  
  const claimQueuedIngestion = (workerId, leaseMinutes) => claimFairQueueRow({
    stage: "ingestion",
    sql: `SELECT jobs.* FROM ai_knowledge_ingestion_jobs jobs
      LEFT JOIN ai_knowledge_worker_project_fairness fairness ON fairness.queue_stage='ingestion' AND fairness.project_id=jobs.project_id
      WHERE jobs.status='queued' ORDER BY fairness.last_served_at ASC NULLS FIRST,jobs.created_at ASC,jobs.id ASC
      LIMIT 1 FOR UPDATE OF jobs SKIP LOCKED`,
    claim: (queued) => db.prepare(`
      UPDATE ai_knowledge_ingestion_jobs
      SET status = 'running', started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
        lease_owner = ?, lease_expires_at = CURRENT_TIMESTAMP + (?::INTEGER * INTERVAL '1 minute'),
        heartbeat_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'queued'
      RETURNING *
    `).get(workerId, leaseMinutes, queued.id)
  });
  
  const renewIngestionLease = async (jobId, workerId, leaseMinutes) => db.prepare(`
    UPDATE ai_knowledge_ingestion_jobs
    SET lease_expires_at = CURRENT_TIMESTAMP + (?::INTEGER * INTERVAL '1 minute'),
      heartbeat_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'running' AND lease_owner = ?
  `).run(leaseMinutes, jobId, workerId);
  
  const processQueuedIngestions = async ({ limit = 2, staleAfterMinutes = 60 } = {}) => {
    const normalizedLimit = Math.max(1, Math.min(10, Number.parseInt(limit, 10) || 2));
    const normalizedStaleMinutes = Math.max(15, Math.min(24 * 60, Number.parseInt(staleAfterMinutes, 10) || 60));
    const leaseMinutes = Math.max(5, Math.min(30, Math.ceil(normalizedStaleMinutes / 4)));
    await db.prepare(`
      UPDATE ai_knowledge_ingestion_jobs
      SET status = 'queued', started_at = NULL, updated_at = CURRENT_TIMESTAMP,
        lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
        warnings = warnings || ?::jsonb
      WHERE status = 'running' AND completed_at IS NULL
        AND (
          (lease_expires_at IS NOT NULL AND lease_expires_at < CURRENT_TIMESTAMP)
          OR (lease_expires_at IS NULL AND updated_at < CURRENT_TIMESTAMP - (?::INTEGER * INTERVAL '1 minute'))
        )
    `).run([{ code: "stale_lease_recovered", message: "A stale ingestion lease was recovered after a worker restart." }], normalizedStaleMinutes);
    // Retain sanitized failed inputs long enough for a manual retry, then purge
    // stale payload copies. Staged file retries remain reconstructable from their
    // scoped attachment even after this retention window.
    await db.prepare(`
      DELETE FROM ai_knowledge_ingestion_inputs inputs
      WHERE EXISTS (
        SELECT 1 FROM ai_knowledge_ingestion_jobs jobs
        WHERE jobs.id = inputs.job_id AND jobs.status = 'failed'
          AND jobs.updated_at < CURRENT_TIMESTAMP - (?::INTEGER * INTERVAL '1 day')
      )
    `).run(FAILED_INPUT_RETENTION_DAYS);
  
    const outcomes = [];
    for (let index = 0; index < normalizedLimit; index += 1) {
      const job = await claimQueuedIngestion(KNOWLEDGE_WORKER_ID, leaseMinutes);
      if (!job) break;
      let terminalStatePersisted = false;
      let queuedInputs = [];
      let jobConfig = {};
      const leaseController = new AbortController();
      const heartbeat = setInterval(async () => {
        try {
          const renewed = await renewIngestionLease(job.id, KNOWLEDGE_WORKER_ID, leaseMinutes);
          if (!renewed.changes) leaseController.abort();
        } catch (error) {
          leaseController.abort();
          console.warn(JSON.stringify({
            event: "knowledge_ingestion_lease_heartbeat_failed",
            job_id: job.id,
            error_fingerprint: fingerprint(error instanceof Error ? error.message : String(error))
          }));
        }
      }, 30_000);
      heartbeat.unref?.();
      try {
        jobConfig = asObject(job.config);
        const workerUser = job.created_by ? await db.prepare(`
          SELECT id, is_workspace_admin FROM users WHERE id = ? AND status = 'active'
        `).get(job.created_by) : null;
        if (!workerUser || !await permissionService.hasPermission(workerUser, 'knowledge.manage', job.project_id)
          || !await featureFlagService.areEnabled(featureFlagService.getFeatureKeysForPermission('knowledge.manage'), { user: workerUser })) {
          throw createError('The ingestion owner is no longer authorized to process Knowledge sources.', 403, 'KNOWLEDGE_SOURCE_PERMISSION_REQUIRED');
        }
        if (workerUser?.is_workspace_admin) workerUser.role = "admin";
        queuedInputs = await db.prepare(`
          SELECT payload FROM ai_knowledge_ingestion_inputs
          WHERE job_id = ? ORDER BY input_index ASC
        `).all(job.id);
        if (!queuedInputs.length) throw createError("Queued knowledge inputs are unavailable.", 409);
        const result = jobConfig.upload
          ? await processQueuedUpload({ job, payload: asObject(queuedInputs[0].payload), user: workerUser, leaseOwner: KNOWLEDGE_WORKER_ID, signal: leaseController.signal })
          : await ingest({
              projectId: job.project_id,
              collectionId: job.collection_id,
              appTypeId: jobConfig.app_type_id,
              integrationId: normalizeId(jobConfig.integration_id) || null,
              title: jobConfig.title,
              inputs: queuedInputs.map((row) => row.payload),
              chunking: jobConfig.chunking,
              integrationId: normalizeId(jobConfig.integration_id) || null,
              user: workerUser,
              existingJobId: job.id,
              leaseOwner: KNOWLEDGE_WORKER_ID,
              signal: leaseController.signal
            });
        terminalStatePersisted = true;
        outcomes.push({ id: job.id, status: result.job.status });
      } catch (error) {
        const classifiedError = classifyIngestionError(error, {
          stage: jobConfig.upload ? "file_processing" : "indexing"
        });
        if (jobConfig.upload) {
          const stagedSourceId = normalizeId(asObject(queuedInputs[0]?.payload).source_id);
          if (stagedSourceId) {
            await markSourcePersistenceFailed({
              id: stagedSourceId,
              revision_token: asObject(queuedInputs[0]?.payload).revision_token,
              _new: true,
              _had_ready_version: false
            }, { jobId: job.id, leaseOwner: KNOWLEDGE_WORKER_ID });
            await recordIngestionResult(job.id, 0, {
              sourceId: stagedSourceId,
              outcome: "failed",
              errorFingerprint: classifiedError.error_fingerprint
            }, { leaseOwner: KNOWLEDGE_WORKER_ID });
          }
        }
        await completeJob(job.id, {
          processed: 0,
          failed: Number(job.input_count || 1),
          chunkCount: 0,
          warnings: [],
          errors: [classifiedError]
        }, { leaseOwner: KNOWLEDGE_WORKER_ID });
        terminalStatePersisted = true;
        console.warn(JSON.stringify({
          event: "knowledge_ingestion_job_failed",
          job_id: job.id,
          project_id: job.project_id,
          stage: classifiedError.stage,
          error_code: classifiedError.code,
          retryable: classifiedError.retryable,
          error_fingerprint: classifiedError.error_fingerprint
        }));
        outcomes.push({ id: job.id, status: "failed" });
      } finally {
        clearInterval(heartbeat);
        if (terminalStatePersisted) await db.prepare(`
          DELETE FROM ai_knowledge_ingestion_inputs inputs
          WHERE inputs.job_id = ? AND EXISTS (
            SELECT 1 FROM ai_knowledge_ingestion_jobs jobs
            WHERE jobs.id = inputs.job_id AND jobs.status IN ('completed', 'completed_with_warnings')
          )
        `).run(job.id);
      }
    }
    return outcomes;
  };
  
  const retryIngestion = async ({ id, user }) => {
    const visibleJob = await getIngestionJob(id, { user });
    const retry = await db.transaction(async () => {
      const job = await db.prepare(`
        SELECT * FROM ai_knowledge_ingestion_jobs WHERE id = ? FOR UPDATE
      `).get(id);
      if (!job) throw createError("Knowledge ingestion job not found.", 404);
      if (["queued", "running"].includes(job.status)) return { job, alreadyAccepted: true };
      if (job.status !== "failed") {
        throw createError("Only a failed Knowledge ingestion can be retried.", 409, "KNOWLEDGE_RETRY_NOT_ALLOWED");
      }
  
      const jobConfig = asObject(job.config);
      const retryCount = Math.max(0, Number(jobConfig.retry_count || 0) || 0);
      if (retryCount >= MAX_MANUAL_INGESTION_RETRIES) {
        throw createError(`This ingestion reached the ${MAX_MANUAL_INGESTION_RETRIES}-retry safety limit. Upload or select the source again to start a clean job.`, 409, "KNOWLEDGE_RETRY_LIMIT_REACHED");
      }
  
      let queuedInputs = await db.prepare(`
        SELECT input_index FROM ai_knowledge_ingestion_inputs
        WHERE job_id = ? ORDER BY input_index ASC
      `).all(id);
      if (!queuedInputs.length && jobConfig.upload) {
        const source = await db.prepare(`
          SELECT sources.id, sources.project_id, sources.attachment_id, sources.checksum_sha256,
            sources.revision_token, sources.mime_type
          FROM ai_knowledge_ingestion_results results
          JOIN ai_knowledge_sources sources ON sources.id = results.source_id
          WHERE results.job_id = ? AND sources.project_id = ?
          ORDER BY results.input_index ASC LIMIT 1
        `).get(id, job.project_id);
        const canReextract = source && (
          NATIVE_TEXT_MIME_TYPES.has(source.mime_type)
          || (TIKA_MIME_TYPES.has(source.mime_type) && Boolean(getTikaUrl()))
        );
        if (!source?.attachment_id || !source.checksum_sha256 || !source.revision_token || !canReextract) {
          throw createError("The retained retry input is unavailable. Upload this source again so its text can be extracted safely.", 409, "KNOWLEDGE_RETRY_INPUT_UNAVAILABLE");
        }
        await db.prepare(`
          INSERT INTO ai_knowledge_ingestion_inputs (job_id, input_index, payload)
          VALUES (?, 0, ?)
        `).run(id, {
          kind: "staged_file",
          source_id: source.id,
          attachment_id: source.attachment_id,
          checksum_sha256: source.checksum_sha256,
          supplied_text: null,
          supplied_text_hash: null,
          revision_token: source.revision_token
        });
        queuedInputs = [{ input_index: 0 }];
      }
      if (!queuedInputs.length) {
        throw createError("The retained retry input has expired. Start a new context build from the source records.", 409, "KNOWLEDGE_RETRY_INPUT_UNAVAILABLE");
      }
  
      await db.prepare(`
        UPDATE ai_knowledge_sources sources
        SET extraction_status = CASE
            WHEN EXISTS (
              SELECT 1 FROM ai_knowledge_documents documents
              WHERE documents.source_id = sources.id AND documents.is_active = TRUE
            ) THEN 'ready' ELSE 'processing' END,
          updated_at = CURRENT_TIMESTAMP
        WHERE sources.id IN (
          SELECT results.source_id FROM ai_knowledge_ingestion_results results
          WHERE results.job_id = ? AND results.source_id IS NOT NULL
        ) AND sources.extraction_status = 'failed'
      `).run(id);
      await db.prepare("DELETE FROM ai_knowledge_ingestion_results WHERE job_id = ?").run(id);
      const updated = await db.prepare(`
        UPDATE ai_knowledge_ingestion_jobs
        SET status = 'queued', processed_count = 0, failed_count = 0, chunk_count = 0,
          warnings = ?, errors = ?, config = ?, started_at = NULL, completed_at = NULL,
          lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'failed'
        RETURNING *
      `).get(
        [{ code: "manual_retry_queued", message: `Retry ${retryCount + 1} was queued from the retained source.` }],
        [],
        { ...jobConfig, retry_count: retryCount + 1 },
        id
      );
      if (!updated) throw createError("The ingestion changed while the retry was being queued.", 409, "KNOWLEDGE_RETRY_RACE");
      return { job: updated, alreadyAccepted: false };
    })();
    return {
      accepted: true,
      idempotent_replay: retry.alreadyAccepted,
      job: toPublicIngestionJob(retry.job),
      status_url: `/knowledge/ingestions/${visibleJob.id}`
    };
  };
  
  const archiveLegacyKnowledgeSource = (projectId, sourceRefId) => db.transaction(async () => {
    const archivedSources = await db.prepare(`
      UPDATE ai_knowledge_sources
      SET extraction_status = 'archived',
        revision_token = id || ':archived:' || EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)::TEXT || ':' || RANDOM()::TEXT,
        updated_at = CURRENT_TIMESTAMP
      WHERE project_id = ? AND source_kind = 'knowledge_item' AND source_ref_id = ?
      RETURNING id
    `).all(projectId, sourceRefId);
    await db.prepare(`
      UPDATE ai_knowledge_documents SET is_active = FALSE, effective_to = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE source_id IN (
        SELECT id FROM ai_knowledge_sources
        WHERE project_id = ? AND source_kind = 'knowledge_item' AND source_ref_id = ?
      ) AND is_active = TRUE
    `).run(projectId, sourceRefId);
    await db.prepare(`
      UPDATE ai_knowledge_index_states SET is_current = FALSE, updated_at = CURRENT_TIMESTAMP
      WHERE source_id IN (
        SELECT id FROM ai_knowledge_sources
        WHERE project_id = ? AND source_kind = 'knowledge_item' AND source_ref_id = ?
      ) AND is_current = TRUE
    `).run(projectId, sourceRefId);
    for (const source of archivedSources) {
      await knowledgeVectorProjection.queueSource({ projectId, sourceId: source.id });
      await require("./knowledgeGraph.service").archiveSource({ projectId, sourceId: source.id });
    }
  })();
  
  const queueLegacyKnowledgeSync = async ({ projectId, sourceRefId, userId, action = "upsert" }) => {
    const normalizedProjectId = normalizeId(projectId);
    const normalizedSourceRefId = normalizeId(sourceRefId);
    if (!normalizedProjectId || !normalizedSourceRefId) throw createError("Legacy knowledge sync requires projectId and sourceRefId.");
    const id = uuid();
    return db.prepare(`
      INSERT INTO ai_knowledge_sync_outbox (
        id, project_id, source_ref_id, action, status, requested_by
      ) VALUES (?, ?, ?, ?, 'queued', ?)
      ON CONFLICT (project_id, source_ref_id) DO UPDATE SET
        action = EXCLUDED.action,
        status = 'queued',
        attempts = 0,
        requested_by = EXCLUDED.requested_by,
        lease_owner = NULL,
        lease_expires_at = NULL,
        error_fingerprint = NULL,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id, project_id, source_ref_id, action, status
    `).get(id, normalizedProjectId, normalizedSourceRefId, action === "archive" ? "archive" : "upsert", userId || null);
  };
  
  const claimLegacyKnowledgeSync = (workerId, leaseMinutes) => db.transaction(async () => {
    const queued = await db.prepare(`
      SELECT id FROM ai_knowledge_sync_outbox
      WHERE status = 'queued'
      ORDER BY created_at ASC, id ASC
      LIMIT 1 FOR UPDATE SKIP LOCKED
    `).get();
    if (!queued) return null;
    return db.prepare(`
      UPDATE ai_knowledge_sync_outbox
      SET status = 'running', attempts = attempts + 1, lease_owner = ?,
        lease_expires_at = CURRENT_TIMESTAMP + (?::INTEGER * INTERVAL '1 minute'),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'queued'
      RETURNING *
    `).get(workerId, leaseMinutes, queued.id);
  })();
  
  const processLegacyKnowledgeSyncOutbox = async ({ limit = 4, leaseMinutes = 10 } = {}) => {
    const normalizedLimit = Math.max(1, Math.min(20, Number.parseInt(limit, 10) || 4));
    const normalizedLeaseMinutes = Math.max(2, Math.min(30, Number.parseInt(leaseMinutes, 10) || 10));
    await db.prepare(`
      UPDATE ai_knowledge_sync_outbox
      SET status = 'queued', lease_owner = NULL, lease_expires_at = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE status = 'running' AND lease_expires_at < CURRENT_TIMESTAMP
    `).run();
    const outcomes = [];
    for (let index = 0; index < normalizedLimit; index += 1) {
      const event = await claimLegacyKnowledgeSync(KNOWLEDGE_WORKER_ID, normalizedLeaseMinutes);
      if (!event) break;
      const leaseController = new AbortController();
      const heartbeat = setInterval(async () => {
        try {
          const renewed = await db.prepare(`
            UPDATE ai_knowledge_sync_outbox
            SET lease_expires_at = CURRENT_TIMESTAMP + (?::INTEGER * INTERVAL '1 minute'),
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND status = 'running' AND lease_owner = ?
          `).run(normalizedLeaseMinutes, event.id, KNOWLEDGE_WORKER_ID);
          if (!renewed.changes) leaseController.abort();
        } catch {
          leaseController.abort();
        }
      }, 30_000);
      heartbeat.unref?.();
      try {
        const record = event.action === "upsert" ? await db.prepare(`
          SELECT id, project_id, app_type_id, title, description, content_type,
            content, source_uri, is_active, metadata
          FROM ai_knowledge_repo WHERE id = ? AND project_id = ?
        `).get(event.source_ref_id, event.project_id) : null;
        if (!record || !record.is_active || !normalizeText(record.content)) {
          await db.transaction(async () => {
            const owned = await db.prepare(`
              SELECT 1 AS owned FROM ai_knowledge_sync_outbox
              WHERE id = ? AND status = 'running' AND lease_owner = ?
              FOR UPDATE
            `).get(event.id, KNOWLEDGE_WORKER_ID);
            if (!owned || leaseController.signal.aborted) throw createError("Legacy sync lease was lost.", 409, "KNOWLEDGE_LEASE_LOST");
            await archiveLegacyKnowledgeSource(event.project_id, event.source_ref_id);
          })();
        } else {
          await syncLegacyKnowledgeItem(event.project_id, record, event.requested_by, {
            signal: leaseController.signal,
            activationGuard: async () => {
              const owned = await db.prepare(`
                SELECT 1 AS owned FROM ai_knowledge_sync_outbox
                WHERE id = ? AND status = 'running' AND lease_owner = ?
                  AND lease_expires_at > CURRENT_TIMESTAMP
                FOR SHARE
              `).get(event.id, KNOWLEDGE_WORKER_ID);
              return Boolean(owned?.owned) && !leaseController.signal.aborted;
            }
          });
        }
        const deleted = await db.prepare(`
          DELETE FROM ai_knowledge_sync_outbox
          WHERE id = ? AND status = 'running' AND lease_owner = ?
        `).run(event.id, KNOWLEDGE_WORKER_ID);
        outcomes.push({ id: event.id, status: deleted.changes ? "completed" : "superseded" });
      } catch (error) {
        const errorFingerprint = fingerprint(error instanceof Error ? error.message : "legacy sync failed");
        await db.prepare(`
          UPDATE ai_knowledge_sync_outbox
          SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'queued' END,
            lease_owner = NULL, lease_expires_at = NULL, error_fingerprint = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND lease_owner = ?
        `).run(errorFingerprint, event.id, KNOWLEDGE_WORKER_ID);
        outcomes.push({ id: event.id, status: "retry_scheduled", error_fingerprint: errorFingerprint });
      } finally {
        clearInterval(heartbeat);
      }
    }
    return outcomes;
  };
  
  const streamToBoundedBuffer = async (stream, maxBytes) => {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > maxBytes) {
        stream.destroy?.();
        throw createError(`Stored knowledge file exceeds the ${maxBytes}-byte processing limit.`, 413);
      }
      chunks.push(buffer);
    }
    if (!bytes) throw createError("Stored knowledge file is empty.", 409);
    return Buffer.concat(chunks);
  };
  
  const processQueuedUpload = async ({ job, payload, user, leaseOwner, signal }) => {
    if (signal?.aborted) throw createError("Knowledge ingestion lease was lost.", 409, "KNOWLEDGE_LEASE_LOST");
    const source = await db.prepare(`
      SELECT id, project_id, app_type_id, source_kind, source_ref_id, title, file_name,
        mime_type, size_bytes, attachment_id, checksum_sha256, extraction_status,
        extraction_strategy, metadata, revision_token
      FROM ai_knowledge_sources WHERE id = ? AND project_id = ?
    `).get(payload.source_id, job.project_id);
    if (!source?.attachment_id || source.attachment_id !== payload.attachment_id) {
      throw createError("Queued knowledge upload is no longer attached to its project source.", 409);
    }
    if (!payload.revision_token || source.revision_token !== payload.revision_token) {
      throw createError("A newer upload revision superseded this queued file.", 409, "KNOWLEDGE_VERSION_SUPERSEDED");
    }
    const suppliedText = normalizeText(payload.supplied_text);
    if ((suppliedText ? fingerprint(suppliedText) : null) !== (payload.supplied_text_hash || null)) {
      throw createError("Queued extracted text fingerprint is invalid.", 409, "KNOWLEDGE_INPUT_FINGERPRINT_MISMATCH");
    }
    const maxFileBytes = Math.min(Number(config.knowledge?.maxFileBytes || 50 * 1024 * 1024), Number(config.objectStorage.maxAttachmentBytes));
    const { stream } = await attachmentService.downloadManagedKnowledgeObject({
      id: source.attachment_id,
      projectId: job.project_id,
      sourceId: source.id
    });
    const buffer = await streamToBoundedBuffer(stream, maxFileBytes);
    if (signal?.aborted) throw createError("Knowledge ingestion lease was lost.", 409, "KNOWLEDGE_LEASE_LOST");
    validateUploadSignature(buffer, source.file_name, source.mime_type);
    const actualChecksum = createHash("sha256").update(buffer).digest("hex");
    if (actualChecksum !== source.checksum_sha256 || actualChecksum !== payload.checksum_sha256) {
      throw createError("Stored knowledge file checksum no longer matches the queued upload.", 409, "KNOWLEDGE_FILE_CHECKSUM_MISMATCH");
    }
  
    let extractedText = suppliedText;
    let extractionStrategy = extractedText ? "client_supplied" : "metadata_only";
    let extractionWarning = null;
    if (!extractedText && NATIVE_TEXT_MIME_TYPES.has(source.mime_type)) {
      extractedText = decodeNativeText(buffer, source.mime_type);
      extractionStrategy = "native_text";
    } else if (!extractedText && TIKA_MIME_TYPES.has(source.mime_type) && getTikaUrl()) {
      if (buffer.length > Number(config.knowledge?.extractionMaxBytes || 20 * 1024 * 1024)) {
        extractionWarning = "The file is stored, but exceeds the configured server extraction limit; provide bounded extracted_text to index it.";
      } else {
        try {
          extractedText = await extractWithTika(buffer, source.mime_type);
          extractionStrategy = extractedText ? "apache_tika" : "metadata_only";
        } catch (error) {
          extractionWarning = `Apache Tika could not extract this file (error ${fingerprint(error instanceof Error ? error.message : "request failed")}).`;
        }
      }
    }
    if (!extractedText && !extractionWarning) {
      extractionWarning = "The file is stored, but searchable context needs extracted_text, a caption, a transcript, or a configured supported document processor.";
    }
    source.extraction_strategy = extractionStrategy;
    await db.prepare(`
      UPDATE ai_knowledge_sources
      SET extraction_status = CASE
            WHEN EXISTS (SELECT 1 FROM ai_knowledge_documents WHERE source_id = ? AND is_active = TRUE) THEN 'ready'
            ELSE 'processing'
          END,
        extraction_strategy = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(source.id, extractionStrategy, source.id);
    const persisted = await persistDocument({
      projectId: job.project_id,
      source,
      content: extractedText,
      chunking: asObject(job.config).chunking,
      integrationId: normalizeId(asObject(job.config).integration_id) || null,
      metadata: { attachment_id: source.attachment_id, mime_type: source.mime_type },
      signal,
      activationGuard: async () => {
        const lease = await db.prepare(`
          SELECT 1 AS owned FROM ai_knowledge_ingestion_jobs
          WHERE id = ? AND status = 'running' AND lease_owner = ?
            AND lease_expires_at > CURRENT_TIMESTAMP
        `).get(job.id, leaseOwner);
        return Boolean(lease?.owned) && !signal?.aborted;
      }
    });
    const warnings = [
      extractionWarning ? { source_id: source.id, code: "extraction_warning", message: extractionWarning } : null,
      persisted.warning ? { source_id: source.id, code: persisted.warning_code || "indexing_warning", message: persisted.warning } : null
    ].filter(Boolean);
    if (!persisted.document) {
      await markSourceNeedsExtraction(source, { jobId: job.id, leaseOwner });
    }
    await recordIngestionResult(job.id, 0, {
      sourceId: source.id,
      documentId: persisted.document?.id,
      outcome: persisted.document ? "indexed" : "needs_extraction",
      warningCodes: warnings.map((warning) => warning.code)
    }, { leaseOwner });
    const completedJob = await completeJob(job.id, {
      processed: 1,
      failed: 0,
      chunkCount: persisted.chunks.length,
      warnings,
      errors: []
    }, { leaseOwner });
    return { job: completedJob, source_id: source.id, status: completedJob.status };
  };
  
  const ingestUpload = async ({ user, fields, file, idempotencyKey }) => {
    const projectId = normalizeId(fields.project_id);
    if (!projectId) throw createError("project_id is required before the file field.");
    const collectionId = normalizeId(fields.collection_id) || null;
    await assertCollectionScope(projectId, collectionId);
    const mimeType = String(file.mimetype || "application/octet-stream").toLowerCase().split(";")[0].trim();
    const safeFileName = attachmentService.safeFileName(file.filename);
    if (!SUPPORTED_UPLOAD_MIME_TYPES.has(mimeType)) throw createError(`Unsupported knowledge file type: ${mimeType}.`, 415);
    const buffer = await file.toBuffer();
    const maxFileBytes = Math.min(Number(config.knowledge?.maxFileBytes || 50 * 1024 * 1024), Number(config.objectStorage.maxAttachmentBytes));
    if (!buffer.length || buffer.length > maxFileBytes || file.file?.truncated) {
      throw createError(`Knowledge files must be non-empty and no larger than ${maxFileBytes} bytes.`);
    }
    try {
      validateUploadSignature(buffer, safeFileName, mimeType);
    } catch (error) {
      throw createError(error instanceof Error ? error.message : "Knowledge file validation failed.", 415, "KNOWLEDGE_FILE_SIGNATURE_MISMATCH");
    }
    const checksum = createHash("sha256").update(buffer).digest("hex");
    const suppliedText = sanitizeAiText(normalizeText(fields.extracted_text || fields.transcript || fields.caption)).text;
    const chunkingOptions = normalizeChunkingOptions(asObject(fields.chunking));
    const normalizedIdempotencyKey = normalizeText(idempotencyKey, 255) || null;
    const uploadStableSourceKey = stableSourceKey({
      source_kind: "file",
      app_type_id: normalizeId(fields.app_type_id),
      checksum_sha256: checksum
    });
    const requestFingerprint = fingerprint(JSON.stringify({
      project_id: projectId,
      collection_id: collectionId,
      app_type_id: normalizeId(fields.app_type_id),
      title: normalizeText(fields.title, 500) || safeFileName,
      file_name: safeFileName,
      mime_type: mimeType,
      checksum_sha256: checksum,
      supplied_text_hash: suppliedText ? fingerprint(suppliedText) : null,
      chunking: chunkingOptions
    }));
    if (normalizedIdempotencyKey) {
      const existing = await db.prepare(`
        SELECT * FROM ai_knowledge_ingestion_jobs
        WHERE project_id = ? AND created_by = ? AND idempotency_key = ?
      `).get(projectId, user?.id, normalizedIdempotencyKey);
      if (existing) {
        if (asObject(existing.config).request_fingerprint !== requestFingerprint) {
          throw createError("Idempotency-Key was already used for a different knowledge upload.", 409, "IDEMPOTENCY_KEY_REUSED");
        }
        return {
          accepted: ["queued", "running"].includes(existing.status),
          idempotent_replay: true,
          job: await getIngestionJob(existing.id, { user }),
          sources: [], documents: [], chunk_count: Number(existing.chunk_count || 0),
          deduplicated_count: 0, warnings: asArray(existing.warnings),
          status_url: `/knowledge/ingestions/${existing.id}`
        };
      }
    }
    let job;
    try {
      job = await createJob({
        projectId,
        collectionId,
        inputCount: 1,
        config: {
          title: normalizeText(fields.title, 500) || safeFileName,
          app_type_id: normalizeId(fields.app_type_id) || null,
          chunking: chunkingOptions,
          upload: true,
          stable_source_key: uploadStableSourceKey,
          queue_version: 1,
          request_fingerprint: requestFingerprint
        },
        userId: user?.id,
        status: "running",
        idempotencyKey: normalizedIdempotencyKey
      });
    } catch (error) {
      if (error?.code !== "23505" || !normalizedIdempotencyKey) throw error;
      const winner = await db.prepare(`
        SELECT * FROM ai_knowledge_ingestion_jobs
        WHERE project_id = ? AND created_by = ? AND idempotency_key = ?
      `).get(projectId, user?.id, normalizedIdempotencyKey);
      if (!winner || asObject(winner.config).request_fingerprint !== requestFingerprint) {
        throw createError("Idempotency-Key was already used for a different knowledge upload.", 409, "IDEMPOTENCY_KEY_REUSED");
      }
      return {
        accepted: ["queued", "running"].includes(winner.status),
        idempotent_replay: true,
        job: await getIngestionJob(winner.id, { user }),
        sources: [], documents: [], chunk_count: Number(winner.chunk_count || 0),
        deduplicated_count: 0, warnings: asArray(winner.warnings),
        status_url: `/knowledge/ingestions/${winner.id}`
      };
    }
    const input = {
      source_kind: "file",
      source_ref_id: null,
      app_type_id: normalizeId(fields.app_type_id) || null,
      title: normalizeText(fields.title, 500) || safeFileName,
      content: suppliedText,
      source_uri: null,
      file_name: safeFileName,
      mime_type: mimeType,
      size_bytes: buffer.length,
      extraction_strategy: suppliedText ? "client_supplied" : "queued_extraction",
      metadata: { original_file_name: safeFileName },
      processing_fingerprint: processingProfile(chunkingOptions).fingerprint
    };
    input.checksum_sha256 = checksum;
    let source;
    try {
      source = await createSource({ projectId, collectionId, input, userId: user?.id, jobId: job.id });
      if (source._reused) {
        const warnings = [{ source_id: source.id, code: "deduplicated", message: "This exact file and extracted content are already indexed; the current version was reused." }];
        await recordIngestionResult(job.id, 0, { sourceId: source.id, outcome: "reused", reused: true, warningCodes: ["deduplicated"] });
        const completedJob = await completeJob(job.id, { processed: 1, failed: 0, chunkCount: 0, warnings, errors: [] });
        return { accepted: false, idempotent_replay: false, job: completedJob, sources: [toPublicSource(source)], documents: [], chunk_count: 0, deduplicated_count: 1, warnings, status_url: `/knowledge/ingestions/${job.id}` };
      }
      let uploadedAttachment = null;
      const attachment = source.attachment_id
        ? { id: source.attachment_id }
        : (uploadedAttachment = await attachmentService.upload({
            user,
            entityType: "knowledge_source",
            entityId: source.id,
            projectId,
            fileName: safeFileName,
            mimeType,
            stream: Readable.from(buffer),
            permissionCode: "knowledge.manage"
          }));
      const attached = await db.prepare(`
        UPDATE ai_knowledge_sources
        SET attachment_id = ?, checksum_sha256 = ?,
          extraction_status = CASE
            WHEN EXISTS (SELECT 1 FROM ai_knowledge_documents WHERE source_id = ? AND is_active = TRUE) THEN 'ready'
            ELSE 'processing'
          END,
          extraction_strategy = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND revision_token = ?
        RETURNING id
      `).get(attachment.id, checksum, source.id, "queued_extraction", source.id, source.revision_token);
      if (!attached) {
        if (uploadedAttachment) {
          await attachmentService.remove({ user, id: uploadedAttachment.id, permissionCode: "knowledge.manage" }).catch(() => undefined);
        }
        throw createError("A newer upload revision superseded this staged file.", 409, "KNOWLEDGE_VERSION_SUPERSEDED");
      }
      await db.transaction(async () => {
        await db.prepare(`
          INSERT INTO ai_knowledge_ingestion_inputs (job_id, input_index, payload)
          VALUES (?, 0, ?)
        `).run(job.id, {
          kind: "staged_file",
          source_id: source.id,
          attachment_id: attachment.id,
          checksum_sha256: checksum,
          supplied_text: suppliedText || null,
          supplied_text_hash: suppliedText ? fingerprint(suppliedText) : null,
          revision_token: source.revision_token,
          stable_source_key: stableSourceKey({
            source_kind: source.source_kind,
            app_scope_key: source.app_scope_key,
            checksum_sha256: checksum
          })
        });
        await db.prepare(`
          UPDATE ai_knowledge_ingestion_jobs
          SET status = 'queued', started_at = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND status = 'running'
        `).run(job.id);
      })();
      return {
        accepted: true,
        idempotent_replay: false,
        job: await getIngestionJob(job.id, { user }),
        sources: [toPublicSource({ ...source, attachment_id: attachment.id, extraction_status: source._had_ready_version ? "ready" : "processing" })],
        documents: [], chunk_count: 0, deduplicated_count: 0, warnings: [],
        status_url: `/knowledge/ingestions/${job.id}`
      };
    } catch (error) {
      await markSourcePersistenceFailed(source);
      const errorFingerprint = fingerprint(error instanceof Error ? error.message : "Upload staging failed");
      await recordIngestionResult(job.id, 0, { sourceId: source?.id, outcome: "failed", errorFingerprint });
      await completeJob(job.id, { processed: 0, failed: 1, chunkCount: 0, warnings: [], errors: [{ code: "upload_staging_failed", error_fingerprint: errorFingerprint }] });
      throw error;
    }
  };
  
  

  return { normalizeInput, isApplicationRecordSnapshotCurrent, createJob, getIngestionJob, toPublicIngestionJob, recordIngestionResult, createSource, markSourcePersistenceFailed, markSourceNeedsExtraction, removeUnactivatedNewSourceAfterLeaseLoss, persistEmbeddingVector, buildChunkRetrievalText, buildDocumentContextProfile, embeddingConfigurationHash, enqueueSemanticWork, claimSemanticWork, enqueueStaleEmbeddingBackfill, finishSemanticWork, processSemanticWork, embedDocumentTexts, persistDocument, completeJob, ingest, claimNativeOutboxEvent, processNativeChangeOutbox, reconcileNativeIndexGaps, prepareQueuedInput, enqueueIngestion, claimQueuedIngestion, renewIngestionLease, processQueuedIngestions, retryIngestion, archiveLegacyKnowledgeSource, queueLegacyKnowledgeSync, claimLegacyKnowledgeSync, processLegacyKnowledgeSyncOutbox, streamToBoundedBuffer, processQueuedUpload, ingestUpload };
}

module.exports = { createKnowledgeIngestionService };
