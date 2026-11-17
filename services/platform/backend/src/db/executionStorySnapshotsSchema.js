// NULL identifies historical runs whose Story links were never captured. Do
// not backfill today's links and present them as immutable historical evidence.
module.exports=[`ALTER TABLE execution_case_snapshots ADD COLUMN IF NOT EXISTS requirement_snapshots JSONB`];
