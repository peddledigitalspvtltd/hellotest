const statements = [
  `CREATE TABLE IF NOT EXISTS automation_paired_dispatches (
    id TEXT PRIMARY KEY,
    execution_id TEXT NOT NULL UNIQUE REFERENCES executions(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    application_origin TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    grant_nonce TEXT NOT NULL,
    envelope_cipher JSONB NOT NULL,
    claim_expires_at TIMESTAMPTZ NOT NULL,
    callback_expires_at TIMESTAMPTZ NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','claimed','cancelled')),
    claimed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (octet_length(envelope_cipher::text) <= 12582912)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_automation_paired_dispatch_owner ON automation_paired_dispatches(project_id,actor_id,created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS automation_paired_browser_bridges (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    app_type_id TEXT NOT NULL REFERENCES app_types(id) ON DELETE CASCADE,
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    paired_origin TEXT NOT NULL,
    allowed_case_ids JSONB NOT NULL CHECK (jsonb_typeof(allowed_case_ids) = 'array' AND jsonb_array_length(allowed_case_ids) BETWEEN 1 AND 2000),
    nonce TEXT NOT NULL,
    bound_job_id TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
    expires_at TIMESTAMPTZ NOT NULL,
    started_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_automation_paired_browser_expiry ON automation_paired_browser_bridges(expires_at)`,
  `CREATE TABLE IF NOT EXISTS automation_paired_browser_commands (
    id TEXT PRIMARY KEY,
    bridge_id TEXT NOT NULL REFERENCES automation_paired_browser_bridges(id) ON DELETE CASCADE,
    request_ciphertext JSONB NOT NULL CHECK (octet_length(request_ciphertext::text) <= 1048576),
    response_ciphertext JSONB CHECK (octet_length(response_ciphertext::text) <= 8388608),
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','delivered','completed','unknown')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    delivered_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
  )`,
  `CREATE INDEX IF NOT EXISTS idx_automation_paired_browser_pending ON automation_paired_browser_commands(bridge_id,created_at,id) WHERE status='queued'`
];
module.exports = {statements};
