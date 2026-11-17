"use strict";

// Provider embeddings and optional enrichment are lower-priority projections.
// The canonical lexical document is already active before a row is queued here.
module.exports = [
  `CREATE TABLE IF NOT EXISTS ai_knowledge_semantic_jobs (
    document_id TEXT PRIMARY KEY REFERENCES ai_knowledge_documents(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL REFERENCES ai_knowledge_sources(id) ON DELETE CASCADE,
    integration_id TEXT,
    revision_token TEXT NOT NULL,
    target_configuration_hash TEXT,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    lease_owner TEXT,
    lease_expires_at TIMESTAMPTZ,
    last_error_fingerprint TEXT,
    last_warning_code TEXT,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_semantic_jobs_due
    ON ai_knowledge_semantic_jobs(status,next_attempt_at,created_at,project_id)
    WHERE status IN ('queued','running')`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_semantic_jobs_source
    ON ai_knowledge_semantic_jobs(project_id,source_id,status)`
];
