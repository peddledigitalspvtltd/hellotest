// Older result logs may be plain text. Invalid logs are absent evidence, never
// a reason to abort the whole metrics request or invent a step outcome.
module.exports = [
  `ALTER TABLE test_case_runs ADD COLUMN IF NOT EXISTS data_set_iteration_index INTEGER`,
  `ALTER TABLE test_case_runs ADD COLUMN IF NOT EXISTS data_set_iteration_key TEXT`,
  `CREATE OR REPLACE FUNCTION shared_step_statuses(log_text TEXT) RETURNS JSONB
    LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
    DECLARE parsed JSONB;
    BEGIN
      parsed := log_text::jsonb -> 'stepStatuses';
      IF jsonb_typeof(parsed) = 'object' THEN RETURN parsed; END IF;
      RETURN '{}'::jsonb;
    EXCEPTION WHEN invalid_text_representation THEN RETURN '{}'::jsonb;
    END $$`,
  `CREATE INDEX IF NOT EXISTS idx_shared_step_current_usage ON test_steps(reusable_group_id, test_case_id) WHERE reusable_group_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_shared_step_snapshot_usage ON execution_step_snapshots(reusable_group_id, execution_id, test_case_id) WHERE reusable_group_id IS NOT NULL`
];
