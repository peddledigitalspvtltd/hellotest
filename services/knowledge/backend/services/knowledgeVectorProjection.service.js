const { randomUUID, createHash } = require("node:crypto");
const db = require("@hellotest/platform/backend/src/db");
const vectors = require("./knowledgeVectorStore.service");
const { boundedRetrievalStage } = require("@hellotest/platform/backend/src/utils/knowledgeRetrievalTiming");

const fingerprint = value => createHash("sha256").update(String(value)).digest("hex");
const id = value => typeof value === "string" ? value.trim() : "";
const assertActive = signal => { if (signal?.aborted) throw signal.reason || new Error("Vector projection cancelled"); };

// Call from the canonical document/tombstone transaction. No credentials or
// model inputs are copied into the journal; retries hydrate current PG data.
async function queueSource({ projectId, sourceId, documentId = null, revisionToken = null }) {
  if (!id(projectId) || !id(sourceId)) throw new Error("Vector synchronization requires project and source ids");
  const result = await db.prepare(`INSERT INTO ai_knowledge_vector_jobs
    (source_id, project_id, document_id, revision_token, generation, status, next_attempt_at)
    VALUES (?, ?, ?, ?, ?, 'queued', CURRENT_TIMESTAMP)
    ON CONFLICT (source_id) DO UPDATE SET
      document_id = EXCLUDED.document_id, revision_token = EXCLUDED.revision_token,
      generation = EXCLUDED.generation, status = 'queued', attempts = 0,
      error_fingerprint = NULL, next_attempt_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE ai_knowledge_vector_jobs.project_id = EXCLUDED.project_id`).run(
    sourceId, projectId, documentId, revisionToken, randomUUID());
  if (!result.changes) throw new Error("Vector synchronization source belongs to a different project");
}

async function completeSource({ projectId, sourceId, documentId, revisionToken, configurationKey = vectors.configurationKey() }) {
  return db.prepare(`UPDATE ai_knowledge_vector_jobs SET status = 'ready', attempts = 0,
    configuration_key = ?, error_fingerprint = NULL, reconciled_at = CURRENT_TIMESTAMP,
    next_attempt_at = CURRENT_TIMESTAMP + INTERVAL '15 minutes', updated_at = CURRENT_TIMESTAMP
    WHERE source_id = ? AND project_id = ? AND document_id = ? AND revision_token = ?`).run(
    configurationKey, sourceId, projectId, documentId, revisionToken);
}

// Repair pre-journal revisions and configuration changes, including sources
// deleted while Qdrant was disabled. Backpressure bounds each worker tick.
async function discoverPending({ limit = 40 } = {}) {
  if (!vectors.isConfigured()) return 0;
  const result = await db.prepare(`INSERT INTO ai_knowledge_vector_jobs
    (source_id, project_id, document_id, revision_token, generation, status, next_attempt_at)
    SELECT sources.id, sources.project_id, documents.id, sources.revision_token,
      sources.id || ':' || sources.revision_token, 'queued', CURRENT_TIMESTAMP
    FROM ai_knowledge_sources sources
    LEFT JOIN ai_knowledge_documents documents ON documents.source_id = sources.id AND documents.is_active = TRUE
    LEFT JOIN ai_knowledge_vector_jobs jobs ON jobs.source_id = sources.id
    WHERE (documents.id IS NOT NULL OR sources.extraction_status = 'archived')
      AND (jobs.source_id IS NULL OR jobs.configuration_key IS DISTINCT FROM ?)
      AND (jobs.source_id IS NULL OR jobs.status <> 'queued')
    ORDER BY sources.updated_at, sources.id LIMIT ?
    ON CONFLICT (source_id) DO UPDATE SET generation = EXCLUDED.generation,
      status = 'queued', attempts = 0, document_id = EXCLUDED.document_id,
      revision_token = EXCLUDED.revision_token, next_attempt_at = CURRENT_TIMESTAMP,
      error_fingerprint = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE ai_knowledge_vector_jobs.status <> 'queued'`).run(vectors.configurationKey(), Math.max(1, Math.min(100, Number(limit) || 40)));
  return result.changes;
}

async function processSource({ sourceId, projectId, signal } = {}) {
  if (!vectors.isConfigured()) return { status: "disabled" };
  assertActive(signal);
  let generation;
  try {
    return await db.transaction(async () => {
      // Canonical writers lock source before journal. Follow the same order;
      // SKIP LOCKED avoids waiting on an ingestion or another worker replica.
      const source = await db.prepare(`SELECT * FROM ai_knowledge_sources
        WHERE id = ? AND project_id = ? FOR UPDATE SKIP LOCKED`).get(sourceId, projectId);
      if (!source && await db.prepare(`SELECT id FROM ai_knowledge_sources WHERE id = ? AND project_id = ?`).get(sourceId, projectId)) {
        return { status: "busy" };
      }
      const job = await db.prepare(`SELECT * FROM ai_knowledge_vector_jobs
        WHERE source_id = ? AND project_id = ? AND next_attempt_at <= CURRENT_TIMESTAMP
        FOR UPDATE SKIP LOCKED`).get(sourceId, projectId);
      if (!job) return { status: "busy" };
      generation = job.generation;
      const configurationKey = vectors.configurationKey();
      const archived = !source || source.extraction_status === "archived";
      let document, chunks;
      if (!archived) {
        document = await db.prepare(`SELECT documents.id, states.embedding_model, states.embedding_dimensions
          FROM ai_knowledge_documents documents JOIN ai_knowledge_index_states states ON states.document_id = documents.id
          WHERE documents.source_id = ? AND documents.project_id = ? AND documents.is_active = TRUE
            AND states.is_current = TRUE AND states.required_indexes_ready = TRUE`).get(sourceId, projectId);
        if (!document) throw new Error("Current canonical document is not ready for vector synchronization");
        chunks = await db.prepare(`SELECT id, content, chunk_index, embedding, embedding_model
          FROM ai_knowledge_chunks WHERE source_id = ? AND project_id = ? AND document_id = ?
          ORDER BY chunk_index`).all(sourceId, projectId, document.id);
        if (!chunks.length || chunks.some(chunk => chunk.embedding_model !== document.embedding_model || !Array.isArray(chunk.embedding))) {
          throw new Error("Canonical vector projection has incomplete or mixed-model chunks");
        }
      }
      assertActive(signal);
      // Only cancellable external IO belongs to the deadline callback. A late
      // provider continuation cannot issue PG writes after rollback/release.
      if (archived) {
        await boundedRetrievalStage(async activeSignal => {
          const removed = await vectors.deleteSource({ projectId, sourceId, signal: activeSignal });
          if (!removed.configured || !removed.deleted) throw new Error("Vector cleanup did not acknowledge deletion");
        }, { timeoutMs: 8_000, signal, code: "VECTOR_PROJECTION_TIMEOUT" });
      } else {
        const projection = await boundedRetrievalStage(activeSignal => vectors.reconcileDocument({
          projectId, source, documentId: document.id, chunks, embeddingModel: document.embedding_model,
          dimensions: document.embedding_dimensions, signal: activeSignal, vectors: chunks.map(chunk => chunk.embedding)
        }), { timeoutMs: 8_000, signal, code: "VECTOR_PROJECTION_TIMEOUT" });
        if (!projection.configured || projection.indexed !== chunks.length) throw new Error("Vector projection did not acknowledge every canonical chunk");
      }
      assertActive(signal);
      if (vectors.configurationKey() !== configurationKey) throw new Error("Vector projection configuration changed during synchronization");
      if (!archived) {
        await db.prepare(`UPDATE ai_knowledge_index_states SET vector_provider = 'qdrant',
          error_fingerprint = NULL, indexed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE document_id = ? AND is_current = TRUE`).run(document.id);
        await db.prepare(`UPDATE ai_knowledge_vector_jobs SET document_id = ?, revision_token = ?
          WHERE source_id = ? AND project_id = ? AND generation = ?`).run(document.id, source.revision_token, sourceId, projectId, generation);
      }
      assertActive(signal);
      await db.prepare(`UPDATE ai_knowledge_vector_jobs SET status = ?, attempts = 0,
        configuration_key = ?, error_fingerprint = NULL, reconciled_at = CURRENT_TIMESTAMP,
        next_attempt_at = CURRENT_TIMESTAMP + INTERVAL '15 minutes', updated_at = CURRENT_TIMESTAMP
        WHERE source_id = ? AND project_id = ? AND generation = ?`).run(archived ? "deleted" : "ready", configurationKey, sourceId, projectId, generation);
      assertActive(signal);
      return { source_id: sourceId, status: archived ? "deleted" : "ready" };
    })();
  } catch (error) {
    // An interrupted transaction rolls back every readiness write. The same
    // idempotent command is retried after restart or an unknown acknowledgement.
    if (signal?.aborted) throw error;
    const errorFingerprint = fingerprint(error instanceof Error ? error.message : "Vector synchronization failed");
    if (generation) await db.prepare(`UPDATE ai_knowledge_vector_jobs SET status = 'queued', attempts = attempts + 1,
      error_fingerprint = ?, next_attempt_at = CURRENT_TIMESTAMP +
        (LEAST(900, 5 * POWER(2, LEAST(attempts, 8))) * INTERVAL '1 second'), updated_at = CURRENT_TIMESTAMP
      WHERE source_id = ? AND project_id = ? AND generation = ?`).run(errorFingerprint, sourceId, projectId, generation);
    return { source_id: sourceId, status: "retry_scheduled", error_fingerprint: errorFingerprint };
  }
}

async function processDue({ limit = 4, signal } = {}) {
  if (!vectors.isConfigured()) return [];
  await discoverPending();
  const jobs = await db.prepare(`SELECT source_id, project_id FROM ai_knowledge_vector_jobs
    WHERE next_attempt_at <= CURRENT_TIMESTAMP ORDER BY next_attempt_at, source_id LIMIT ?`).all(Math.max(1, Math.min(20, Number(limit) || 4)));
  const outcomes = [];
  for (const job of jobs) {
    assertActive(signal);
    outcomes.push(await processSource({ sourceId: job.source_id, projectId: job.project_id, signal }));
  }
  return outcomes;
}

module.exports = { queueSource, completeSource, discoverPending, processSource, processDue };
