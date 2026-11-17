// Durable Story, grooming and case-preview jobs share lease and failure contracts.
module.exports = [
  `
    CREATE TABLE IF NOT EXISTS ai_requirement_generation_jobs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'queued',
      input_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      result_payload JSONB,
      last_error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      lease_owner TEXT,
      lease_expires_at TIMESTAMPTZ,
      heartbeat_at TIMESTAMPTZ,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE ai_requirement_generation_jobs ADD COLUMN IF NOT EXISTS job_kind TEXT NOT NULL DEFAULT 'story'`,
  `ALTER TABLE ai_requirement_generation_jobs ADD COLUMN IF NOT EXISTS error_code TEXT`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS error_code TEXT`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS failure_payload JSONB`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS processing_payload JSONB`,
  `ALTER TABLE ai_requirement_generation_jobs ADD COLUMN IF NOT EXISTS failure_payload JSONB`,
  `ALTER TABLE ai_requirement_generation_jobs ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE ai_requirement_generation_jobs ADD COLUMN IF NOT EXISTS lease_owner TEXT`,
  `ALTER TABLE ai_requirement_generation_jobs ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ`,
  `ALTER TABLE ai_requirement_generation_jobs ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ`,
  `UPDATE ai_requirement_generation_jobs SET attempts = 0 WHERE attempts IS NULL`,
  `ALTER TABLE ai_requirement_generation_jobs ALTER COLUMN attempts SET DEFAULT 0`,
  `ALTER TABLE ai_requirement_generation_jobs ALTER COLUMN attempts SET NOT NULL`,
  `ALTER TABLE ai_requirement_generation_jobs DROP CONSTRAINT IF EXISTS ai_requirement_generation_jobs_status_check`,
  `ALTER TABLE ai_requirement_generation_jobs ADD CONSTRAINT ai_requirement_generation_jobs_status_check CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled'))`,
  `CREATE INDEX IF NOT EXISTS idx_ai_requirement_generation_jobs_project ON ai_requirement_generation_jobs (project_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_requirement_generation_jobs_queue ON ai_requirement_generation_jobs (status, lease_expires_at, created_at ASC)`,
];
