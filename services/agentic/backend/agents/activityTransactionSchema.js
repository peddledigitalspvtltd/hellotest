const descriptors=require('./agentDescriptors.service').catalog();
const literal=value=>`'${String(value).replace(/'/g,"''")}'`;
module.exports=[
  `CREATE TABLE IF NOT EXISTS agent_descriptors(system TEXT NOT NULL,agent_id TEXT NOT NULL,descriptor JSONB NOT NULL,descriptor_hash TEXT NOT NULL,PRIMARY KEY(system,agent_id))`,
  ...descriptors.map(descriptor=>`INSERT INTO agent_descriptors(system,agent_id,descriptor,descriptor_hash) VALUES(${literal(descriptor.system)},${literal(descriptor.id)},${literal(JSON.stringify(descriptor))}::jsonb,${literal(descriptor.descriptor_hash)}) ON CONFLICT(system,agent_id) DO UPDATE SET descriptor=EXCLUDED.descriptor,descriptor_hash=EXCLUDED.descriptor_hash`),
  `CREATE OR REPLACE FUNCTION project_transaction_agent_run(source workspace_transactions, reconstructed BOOLEAN DEFAULT false) RETURNS void LANGUAGE plpgsql AS $$
    DECLARE family TEXT; agent TEXT; native TEXT; unified TEXT; definition RECORD; public_status TEXT; BEGIN
    family=CASE WHEN source.related_kind='quality_agent_run' THEN 'quality' WHEN source.category='automation_build' THEN 'automation' WHEN source.related_kind='agentic_assistant_session' THEN 'workflow' ELSE NULL END;
    IF family IS NULL OR source.project_id IS NULL THEN RETURN; END IF;
    agent=CASE WHEN family='quality' THEN COALESCE(source.metadata#>>'{request,kind}','web') WHEN family='automation' THEN 'browser' ELSE COALESCE(source.metadata->>'agent_id','quality-orchestrator') END;
    SELECT * INTO definition FROM agent_descriptors WHERE system=family AND agent_id=agent;
    IF NOT FOUND THEN SELECT * INTO definition FROM agent_descriptors WHERE system=family ORDER BY agent_id LIMIT 1; END IF;
    IF definition IS NULL THEN RETURN; END IF;
    IF source.metadata#>>'{agent_descriptor,schema_version}'='agent-descriptor/1' AND source.metadata#>>'{agent_descriptor,system}'=family THEN
      definition.descriptor=source.metadata->'agent_descriptor';definition.descriptor_hash=source.metadata->>'agent_descriptor_hash';
    END IF;
    native=COALESCE(source.metadata->>'run_status',source.status,'unknown');
    public_status=CASE WHEN native IN ('completed','complete','passed','succeeded') THEN 'succeeded' WHEN native IN ('cancelled','canceled','aborted','stopped') THEN 'cancelled' WHEN native IN ('interrupted','incident','outcome_unknown','unknown') THEN 'unknown' WHEN native IN ('needs_input','needs_review','waiting','blocked','approval_required') THEN 'waiting' WHEN native IN ('queued','running','partial','failed') THEN native ELSE 'unknown' END;
    unified=family||':'||source.id;
    INSERT INTO agent_runs(id,system,source_run_id,project_id,app_type_id,actor_id,agent_id,descriptor,descriptor_hash,status,native_status,progress,title,payload,started_at,completed_at,created_at,updated_at)
    VALUES(unified,family,source.id,source.project_id,source.app_type_id,source.created_by,agent,definition.descriptor,definition.descriptor_hash,public_status,native,
      LEAST(100,GREATEST(0,CASE WHEN source.metadata->>'progress' ~ '^[0-9]{1,3}$' THEN (source.metadata->>'progress')::int WHEN public_status='succeeded' THEN 100 ELSE 0 END)),
      definition.descriptor->>'name',jsonb_strip_nulls(jsonb_build_object('source_kind',source.related_kind,'native_run_id',COALESCE(source.metadata->>'id',source.id),'transaction_id',source.id,'requires_human_review',true,'descriptor_reconstructed',reconstructed,'system_message_hash',source.metadata->>'system_message_hash','prompt_hash',source.metadata->>'prompt_hash','prompt_template_version',source.metadata->>'prompt_template_version','agent_version',source.metadata->'agent_version')),
      source.started_at,source.completed_at,source.created_at,source.updated_at)
    ON CONFLICT(system,source_run_id) DO UPDATE SET status=EXCLUDED.status,native_status=EXCLUDED.native_status,progress=EXCLUDED.progress,payload=agent_runs.payload||EXCLUDED.payload||jsonb_build_object('descriptor_reconstructed',COALESCE(agent_runs.payload->'descriptor_reconstructed','false'::jsonb)),started_at=EXCLUDED.started_at,completed_at=EXCLUDED.completed_at,updated_at=EXCLUDED.updated_at,synchronized_at=clock_timestamp(); RETURN; END $$`,
  `CREATE OR REPLACE FUNCTION mirror_transaction_agent_run() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM project_transaction_agent_run(NEW,false); RETURN NEW; END $$`,
  `DROP TRIGGER IF EXISTS workspace_agent_run ON workspace_transactions`,
  `CREATE TRIGGER workspace_agent_run AFTER INSERT OR UPDATE ON workspace_transactions FOR EACH ROW EXECUTE FUNCTION mirror_transaction_agent_run()`,
  `CREATE OR REPLACE FUNCTION project_transaction_agent_event(source workspace_transaction_events) RETURNS void LANGUAGE plpgsql AS $$ DECLARE target TEXT; safe_details JSONB; BEGIN
    SELECT id INTO target FROM agent_runs WHERE source_run_id=source.transaction_id;
    IF target IS NULL THEN RETURN; END IF;
    safe_details=jsonb_strip_nulls(jsonb_build_object('native_event_id',source.id,'details_retained_at_source',true,
      'duration_ms',CASE WHEN source.details->>'duration_ms' ~ '^[0-9]{1,10}(\\.[0-9]{1,6})?$' THEN LEAST(3600000,(source.details->>'duration_ms')::numeric) END,
      'code',CASE WHEN COALESCE(source.details->>'code',source.details->>'error_code') ~ '^[A-Z][A-Z0-9_]{0,79}$' THEN COALESCE(source.details->>'code',source.details->>'error_code') END,
      'tool',CASE WHEN source.details->>'tool' IN ('project_evidence','knowledge_search','record_read','graph_read') THEN source.details->>'tool' END,
      'trace_id',CASE WHEN source.details->>'trace_id' ~ '^([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$' THEN source.details->>'trace_id' END,
      'model_calls',CASE WHEN source.details->>'model_calls' ~ '^[0-9]{1,4}$' THEN (source.details->>'model_calls')::int END));
    INSERT INTO agent_run_events(id,run_id,source_event_id,phase,level,message,payload,occurred_at)
    VALUES(target||':'||source.id,target,source.id,COALESCE(source.phase,'activity'),source.level,COALESCE(source.phase,'activity'),safe_details,source.created_at)
    ON CONFLICT(run_id,source_event_id) DO NOTHING; RETURN; END $$`,
  `CREATE OR REPLACE FUNCTION mirror_transaction_agent_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM project_transaction_agent_event(NEW); RETURN NEW; END $$`,
  `DROP TRIGGER IF EXISTS workspace_agent_event ON workspace_transaction_events`,
  `CREATE TRIGGER workspace_agent_event AFTER INSERT ON workspace_transaction_events FOR EACH ROW EXECUTE FUNCTION mirror_transaction_agent_event()`,
  // Historical rows are backfilled once and keep their reconstructed descriptor
  // provenance. Subsequent source updates retain the original snapshot.
  `SELECT project_transaction_agent_run(t,true) FROM workspace_transactions t WHERE project_id IS NOT NULL AND (related_kind IN ('agentic_assistant_session','quality_agent_run') OR category='automation_build') AND NOT EXISTS(SELECT 1 FROM agent_runs r WHERE r.source_run_id=t.id)`,
  `SELECT project_transaction_agent_event(e) FROM workspace_transaction_events e WHERE EXISTS(SELECT 1 FROM agent_runs r WHERE r.source_run_id=e.transaction_id) AND NOT EXISTS(SELECT 1 FROM agent_run_events a WHERE a.source_event_id=e.id)`
];
