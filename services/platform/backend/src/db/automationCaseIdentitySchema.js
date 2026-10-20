// Automation and manual cases share storage, but retain independent identities
// and execution evidence. Linked coverage is a read-only projection of genuine
// source results; it never inserts a manual execution or copies step evidence.
const resultColumns = ['id','execution_id','test_case_id','test_case_title','suite_id','suite_name','app_type_id','status','duration_ms','started_at','timer_started_at','ended_at','lifecycle_history','error','logs','test_data_set_id','test_data_set_name','data_set_iteration_index','data_set_iteration_key','data_set_row_snapshot','external_references','defects','step_defects','case_defects','revision','executed_by','created_at','updated_at'];
const derivedOverrides = {
  id: "'linked:' || manual.id || ':' || source.execution_id",
  test_case_id: 'manual.id', test_case_title: 'manual.title', status: `CASE WHEN coverage.status IN ('failed','blocked') THEN coverage.status
    WHEN EXISTS(SELECT 1 FROM execution_case_snapshots needed JOIN automation_case_links needed_link ON needed_link.automation_test_case_id=needed.test_case_id AND needed_link.manual_test_case_id=manual.id
      JOIN test_cases needed_case ON needed_case.id=needed.test_case_id AND needed_case.automated='yes' AND needed_case.app_type_id=manual.app_type_id
      WHERE needed.execution_id=source.execution_id AND NOT EXISTS(SELECT 1 FROM execution_results started WHERE started.execution_id=needed.execution_id AND started.test_case_id=needed.test_case_id)) THEN 'pending' ELSE coverage.status END`,
  suite_id: 'manual_snapshot.suite_id', suite_name: 'manual_snapshot.suite_name',
  data_set_iteration_index: 'NULL::integer', data_set_iteration_key: 'NULL::text', data_set_row_snapshot: 'NULL::jsonb',
  duration_ms:'NULL::bigint', timer_started_at: 'NULL::timestamptz', lifecycle_history: "'[]'::jsonb", revision: '1',
  logs: 'NULL::text', step_defects: "'{}'::jsonb", created_at: "GREATEST(coverage.effective_at,(SELECT MAX(pending.updated_at) FROM execution_results pending WHERE pending.execution_id=source.execution_id AND pending.test_case_id=manual.id AND pending.status='pending'))", updated_at: 'coverage.effective_at'
};
module.exports = [
  "ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS legacy_display_ids JSONB NOT NULL DEFAULT '[]'::jsonb",
  "CREATE TABLE IF NOT EXISTS record_display_sequences(kind TEXT PRIMARY KEY, value BIGINT NOT NULL)",
  `WITH existing AS (SELECT COALESCE(MAX(SUBSTRING(display_id FROM '^AT_([0-9]+)$')::bigint),0) AS maximum FROM test_cases),
    numbered AS (SELECT id,display_id,ROW_NUMBER() OVER(ORDER BY created_at NULLS LAST,id) AS number FROM test_cases WHERE automated='yes' AND (display_id IS NULL OR display_id !~ '^AT_[0-9]+$'))
    UPDATE test_cases tc SET legacy_display_ids=CASE WHEN numbered.display_id IS NULL THEN tc.legacy_display_ids ELSE tc.legacy_display_ids || jsonb_build_array(numbered.display_id) END,
      display_id='AT_' || (existing.maximum+numbered.number) FROM numbered,existing WHERE tc.id=numbered.id`,
  `CREATE OR REPLACE FUNCTION preserve_test_case_identity() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE assigned bigint; previous_reference text;
    BEGIN
      IF TG_OP='UPDATE' AND COALESCE(OLD.automated,'no')<>COALESCE(NEW.automated,'no') THEN
        RAISE EXCEPTION 'Manual and automation cases have separate immutable identities' USING ERRCODE='23514';
      END IF;
      IF TG_OP='UPDATE' AND NEW.app_type_id IS DISTINCT FROM OLD.app_type_id AND EXISTS(SELECT 1 FROM automation_case_links WHERE automation_test_case_id=OLD.id OR manual_test_case_id=OLD.id) THEN
        RAISE EXCEPTION 'Unlink manual and automation cases before moving them to another application' USING ERRCODE='23514';
      END IF;
      IF NEW.automated='yes' AND (NEW.display_id IS NULL OR NEW.display_id !~ '^AT_[0-9]+$') THEN
        previous_reference=NEW.display_id;
        IF TG_OP='UPDATE' AND OLD.display_id ~ '^AT_[0-9]+$' THEN NEW.display_id=OLD.display_id;
        ELSE
          INSERT INTO record_display_sequences(kind,value)
          SELECT 'automation_case',COALESCE(MAX(SUBSTRING(display_id FROM '^AT_([0-9]+)$')::bigint),0)+1 FROM test_cases
          ON CONFLICT(kind) DO UPDATE SET value=GREATEST(record_display_sequences.value+1,EXCLUDED.value) RETURNING value INTO assigned;
          NEW.display_id='AT_'||assigned;
        END IF;
        IF previous_reference IS NOT NULL AND NOT COALESCE(NEW.legacy_display_ids,'[]'::jsonb) @> jsonb_build_array(previous_reference) THEN
          NEW.legacy_display_ids=COALESCE(NEW.legacy_display_ids,'[]'::jsonb)||jsonb_build_array(previous_reference);
        END IF;
      END IF;
      RETURN NEW;
    END $$`,
  `DROP TRIGGER IF EXISTS test_case_identity_preserved ON test_cases`,
  `CREATE TRIGGER test_case_identity_preserved BEFORE INSERT OR UPDATE OF automated,display_id,app_type_id ON test_cases FOR EACH ROW EXECUTE FUNCTION preserve_test_case_identity()`,
  `ALTER TABLE execution_results ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`,
  `UPDATE execution_results SET updated_at=COALESCE(ended_at,started_at,created_at,CURRENT_TIMESTAMP) WHERE updated_at IS NULL`,
  `ALTER TABLE execution_results ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP`,
  `CREATE OR REPLACE FUNCTION touch_execution_result_outcome() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status OR NEW.started_at IS DISTINCT FROM OLD.started_at OR NEW.ended_at IS DISTINCT FROM OLD.ended_at THEN NEW.updated_at=CURRENT_TIMESTAMP;
    ELSE NEW.updated_at=OLD.updated_at; END IF; RETURN NEW; END $$`,
  `DROP TRIGGER IF EXISTS execution_result_outcome_updated ON execution_results`,
  `CREATE TRIGGER execution_result_outcome_updated BEFORE UPDATE ON execution_results FOR EACH ROW EXECUTE FUNCTION touch_execution_result_outcome()`,
  `CREATE INDEX IF NOT EXISTS idx_execution_results_linked_case_run ON execution_results(test_case_id,execution_id,COALESCE(data_set_iteration_index,-1),created_at DESC,id DESC)`,
  `CREATE OR REPLACE VIEW test_case_effective_results AS
    WITH linked_candidates AS (
    SELECT ${resultColumns.map(column => `${derivedOverrides[column] || `source.${column}`} AS ${column}`).join(',')}, 'linked_automation'::text AS result_origin,true AS derived,
      source.id AS source_result_id,automation.id AS source_test_case_id,automation.display_id AS source_display_id,GREATEST(coverage.effective_at,(SELECT MAX(pending.updated_at) FROM execution_results pending WHERE pending.execution_id=source.execution_id AND pending.test_case_id=manual.id AND pending.status='pending')) AS effective_at,true AS covers_entire_case,
      ROW_NUMBER() OVER(PARTITION BY manual.id,source.execution_id ORDER BY CASE coverage.status WHEN 'failed' THEN 1 WHEN 'blocked' THEN 2 WHEN 'pending' THEN 3 WHEN 'passed' THEN 4 ELSE 5 END,coverage.effective_at DESC,automation.id) AS candidate_rank,
      MAX(GREATEST(coverage.effective_at,(SELECT MAX(pending.updated_at) FROM execution_results pending WHERE pending.execution_id=source.execution_id AND pending.test_case_id=manual.id AND pending.status='pending'))) OVER(PARTITION BY manual.id,source.execution_id) AS case_effective_at,
      jsonb_agg(jsonb_build_object('source_result_id',source.id,'source_test_case_id',automation.id,'source_display_id',automation.display_id,'status',coverage.status)) OVER(PARTITION BY manual.id,source.execution_id ORDER BY automation.id ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS source_results,source.duration_ms AS source_duration_ms
    FROM automation_case_links link
    JOIN test_cases automation ON automation.id=link.automation_test_case_id AND automation.automated='yes'
    JOIN test_cases manual ON manual.id=link.manual_test_case_id AND COALESCE(manual.automated,'no')='no' AND manual.app_type_id=automation.app_type_id
    JOIN LATERAL (
      WITH latest_iterations AS (
        SELECT DISTINCT ON(execution_id,COALESCE(data_set_iteration_index,-1)) * FROM execution_results
        WHERE test_case_id=automation.id ORDER BY execution_id,COALESCE(data_set_iteration_index,-1),created_at DESC,id DESC
      )
      SELECT result.execution_id,result.test_case_id,
        CASE WHEN BOOL_OR(result.status='failed') THEN 'failed'
          WHEN BOOL_OR(result.status IN ('blocked','aborted')) THEN 'blocked'
          WHEN BOOL_OR(result.status IN ('pending','running','paused')) THEN 'pending'
          WHEN COUNT(*) < MAX(CASE WHEN snapshot.test_data_set_snapshot->>'mode'='table' AND jsonb_typeof(snapshot.test_data_set_snapshot->'rows')='array' THEN GREATEST(1,jsonb_array_length(snapshot.test_data_set_snapshot->'rows')) ELSE 1 END) THEN 'pending'
          WHEN BOOL_AND(result.status='passed') THEN 'passed' ELSE 'blocked' END AS status,
        MAX(COALESCE(result.updated_at,result.created_at)) AS effective_at,
        (ARRAY_AGG(result.id ORDER BY CASE result.status WHEN 'failed' THEN 1 WHEN 'blocked' THEN 2 WHEN 'aborted' THEN 3 WHEN 'running' THEN 4 WHEN 'paused' THEN 5 WHEN 'pending' THEN 6 WHEN 'skipped' THEN 7 ELSE 8 END, result.created_at DESC,result.id DESC))[1] AS representative_id
      FROM latest_iterations result LEFT JOIN execution_case_snapshots snapshot ON snapshot.execution_id=result.execution_id AND snapshot.test_case_id=result.test_case_id
      GROUP BY result.execution_id,result.test_case_id
    ) coverage ON TRUE
    JOIN execution_results source ON source.id=coverage.representative_id
    JOIN executions run ON run.id=source.execution_id
    JOIN app_types app ON app.id=automation.app_type_id AND app.project_id=run.project_id
    LEFT JOIN execution_case_snapshots manual_snapshot ON manual_snapshot.execution_id=source.execution_id AND manual_snapshot.test_case_id=manual.id
    LEFT JOIN execution_case_snapshots automation_snapshot ON automation_snapshot.execution_id=source.execution_id AND automation_snapshot.test_case_id=automation.id
    WHERE automation_snapshot.test_case_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM execution_results human WHERE human.execution_id=source.execution_id AND human.test_case_id=manual.id AND human.status<>'pending')
      AND (manual_snapshot.test_data_set_id IS NULL OR (manual_snapshot.test_data_set_id=automation_snapshot.test_data_set_id AND manual_snapshot.test_data_set_snapshot IS NOT DISTINCT FROM automation_snapshot.test_data_set_snapshot))
    )
    SELECT ${resultColumns.map(column => `result.${column}`).join(',')}, 'direct'::text AS result_origin,false AS derived,
      result.id AS source_result_id,result.test_case_id AS source_test_case_id,direct_case.display_id AS source_display_id,
      COALESCE(result.updated_at,result.created_at) AS effective_at,false AS covers_entire_case,
      jsonb_build_array(jsonb_build_object('source_result_id',result.id,'source_test_case_id',result.test_case_id,'source_display_id',direct_case.display_id,'status',result.status)) AS source_results,result.duration_ms AS source_duration_ms
    FROM execution_results result LEFT JOIN test_cases direct_case ON direct_case.id=result.test_case_id
    UNION ALL
    SELECT ${resultColumns.map(column => ['created_at','updated_at'].includes(column)?`candidate.case_effective_at AS ${column}`:`candidate.${column}`).join(',')},candidate.result_origin,candidate.derived,
      candidate.source_result_id,candidate.source_test_case_id,candidate.source_display_id,candidate.case_effective_at AS effective_at,candidate.covers_entire_case,candidate.source_results,candidate.source_duration_ms
    FROM linked_candidates candidate WHERE candidate.candidate_rank=1`
];
