module.exports = [
  `CREATE TABLE IF NOT EXISTS agent_runs (
    id TEXT PRIMARY KEY, schema_version TEXT NOT NULL DEFAULT 'agent-run/1',
    system TEXT NOT NULL CHECK(system IN ('workflow','repository','quality','automation')),
    source_run_id TEXT NOT NULL, project_id TEXT NOT NULL, app_type_id TEXT, actor_id TEXT,
    agent_id TEXT NOT NULL, descriptor JSONB NOT NULL, descriptor_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('queued','running','waiting','succeeded','partial','failed','cancelled','unknown')),
    native_status TEXT NOT NULL, progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
    title TEXT NOT NULL, payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL, synchronized_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(system, source_run_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_runs_project ON agent_runs(project_id, updated_at DESC, id)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_runs_system_status ON agent_runs(project_id,system,status,updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS agent_run_events (
    id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    source_event_id TEXT NOT NULL, phase TEXT NOT NULL, level TEXT NOT NULL,
    message TEXT NOT NULL, payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(run_id,source_event_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_run_events_order ON agent_run_events(run_id,occurred_at,id)`
];
