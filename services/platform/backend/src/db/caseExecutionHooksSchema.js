// Case setup and teardown references are distinct from frozen run snapshots.
module.exports = [
  `ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS execution_hooks JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE execution_case_snapshots ADD COLUMN IF NOT EXISTS execution_hooks JSONB NOT NULL DEFAULT '[]'::jsonb`
];
