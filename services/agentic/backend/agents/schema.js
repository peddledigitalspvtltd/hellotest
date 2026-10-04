// Kept with the agent control plane; the application's normal transactional
// schema bootstrap owns applying these additive statements.
module.exports = [
  ...require("../workflows/temporal/durableSchema"),
  `CREATE TABLE IF NOT EXISTS workflow_operation_receipts (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    run_id TEXT NOT NULL, node_id TEXT NOT NULL, actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    request_hash TEXT NOT NULL, connection_id TEXT, state TEXT NOT NULL CHECK(state IN ('in_flight','response_received','outcome_unknown')),
    response JSONB, error_code TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TIMESTAMPTZ,
    UNIQUE(project_id,run_id,node_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_workflow_operation_receipts_run ON workflow_operation_receipts(project_id,run_id)`,
  `CREATE TABLE IF NOT EXISTS ai_agent_definitions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  current_version INTEGER NOT NULL DEFAULT 0,
  active_version INTEGER,
  archived BOOLEAN NOT NULL DEFAULT false,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
  `CREATE TABLE IF NOT EXISTS ai_agent_versions (
  agent_id TEXT NOT NULL REFERENCES ai_agent_definitions(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  definition JSONB NOT NULL,
  definition_hash TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  activated_at TIMESTAMPTZ,
  PRIMARY KEY (agent_id, version)
)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_agent_definitions_scope ON ai_agent_definitions(project_id, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS repository_agent_runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    app_type_id TEXT REFERENCES app_types(id) ON DELETE SET NULL,
    agent_type TEXT NOT NULL CHECK (agent_type IN ('object_repository','api_tests','repository_knowledge','component_tests')),
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','partial','failed','cancelled')),
    source JSONB NOT NULL DEFAULT '{}'::jsonb,
    input JSONB NOT NULL DEFAULT '{}'::jsonb,
    input_hash TEXT,
    compiler_version TEXT NOT NULL,
    request_key TEXT,
    progress INTEGER NOT NULL DEFAULT 0,
    stages JSONB NOT NULL DEFAULT '[]'::jsonb,
    summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
    result JSONB,
    error TEXT,
    published JSONB NOT NULL DEFAULT '{"items":[]}'::jsonb,
    cached_from TEXT,
    lease_token TEXT,
    heartbeat_at TIMESTAMPTZ,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_repository_agent_runs_scope ON repository_agent_runs(project_id, app_type_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_repository_agent_runs_queue ON repository_agent_runs(status, created_at) WHERE status IN ('queued','running')`,
  `CREATE INDEX IF NOT EXISTS idx_repository_agent_runs_cache ON repository_agent_runs(project_id, agent_type, input_hash, compiler_version) WHERE status IN ('completed','partial')`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_repository_agent_runs_request ON repository_agent_runs(project_id, created_by, request_key) WHERE request_key IS NOT NULL`
];
