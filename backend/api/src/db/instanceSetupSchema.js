// The durable receipt survives changes to sample projects and administrator
// accounts. Only one installation may be queued or running in a workspace.
module.exports = [
  `CREATE TABLE IF NOT EXISTS instance_setup_jobs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
    phase TEXT NOT NULL DEFAULT 'validating' CHECK (phase IN ('validating', 'installing', 'verifying')),
    requested_modules JSONB NOT NULL DEFAULT '[]'::jsonb,
    installed_modules JSONB NOT NULL DEFAULT '[]'::jsonb,
    dataset_version INTEGER NOT NULL,
    manifest_hash TEXT NOT NULL,
    files JSONB NOT NULL DEFAULT '[]'::jsonb,
    current_file TEXT,
    total_files INTEGER NOT NULL DEFAULT 0 CHECK (total_files >= 0),
    completed_files INTEGER NOT NULL DEFAULT 0 CHECK (completed_files >= 0 AND completed_files <= total_files),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    error JSONB,
    result JSONB,
    requested_by TEXT NOT NULL,
    ip_address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_instance_setup_jobs_single_active
    ON instance_setup_jobs ((TRUE)) WHERE status IN ('queued', 'running')`,
  `CREATE INDEX IF NOT EXISTS idx_instance_setup_jobs_latest
    ON instance_setup_jobs (created_at DESC, id DESC)`
];
