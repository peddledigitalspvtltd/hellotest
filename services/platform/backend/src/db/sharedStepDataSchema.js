// Shared groups consume one selected data row; case/run iteration counts remain independent.
module.exports = [
  `ALTER TABLE shared_step_groups ADD COLUMN IF NOT EXISTS test_data_set_id TEXT REFERENCES test_data_sets(id) ON DELETE SET NULL`,
  `ALTER TABLE shared_step_groups ADD COLUMN IF NOT EXISTS test_data_row_index INTEGER NOT NULL DEFAULT 0 CHECK (test_data_row_index >= 0)`,
  `CREATE INDEX IF NOT EXISTS idx_shared_step_groups_data_set ON shared_step_groups (test_data_set_id) WHERE test_data_set_id IS NOT NULL`,
  `ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS test_data_options JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE execution_case_snapshots ADD COLUMN IF NOT EXISTS test_data_options JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE execution_step_snapshots ADD COLUMN IF NOT EXISTS shared_parameter_values JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE execution_step_snapshots ADD COLUMN IF NOT EXISTS shared_parameter_template_values JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE execution_step_snapshots ADD COLUMN IF NOT EXISTS shared_parameter_sensitive_names JSONB NOT NULL DEFAULT '[]'::jsonb`
];
