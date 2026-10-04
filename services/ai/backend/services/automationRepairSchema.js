module.exports=[`CREATE TABLE IF NOT EXISTS ai_automation_repairs (
  id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  test_case_id TEXT NOT NULL,session_id TEXT NOT NULL,base JSONB NOT NULL,patch JSONB NOT NULL,
  validation JSONB,verification JSONB,applied_at TIMESTAMPTZ,applied_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,`CREATE INDEX IF NOT EXISTS idx_ai_automation_repairs_project ON ai_automation_repairs(project_id,test_case_id,created_at DESC)`,
`ALTER TABLE executions ADD COLUMN IF NOT EXISTS repair_validation JSONB`];
