const tracked = ['requirements','test_cases','test_steps','executions','execution_results','execution_case_snapshots','execution_step_snapshots','feedback','requirement_test_cases','requirement_defects','test_case_defects','requirement_releases','quality_assertion_reviews','project_members','quality_release_policies','quality_release_waivers'];
module.exports = [
  `ALTER TABLE quality_graph_snapshots ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMPTZ`,
  `CREATE TABLE IF NOT EXISTS quality_graph_change_outbox (
    id BIGSERIAL PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_table TEXT NOT NULL, entity_id TEXT, operation TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),processed_at TIMESTAMPTZ
  )`,
  `CREATE INDEX IF NOT EXISTS idx_quality_graph_changes_pending ON quality_graph_change_outbox(project_id,id) WHERE processed_at IS NULL`,
  `ALTER TABLE quality_graph_change_outbox ADD COLUMN IF NOT EXISTS delivery_key TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_quality_graph_change_delivery ON quality_graph_change_outbox(delivery_key) WHERE delivery_key IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_quality_graph_changes_processed ON quality_graph_change_outbox(project_id,processed_at) WHERE processed_at IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_quality_graph_changes_retention ON quality_graph_change_outbox(processed_at) WHERE processed_at IS NOT NULL`,
  `CREATE OR REPLACE FUNCTION record_quality_graph_change() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE row_data JSONB; project_key TEXT; entity_key TEXT;
    BEGIN
      IF TG_OP='UPDATE' AND to_jsonb(OLD)=to_jsonb(NEW) THEN RETURN NEW; END IF;
      row_data := CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
      project_key := row_data->>'project_id';
      IF TG_TABLE_NAME='requirements' THEN entity_key := 'story:'||(row_data->>'id');
      ELSIF TG_TABLE_NAME='test_cases' THEN
        SELECT project_id INTO project_key FROM app_types WHERE id=row_data->>'app_type_id';
        IF project_key IS NULL THEN SELECT project_id INTO project_key FROM requirements WHERE id=row_data->>'requirement_id'; END IF;
        entity_key := 'test:'||(row_data->>'id');
      ELSIF TG_TABLE_NAME='test_steps' THEN
        SELECT a.project_id INTO project_key FROM test_cases t JOIN app_types a ON a.id=t.app_type_id WHERE t.id=row_data->>'test_case_id';
        entity_key := 'assertion:'||(row_data->>'test_case_id')||':'||(row_data->>'id');
      ELSIF TG_TABLE_NAME='executions' THEN entity_key := 'run:'||(row_data->>'id');
      ELSIF TG_TABLE_NAME='execution_results' THEN
        SELECT project_id INTO project_key FROM executions WHERE id=row_data->>'execution_id';
        entity_key := 'attempt:'||(row_data->>'id');
      ELSIF TG_TABLE_NAME IN ('execution_case_snapshots','execution_step_snapshots') THEN
        SELECT project_id INTO project_key FROM executions WHERE id=row_data->>'execution_id';
      ELSIF TG_TABLE_NAME='feedback' THEN entity_key := 'defect:'||(row_data->>'id');
      ELSIF TG_TABLE_NAME='requirement_test_cases' THEN SELECT project_id INTO project_key FROM requirements WHERE id=row_data->>'requirement_id';
      ELSIF TG_TABLE_NAME IN ('requirement_defects','test_case_defects') THEN SELECT project_id INTO project_key FROM feedback WHERE id=row_data->>'issue_id';
      END IF;
      IF project_key IS NOT NULL AND EXISTS(SELECT 1 FROM projects WHERE id=project_key) THEN
        -- Coalesce bulk snapshot writes within a transaction. Delete events
        -- retain individual entity identities for historical tombstones.
        IF TG_OP<>'DELETE' THEN entity_key := NULL; END IF;
        INSERT INTO quality_graph_change_outbox(project_id,source_table,entity_id,operation,delivery_key)
          VALUES(project_key,TG_TABLE_NAME,entity_key,TG_OP,md5(jsonb_build_array(project_key,TG_TABLE_NAME,TG_OP,entity_key,txid_current())::text))
          ON CONFLICT DO NOTHING;
      END IF;
      IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END
  $$`,
  ...tracked.map(table=>`DO $$ BEGIN
    IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='${table}'::regclass AND tgname='quality_graph_change') THEN
      CREATE TRIGGER quality_graph_change BEFORE INSERT OR UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION record_quality_graph_change();
    END IF;
  END $$`)
];
