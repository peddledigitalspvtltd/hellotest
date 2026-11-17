const assert=require('node:assert/strict');
async function verify(client,schemas){
 await client.query('BEGIN');
 try{
  await client.query('CREATE SCHEMA agent_activity_rollback_check');
  await client.query('SET LOCAL search_path=agent_activity_rollback_check,public');
  await client.query(`CREATE TABLE workspace_transactions(id TEXT PRIMARY KEY,project_id TEXT,app_type_id TEXT,created_by TEXT,related_kind TEXT,category TEXT,status TEXT,metadata JSONB DEFAULT '{}'::jsonb,started_at TIMESTAMPTZ,completed_at TIMESTAMPTZ,created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP); CREATE TABLE workspace_transaction_events(id TEXT PRIMARY KEY,transaction_id TEXT,phase TEXT,level TEXT,details JSONB DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP); CREATE TABLE repository_agent_runs(id TEXT PRIMARY KEY,project_id TEXT); CREATE TABLE agentic_workflow_runs(id TEXT PRIMARY KEY,project_id TEXT)`);
  await client.query(`INSERT INTO workspace_transactions(id,project_id,related_kind,category,status,metadata)VALUES('historical','p','agentic_assistant_session','agentic','completed','{"agent_id":"story-architect","prompt":"PRIVATE_DO_NOT_COPY"}'); INSERT INTO workspace_transaction_events(id,transaction_id,phase,level,details)VALUES('historical-event','historical','model.call','info','{"duration_ms":12,"code":"MODEL_TIMEOUT","prompt":"PRIVATE_DO_NOT_COPY"}')`);
  for(const sql of schemas)await client.query(sql);
  const read=async id=>(await client.query('SELECT * FROM agent_runs WHERE source_run_id=$1',[id])).rows[0];
  let run=await read('historical');assert.equal(run.status,'succeeded');assert.equal(run.payload.descriptor_reconstructed,true);
  assert.equal((await client.query('SELECT COUNT(*) AS n FROM agent_descriptors')).rows[0].n,'32');
  await client.query(`UPDATE workspace_transactions SET status='failed',metadata=metadata||'{"run_status":"cancelled"}' WHERE id='historical'`);run=await read('historical');assert.equal(run.status,'cancelled');assert.equal(run.payload.descriptor_reconstructed,true);
  await client.query(`INSERT INTO workspace_transactions(id,project_id,related_kind,category,status,metadata)VALUES('native-quality','p','quality_agent_run','agentic','failed','{"request":{"kind":"web"},"run_status":"cancelled"}'),('native-automation','p','build','automation_build','running','{}')`);
  assert.equal((await read('native-quality')).system,'quality');assert.equal((await read('native-quality')).status,'cancelled');assert.equal((await read('native-automation')).system,'automation');
  const event=(await client.query("SELECT payload FROM agent_run_events WHERE source_event_id='historical-event'")).rows[0].payload;assert.equal(event.duration_ms,12);assert.equal(event.code,'MODEL_TIMEOUT');assert.doesNotMatch(JSON.stringify(event),/PRIVATE_DO_NOT_COPY/);
  await client.query("INSERT INTO repository_agent_runs(id,project_id)VALUES('repo','p'); INSERT INTO agentic_workflow_runs(id,project_id)VALUES('workflow','p')");
  assert.equal((await client.query('SELECT COUNT(*) AS n FROM agent_activity_outbox')).rows[0].n,'2');
  await client.query("UPDATE agent_activity_outbox SET updated_at='2026-11-17T01:02:03.123456Z' WHERE source_run_id='repo'");
  const version=(await client.query("SELECT updated_at::text AS version FROM agent_activity_outbox WHERE source_run_id='repo'")).rows[0].version;
  assert.equal((await client.query("DELETE FROM agent_activity_outbox WHERE source_run_id='repo' AND updated_at::text=$1 RETURNING source_run_id",[version])).rowCount,1);
  const old=(await client.query("SELECT updated_at::text AS version FROM agent_activity_outbox WHERE source_run_id='workflow'")).rows[0].version;
  await client.query("UPDATE agent_activity_outbox SET updated_at=updated_at+INTERVAL '1 microsecond' WHERE source_run_id='workflow'");
  assert.equal((await client.query("DELETE FROM agent_activity_outbox WHERE source_run_id='workflow' AND updated_at::text=$1 RETURNING source_run_id",[old])).rowCount,0);

  assert.doesNotMatch(JSON.stringify((await client.query('SELECT * FROM agent_runs')).rows),/PRIVATE_DO_NOT_COPY/);
  return {schema_and_trigger_checks:'passed',descriptor_count:32,historical_backfill:true,descriptor_provenance_retained:true,native_cancellation:true,event_metadata:true,separate_store_outbox:true,microsecond_delivery_acknowledgment:true,concurrent_update_preserved:true,private_values_not_copied:true,rollback:true};
 }finally{await client.query('ROLLBACK');}
}
module.exports={verify};
