module.exports = [
`CREATE TABLE IF NOT EXISTS mcp_credentials (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, client_id TEXT NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
`CREATE INDEX IF NOT EXISTS mcp_credentials_owner ON mcp_credentials(user_id, project_id)`,
// Tool-set scopes. The signed token is what a request is authorized by; this mirror is for listing a
// credential's access and for audit. Rows from before tool sets default to the read-only sets, matching how
// a token without the claim is treated. The internal column marks credentials the platform mints for its own calls.
`ALTER TABLE mcp_credentials ADD COLUMN IF NOT EXISTS scopes JSONB NOT NULL DEFAULT '["knowledge","records"]'::jsonb`,
`ALTER TABLE mcp_credentials ADD COLUMN IF NOT EXISTS internal BOOLEAN NOT NULL DEFAULT FALSE`,
// Exact manual credentials bind this list with a hash signed into their token.
// Null keeps legacy, OAuth and internal rows on their original tool-set contract.
`ALTER TABLE mcp_credentials ADD COLUMN IF NOT EXISTS tool_names JSONB CHECK (tool_names IS NULL OR (jsonb_typeof(tool_names) = 'array' AND internal = FALSE))`,
`CREATE INDEX IF NOT EXISTS mcp_credentials_expiry ON mcp_credentials(expires_at)`,
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
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
`CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
 client_id TEXT PRIMARY KEY, client_name TEXT NOT NULL,
 redirect_uris JSONB NOT NULL CHECK (jsonb_typeof(redirect_uris) = 'array'),
 grant_types JSONB NOT NULL DEFAULT '["authorization_code"]'::jsonb,
 response_types JSONB NOT NULL DEFAULT '["code"]'::jsonb,
 token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none' CHECK (token_endpoint_auth_method = 'none'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
`CREATE TABLE IF NOT EXISTS mcp_oauth_authorization_requests (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES mcp_oauth_clients(client_id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 redirect_uri TEXT NOT NULL, resource TEXT NOT NULL, scopes JSONB NOT NULL,
 code_challenge TEXT NOT NULL, code_challenge_method TEXT NOT NULL CHECK (code_challenge_method = 'S256'),
 state TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, consumed_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
`CREATE INDEX IF NOT EXISTS mcp_oauth_authorization_requests_expiry ON mcp_oauth_authorization_requests(expires_at)`,
`CREATE TABLE IF NOT EXISTS mcp_oauth_codes (
 code_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES mcp_oauth_clients(client_id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 redirect_uri TEXT NOT NULL, resource TEXT NOT NULL, scopes JSONB NOT NULL,
 code_challenge TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, consumed_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
`CREATE INDEX IF NOT EXISTS mcp_oauth_codes_expiry ON mcp_oauth_codes(expires_at)`
];
