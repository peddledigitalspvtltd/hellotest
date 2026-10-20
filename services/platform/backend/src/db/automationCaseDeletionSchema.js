module.exports = [
  // Queue payloads and receipts refer to the frozen case identity just like
  // execution snapshots. Removing a live case must retain completed job proof.
  `DO $$ DECLARE relation RECORD; BEGIN
    FOR relation IN SELECT conname FROM pg_constraint
      WHERE conrelid='test_engine_jobs'::regclass
        AND confrelid='test_cases'::regclass AND contype='f'
    LOOP
      EXECUTE format('ALTER TABLE test_engine_jobs DROP CONSTRAINT %I',relation.conname);
    END LOOP;
  END $$`,
  `CREATE INDEX IF NOT EXISTS idx_admin_audit_automation_delete_selection
    ON admin_audit_log ((metadata->>'selection_key'))
    WHERE action='automation_case.bulk_delete'`
];
