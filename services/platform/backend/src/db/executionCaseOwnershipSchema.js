module.exports = [
  `ALTER TABLE execution_case_snapshots ADD COLUMN IF NOT EXISTS automated TEXT CHECK (automated IN ('yes', 'no'))`,
  `UPDATE execution_case_snapshots snapshot SET automated = tc.automated
    FROM test_cases tc WHERE tc.id = snapshot.test_case_id AND snapshot.automated IS NULL`
];
