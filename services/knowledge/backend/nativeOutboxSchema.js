"use strict";

// Native product writes and the Knowledge index stay atomic: these triggers only
// enqueue a bounded identity/event. Indexing runs later under the Knowledge
// service principal and read-time access still comes from required_permission.
module.exports = [
  `CREATE TABLE IF NOT EXISTS ai_knowledge_native_outbox (
    source_kind TEXT NOT NULL,
    source_ref_id TEXT NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    action TEXT NOT NULL CHECK (action IN ('upsert','archive')),
    revision BIGINT NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    lease_owner TEXT,
    lease_expires_at TIMESTAMPTZ,
    last_error_fingerprint TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (source_kind,source_ref_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_native_outbox_due
    ON ai_knowledge_native_outbox (status,next_attempt_at,created_at,project_id)
    WHERE status IN ('queued','running')`,
  `CREATE TABLE IF NOT EXISTS ai_knowledge_outbox_project_fairness (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    last_served_at TIMESTAMPTZ NOT NULL DEFAULT '-infinity'
  )`,
  `CREATE TABLE IF NOT EXISTS ai_knowledge_worker_project_fairness (
    queue_stage TEXT NOT NULL CHECK(queue_stage IN ('ingestion','graph_projection','vector_projection','semantic_work')),
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    last_served_at TIMESTAMPTZ NOT NULL DEFAULT '-infinity',
    PRIMARY KEY(queue_stage,project_id)
  )`,
  `CREATE OR REPLACE FUNCTION ai_knowledge_enqueue_native(p_kind TEXT,p_ref TEXT,p_project TEXT,p_action TEXT)
    RETURNS VOID LANGUAGE plpgsql AS $function$
    BEGIN
      IF p_kind IS NULL OR p_ref IS NULL OR p_project IS NULL THEN RETURN; END IF;
      INSERT INTO ai_knowledge_native_outbox(source_kind,source_ref_id,project_id,action,status,attempts,next_attempt_at,lease_owner,lease_expires_at,last_error_fingerprint)
      VALUES(p_kind,p_ref,p_project,p_action,'queued',0,CURRENT_TIMESTAMP,NULL,NULL,NULL)
      ON CONFLICT(source_kind,source_ref_id) DO UPDATE SET project_id=EXCLUDED.project_id,action=EXCLUDED.action,
        revision=ai_knowledge_native_outbox.revision+1,status='queued',attempts=0,next_attempt_at=CURRENT_TIMESTAMP,
        lease_owner=NULL,lease_expires_at=NULL,last_error_fingerprint=NULL,updated_at=CURRENT_TIMESTAMP;
    END
  $function$`,
  `CREATE OR REPLACE FUNCTION ai_knowledge_native_change_trigger() RETURNS trigger LANGUAGE plpgsql AS $function$
    DECLARE old_row JSONB; new_row JSONB; payload JSONB; entity_id TEXT; project_id TEXT; entity_kind TEXT; action TEXT;
    BEGIN
      IF TG_OP <> 'INSERT' THEN old_row := to_jsonb(OLD); END IF;
      IF TG_OP <> 'DELETE' THEN new_row := to_jsonb(NEW); END IF;
      FOREACH payload IN ARRAY ARRAY[old_row,new_row] LOOP
        IF payload IS NULL THEN CONTINUE; END IF;
        entity_id := NULL; project_id := NULL; entity_kind := NULL; action := 'upsert';
        IF TG_TABLE_NAME='requirements' THEN
          entity_kind := 'requirement'; entity_id := payload->>'id'; project_id := payload->>'project_id';
        ELSIF TG_TABLE_NAME='test_cases' THEN
          entity_kind := 'test_case'; entity_id := payload->>'id';
          SELECT apps.project_id INTO project_id FROM app_types apps WHERE apps.id=payload->>'app_type_id';
        ELSIF TG_TABLE_NAME='executions' THEN
          entity_kind := 'execution'; entity_id := payload->>'id'; project_id := payload->>'project_id';
        ELSIF TG_TABLE_NAME='feedback' THEN
          entity_kind := 'bug'; entity_id := payload->>'id'; project_id := payload->>'project_id';
        ELSIF TG_TABLE_NAME='test_suites' THEN
          entity_kind := 'test_suite'; entity_id := payload->>'id';
          SELECT apps.project_id INTO project_id FROM app_types apps WHERE apps.id=payload->>'app_type_id';
        ELSIF TG_TABLE_NAME='test_case_modules' THEN
          entity_kind := 'test_module'; entity_id := payload->>'id';
          SELECT apps.project_id INTO project_id FROM app_types apps WHERE apps.id=payload->>'app_type_id';
        ELSIF TG_TABLE_NAME='requirement_releases' THEN
          entity_kind := 'release'; entity_id := payload->>'id'; project_id := payload->>'project_id';
        ELSIF TG_TABLE_NAME='requirement_iterations' THEN
          entity_kind := 'sprint'; entity_id := payload->>'id'; project_id := payload->>'project_id';
        END IF;
        IF entity_kind IS NOT NULL THEN
          IF TG_OP='DELETE' AND payload=old_row THEN action := 'archive'; END IF;
          PERFORM ai_knowledge_enqueue_native(entity_kind,entity_id,project_id,action);
          CONTINUE;
        END IF;
        IF TG_TABLE_NAME='test_steps' THEN
          SELECT apps.project_id INTO project_id FROM test_cases cases JOIN app_types apps ON apps.id=cases.app_type_id WHERE cases.id=payload->>'test_case_id';
          PERFORM ai_knowledge_enqueue_native('test_case',payload->>'test_case_id',project_id,'upsert');
        ELSIF TG_TABLE_NAME='requirement_test_cases' THEN
          SELECT records.project_id INTO project_id FROM requirements records WHERE records.id=payload->>'requirement_id';
          PERFORM ai_knowledge_enqueue_native('requirement',payload->>'requirement_id',project_id,'upsert');
          SELECT apps.project_id INTO project_id FROM test_cases cases JOIN app_types apps ON apps.id=cases.app_type_id WHERE cases.id=payload->>'test_case_id';
          PERFORM ai_knowledge_enqueue_native('test_case',payload->>'test_case_id',project_id,'upsert');
        ELSIF TG_TABLE_NAME='test_case_module_cases' THEN
          SELECT apps.project_id INTO project_id FROM test_case_modules modules JOIN app_types apps ON apps.id=modules.app_type_id WHERE modules.id=payload->>'module_id';
          PERFORM ai_knowledge_enqueue_native('test_module',payload->>'module_id',project_id,'upsert');
          SELECT apps.project_id INTO project_id FROM test_cases cases JOIN app_types apps ON apps.id=cases.app_type_id WHERE cases.id=payload->>'test_case_id';
          PERFORM ai_knowledge_enqueue_native('test_case',payload->>'test_case_id',project_id,'upsert');
        ELSIF TG_TABLE_NAME='test_case_module_requirements' THEN
          SELECT apps.project_id INTO project_id FROM test_case_modules modules JOIN app_types apps ON apps.id=modules.app_type_id WHERE modules.id=payload->>'module_id';
          PERFORM ai_knowledge_enqueue_native('test_module',payload->>'module_id',project_id,'upsert');
          PERFORM ai_knowledge_enqueue_native('requirement',payload->>'requirement_id',project_id,'upsert');
        ELSIF TG_TABLE_NAME='suite_test_cases' THEN
          SELECT apps.project_id INTO project_id FROM test_suites suites JOIN app_types apps ON apps.id=suites.app_type_id WHERE suites.id=payload->>'suite_id';
          PERFORM ai_knowledge_enqueue_native('test_suite',payload->>'suite_id',project_id,'upsert');
          PERFORM ai_knowledge_enqueue_native('test_case',payload->>'test_case_id',project_id,'upsert');
        ELSIF TG_TABLE_NAME='execution_results' THEN
          SELECT records.project_id INTO project_id FROM executions records WHERE records.id=payload->>'execution_id';
          PERFORM ai_knowledge_enqueue_native('execution',payload->>'execution_id',project_id,'upsert');
          SELECT apps.project_id INTO project_id FROM test_cases cases JOIN app_types apps ON apps.id=cases.app_type_id WHERE cases.id=payload->>'test_case_id';
          PERFORM ai_knowledge_enqueue_native('test_case',payload->>'test_case_id',project_id,'upsert');
          PERFORM ai_knowledge_enqueue_native('execution_result',payload->>'id',
            (SELECT records.project_id FROM executions records WHERE records.id=payload->>'execution_id'),'upsert');
        ELSIF TG_TABLE_NAME='requirement_release_items' THEN
          SELECT records.project_id INTO project_id FROM requirement_releases records WHERE records.id=payload->>'release_id';
          PERFORM ai_knowledge_enqueue_native('release',payload->>'release_id',project_id,'upsert');
          PERFORM ai_knowledge_enqueue_native('requirement',payload->>'requirement_id',project_id,'upsert');
        ELSIF TG_TABLE_NAME='requirement_relations' THEN
          SELECT records.project_id INTO project_id FROM requirements records WHERE records.id=payload->>'requirement_id';
          PERFORM ai_knowledge_enqueue_native('requirement',payload->>'requirement_id',project_id,'upsert');
          PERFORM ai_knowledge_enqueue_native('requirement',payload->>'related_requirement_id',project_id,'upsert');
        END IF;
      END LOOP;
      IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END
  $function$`,
  `DO $triggers$
    DECLARE table_name TEXT;
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM knowledge_schema_migrations WHERE id='knowledge-native-outbox-v1') THEN
        FOREACH table_name IN ARRAY ARRAY['requirements','test_cases','executions','feedback','test_suites','test_case_modules','requirement_releases','requirement_iterations','test_steps','requirement_test_cases','test_case_module_cases','test_case_module_requirements','suite_test_cases','execution_results','requirement_release_items','requirement_relations'] LOOP
          IF to_regclass(current_schema()||'.'||table_name) IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM pg_trigger WHERE tgname='ai_knowledge_native_outbox' AND tgrelid=to_regclass(current_schema()||'.'||table_name) AND NOT tgisinternal
          ) THEN
            EXECUTE format('CREATE TRIGGER ai_knowledge_native_outbox AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION ai_knowledge_native_change_trigger()',table_name);
          END IF;
        END LOOP;
        INSERT INTO knowledge_schema_migrations(id,description) VALUES('knowledge-native-outbox-v1','Transactional native-record indexing events') ON CONFLICT(id) DO NOTHING;
      END IF;
    END
  $triggers$`
];
