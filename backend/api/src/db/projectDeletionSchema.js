// Keep the deletion ledger independent of projects and users: status, retry
// authorization and object cleanup must survive deletion of the original rows.
module.exports = [
  `CREATE TABLE IF NOT EXISTS project_deletion_jobs (
    id TEXT PRIMARY KEY,
    project_id TEXT UNIQUE NOT NULL,
    project_name TEXT NOT NULL,
    requested_by TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued'
      CHECK (status IN ('queued', 'running', 'cleanup', 'completed', 'failed')),
    phase TEXT,
    processed_rows BIGINT NOT NULL DEFAULT 0 CHECK (processed_rows >= 0),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_project_deletion_jobs_pending
    ON project_deletion_jobs (status, next_attempt_at, created_at)`,
  `CREATE TABLE IF NOT EXISTS project_deletion_objects (
    job_id TEXT NOT NULL REFERENCES project_deletion_jobs(id) ON DELETE CASCADE,
    bucket_name TEXT NOT NULL,
    object_name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'object' CHECK (kind IN ('object', 'knowledge_vectors')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    error TEXT,
    PRIMARY KEY (job_id, bucket_name, object_name)
  )`,
  `ALTER TABLE project_deletion_objects ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'object'
    CHECK (kind IN ('object', 'knowledge_vectors'))`
];
