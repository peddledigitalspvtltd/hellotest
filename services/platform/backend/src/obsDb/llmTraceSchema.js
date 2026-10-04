module.exports = [
  `CREATE TABLE IF NOT EXISTS llm_request_traces (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, actor_id TEXT,
    request_id TEXT, trace_id TEXT, run_id TEXT, node_id TEXT, session_id TEXT,
    operation TEXT NOT NULL, feature TEXT, integration_id TEXT, integration_name TEXT,
    provider_origin TEXT, requested_model TEXT, effective_model TEXT,
    status TEXT NOT NULL CHECK (status IN ('running','succeeded','failed','invalid','cancelled')),
    attempt INTEGER NOT NULL DEFAULT 1, correction_of TEXT,
    started_at TIMESTAMPTZ NOT NULL, completed_at TIMESTAMPTZ, duration_ms INTEGER,
    http_status INTEGER, provider_request_id TEXT, usage JSONB,
    request_payload JSONB, response_payload JSONB, request_hash TEXT,
    capture JSONB NOT NULL DEFAULT '{}'::jsonb, error_code TEXT,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '14 days')
  )`,
  `CREATE INDEX IF NOT EXISTS idx_llm_traces_project_time ON llm_request_traces(project_id, started_at DESC, id DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_llm_traces_run ON llm_request_traces(project_id, run_id, node_id) WHERE run_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_llm_traces_session ON llm_request_traces(project_id, session_id) WHERE session_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_llm_traces_expiry ON llm_request_traces(expires_at)`
];
