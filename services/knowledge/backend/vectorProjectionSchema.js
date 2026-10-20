// PostgreSQL is authoritative. This durable source-keyed journal also survives
// hard source deletion so external projections can still be removed afterwards.
module.exports = [
  `CREATE TABLE IF NOT EXISTS ai_knowledge_vector_jobs (
    source_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    document_id TEXT,
    revision_token TEXT,
    generation TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'ready', 'deleted')),
    attempts INTEGER NOT NULL DEFAULT 0,
    configuration_key TEXT,
    error_fingerprint TEXT,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reconciled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `ALTER TABLE ai_knowledge_vector_jobs DROP CONSTRAINT IF EXISTS ai_knowledge_vector_jobs_project_id_fkey`,
  `CREATE INDEX IF NOT EXISTS idx_ai_knowledge_vector_jobs_due ON ai_knowledge_vector_jobs(next_attempt_at, source_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_knowledge_vector_jobs_project ON ai_knowledge_vector_jobs(project_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_knowledge_chunks_embedding_reuse ON ai_knowledge_chunks
    (project_id, source_id, embedding_model, (metadata->>'embedding_configuration_hash'), (metadata->>'embedding_input_hash'))
    WHERE jsonb_exists(metadata, 'embedding_input_hash')`,
];
