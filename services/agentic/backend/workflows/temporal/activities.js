const { createHash } = require('node:crypto');
const { Context } = require('@temporalio/activity');
const { ApplicationFailure } = require('@temporalio/common');
const db = require('@hellotest/platform/backend/src/db');
const execution = require('@hellotest/knowledge/backend/services/knowledgeExecution.service');
const events = require('../runtimeEvents');
const runtime = () => require('../../services/agenticWorkflowExecution.service')._internals;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const invalid = message => ApplicationFailure.nonRetryable(message, 'AGENT_RECEIPT_INVALID');
function checkIdentity(runId) {
  if (Context.current().info.workflowExecution.workflowId !== require('./control').workflowId(runId)) throw invalid('Workflow identity does not match its run.');
}
function summary(result, digest) {
  return { node_id: result.node_id, kind: result.node_type, status: result.status, result_hash: digest,
    matched: result.node_type === 'condition' ? result.output?.matched : undefined,
    ...(result.output?.routes ? { routes: Object.fromEntries(Object.entries(result.output.routes).map(([key, items]) => [key, items.length > 0])) } : {}),
    ...(result.output?.loop_mode === 'workflow' ? { loop_mode: 'workflow' } : {}),
    ...(result.node_type === 'dataOperation' ? { output: { item_count: result.output?.item_count } } : {}),
    fatal: Boolean(result.fatal), error_code: result.error_details?.code,
    needs_review: result.output?.readiness?.status === 'insufficient_evidence',
    needs_attention: result.output?.verification?.status === 'needs_input' };
}
async function restore(runId, receipts) {
  checkIdentity(runId);
  const run = await runtime().store.get(runId);
  if (!run || run.workflow_snapshot.runtime_contract?.orchestrator !== 'temporal') throw invalid('Durable workflow run not found.');
  // Persisted activity progress is useful for inspection after interruption,
  // but is never a dependency receipt or permission to resume a dispatch.
  run.saved_node_projection = run.node_results;
  const saved = await db.prepare(`SELECT node_id,result,result_hash FROM workflow_node_receipts WHERE run_id=? AND project_id=? AND state='recorded'`).all(runId, run.project_id);
  const trusted = new Map();
  for (const receipt of receipts) {
    const record = saved.find(item => item.node_id === receipt.node_id);
    // Hash the parsed JSON representation in stable key order; PostgreSQL JSONB
    // does not preserve JavaScript object insertion order.
    if (!record || record.result_hash !== receipt.result_hash || digest(record.result) !== record.result_hash) throw invalid('A recorded node result does not match workflow history.');
    const { body_results: bodyResults, ...nodeResult } = record.result;
    trusted.set(receipt.node_id, nodeResult);
    if (bodyResults) for (const item of bodyResults) trusted.set(item.node_id, item);
  }
  run.node_results = run.workflow_snapshot.execution_order.map(id => {
    const node = run.workflow_snapshot.nodes.find(item => item.id === id);
    return trusted.get(id) || { node_id: id, node_name: node.data.label || id, node_type: node.data.kind,
      specialist_id: node.data.agentId, status: 'queued', execution_mode: 'review', attempts: 0, logs: [] };
  });
  run.output_payload = { execution_mode: 'review', status: 'running', requires_human_review: true,
    project_changes_applied: run.node_results.some(item => item.output?.library_publication?.receipts?.some(receipt => receipt.saved === true && typeof receipt.id === 'string' && receipt.id.trim())),
    runtime_contract: run.workflow_snapshot.runtime_contract, total_steps: run.node_results.length,
    completed_steps: run.node_results.filter(item => item.status === 'completed').length };
  const bodyIds = new Set(Object.values(require('@hellotest/platform/backend/src/utils/agenticWorkflowGraph').loopBodies(run.workflow_snapshot.nodes, run.workflow_snapshot.edges)).flat());
  run.loop_budget = run.node_results.filter(item => !bodyIds.has(item.node_id)).reduce((sum, item) => ({
    batches: sum.batches + (item.output?.execution_usage?.batches || 0), node_executions: sum.node_executions + (item.output?.execution_usage?.node_executions || 0) }), { batches: 0, node_executions: 0 });
  return run;
}
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = value => hash(canonical(value));
async function record(run, result, requestHash) {
  const encoded = JSON.parse(JSON.stringify(result));
  const resultHash = digest(encoded);
  const saved = await db.prepare(`UPDATE workflow_node_receipts SET state='recorded',result=?,result_hash=?,completed_at=CURRENT_TIMESTAMP
    WHERE run_id=? AND node_id=? AND request_hash=? AND state='in_flight' RETURNING result,result_hash`).get(encoded,resultHash,run.id,result.node_id,requestHash);
  if (!saved) {
    const prior = await db.prepare('SELECT result,result_hash FROM workflow_node_receipts WHERE run_id=? AND node_id=? AND state=\'recorded\'').get(run.id,result.node_id);
    if (!prior) throw invalid('The durable node receipt could not be saved.');
    return summary(prior.result,prior.result_hash);
  }
  return summary(encoded,resultHash);
}
function interruptedBody(run, ids) {
  return run.saved_node_projection.filter(item => ids.includes(item.node_id)).map(item => ['queued', 'skipped'].includes(item.status) ? item : {
    ...item, status: item.status === 'running' ? 'interrupted' : item.status,
    activity_acknowledgement: 'not_recorded',
    ...(item.status === 'running' ? { completed_at: new Date().toISOString(), error: 'The loop activity stopped before acknowledging this body step.',
      error_details: { code: 'AGENT_ACTIVITY_OUTCOME_UNKNOWN', outcome_unknown: true, reconciliation_required: true, retryable: false } } : {})
  });
}
async function executeReviewNode({ runId, nodeId, shouldRun, receipts }) {
  const context = Context.current();
  const run = await restore(runId, receipts);
  const node = run.workflow_snapshot.nodes.find(item => item.id === nodeId);
  const bodies = require('@hellotest/platform/backend/src/utils/agenticWorkflowGraph').loopBodies(run.workflow_snapshot.nodes, run.workflow_snapshot.edges);
  const version2 = run.workflow_snapshot.runtime_contract.scheduler_version === 2;
  if (!node || (!version2 && run.workflow_snapshot.execution_order[receipts.length] !== nodeId)
    || (version2 && (Object.values(bodies).some(ids => ids.includes(nodeId)) || receipts.some(item => item.node_id === nodeId)
      || require('../workflowScheduling').orderedEdges(run.workflow_snapshot.edges, nodeId).some(edge => !require('../workflowScheduling').terminal(run.node_results.find(item => item.node_id === edge.source)))))) throw invalid('Node dependencies do not match the saved workflow.');
  const requestHash = digest({ node, input: run.input_payload, receipts, shouldRun });
  const existing = await db.prepare('SELECT * FROM workflow_node_receipts WHERE run_id=? AND node_id=?').get(runId,nodeId);
  if (existing?.request_hash !== undefined && existing.request_hash !== requestHash) throw invalid('A node identity was reused with different inputs.');
  if (existing?.state === 'recorded') return summary(existing.result,existing.result_hash);
  const result = run.node_results.find(item => item.node_id === nodeId);
  const reserved = !existing && await db.prepare(`INSERT INTO workflow_node_receipts(run_id,node_id,project_id,request_hash,state)
    VALUES(?,?,?,?,'in_flight') ON CONFLICT(run_id,node_id) DO NOTHING RETURNING node_id`).get(runId,nodeId,run.project_id,requestHash);
  if (!reserved) {
    // A previous activity may have consumed a model budget or sent an effect.
    // No second dispatch is permitted without a recorded result.
    result.status = 'failed'; result.fatal = true;
    result.error = 'The worker stopped before recording this node. Review its LLM trace and operation receipt before a new execution.';
    result.error_details = { code:'AGENT_ACTIVITY_OUTCOME_UNKNOWN', message:result.error, outcome_unknown:true, reconciliation_required:true, retryable:false };
    result.completed_at = new Date().toISOString();
    return record(run,bodies[nodeId] ? { ...result, body_results: interruptedBody(run, bodies[nodeId]) } : result,requestHash);
  }
  const timer = setInterval(() => context.heartbeat({ node_id:nodeId }),1000);
  timer.unref?.();
  const persist = async () => {
    if (context.cancellationSignal.aborted) throw execution.abortError();
    const saved = version2 ? await runtime().store.saveNodes(run, run.node_results.filter(item => item.node_id === nodeId || bodies[nodeId]?.includes(item.node_id)))
      : await runtime().store.save(run.id,'running',run.node_results,run.output_payload);
    if (!saved) throw execution.abortError();
  };
  try {
    const user = await db.prepare(`SELECT id,email,name,is_workspace_admin,CASE WHEN is_workspace_admin THEN 'admin' ELSE 'member' END AS role FROM users WHERE id=? AND status='active'`).get(run.created_by);
    const remaining = Date.parse(run.workflow_snapshot.runtime_contract.deadline_at) - Date.now();
    if (remaining <= 0) throw Object.assign(new Error('Review deadline exceeded.'),{code:'DEADLINE_EXCEEDED',publicMessage:'Review deadline exceeded.'});
    await execution.bounded(signal => runtime().runStep(run,node,user,signal,persist,shouldRun),{signal:context.cancellationSignal,timeoutMs:remaining});
  } catch (error) {
    error = events.withNode(error,run,node);
    result.status = 'failed'; result.fatal = true;
    result.error_details = events.failureInfo(error); result.error = result.error_details.message;
    result.completed_at = new Date().toISOString(); result.duration_ms = events.duration(result);
    events.log(result,{event:'node_failed',level:'error',...result.error_details});
  } finally { clearInterval(timer); }
  // The durable receipt precedes Temporal's activity acknowledgement. A lost
  // acknowledgement can replay this read, never the model/tool call.
  const receipt = await record(run,bodies[nodeId] ? { ...result, body_results: run.node_results.filter(item => bodies[nodeId].includes(item.node_id)) } : result,requestHash);
  if (version2) await runtime().store.saveNodes(run, run.node_results.filter(item => item.node_id === nodeId || bodies[nodeId]?.includes(item.node_id)));
  else await runtime().store.save(run.id,'running',run.node_results,run.output_payload);
  return receipt;
}
async function publishReview({ runId, receipts, status, reason }) {
  const run = await restore(runId,receipts);
  const reviews = runtime().collectReviews(run.node_results.filter(runtime().reviewSource)).map(({response,citation_ids,...review}) => review);
  const target = run.workflow_snapshot.runtime_contract.target_node_id;
  const hasOutput = target ? run.node_results.some(item => item.node_id === target && item.status === 'completed')
    : run.node_results.some(item => item.node_type === 'output' && item.status === 'completed');
  if (status === 'completed' && (!hasOutput || reviews.some(item => item.readiness?.status !== 'ready_for_review') || run.node_results.some(runtime().needsAttention))) status = 'needs_review';
  const unacknowledged = await db.prepare('SELECT node_id FROM workflow_node_receipts WHERE run_id=?').all(runId);
  const bodies = require('@hellotest/platform/backend/src/utils/agenticWorkflowGraph').loopBodies(run.workflow_snapshot.nodes, run.workflow_snapshot.edges);
  for (const owner of unacknowledged) {
    if (receipts.some(receipt => receipt.node_id === owner.node_id) || !bodies[owner.node_id]) continue;
    const partial = interruptedBody(run, bodies[owner.node_id]);
    run.node_results = run.node_results.map(item => partial.find(record => record.node_id === item.node_id) || item);
  }
  run.node_results = run.node_results.map(item => {
    if (item.status !== 'queued') return item;
    if (unacknowledged.some(record => record.node_id === item.node_id)) return {...item,status:'interrupted',completed_at:new Date().toISOString(),
      error:'The activity was dispatched but its result was not acknowledged before the workflow stopped.',
      error_details:{code:'AGENT_ACTIVITY_OUTCOME_UNKNOWN',outcome_unknown:true,reconciliation_required:true,retryable:false}};
    return {...item,status:'skipped',skip_reason:`Workflow finished: ${status}`,completed_at:new Date().toISOString()};
  });
  const failedNode = status === 'failed' ? run.node_results.find(item=>item.fatal && item.error_details) || run.node_results.find(item=>item.status==='failed'&&item.error_details) : null;
  const output = {...run.output_payload,status,error_code:reason,orchestrator:'temporal',
    ...(failedNode?{failed_node_id:failedNode.error_details.origin?.node_id || failedNode.node_id,
      ...(failedNode.error_details.origin?.node_id && failedNode.error_details.origin.node_id!==failedNode.node_id?{failed_parent_node_id:failedNode.node_id}:{}),error_details:failedNode.error_details}:{}),
    summary: status === 'completed' ? 'Review workflow completed. Results are ready for human review.' : status === 'needs_review' ? 'Review the evidence gaps and recovery results before acting.' : `Review execution ${status}. Completed results are preserved.`,
    reviews,review_session_ids:reviews.map(item=>item.session_id).filter(Boolean),
    results:run.node_results.filter(item=>item.node_type==='output'&&item.status==='completed').map(item=>({node_id:item.node_id,output:item.output}))};
  output.summary = runtime().terminalSummary(run,status,run.node_results,output.summary);
  await runtime().store.save(runId,status,run.node_results,output);
  return { status };
}
module.exports = { executeReviewNode, publishReview };
