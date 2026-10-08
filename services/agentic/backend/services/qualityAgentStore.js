// Runs and reviewed images live in the existing PostgreSQL observability store.
// Lease-guarded JSON updates prevent cancellation or another worker being overwritten.
const { randomUUID } = require('node:crypto');
const RUN = 'quality_agent_run', BASELINE = 'quality_agent_baseline';
function createQualityAgentStore({ db, workspace }) {
  const find = (kind, id) => db.prepare('SELECT * FROM workspace_transactions WHERE related_kind = ? AND related_id = ? ORDER BY created_at DESC LIMIT 1').get(kind,id);
  const list = (kind, scope) => workspace.listTransactions({ ...scope,related_kind:kind,include_global:false,limit:50 });
  return {
    findRun:id=>find(RUN,id),findBaseline:id=>find(BASELINE,id),
    listRuns:scope=>list(RUN,scope),listBaselines:scope=>list(BASELINE,scope),
    async create(input, user, metadata, key) {
      return db.transaction(async()=>{
        await db.query('SELECT pg_advisory_xact_lock(hashtext(?))',[`quality-agent-create:${input.project_id}:${user.id}`]);
        if (key) {
          const prior=await db.prepare("SELECT * FROM workspace_transactions WHERE related_kind = ? AND project_id = ? AND created_by = ? AND metadata->>'request_key' = ? ORDER BY created_at DESC LIMIT 1").get(RUN,input.project_id,user.id,key);
          if (prior) return {row:prior,existing:true};
        }
        const busy=await db.prepare("SELECT count(*)::integer AS total FROM workspace_transactions WHERE related_kind = ? AND project_id = ? AND created_by = ? AND status IN ('queued','running')").get(RUN,input.project_id,user.id);
        if (busy.total>=3) return {busy:true};
        const {id}=await workspace.createTransaction({project_id:input.project_id,app_type_id:input.app_type_id,category:'agentic',action:'quality_agent_run',status:'queued',title:`${input.kind} quality review`,related_kind:RUN,related_id:metadata.id,created_by:user.id,metadata});
        return {row:await db.prepare('SELECT * FROM workspace_transactions WHERE id = ?').get(id),existing:false};
      })();
    },
    async claim() {
      return db.transaction(async()=>{
        const row=await db.prepare(`SELECT * FROM workspace_transactions WHERE related_kind = ? AND status IN ('queued','running')
          AND COALESCE((metadata->>'lease_until')::timestamptz,'epoch'::timestamptz) < CURRENT_TIMESTAMP
          AND COALESCE((metadata->>'next_poll_at')::timestamptz,'epoch'::timestamptz) <= CURRENT_TIMESTAMP
          ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`).get(RUN);
        if (!row) return null;
        const lease_token=randomUUID();
        return db.prepare(`UPDATE workspace_transactions SET metadata = metadata || jsonb_build_object('lease_token',?::text,'lease_until',(CURRENT_TIMESTAMP + INTERVAL '60 seconds')::text)
          WHERE id = ? RETURNING *`).get(lease_token,row.id);
      })();
    },
    async checkpoint(row,patch) {
      return db.prepare(`UPDATE workspace_transactions SET metadata = metadata || ?::jsonb, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND metadata->>'lease_token' = ? AND status IN ('queued','running') RETURNING *`).get({...patch,lease_until:new Date(Date.now()+60000).toISOString()},row.id,row.metadata.lease_token);
    },
    async updateClaim(row, patch, status) {
      return db.prepare(`UPDATE workspace_transactions SET metadata = metadata || ?::jsonb,
        status = ?, started_at = COALESCE(started_at,?::timestamptz),completed_at = COALESCE(?::timestamptz,completed_at),updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND metadata->>'lease_token' = ? AND status IN ('queued','running') RETURNING *`).get(
          {...patch,lease_until:null,lease_token:null,next_poll_at:new Date(Date.now()+2000).toISOString()},status,patch.started_at||null,patch.completed_at||null,row.id,row.metadata.lease_token);
    },
    async cancel(row) {
      return db.prepare(`UPDATE workspace_transactions SET status = 'failed',metadata = metadata || ?::jsonb,completed_at = CURRENT_TIMESTAMP,updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status IN ('queued','running') RETURNING *`).get({run_status:'cancelled',cancellation_requested:true,lease_token:null,lease_until:null,error:null,outcome:null,stages:(row.metadata?.stages||[]).map(stage=>stage.status==='running'?{...stage,status:'failed'}:stage),...(row.metadata?.mission_report?{mission_report:{...row.metadata.mission_report,status:'cancelled',summary:'Stopped. Partial browser observations are preserved.'}}:{})},row.id);
    },
    event:(row,entry)=>workspace.appendTransactionEvent(row.id,entry),
    async saveBaseline(row, metadata, bytes) {
      return db.transaction(async()=>{
        await db.query('SELECT pg_advisory_xact_lock(hashtext(?))',[`quality-agent-baseline:${row.related_id}`]);
        const prior=await db.prepare("SELECT * FROM workspace_transactions WHERE related_kind = ? AND project_id = ? AND metadata->>'source_run_id' = ? AND metadata->>'source_artifact_id' = ? LIMIT 1").get(BASELINE,row.project_id,row.related_id,metadata.source_artifact_id);
        if (prior) return prior;
        const {id}=await workspace.createTransaction({project_id:row.project_id,app_type_id:row.app_type_id,category:'agentic',action:'quality_agent_baseline',status:'completed',title:metadata.label,related_kind:BASELINE,related_id:metadata.id,created_by:metadata.reviewed_by,metadata});
        const artifact=await workspace.createTransactionArtifact(id,{file_name:'reviewed-baseline.png',mime_type:'image/png',content:bytes.toString('base64')});
        return db.prepare('UPDATE workspace_transactions SET metadata = metadata || ?::jsonb WHERE id = ? RETURNING *').get({stored_artifact_id:artifact.id},id);
      })();
    },
    artifact:id=>workspace.getTransactionArtifact(id)
  };
}
module.exports={createQualityAgentStore,RUN,BASELINE};
