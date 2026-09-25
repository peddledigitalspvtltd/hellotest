// Additive schema owned by Knowledge Repo; applied by the deployment migration.
module.exports = [
  `CREATE TABLE IF NOT EXISTS ai_knowledge_refresh (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  interval_ms INTEGER NOT NULL DEFAULT 300000 CHECK(interval_ms BETWEEN 5000 AND 86400000),
  requested BOOLEAN NOT NULL DEFAULT FALSE,
  cursor TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'idle',
  next_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_started_at TIMESTAMPTZ, last_completed_at TIMESTAMPTZ,
  last_result JSONB NOT NULL DEFAULT '{}'::jsonb, last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_knowledge_refresh_due ON ai_knowledge_refresh(next_at) WHERE enabled OR requested`,
];
