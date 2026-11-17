// Main-store lifecycle writes enqueue their identity atomically. The shared
// activity ledger lives in the observability store, which may be a separate DB.
module.exports=[
  `CREATE TABLE IF NOT EXISTS agent_activity_outbox(system TEXT NOT NULL,source_run_id TEXT NOT NULL,project_id TEXT NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(system,source_run_id))`,
  `CREATE OR REPLACE FUNCTION enqueue_agent_activity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    INSERT INTO agent_activity_outbox(system,source_run_id,project_id,updated_at) VALUES(TG_ARGV[0],NEW.id,NEW.project_id,clock_timestamp())
    ON CONFLICT(system,source_run_id) DO UPDATE SET updated_at=EXCLUDED.updated_at; RETURN NEW; END $$`,
  `DROP TRIGGER IF EXISTS repository_agent_activity ON repository_agent_runs`,
  `CREATE TRIGGER repository_agent_activity AFTER INSERT OR UPDATE ON repository_agent_runs FOR EACH ROW EXECUTE FUNCTION enqueue_agent_activity('repository')`,
  `DROP TRIGGER IF EXISTS workflow_agent_activity ON agentic_workflow_runs`,
  `CREATE TRIGGER workflow_agent_activity AFTER INSERT OR UPDATE ON agentic_workflow_runs FOR EACH ROW EXECUTE FUNCTION enqueue_agent_activity('workflow')`,
  `INSERT INTO agent_activity_outbox(system,source_run_id,project_id) SELECT 'repository',id,project_id FROM repository_agent_runs ON CONFLICT DO NOTHING`,
  `INSERT INTO agent_activity_outbox(system,source_run_id,project_id) SELECT 'workflow',id,project_id FROM agentic_workflow_runs ON CONFLICT DO NOTHING`
];
