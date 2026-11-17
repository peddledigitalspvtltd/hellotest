const db=require('@hellotest/platform/backend/src/db');
const policy=require('../workflows/triggerPolicy');
const crypto=require('node:crypto');
const fail=policy.fail;
const parse=value=>typeof value==='string'?JSON.parse(value):value;
const hydrate=row=>row&&({...row,nodes:parse(row.nodes),edges:parse(row.edges),settings:parse(row.settings)});
const store={
 workflow:async id=>hydrate(await db.prepare('SELECT * FROM agentic_workflows WHERE id=?').get(id)),
 actor:async id=>db.prepare("SELECT id,email,name,is_workspace_admin,CASE WHEN is_workspace_admin THEN 'admin' ELSE 'member' END AS role FROM users WHERE id=? AND status='active'").get(id),
 secret:async id=>db.prepare('SELECT encrypted FROM workflow_trigger_secrets WHERE workflow_id=?').get(id),
};
async function requireActor(workflow) {
 const user=await store.actor(workflow.updated_by||workflow.created_by);
 if(!user)throw fail('The workflow owner is no longer active. Save it as an authorized user.',403);
 await require('./agenticWorkflowExecution.service')._internals.requireRunAccess(user,workflow.project_id);
 const event=policy.config(workflow).event_name||'release.updated';
 if(['release','event'].includes(workflow.trigger_kind)) {
  const permission=({story:'requirement.view',test_case:'testcase.view',bug:'feedback.view',run:'run.view',release:'requirement.view'})[event.split('.')[0]];
  if(!await require('@hellotest/platform/backend/services/permission.service').hasPermission(user,permission,workflow.project_id))throw fail('The workflow owner cannot read the triggering project entity.',403);
 }
 return user;
}
function assertActive(workflow) {
 if(!workflow||workflow.status!=='active'||workflow.trigger_kind==='manual')throw fail('Activate a configured workflow before delivering trigger events.',409);
 if(!require('../workflows/temporal/control').enabled())throw fail('Unattended triggers require the durable Temporal worker.',503);
 policy.config(workflow);
}
async function sync(workflow) {
 if(!workflow||workflow.trigger_kind==='manual')return;
 const hash=policy.definitionHash(workflow);
 // Baseline at the saved definition's timestamp. Subsequent committed events
 // survive scanner downtime and are never inferred from mutable entity rows.
 await db.prepare(`INSERT INTO workflow_trigger_state(workflow_id,definition_hash,event_cursor)
 SELECT ?,?,COALESCE(MAX(id),0) FROM workflow_project_events WHERE occurred_at < ?
 ON CONFLICT(workflow_id) DO UPDATE SET definition_hash=EXCLUDED.definition_hash,event_cursor=EXCLUDED.event_cursor,updated_at=CURRENT_TIMESTAMP
 WHERE workflow_trigger_state.definition_hash<>EXCLUDED.definition_hash`).run(workflow.id,hash,workflow.updated_at||workflow.created_at);
}
async function enqueue(workflow,eventKey,payload) {
 const hash=policy.definitionHash(workflow), payloadHash=policy.digest(payload), id='trigger-'+policy.digest([workflow.id,eventKey]).slice(0,48);
 if(Buffer.byteLength(JSON.stringify(payload))>16*1024)throw fail('Trigger input exceeds the 16 KB workflow limit.');
 return db.transaction(async()=>{
 const saved=hydrate(await db.prepare('SELECT * FROM agentic_workflows WHERE id=? FOR UPDATE').get(workflow.id));
 if(!saved||saved.status!=='active'||policy.definitionHash(saved)!==hash)throw fail('The workflow definition changed. Redeliver a new event after reviewing its current trigger.',409);
 const existing=await db.prepare('SELECT id,payload_hash,definition_hash,run_id,state FROM workflow_trigger_deliveries WHERE workflow_id=? AND event_key=?').get(workflow.id,eventKey);
 if(!existing){const count=await db.prepare("SELECT COUNT(*) AS count FROM workflow_trigger_deliveries WHERE workflow_id=? AND state='pending'").get(workflow.id);if(Number(count.count)>=100)throw fail('This workflow already has 100 waiting events. Resolve its delivery backlog.',429);}
 await db.prepare(`INSERT INTO workflow_trigger_deliveries(id,workflow_id,project_id,actor_id,trigger_kind,event_key,definition_hash,payload_hash,payload)
 VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(workflow_id,event_key) DO NOTHING`).run(id,workflow.id,workflow.project_id,workflow.updated_by||workflow.created_by,workflow.trigger_kind,eventKey,hash,payloadHash,payload);
 const row=await db.prepare('SELECT id,payload_hash,definition_hash,run_id,state FROM workflow_trigger_deliveries WHERE workflow_id=? AND event_key=?').get(workflow.id,eventKey);
 if(row.payload_hash!==payloadHash||row.definition_hash!==hash)throw fail('This event ID was already used with different input or a changed definition.',409);
 return {delivery_id:row.id,run_id:row.run_id||null,state:row.state};
 })();
}
async function rotateSecret(workflow,user) {
 if(workflow.trigger_kind!=='webhook')throw fail('Choose Webhook and save the workflow before rotating its signing secret.');
 const secret=crypto.randomBytes(32).toString('base64url');
 const encrypted=require('../workflows/connectionSettings').sealCredential(secret,'workflow-trigger:'+workflow.id);
 await db.prepare(`INSERT INTO workflow_trigger_secrets(workflow_id,encrypted,rotated_by) VALUES(?,?,?)
 ON CONFLICT(workflow_id) DO UPDATE SET encrypted=EXCLUDED.encrypted,rotated_by=EXCLUDED.rotated_by,rotated_at=CURRENT_TIMESTAMP`).run(workflow.id,encrypted,user.id);
 return {secret,endpoint:`/agentic-workflow-hooks/${encodeURIComponent(workflow.id)}`,algorithm:'HMAC-SHA256',max_clock_skew_seconds:300,signing_input:'timestamp + "\\n" + event_id + "\\n" + canonical JSON body (sorted object keys)'};
}
async function webhook(id,headers,body) {
 const workflow=await store.workflow(id);assertActive(workflow);
 if(workflow.trigger_kind!=='webhook')throw fail('Webhook is unavailable.',404);
 const row=await store.secret(id);if(!row)throw fail('Configure the workflow signing secret first.',409);
 const secret=require('../workflows/connectionSettings').credential({id:'workflow-trigger:'+id,encryptedSecret:parse(row.encrypted)});
 const eventId=policy.verifySignature(secret,headers,body);
 await requireActor(workflow);
 if(!body||typeof body!=='object'||Array.isArray(body))throw fail('Webhook input must be a JSON object.');
 return enqueue(workflow,'webhook:'+eventId,{...policy.config(workflow).input_payload,...body});
}
let processing=false;
async function processPending() {
 if(processing||!require('../workflows/temporal/control').enabled())return;
 processing=true;
 try {
  const workflows=(await db.prepare("SELECT workflow.* FROM agentic_workflows workflow LEFT JOIN workflow_trigger_state state ON state.workflow_id=workflow.id WHERE workflow.status='active' AND workflow.trigger_kind IN ('schedule','release','event') ORDER BY COALESCE(state.last_polled_at,'epoch'::timestamptz),workflow.updated_at,workflow.id LIMIT 100").all()).map(hydrate);
  for(const workflow of workflows) {
   await sync(workflow);
   try {
    assertActive(workflow);await requireActor(workflow);
    const config=policy.config(workflow);
    if(workflow.trigger_kind==='schedule') {
     const slot=policy.scheduleSlot(workflow);if(slot)await enqueue(workflow,'schedule:'+policy.definitionHash(workflow).slice(0,16)+':'+slot,{...config.input_payload,trigger:{kind:'schedule',scheduled_at:slot}});
    } else await db.transaction(async()=>{
     const current=hydrate(await db.prepare('SELECT * FROM agentic_workflows WHERE id=? FOR UPDATE').get(workflow.id));
     if(!current||policy.definitionHash(current)!==policy.definitionHash(workflow))return;
     const state=await db.prepare('SELECT * FROM workflow_trigger_state WHERE workflow_id=? FOR UPDATE').get(workflow.id);
     const events=await db.prepare(`SELECT event.* FROM workflow_project_events event WHERE project_id=? AND occurred_at>=?::timestamptz
 AND NOT EXISTS (SELECT 1 FROM workflow_trigger_event_scans scan WHERE scan.workflow_id=? AND scan.event_id=event.id) ORDER BY id LIMIT 100`).all(workflow.project_id,workflow.updated_at||workflow.created_at,workflow.id);
     for(const event of events) {
      const matches=workflow.trigger_kind==='event'?event.event_name===config.event_name:event.event_name.startsWith('release.')&&(!config.release_id||config.release_id===event.entity_id)&&(!config.state||config.state===event.current_state&&event.previous_state!==event.current_state);
      if(matches&&(!workflow.app_type_id||!event.app_type_id||event.app_type_id===workflow.app_type_id))await enqueue(workflow,'event:'+event.id,{...config.input_payload,trigger:{kind:workflow.trigger_kind,event_id:String(event.id),event_name:event.event_name,entity_id:event.entity_id,current_state:event.current_state,previous_state:event.previous_state,occurred_at:event.occurred_at}});
     }
     for(const event of events)await db.prepare('INSERT INTO workflow_trigger_event_scans(workflow_id,event_id) VALUES(?,?) ON CONFLICT DO NOTHING').run(workflow.id,event.id);
    })();
   }catch(error){ if(!error.statusCode||error.statusCode>=500)throw error; }finally{await db.prepare("UPDATE workflow_trigger_state SET last_polled_at=clock_timestamp() WHERE workflow_id=?").run(workflow.id); }
  }
  // Row locks serialize competing delivery processes. A lost
  // start acknowledgement is safe: the delivery ID is the immutable request ID.
  const rows=await db.prepare("SELECT id FROM workflow_trigger_deliveries WHERE state='pending' AND next_attempt_at<=CURRENT_TIMESTAMP ORDER BY created_at,id LIMIT 20").all();
  for(const item of rows)await db.transaction(async()=>{
   const row=await db.prepare("SELECT * FROM workflow_trigger_deliveries WHERE id=? AND state='pending' FOR UPDATE SKIP LOCKED").get(item.id);if(!row)return;
   try {
    const workflow=await store.workflow(row.workflow_id);assertActive(workflow);
    if(policy.definitionHash(workflow)!==row.definition_hash)throw fail('The workflow changed after this event was accepted. Review and redeliver a new event.',409);
    const user=await requireActor(workflow);
    const run=await require('./agenticWorkflowExecution.service').startTriggered(workflow,{request_id:row.id,input_payload:parse(row.payload)},user,row.trigger_kind);
    await db.prepare("UPDATE workflow_trigger_deliveries SET state='delivered',run_id=?,delivered_at=CURRENT_TIMESTAMP,last_error=NULL WHERE id=?").run(run.id,row.id);
   }catch(error){
    const blocked=error.statusCode&&error.statusCode<500;
    await db.prepare("UPDATE workflow_trigger_deliveries SET state=?,attempts=attempts+1,last_error=?,next_attempt_at=CURRENT_TIMESTAMP+INTERVAL '30 seconds' WHERE id=?").run(blocked||row.attempts>=9?'blocked':'pending',blocked?'TRIGGER_REQUIRES_REVIEW':'TRIGGER_DELIVERY_UNAVAILABLE',row.id);
   }
  })();
 }finally{processing=false;}
}
async function status(workflow) {
 return {durable_enabled:require('../workflows/temporal/control').enabled(),secret_configured:Boolean(await store.secret(workflow.id)),endpoint:`/agentic-workflow-hooks/${encodeURIComponent(workflow.id)}`,deliveries:await db.prepare('SELECT id,trigger_kind,event_key,state,run_id,attempts,last_error,created_at,delivered_at FROM workflow_trigger_deliveries WHERE workflow_id=? ORDER BY created_at DESC LIMIT 20').all(workflow.id)};
}
module.exports={sync,webhook,rotateSecret,processPending,status,_internals:{store,enqueue,requireActor}};
