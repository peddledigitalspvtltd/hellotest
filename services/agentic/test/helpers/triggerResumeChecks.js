const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
exports.run=async({db,workflow,user,control,finish,cancelledRun,dispatches})=>{
 const triggers=require('../../backend/services/workflowTriggers.service');
 const policy=require('../../backend/workflows/triggerPolicy');
 const resume=require('../../backend/services/workflowResume.service');
 const service=require('../../backend/services/agenticWorkflow.service');
 const make=(trigger_kind,trigger)=>service.createWorkflow({project_id:workflow.project_id,name:`Real ${trigger_kind} fixture`,status:'active',trigger_kind,
 nodes:[{id:'input',data:{kind:'trigger'}},{id:'output',data:{kind:'output'}}],edges:[{id:'in-out',source:'input',target:'output'}],settings:{trigger}},user.id);
 const hook=await make('webhook',{}),credential=await triggers.rotateSecret(hook,user),body={message:'Signed review input'},timestamp=String(Math.floor(Date.now()/1000)),eventId=randomUUID();
 const headers={'x-hellotest-timestamp':timestamp,'x-hellotest-event-id':eventId,'x-hellotest-signature':policy.signature(credential.secret,timestamp,eventId,body)};
 const first=await triggers.webhook(hook.id,headers,body),duplicate=await triggers.webhook(hook.id,headers,body);assert.equal(first.delivery_id,duplicate.delivery_id);
 const changed={message:'Changed input'};
 await assert.rejects(triggers.webhook(hook.id,{...headers,'x-hellotest-signature':policy.signature(credential.secret,timestamp,eventId,changed)},changed),{statusCode:409});
 await assert.rejects(triggers.webhook(hook.id,{...headers,'x-hellotest-signature':'0'.repeat(64)},body),{statusCode:401});
 const savedSecret=await db.prepare('SELECT encrypted FROM workflow_trigger_secrets WHERE workflow_id=?').get(hook.id);assert.ok(!JSON.stringify(savedSecret).includes(credential.secret));
 await triggers.processPending();await control.deliver();
 const hookDelivery=await db.prepare('SELECT * FROM workflow_trigger_deliveries WHERE id=?').get(first.delivery_id);assert.equal(hookDelivery.state,'delivered');
 const hookFinal=await finish({id:hookDelivery.run_id});assert.equal(hookFinal.trigger_kind,'webhook');assert.equal(hookFinal.input_payload.message,body.message);assert.equal(hookFinal.status,'completed');
 const scheduled=await make('schedule',{interval_minutes:10,starts_at:new Date(Date.now()-60000).toISOString()});
 await triggers.processPending();await triggers.processPending();await control.deliver();
 const scheduledRows=await db.prepare('SELECT * FROM workflow_trigger_deliveries WHERE workflow_id=?').all(scheduled.id);assert.equal(scheduledRows.length,1);assert.equal((await finish({id:scheduledRows[0].run_id})).status,'completed');
 const release=await make('release',{state:'released'}),event=await make('event',{event_name:'release.updated'}),releaseId=randomUUID();
 await triggers.processPending();
 await db.prepare("INSERT INTO requirement_releases(id,project_id,name,fix_version,state) VALUES(?,?,?,'fixture-1','planned')").run(releaseId,workflow.project_id,'Real metadata event fixture');
 await db.prepare("UPDATE requirement_releases SET state='released',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(releaseId);
 await triggers.processPending();await triggers.processPending();await control.deliver();
 for(const definition of [release,event]){const rows=await db.prepare('SELECT * FROM workflow_trigger_deliveries WHERE workflow_id=?').all(definition.id);assert.equal(rows.length,1);const final=await finish({id:rows[0].run_id});assert.equal(final.status,'completed');assert.equal(final.input_payload.trigger.entity_id,releaseId);}
 const plan=await resume.preview(cancelledRun.id,'wait',user);
 assert.deepEqual(plan.reuse.map(item=>item.node_id),['input']);
 if(plan.reconciliation_required.length)await assert.rejects(resume.resume(cancelledRun.id,{node_id:'wait',request_id:randomUUID(),source_hash:plan.source_hash},user),{statusCode:409});
 const request={node_id:'wait',request_id:randomUUID(),source_hash:plan.source_hash,reconciliations:plan.reconciliation_required.map(item=>({...item,disposition:'not_applied_or_reverted',note:'Verified the cancelled wait has no external side effects; no operation was applied.'}))};
 const resumed=await resume.resume(cancelledRun.id,request,user),retried=await resume.resume(cancelledRun.id,request,user);assert.equal(resumed.id,retried.id);
 const command=await db.prepare("SELECT payload FROM workflow_delivery_outbox WHERE run_id=? AND command='start'").get(resumed.id);assert.equal(command.payload.scheduler_version,3);assert.equal(command.payload.initial_receipts.length,1);
 await control.deliver();const final=await finish(resumed);assert.equal(final.status,'completed');
 assert.equal(dispatches.filter(item=>item.run_id===resumed.id&&item.node_id==='input').length,0,'Prior verified input is restored, never redispatched.');
 assert.equal(final.workflow_snapshot.runtime_contract.resume.source_run_id,cancelledRun.id);
 return {signed_webhook:true,encrypted_secret:true,duplicate_event_idempotent:true,replay_conflict_blocked:true,schedule_coalescing:true,release_and_project_events:true,receipt_verified_resume:true,resume_v3_replay:true};
};
