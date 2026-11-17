module.exports = [
`CREATE TABLE IF NOT EXISTS workflow_trigger_state (
 workflow_id TEXT PRIMARY KEY REFERENCES agentic_workflows(id) ON DELETE CASCADE,
 definition_hash TEXT NOT NULL, event_cursor BIGINT NOT NULL DEFAULT 0, last_polled_at TIMESTAMPTZ,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
`ALTER TABLE workflow_trigger_state ADD COLUMN IF NOT EXISTS last_polled_at TIMESTAMPTZ`,
`CREATE TABLE IF NOT EXISTS workflow_trigger_event_scans (
 workflow_id TEXT NOT NULL REFERENCES agentic_workflows(id) ON DELETE CASCADE, event_id BIGINT NOT NULL,
 PRIMARY KEY(workflow_id,event_id)
)`,
`CREATE TABLE IF NOT EXISTS workflow_trigger_secrets (
 workflow_id TEXT PRIMARY KEY REFERENCES agentic_workflows(id) ON DELETE CASCADE,
 encrypted JSONB NOT NULL, rotated_by TEXT REFERENCES users(id) ON DELETE SET NULL, rotated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
`CREATE TABLE IF NOT EXISTS workflow_project_events (
 id BIGSERIAL PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 app_type_id TEXT, event_name TEXT NOT NULL, entity_id TEXT NOT NULL,
 current_state TEXT, previous_state TEXT, occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
`CREATE INDEX IF NOT EXISTS idx_workflow_project_events_scope ON workflow_project_events(project_id,id)`,
`CREATE TABLE IF NOT EXISTS workflow_trigger_deliveries (
 id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL REFERENCES agentic_workflows(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, actor_id TEXT,
 trigger_kind TEXT NOT NULL, event_key TEXT NOT NULL, definition_hash TEXT NOT NULL, payload_hash TEXT NOT NULL,
 payload JSONB NOT NULL, run_id TEXT, state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','delivered','blocked')),
 attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, delivered_at TIMESTAMPTZ,
 UNIQUE(workflow_id,event_key)
)`,
`CREATE INDEX IF NOT EXISTS idx_workflow_trigger_pending ON workflow_trigger_deliveries(next_attempt_at) WHERE state='pending'`,
// Minimal event metadata is committed with the domain change. No row content,
// titles, credentials or source excerpts enter this durable event transport.
`CREATE OR REPLACE FUNCTION hellotest_workflow_project_event() RETURNS trigger LANGUAGE plpgsql AS $$
 DECLARE row_value JSONB; old_value JSONB; project TEXT; app TEXT; event_kind TEXT;
 BEGIN
 row_value=to_jsonb(NEW); old_value=CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
 IF TG_OP='UPDATE' AND row_value=old_value THEN RETURN NEW; END IF;
 project=row_value->>'project_id'; app=row_value->>'app_type_id';
 IF project IS NULL AND app IS NOT NULL THEN SELECT project_id INTO project FROM app_types WHERE id=app; END IF;
 IF project IS NULL THEN RETURN NEW; END IF;
 event_kind=TG_ARGV[0]||CASE WHEN TG_OP='INSERT' THEN '.created' ELSE '.updated' END;
 INSERT INTO workflow_project_events(project_id,app_type_id,event_name,entity_id,current_state,previous_state)
 VALUES(project,app,event_kind,row_value->>'id',COALESCE(row_value->>'state',row_value->>'status'),COALESCE(old_value->>'state',old_value->>'status'));
 RETURN NEW;
 END $$`,
...Object.entries({requirements:'story',test_cases:'test_case',feedback:'bug',executions:'run',requirement_releases:'release'}).map(([table,kind])=>
`DO $$ BEGIN IF to_regclass('${table}') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('${table}') AND tgname='workflow_project_event') THEN
 CREATE TRIGGER workflow_project_event AFTER INSERT OR UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION hellotest_workflow_project_event('${kind}');
 END IF; END $$`)
];
