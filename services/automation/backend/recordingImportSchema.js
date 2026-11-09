// This receipt belongs to the same database transaction as the saved plan.
// Observability activity may be unavailable after a successful import.
const statements = [`
  CREATE TABLE IF NOT EXISTS automation_recording_imports (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    source_test_case_id TEXT NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
    test_case_id TEXT NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
    created_by TEXT NOT NULL,
    recorder_session_id TEXT NOT NULL,
    input_sha256 TEXT NOT NULL,
    result JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`, `CREATE INDEX IF NOT EXISTS idx_automation_recording_imports_case ON automation_recording_imports(test_case_id)`];

module.exports = { statements };
