const db = require('@hellotest/platform/backend/src/db');
const obsDb = require('@hellotest/platform/backend/src/obsDb');
const {createHash,randomUUID}=require('node:crypto');
const fail=(message,statusCode=400,code='INVALID_AUTOMATION_SELECTION')=>Object.assign(new Error(message),{statusCode,code});

function normalizeSelection(input={}) {
  if(typeof input.project_id!=='string'||!input.project_id.trim()||typeof input.app_type_id!=='string'||!input.app_type_id.trim())throw fail('Project and application are required.');
  if(!Array.isArray(input.test_case_ids)||!input.test_case_ids.length||input.test_case_ids.length>10000)throw fail('Select between 1 and 10,000 automation cases.');
  if(input.test_case_ids.some(id=>typeof id!=='string'||!id.trim()||id.trim().length>255))throw fail('Each selected automation case must have a valid record ID.');
  return {project_id:input.project_id.trim(),app_type_id:input.app_type_id.trim(),test_case_ids:[...new Set(input.test_case_ids.map(id=>id.trim()))].sort()};
}

exports.normalizeSelection=normalizeSelection;
exports.deleteAutomationCases=async(input,{actorId=null,ipAddress=null}={})=>{
  const selection=normalizeSelection(input);
  const encoded=JSON.stringify(selection.test_case_ids);
  const selectionKey=createHash('sha256').update(JSON.stringify([selection.project_id,selection.app_type_id,actorId,selection.test_case_ids])).digest('hex');
  return db.transaction(async()=>{
    // The selection lock also makes a lost-response retry return its committed
    // receipt rather than treating already deleted records as a new failure.
    await db.query('SELECT pg_advisory_xact_lock(hashtext(?),hashtext(?))',['hellotest.automation-delete',selectionKey]);
    const replay=await db.prepare(`SELECT metadata->'receipt' AS receipt FROM admin_audit_log
      WHERE action='automation_case.bulk_delete' AND metadata->>'selection_key'=?
        AND metadata->>'project_id'=? AND metadata->>'app_type_id'=?
        AND actor_id IS NOT DISTINCT FROM ? ORDER BY created_at DESC LIMIT 1`).get(selectionKey,selection.project_id,selection.app_type_id,actorId);
    if(replay?.receipt)return {...replay.receipt,idempotent_replay:true};
    const app=await db.prepare('SELECT id,project_id FROM app_types WHERE id=? FOR SHARE').get(selection.app_type_id);
    if(!app||app.project_id!==selection.project_id)throw fail('The application does not belong to the selected project.',403,'AUTOMATION_SCOPE_MISMATCH');
    // A generator can target either the AT itself or its original manual case.
    // One application lock serializes both aliases and avoids allocating up
    // to 20,000 advisory locks for a supported 10,000-case bulk selection.
    await db.query("SELECT pg_advisory_xact_lock(hashtext('hellotest.automation-build'),hashtext(?))",[selection.app_type_id]);
    const cases=await db.prepare(`SELECT id,display_id,title,app_type_id,automated,source_idempotency_key
      FROM test_cases WHERE id IN(SELECT jsonb_array_elements_text(?::jsonb)) ORDER BY id FOR UPDATE`).all(encoded);
    if(cases.length!==selection.test_case_ids.length)throw fail('One or more selected automation cases no longer exist. Refresh the list before deleting.',409,'AUTOMATION_SELECTION_CHANGED');
    if(cases.some(item=>item.app_type_id!==selection.app_type_id||item.automated!=='yes'))throw fail('Every selected record must be an automation case in this application.',403,'AUTOMATION_SCOPE_MISMATCH');
    const buildIds=JSON.stringify([...new Set([...selection.test_case_ids,...cases.map(item=>item.source_idempotency_key?.startsWith('automation-builder:')?item.source_idempotency_key.slice('automation-builder:'.length):null).filter(Boolean)])]);
    // This release requires both adapters to use the same physical database.
    // Use this transaction's connection for generator locks and cancellation:
    // an independent observability transaction could commit cancellation even
    // when deleting a case later fails. The worker's conditional claim waits
    // on these rows and cannot acquire a cancelled job after deletion commits.
    const generators=await db.prepare(`SELECT id,transaction_id,status,attempts,started_at,completed_at,leased_by,lease_expires_at
      FROM automation_generator_jobs WHERE project_id=? AND app_type_id=?
        AND status IN('queued','leased','running') AND test_case_id IN(SELECT jsonb_array_elements_text(?::jsonb)) ORDER BY id FOR UPDATE`).all(selection.project_id,selection.app_type_id,buildIds);
    const cancellableGenerators=generators.filter(job=>job.status==='queued'&&Number(job.attempts)===0&&!job.started_at&&!job.completed_at&&!job.leased_by&&!job.lease_expires_at);
    const activeGenerator=generators.length!==cancellableGenerators.length;
    const [activeBatch,engineRuns,directRuns]=await Promise.all([
      obsDb.prepare(`SELECT job.id FROM batch_process_jobs job JOIN workspace_transactions tx ON tx.id=job.transaction_id
        WHERE tx.project_id=? AND job.status IN('queued','running') AND job.operation='automation_build'
        AND job.payload->>'app_type_id'=? AND (EXISTS(SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(job.payload->'test_case_ids')='array' THEN job.payload->'test_case_ids' ELSE '[]'::jsonb END) selected(id)
          WHERE selected.id IN(SELECT jsonb_array_elements_text(?::jsonb))) OR (?::boolean AND CASE WHEN jsonb_typeof(job.payload->'test_case_ids')='array' THEN jsonb_array_length(job.payload->'test_case_ids') ELSE 0 END=0)) LIMIT 1`).get(selection.project_id,selection.app_type_id,buildIds,cases.some(item=>item.source_idempotency_key?.startsWith('automation-builder:'))),
      obsDb.prepare(`SELECT DISTINCT execution_id FROM test_engine_jobs WHERE project_id=?
        AND test_case_id IN(SELECT jsonb_array_elements_text(?::jsonb)) AND status IN('queued','leased','running') AND completed_at IS NULL`).all(selection.project_id,encoded),
      obsDb.prepare(`SELECT tx.id,tx.related_id,tx.started_at,tx.created_at,tx.metadata,tx.metadata->>'execution_id' AS execution_id FROM workspace_transactions tx
        WHERE tx.project_id=? AND tx.action='testengine_run' AND tx.status IN('queued','running')
        AND COALESCE(tx.metadata->>'callback_final_received','false')<>'true'
        AND tx.metadata->>'test_case_id' IN(SELECT jsonb_array_elements_text(?::jsonb))
        AND NOT EXISTS(SELECT 1 FROM test_engine_jobs job WHERE job.engine_run_id=tx.related_id OR job.transaction_id=tx.id)`).all(selection.project_id,encoded)
    ]);
    // A direct runner does not own a durable queue job. Old activity alone can
    // survive a runner restart, so require authenticated, case-scoped evidence
    // before treating that dispatch as finished or abandoned.
    const reconciledDirectRuns=[];
    if(!activeGenerator&&!activeBatch){
      const deadline=Date.now()+6000;
      const directActiveExecutions=await db.prepare(`SELECT id FROM executions WHERE project_id=?
        AND id IN(SELECT jsonb_array_elements_text(?::jsonb)) AND status IN('queued','running','retrying') AND ended_at IS NULL`).all(selection.project_id,JSON.stringify(directRuns.map(row=>row.execution_id)));
      const activeIds=new Set(directActiveExecutions.map(row=>row.id));
      for(const transaction of directRuns.filter(row=>activeIds.has(row.execution_id)).sort((a,b)=>String(a.related_id).localeCompare(String(b.related_id)))){
        const proof=await require('./automationDeletionReconciliation').inspectDirectRun(transaction,{deadline});
        if(!proof)continue;
        // Match the final-callback lock before re-reading its receipt. A final
        // delivery that arrived while the runner was inspected takes priority.
        await db.query('SELECT pg_advisory_xact_lock(hashtext(?),hashtext(?))',['hellotest.engine-callback',transaction.related_id]);
        const current=await db.prepare('SELECT * FROM workspace_transactions WHERE id=? FOR UPDATE').get(transaction.id);
        if(!current||current.project_id!==selection.project_id||current.metadata?.execution_id!==transaction.execution_id
          ||current.metadata?.test_case_id!==transaction.metadata.test_case_id||current.related_id!==transaction.related_id
          ||current.metadata?.engine_run_id!==transaction.metadata.engine_run_id||current.metadata?.engine_host!==transaction.metadata.engine_host)continue;
        if(current.metadata?.callback_final_received||!['queued','running'].includes(current.status)){
          reconciledDirectRuns.push({transaction_id:current.id,engine_run_id:current.related_id,outcome:'final_receipt'});
          continue;
        }
        const abandoned=proof.outcome==='abandoned';
        const message=abandoned?'The authenticated local runner no longer has this dispatched attempt. It was retained as abandoned; no passing outcome was inferred.'
          :'The authenticated local runner confirms this attempt has finished. Its saved results and any subsequent final evidence remain independent.';
        const metadata={deletion_reconciliation:proof,current_phase:abandoned?'run.abandoned':'run.finished',phase_message:message};
        // Only missing attempts are fenced. A finished runner may still retry
        // its signed final report, which can enrich the frozen historical run.
        if(abandoned)Object.assign(metadata,{callback_final_received:true,abandoned:true});
        await db.prepare(`UPDATE workspace_transactions SET status=?,completed_at=COALESCE(completed_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP,
          description=?,metadata=metadata||?::jsonb WHERE id=?`).run(abandoned?'failed':'completed',message,metadata,current.id);
        await db.prepare(`INSERT INTO workspace_transaction_events(id,transaction_id,level,phase,message,details) VALUES(?,?,'warning',?,?,?)`).run(randomUUID(),current.id,abandoned?'run.abandoned':'run.finished',message,{engine_run_id:current.related_id,...proof});
        reconciledDirectRuns.push({transaction_id:current.id,engine_run_id:current.related_id,...proof});
      }
    }
    const reconciledIds=new Set(reconciledDirectRuns.map(row=>row.transaction_id));
    const candidateRuns=JSON.stringify([...new Set([...engineRuns,...directRuns.filter(row=>!reconciledIds.has(row.id))].map(row=>row.execution_id).filter(Boolean))]);
    const activeExecution=await db.prepare(`SELECT id FROM executions WHERE project_id=?
      AND id IN(SELECT jsonb_array_elements_text(?::jsonb)) AND status IN('queued','running','retrying') AND ended_at IS NULL LIMIT 1`).get(selection.project_id,candidateRuns);
    if(activeGenerator||activeBatch||activeExecution)throw fail(activeGenerator
      ? 'A selected automation case has a claimed or recoverable generator build. Wait for that build to finish before deleting it.'
      : activeBatch ? 'A selected automation case belongs to a queued or running automation build. Wait for that build to finish before deleting it.'
      : 'A selected automation case is running. Wait for its execution to finish before deleting it.',409,'AUTOMATION_CASE_BUSY');
    const links=await db.prepare('SELECT automation_test_case_id,manual_test_case_id FROM automation_case_links WHERE automation_test_case_id IN(SELECT jsonb_array_elements_text(?::jsonb)) ORDER BY automation_test_case_id,manual_test_case_id FOR UPDATE').all(encoded);
    const retained=await db.prepare(`WITH selected AS(SELECT jsonb_array_elements_text(?::jsonb) AS id),
      runs AS(SELECT execution_id FROM execution_results WHERE test_case_id IN(SELECT id FROM selected) UNION SELECT execution_id FROM execution_case_snapshots WHERE test_case_id IN(SELECT id FROM selected))
      SELECT (SELECT COUNT(*)::int FROM execution_results WHERE test_case_id IN(SELECT id FROM selected)) AS results,(SELECT COUNT(*)::int FROM runs) AS runs`).get(encoded);
    const receipt={deleted:true,deleted_count:cases.length,deleted_ids:selection.test_case_ids,unlinked_manual_case_ids:[...new Set(links.map(link=>link.manual_test_case_id))].sort(),retained_run_count:Number(retained?.runs||0),retained_result_count:Number(retained?.results||0),cancelled_generator_job_ids:cancellableGenerators.map(job=>job.id),reconciled_direct_runs:reconciledDirectRuns,operation_id:randomUUID()};
    for(const job of cancellableGenerators){
      const message='Unclaimed automation build cancelled because its automation case was deleted.';
      await db.prepare(`UPDATE automation_generator_jobs SET status='cancelled',completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP,
        leased_by=NULL,lease_expires_at=NULL,result=?,runtime_state=runtime_state||?::jsonb WHERE id=?`).run({cancelled:true,reason:'automation_case_deleted',operation_id:receipt.operation_id},{current_phase:'generator.cancelled'},job.id);
      // Workspace activity has four lifecycle states; retain an explicit
      // cancelled outcome instead of presenting a cancelled build as completed.
      await db.prepare(`UPDATE workspace_transactions SET status='failed',completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP,
        description=?,metadata=metadata||?::jsonb WHERE id=? AND status IN('queued','running')`).run(message,{current_phase:'generator.cancelled',cancelled:true,cancellation_reason:'automation_case_deleted',deletion_operation_id:receipt.operation_id,phase_message:message},job.transaction_id);
      await db.prepare(`INSERT INTO workspace_transaction_events(id,transaction_id,level,phase,message,details)
        SELECT ?,id,'warning','generator.cancelled',?,?::jsonb FROM workspace_transactions WHERE id=?`).run(randomUUID(),message,{job_id:job.id,operation_id:receipt.operation_id,reason:'automation_case_deleted'},job.transaction_id);
    }
    await require('@hellotest/platform/backend/services/adminPortal.service').recordAudit({actorId,ipAddress,action:'automation_case.bulk_delete',targetType:'automation_case_selection',targetId:receipt.operation_id,
      summary:`Deleted ${cases.length} automation case${cases.length===1?'':'s'} and removed current manual-case associations.`,
      metadata:{project_id:selection.project_id,app_type_id:selection.app_type_id,selection_key:selectionKey,cases:cases.map(item=>({id:item.id,display_id:item.display_id,title:item.title})),removed_links:links,receipt}});
    await db.prepare('DELETE FROM test_steps WHERE test_case_id IN(SELECT jsonb_array_elements_text(?::jsonb))').run(encoded);
    // Only live definitions/memberships cascade. Frozen run snapshots, results,
    // artifacts and the shared data/library records remain their own evidence.
    await db.prepare('DELETE FROM test_cases WHERE id IN(SELECT jsonb_array_elements_text(?::jsonb))').run(encoded);
    return receipt;
  })();
};
