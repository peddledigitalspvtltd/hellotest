const db = require('@hellotest/platform/backend/src/db');
const { createHash } = require('node:crypto');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (message,code,statusCode=409) => Object.assign(new Error(message),{publicMessage:message,code,statusCode,retryable:false});
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])) : value;

async function invoke({run,node,input,user},dispatch) {
  const id=`op-${hash([run.project_id,run.id,node.id,...(run.iteration_path || []),'tool-dispatch']).slice(0,48)}`;
  const requestHash=hash(canonical({connection_id:node.data.connectionId,kind:node.data.kind,node:node.data,input}));
  const inserted=await db.prepare(`INSERT INTO workflow_operation_receipts
    (id,project_id,run_id,node_id,actor_id,request_hash,connection_id,state) VALUES(?,?,?,?,?,?,?,'in_flight')
    ON CONFLICT(id) DO NOTHING RETURNING id`).get(id,run.project_id,run.id,node.id,user.id,requestHash,node.data.connectionId||null);
  if(!inserted) {
    const previous=await db.prepare('SELECT * FROM workflow_operation_receipts WHERE id=? AND project_id=?').get(id,run.project_id);
    if(previous?.request_hash!==requestHash) throw fail('The same operation identity cannot be used for changed tool arguments.','AGENT_OPERATION_CONFLICT');
    if(previous.state==='response_received') return {...previous.response,operation_receipt:{id,state:previous.state,postcondition_verified:false,reused:true}};
    throw Object.assign(fail('This tool operation may already have reached the provider. Reconcile its saved receipt before starting another write.','AGENT_OPERATION_OUTCOME_UNKNOWN'),{outcome_unknown:true,operation_id:id});
  }
  try {
    const output=await dispatch();
    const encoded=JSON.stringify(output);
    if(Buffer.byteLength(encoded)>128*1024) throw fail('Tool response exceeds the durable receipt limit.','AGENT_OPERATION_RECEIPT_LIMIT',422);
    const response=JSON.parse(encoded);
    const saved=await db.prepare(`UPDATE workflow_operation_receipts SET state='response_received',response=?,completed_at=CURRENT_TIMESTAMP WHERE id=? AND state='in_flight' RETURNING id`).get(response,id);
    if(!saved) throw fail('The tool returned a response, but its durable receipt could not be recorded.','AGENT_OPERATION_RECEIPT_FAILED',503);
    return {...output,operation_receipt:{id,state:'response_received',postcondition_verified:false}};
  } catch(error) {
    if(error.effect_dispatched===false&&!error.outcome_unknown&&!error.transactionOutcomeUnknown){
      // Only a locally proven pre-dispatch failure may release this reservation.
      // Missing acknowledgments after dispatch still retain an immutable receipt.
      const released=await db.prepare(`DELETE FROM workflow_operation_receipts
        WHERE id=? AND request_hash=? AND state='in_flight' RETURNING id`).get(id,requestHash).catch(()=>null);
      if(released)throw Object.assign(error,{operation_id:id});
    }
    // A transport error or worker crash cannot establish that a write did not
    // happen. Never turn a missing response into permission to repeat the effect.
    await db.prepare(`UPDATE workflow_operation_receipts SET state='outcome_unknown',error_code=?,completed_at=CURRENT_TIMESTAMP WHERE id=? AND state='in_flight'`)
      .run(/^[A-Z_]+$/.test(error.code||'')?error.code:'TOOL_OUTCOME_UNKNOWN',id).catch(()=>{});
    throw Object.assign(error,{outcome_unknown:true,retryable:false,operation_id:id});
  }
}
module.exports={invoke};
