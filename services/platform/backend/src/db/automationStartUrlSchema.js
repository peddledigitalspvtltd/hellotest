// Preserve legacy targets. A reviewed literal URL is required by new browser
// case creation and generation, rather than inferred or backfilled from data.
module.exports = [
  `ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS automation_start_url TEXT`
];
