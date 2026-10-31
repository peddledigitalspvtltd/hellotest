module.exports = [
`CREATE TABLE IF NOT EXISTS mcp_credentials (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, client_id TEXT NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
`CREATE INDEX IF NOT EXISTS mcp_credentials_owner ON mcp_credentials(user_id, project_id)`,
`CREATE TABLE IF NOT EXISTS mcp_action_plans (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, client_id TEXT NOT NULL,
 operation_id TEXT NOT NULL, catalog_revision TEXT NOT NULL, arguments JSONB NOT NULL,
 digest TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'requires_authorization',
 approved_at TIMESTAMPTZ, expires_at TIMESTAMPTZ NOT NULL, started_at TIMESTAMPTZ,
 receipt JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK (state IN ('requires_authorization','authorized','executing','submitted','succeeded_verified','succeeded_proposal','failed','unknown')))`,
`DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='mcp_action_plans'::regclass AND conname='mcp_action_plans_state_check' AND pg_get_constraintdef(oid) NOT LIKE '%succeeded_proposal%') THEN
  ALTER TABLE mcp_action_plans DROP CONSTRAINT mcp_action_plans_state_check;
  ALTER TABLE mcp_action_plans ADD CONSTRAINT mcp_action_plans_state_check CHECK (state IN ('requires_authorization','authorized','executing','submitted','succeeded_verified','succeeded_proposal','failed','unknown'));
 END IF;
END $$`,
`CREATE INDEX IF NOT EXISTS mcp_plans_owner ON mcp_action_plans(user_id, project_id, created_at DESC)`,
`CREATE TABLE IF NOT EXISTS mcp_audit_events (
 id BIGSERIAL PRIMARY KEY, project_id TEXT NOT NULL, user_id TEXT NOT NULL, client_id TEXT NOT NULL,
 tool TEXT NOT NULL, outcome TEXT NOT NULL, plan_id TEXT, duration_ms INTEGER,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
];
