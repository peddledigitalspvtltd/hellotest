const { createHash, randomUUID } = require("node:crypto");
const db = require("@hellotest/platform/backend/src/db");
const assistant = require("./agenticAssistant.service");
const agentRegistry = require("../agents/agentRegistry.service");
const agentContract = require("../agents/agentDefinition");
const permissions = require("@hellotest/platform/backend/services/permission.service");
const flags = require("@hellotest/platform/backend/services/featureFlag.service");
const execution = require("@hellotest/knowledge/backend/services/knowledgeExecution.service");
const nodeAiConfiguration = require('../workflows/nodeAiConfiguration');
const graphContract = require('@hellotest/platform/backend/src/utils/agenticWorkflowGraph');
const scheduling = require('../workflows/workflowScheduling');
const flowOperations = require('../workflows/flowOperations');
const mergeOperations = require('../workflows/mergeOperations');
const loopBudget = require('../workflows/workflowLoopBudget');
const { isDeepStrictEqual } = require('node:util');
const { mapWithConcurrency } = require('@hellotest/platform/backend/src/utils/boundedConcurrency');

// Every offered node has a bounded adapter. Legacy unsupported definitions
// fail readiness before a run starts; no simulated output is passed as real data.
const operations = require("../workflows/nodeOperations");
const nodeRegistry = require('../workflows/nodeRegistry');
const { policy: specialistPolicy } = require("../workflows/specialistPolicy");
const { contextFor, appendInputs, mergeInputs, mergeExecutionContext } = operations._internals;
const events = require("../workflows/runtimeEvents");
const MODE = "review";
const MAX_DURATION_MS = 180_000;
const MAX_INPUT_BYTES = 16_384;
const MAX_ARTIFACT_DURATION_MS = 3_600_000;
const workflowDuration = workflow => Math.min(MAX_ARTIFACT_DURATION_MS, Math.max(1000, Number(workflow.settings?.maxDurationMs) || (workflow.nodes?.some(node => node.data?.kind === 'artifactTask') ? MAX_ARTIFACT_DURATION_MS : MAX_DURATION_MS)));
const MAX_PARALLEL_RUNS = 2;
const localQueue = require('../workflows/localRunQueue').createLocalRunQueue({ concurrency: MAX_PARALLEL_RUNS, maxQueued: 20 });
const TERMINAL_SAVE_TIMEOUT_MS = 6000;
const SUPPORTED_KINDS = new Set(Object.values(nodeRegistry.registry).filter(kind => kind.executable).map(kind => kind.kind));
const active = new Map();
const starting = new Map();
// Only terminal snapshots produced by this worker may be recovered on a read.
// An absent active-map entry alone never establishes ownership or abandonment.
const pendingTerminals = new Map();
const diagnostics = { onFailure: () => {}, failures: [] };
const error = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode, publicMessage: message });
const text = (value) => typeof value === "string" ? value.trim() : "";
const object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const array = (value) => Array.isArray(value) ? value : [];
const parse = (value, fallback) => { try { return typeof value === "string" ? JSON.parse(value) : value ?? fallback; } catch { return fallback; } };
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const kindOf = (node) => node.data?.kind || node.type || "agent";
const numericScalar = value => ['number', 'string'].includes(typeof value) && String(value).trim() !== '';
const processing = workflow => ({ mode: workflow.settings?.processing_mode === 'parallel' ? 'parallel' : 'sequential',
  max_parallel_nodes: workflow.settings?.processing_mode === 'parallel' ? Math.min(8, Math.max(1, Number(workflow.settings?.max_parallel_nodes) || 2)) : 1 });
const nodeName = (node) => text(node.data?.label) || node.id;
const hydrate = (run) => run && ({ ...run, execution_mode: parse(run.workflow_snapshot, {}).execution_mode || "preview", workflow_snapshot: parse(run.workflow_snapshot, {}), input_payload: parse(run.input_payload, {}), output_payload: parse(run.output_payload, {}), node_results: parse(run.node_results, []) });
const publicationRecoveryNeeded = run => run?.execution_mode === MODE && ['cancelled','interrupted','failed'].includes(run.status)
  && run.workflow_snapshot?.settings?.template_id === 'sprint-automator'
  && run.workflow_snapshot?.settings?.library_publication_mode === 'automatic';

const store = {
  get: async (id) => hydrate(await db.prepare("SELECT * FROM agentic_workflow_runs WHERE id = ?").get(id)),
  insert: async (run) => db.prepare(`INSERT INTO agentic_workflow_runs
    (id, workflow_id, project_id, app_type_id, workflow_name, status, trigger_kind, input_payload, output_payload, workflow_snapshot, node_results, created_by, started_at)
    VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT (id) DO NOTHING RETURNING id`).get(run.id, run.workflow_id, run.project_id, run.app_type_id, run.workflow_name, run.trigger_kind, run.input_payload, run.output_payload, run.workflow_snapshot, run.node_results, run.created_by),
  save: async (id, status, nodes, output, expectedNodes = null) => db.prepare(`UPDATE agentic_workflow_runs
    SET status = ?, node_results = ?, output_payload = ?, updated_at = CURRENT_TIMESTAMP,
      completed_at = CASE WHEN ? = 'running' THEN NULL ELSE CURRENT_TIMESTAMP END
    WHERE id = ? AND status = 'running'
      AND (?::jsonb IS NULL OR node_results = ?::jsonb) RETURNING id`).get(status, nodes, output, status, id, expectedNodes, expectedNodes),
  // Durable parallel activities patch only their own node/composite body. A
  // sibling's running/completed projection must never be replaced by the
  // activity's dependency snapshot.
  saveNodes: async (run, results) => {
    const patches = Object.fromEntries(results.map(result => [result.node_id, result]));
    return db.prepare(`UPDATE agentic_workflow_runs SET
      node_results=(SELECT jsonb_agg(COALESCE(?::jsonb -> (item.value->>'node_id'),item.value) ORDER BY item.ordinality)
        FROM jsonb_array_elements(node_results) WITH ORDINALITY item(value,ordinality)),
      output_payload=COALESCE(output_payload,'{}'::jsonb) || jsonb_build_object(
        'completed_steps',(SELECT COUNT(*) FROM jsonb_array_elements(node_results) item
          WHERE COALESCE(?::jsonb -> (item->>'node_id'),item)->>'status'='completed'),
        'project_changes_applied',COALESCE((output_payload->>'project_changes_applied')::boolean,false) OR ?::boolean),
      updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='running' RETURNING id`).get(patches, patches, run.output_payload.project_changes_applied === true, run.id);
  },
  // A cancellation may win while the current atomic case publication commits.
  // Recover only committed domain receipts, without replacing cancellation,
  // other node results, or their timestamps with a worker's earlier snapshot.
  // A list poll shares one bounded receipt read per group, rather than issuing
  // a query for each historical failure or each repeated receipt projection.
  publicationRows: async runs => db.prepare(`SELECT runs.id AS run_id,receipts.node_id,receipts.receipt
    FROM jsonb_to_recordset(?::jsonb) AS scope(id text,project_id text)
    JOIN agentic_workflow_runs runs ON runs.id=scope.id AND runs.project_id=scope.project_id
    JOIN LATERAL (SELECT node_id,receipt FROM workflow_draft_acceptances
      WHERE run_id=runs.id AND project_id=runs.project_id
      ORDER BY node_id,story_id,case_index,kind LIMIT 2001) receipts ON true`).all(runs.map(run => ({id:run.id,project_id:run.project_id}))),
  mergePublication: async (id, nodeId = null, publicationStatus = null, supplied = {}) => {
    const rows = supplied.rows ?? await db.prepare(`SELECT acceptances.node_id,acceptances.receipt
      FROM workflow_draft_acceptances acceptances JOIN agentic_workflow_runs runs
        ON runs.id=acceptances.run_id AND runs.project_id=acceptances.project_id
      WHERE runs.id=? AND (?::text IS NULL OR acceptances.node_id=?)
      ORDER BY acceptances.node_id,acceptances.story_id,acceptances.case_index,acceptances.kind LIMIT 2001`).all(id,nodeId,nodeId);
    if (!rows.length) return null;
    if (rows.length > 2000) throw error('Recorded publication receipts exceed the workflow limit.', 409);
    const grouped = Object.create(null);
    for (const row of rows) {
      const receipt = object(row.receipt);
      if (receipt.saved !== true || !text(receipt.id)) continue;
      (grouped[row.node_id] ||= { mode:'automatic', status:publicationStatus === 'partial' ? 'partial' : 'saved',
        receipts:[], manual_cases_saved:0, automation_cases_saved:0, requires_review:true, approved:false }).receipts.push(receipt);
      if (receipt.kind === 'manual') grouped[row.node_id].manual_cases_saved++;
      if (receipt.kind === 'automation') grouped[row.node_id].automation_cases_saved++;
    }
    if (!Object.keys(grouped).length) return null;
    const current = supplied.run;
    if (current?.id === id && current.output_payload?.project_changes_applied === true
      && array(current.node_results).every(node => !grouped[node.node_id] || isDeepStrictEqual(node.output?.library_publication,
        { ...grouped[node.node_id], ...(publicationStatus === null ? { status:node.output?.library_publication?.status
          ?? (['cancelled','interrupted','failed'].includes(current.status) ? 'partial' : 'saved') } : {}) }))
      && (current.status === 'running' || terminalSummary(current,current.status,current.node_results,current.output_payload.summary) === current.output_payload.summary)) return current;
    const updated = hydrate(await db.prepare(`UPDATE agentic_workflow_runs SET
      node_results=(SELECT jsonb_agg(CASE WHEN (?::jsonb -> (item.value->>'node_id')) IS NOT NULL
        THEN jsonb_set(item.value,'{output}',COALESCE(NULLIF(item.value->'output','null'::jsonb),'{}'::jsonb)
          || jsonb_build_object('library_publication',(?::jsonb -> (item.value->>'node_id')) ||
            CASE WHEN ?::text IS NULL THEN jsonb_build_object('status',COALESCE(item.value#>>'{output,library_publication,status}',
              CASE WHEN status IN ('cancelled','interrupted','failed') THEN 'partial' ELSE 'saved' END)) ELSE '{}'::jsonb END),true)
        ELSE item.value END ORDER BY item.ordinality)
        FROM jsonb_array_elements(node_results) WITH ORDINALITY AS item(value,ordinality)),
      output_payload=COALESCE(output_payload,'{}'::jsonb)||'{"project_changes_applied":true}'::jsonb,
      updated_at=CURRENT_TIMESTAMP WHERE id=? AND (
        output_payload->'project_changes_applied' IS DISTINCT FROM 'true'::jsonb OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(node_results) item WHERE (?::jsonb -> (item->>'node_id')) IS NOT NULL
            AND item#>'{output,library_publication}' IS DISTINCT FROM ((?::jsonb -> (item->>'node_id')) ||
              CASE WHEN ?::text IS NULL THEN jsonb_build_object('status',COALESCE(item#>>'{output,library_publication,status}',
                CASE WHEN status IN ('cancelled','interrupted','failed') THEN 'partial' ELSE 'saved' END)) ELSE '{}'::jsonb END)
        )) RETURNING *`).get(grouped,grouped,publicationStatus,id,grouped,grouped,publicationStatus)) || await store.get(id);
    if (!updated || updated.status === 'running') return updated;
    const summary = terminalSummary(updated,updated.status,updated.node_results,updated.output_payload.summary);
    if (summary === updated.output_payload.summary) return updated;
    return hydrate(await db.prepare(`UPDATE agentic_workflow_runs SET output_payload=jsonb_set(output_payload,'{summary}',to_jsonb(?::text),true)
      WHERE id=? AND status=? AND node_results=?::jsonb RETURNING *`).get(summary,id,updated.status,updated.node_results)) || updated;
  },
  // Recovery must not inherit a failed/released domain transaction or a
  // cancelled retrieval context. This conditional metadata write cannot replay
  // node work or overwrite an already-terminal cancellation/receipt.
  saveTerminal: async (id, status, nodes, output) => {
    const isolated = require('@hellotest/platform/backend/src/db/createPostgresAdapter').createPostgresAdapter({
      poolConfig: { ...db.pool.options, application_name: 'hellotest-workflow-terminal', max: 1, min: 0,
        connectionTimeoutMillis: 2500, statement_timeout: 1500, query_timeout: 2000, lock_timeout: 500 },
      statementNamespace: 'hellotest_workflow_terminal'
    });
    try {
      return (await isolated.pool.query({
        text: `UPDATE agentic_workflow_runs SET status=$2,node_results=$3::jsonb,output_payload=$4::jsonb,
          updated_at=CURRENT_TIMESTAMP,completed_at=CURRENT_TIMESTAMP WHERE id=$1 AND status='running' RETURNING id`,
        values: [id, status, JSON.stringify(nodes), JSON.stringify(output)], query_timeout: 2000
      })).rows[0];
    } finally { await isolated.close(); }
  }
};

store.activateLocal = (id, snapshot, output) => db.prepare(`UPDATE agentic_workflow_runs SET workflow_snapshot=?,output_payload=?,updated_at=CURRENT_TIMESTAMP,started_at=CURRENT_TIMESTAMP
  WHERE id=? AND status='running' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(node_results) node WHERE node->>'status' <> 'queued') RETURNING id`).get(snapshot,output,id);

function recordFailure(run, phase, failure, nodeId = null) {
  const entry = { event: 'workflow.execution.failure', run_id: run.id, node_id: nodeId, phase,
    code: typeof failure?.code === 'string' && /^[A-Z0-9_]{1,100}$/.test(failure.code) ? failure.code
      : /timeout exceeded when trying to connect|Connection terminated due to connection timeout/i.test(failure?.message || '') ? 'WORKFLOW_DATABASE_CONNECT_TIMEOUT' : 'WORKFLOW_EXECUTION_FAILED',
    ...(Number.isInteger(failure?.statusCode) ? { status_code: failure.statusCode } : {}), at: new Date().toISOString() };
  diagnostics.failures.push(entry);
  if (diagnostics.failures.length > 20) diagnostics.failures.shift();
  try { diagnostics.onFailure(failure); } catch { /* Diagnostics cannot prevent terminal persistence. */ }
  console.error(JSON.stringify(entry));
}

async function persistTerminal(run, status, nodes, output) {
  const snapshot = { run, status, nodes: structuredClone(nodes), output: structuredClone({ ...output, summary: terminalSummary(run, status, nodes, output.summary) }) };
  pendingTerminals.set(run.id, snapshot);
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const saved = await execution.run({ signal: undefined }, () => execution.bounded(() => attempt
        ? store.saveTerminal(run.id, status, snapshot.nodes, snapshot.output)
        : store.save(run.id, status, snapshot.nodes, snapshot.output), { timeoutMs: TERMINAL_SAVE_TIMEOUT_MS }));
      // A null conditional UPDATE means another terminal writer won. Its
      // cancellation or completion remains authoritative.
      pendingTerminals.delete(run.id);
      return saved;
    } catch (failure) {
      lastError = failure;
      recordFailure(run, attempt ? 'terminal_recovery' : 'terminal_save', failure);
    }
  }
  throw Object.assign(error('The workflow stopped, but its final status could not be recorded. Reload to retry status recovery; do not repeat its actions.', 503), {
    code: 'WORKFLOW_TERMINAL_PERSISTENCE', cause: lastError
  });
}

function readiness(workflow, targetNodeId = "") {
  const blockers = [];
  const warnings = [];
  const runtimePolicy = require('../workflows/executionRuntimePolicy').executionRuntimePolicy({durable:require('../workflows/temporal/control').enabled()});
  const add = (node, message) => blockers.push({ node_id: node?.id || null, node_name: node ? nodeName(node) : null, message });
  if (!runtimePolicy.available) add(null,runtimePolicy.message);
  try { require('../workflows/workflowCredentialPolicy').assertDefinition(workflow); } catch (failure) { add(null, failure.publicMessage || failure.message); }
  let ordered = [];
  try { ordered = require("@hellotest/platform/backend/src/utils/agenticWorkflowGraph").validateWorkflowGraph(workflow.nodes, workflow.edges, { requireNodes: true }); }
  catch (failure) { add(null, failure.publicMessage || failure.message); }
  let nodes = array(workflow.nodes);
  let edges = array(workflow.edges);
  const connectionKeys = new Set();
  for (const edge of edges) {
    const key = JSON.stringify([edge.source, edge.target, edge.sourceHandle || "", edge.targetHandle || ""]);
    if (connectionKeys.has(key)) add(null, "Remove duplicate connections between the same node ports.");
    connectionKeys.add(key);
  }
  if (targetNodeId) {
    if (typeof targetNodeId !== "string" || !nodes.some(node => node.id === targetNodeId)) add(null, "Select an existing node to execute.");
    let bodies = {};
    try { bodies = graphContract.loopBodies(nodes, edges); } catch { /* The full graph error is already reported. */ }
    if (Object.values(bodies).some(ids => ids.includes(targetNodeId))) add(null, 'Execute the enclosing Loop Over Items step to run a body with its batch context.');
    const required = new Set([targetNodeId]);
    const visit = id => edges.filter(edge => edge.target === id && !scheduling.isReturn(edge)).forEach(edge => {
      if (!required.has(edge.source)) { required.add(edge.source); visit(edge.source); }
    });
    visit(targetNodeId);
    for (const [loopId, ids] of Object.entries(bodies)) if (required.has(loopId)) ids.forEach(id => required.add(id));
    nodes = nodes.filter(node => required.has(node.id));
    edges = edges.filter(edge => required.has(edge.source) && required.has(edge.target));
    ordered = ordered.filter(node => required.has(node.id));
  }
  const settings = object(workflow.settings);
  if (settings.processing_mode != null && !['sequential', 'parallel'].includes(settings.processing_mode)) add(null, 'Choose sequential or parallel node processing.');
  if (settings.max_parallel_nodes != null && (!numericScalar(settings.max_parallel_nodes) || !Number.isInteger(Number(settings.max_parallel_nodes)) || Number(settings.max_parallel_nodes) < 1 || Number(settings.max_parallel_nodes) > 8)) add(null, 'Run between one and eight independent nodes at a time.');
  if (settings.maxDurationMs != null && (!numericScalar(settings.maxDurationMs) || !Number.isInteger(Number(settings.maxDurationMs)) || Number(settings.maxDurationMs) < 1000 || Number(settings.maxDurationMs) > MAX_ARTIFACT_DURATION_MS)) add(null, 'Choose a workflow deadline between 1000 and 3600000 milliseconds.');
  if (settings.requiresApproval || settings.approvalRequired || settings.human_approval_required) add(null, "Approval gates are preview-only. Remove the execution approval gate; results will still require human review before any artifact change.");
  if (settings.execution_mode && !["review", "sequential", "preview"].includes(settings.execution_mode)) add(null, "Only sequential review execution is supported. Parallel or custom execution modes are preview-only.");
  const specialists = nodes.filter(node => nodeRegistry.get(kindOf(node))?.specialist);
  if (["paused", "archived"].includes(workflow.status)) add(null, "Move this workflow to Draft or Active before executing a review.");
  try { require("../workflows/triggerPolicy").config(workflow); } catch (error) { add(null,error.publicMessage || error.message); }
  if (workflow.trigger_kind && workflow.trigger_kind !== "manual" && !require("../workflows/temporal/control").enabled()) add(null,"Unattended triggers require the durable Temporal worker. Manual workflows can use the development fallback.");
  if (nodes.length > 100) add(null, "A workflow supports at most 100 steps.");
  if (specialists.length > 4) add(null, "Include at most 4 registered specialist steps.");
  const triggers = nodes.filter(node => kindOf(node) === "trigger");
  const aliases = new Map();
  for (const node of nodes) {
    const alias = text(node.data?.outputKey);
    if (!alias) continue;
    if (!/^[\w-]{1,160}$/.test(alias) || ["__proto__", "constructor", "prototype"].includes(alias)) add(node, "Output labels must use letters, numbers, underscores or hyphens (up to 160 characters).");
    if (aliases.has(alias) || nodes.some(other => other.id !== node.id && other.id === alias)) add(node, "Use a unique output label so downstream data references are unambiguous.");
    aliases.set(alias, node.id);
  }
  if (triggers.length !== 1) add(null, "Include exactly one request trigger.");
  if (!targetNodeId && !nodes.some(node => kindOf(node) === "output")) add(null, "Add an Output step for the review packet.");
  for (const node of nodes) {
    const data = object(node.data);
    const kind = kindOf(node);
    const nodeDefinition=nodeRegistry.get(kind),connectionPolicy=nodeDefinition?.connectionPolicy;
    const incoming = edges.filter(edge => edge.target === node.id && !scheduling.isReturn(edge));
    const outgoing = edges.filter(edge => edge.source === node.id);
    if (!SUPPORTED_KINDS.has(kind)) add(node, `Unsupported ${kind} step. Replace it with a registered executable node.`);
    if (data.requiresApproval || data.approvalRequired || data.toolPolicy === "approval-required") add(node, "Approval gates are preview-only. Remove this gate before executing a read-only review.");
    if (data.parallel === true || data.concurrency != null && (!numericScalar(data.concurrency) || Number(data.concurrency)!==1) || data.maxConcurrency != null && (!numericScalar(data.maxConcurrency) || Number(data.maxConcurrency)!==1)) add(node, "Configure independent branch concurrency in Workflow settings → Node processing. Per-node fan-out is unsupported; remove parallel, concurrency and maxConcurrency from this step.");
    if (!nodeDefinition?.allowsCredentialReference && text(data.credentialId)) add(node, "Node credentials bind external tools and are preview-only. Remove the credential binding for a specialist evidence review.");
    if (text(data.outputSchema)) add(node, "Custom output schemas are preview-only. Clear the schema to use the specialist's validated evidence-review contract.");
    if (["topK", "maxContextChars", "maxOutputChars", "maxCompletionTokens"].some(key => data[key] != null && String(data[key]).trim())) add(node, "Custom model limits are preview-only. Clear model tuning to use the specialist's bounded retrieval and validated output.");
    if (data.redactSecrets === false || data.redactSecrets === "false") add(node, "Secret redaction is required for executed reviews.");
    if (data.logLevel && !["standard", "audit"].includes(data.logLevel)) add(node, "Use Standard or Audit logging. Debug payload logging is preview-only.");
    if(connectionPolicy?.incoming==='forbidden'&&incoming.length)add(node,'The request trigger cannot have incoming connections.');
    if(connectionPolicy?.incoming==='required'&&!incoming.length)add(node,'Connect this step to the request trigger or an earlier step.');
    if(connectionPolicy?.outgoing==='forbidden'&&outgoing.length)add(node,'Output steps must finish a branch.');
    if(connectionPolicy?.outgoing==='required'&&node.id!==targetNodeId&&!outgoing.length)add(node,'Connect this branch to an Output step.');
    if (text(data.inputExpression) || data.inputMode === "manualReferences") add(node, "Expression inputs are preview-only. Clear the expression and use connected step outputs.");
    if (!nodeDefinition?.acceptsLoopPolicy && (text(data.loopSourceKey) || Number(data.loopMaxIterations) > 0)) add(node, "Loop policies are preview-only; remove this step's loop configuration.");
    if (nodeRegistry.get(kind)?.executor!=='operation' && (text(data.apiUrl) || text(data.toolName) || text(data.testOpsAction))) add(node, "External tools and write actions are preview-only. Remove the tool binding to execute an evidence review.");
    if (data.onError && !["stop", "errorOutput"].includes(data.onError)) add(node, "Choose Stop workflow or Route to error handler.");
    if (data.onError === "errorOutput" && !outgoing.some(edge => nodes.some(next => next.id === edge.target && kindOf(next) === "errorHandler"))) add(node, "Connect an Error handler before routing failures.");
    for (const message of nodeRegistry.get(kind)?.validate(node, { incomingCount: incoming.length,incoming,outgoing,nodes }) || []) add(node, message);
    if (data.aiConfiguration !== undefined || data.reviewCriteria !== undefined) {
      try { nodeAiConfiguration.normalize(data.aiConfiguration); nodeAiConfiguration.reviewCriteria(data); }
      catch (failure) { add(node, failure.publicMessage || failure.message); }
    }
    if (data.mergeMode && !nodeDefinition?.acceptsMergePolicy && !['waitAllAppend', 'waitAllMerge'].includes(data.mergeMode)) add(node, 'Configure Merge modes on a Merge step.');
    const maxTimeout=nodeDefinition?.timeoutMaxMs(data)||70000;
    if (data.timeoutMs != null && (!numericScalar(data.timeoutMs) || !Number.isInteger(Number(data.timeoutMs)) || Number(data.timeoutMs) < 1_000 || Number(data.timeoutMs) > maxTimeout)) add(node, `Choose a step timeout between 1,000 and ${maxTimeout.toLocaleString("en-US")} milliseconds.`);
    if (data.retryCount != null && (!numericScalar(data.retryCount) || !Number.isInteger(Number(data.retryCount)) || Number(data.retryCount) < 0 || Number(data.retryCount) > 2)) add(node, "Review steps support zero, one or two retries within their timeout.");
    if (data.retryDelayMs != null && (!numericScalar(data.retryDelayMs) || !Number.isInteger(Number(data.retryDelayMs)) || Number(data.retryDelayMs) < 0 || Number(data.retryDelayMs) > 10_000)) add(node, "Choose a retry delay between 0 and 10,000 milliseconds.");
  }
  if (nodes.some(node => node.data?.sampleOutput != null)) warnings.push("Execution uses actual connected results. Declared sample outputs are used only in previews.");
  warnings.push("AI and source analysis return reviewable results. HTTP methods and MCP tools can act on external systems only when enabled by the server connection policy.");
  warnings.push(processing(workflow).mode === 'parallel'
    ? `Up to ${processing(workflow).max_parallel_nodes} independent nodes run together after their dependencies finish. External mutations, loops and native artifact tasks run alone; merges preserve input order.`
    : 'Connected branches execute sequentially in dependency order. Each specialist retrieves fresh evidence with its own bounded context policy.');
  if (!require('../workflows/temporal/control').enabled()) warnings.push('Development fallback: two local workflows run at once and up to twenty wait in memory. Use Temporal for durable unattended execution and restart recovery.');
  try {
    const capacity = loopBudget.sprintCapacity({ ...workflow, nodes, edges });
    if (capacity != null) warnings.push(`With the saved case count, this Sprint workflow supports at most ${capacity} Stories within the shared loop budget. Split larger Sprints or lower the case count before running.`);
  } catch (failure) { add(null, failure.publicMessage || failure.message); }
  return { ready: blockers.length === 0, execution_mode: MODE, target_node_id: targetNodeId || null, blockers, warnings,
    processing: processing(workflow), limits: { max_steps: 100, max_specialists: 4, timeout_ms: workflowDuration(workflow), input_limit_bytes: MAX_INPUT_BYTES, max_parallel_nodes: processing(workflow).max_parallel_nodes,
      max_loop_batches: loopBudget.LIMITS.batches, max_loop_node_executions: loopBudget.LIMITS.node_executions },
    steps: ordered.map(node => ({ node_id: node.id, name: nodeName(node), kind: kindOf(node), specialist_id: node.data?.agentId || null })) };
}

async function requireRunAccess(user, projectId, { allowDisabled = false } = {}) {
  if (!user?.id || !await permissions.hasPermission(user, "agentic_workflow.run", projectId)) throw error("Permission required: agentic_workflow.run", 403);
  if (!allowDisabled && !await flags.areEnabled(flags.getFeatureKeysForPermission("agentic_workflow.run"), { user })) throw error("Agent workflows are disabled for this workspace.", 403);
}

async function checkReadiness(workflow,targetNodeId='',user,inputPayload) {
  const report=readiness(workflow,targetNodeId);if(!report.ready)return report;
  const hasInput=inputPayload!==undefined,payload=object(inputPayload),trigger=workflow.nodes.find(node=>nodeRegistry.get(kindOf(node))?.executor==='trigger');
  const inputBlocker=message=>report.blockers.push({node_id:trigger?.id||null,node_name:trigger?nodeName(trigger):null,message});
  if(hasInput){if(!inputPayload||typeof inputPayload!=='object'||Array.isArray(inputPayload))inputBlocker('Workflow input must be a JSON object.');else if(Buffer.byteLength(JSON.stringify(payload))>MAX_INPUT_BYTES)inputBlocker('Workflow input is limited to 16 KB.');}
  const selected=report.steps.map(step=>({node:workflow.nodes.find(node=>node.id===step.node_id),definition:nodeRegistry.get(step.kind)}));
  const checkedInputs=new Set(),warnings=new Set();
  const context={workflow,user,payload,hasInput,hasNativeInput:selected.some(({definition})=>definition.inputContract==='nativeStory'),
    checkInputOnce(key,check){if(checkedInputs.has(key))return;checkedInputs.add(key);try{check();}catch(failure){inputBlocker(failure.publicMessage||failure.message);}},
    warnOnce(message){if(!warnings.has(message)){warnings.add(message);report.warnings.push(message);}}};
  for(const {node,definition}of selected)definition.validateInput?.({...context,node});
  if(report.blockers.length){report.ready=false;return report;}
  for(const phase of ['model','connection'])for(const {node,definition}of selected){
    const check=definition.preflight?.[phase];if(!check)continue;
    try{await check({...context,node});}catch(failure){report.blockers.push({node_id:node.id,node_name:nodeName(node),message:definition.preflightFailure?.(phase,failure)||failure.publicMessage||'Check this node configuration and connection.'});}
  }
  report.ready=report.blockers.length===0;return report;
}

const terminalNodes = (nodes, currentId, state) => nodes.map(node => node.status === "running"
  ? { ...node, status: node.node_id === currentId || ['cancelled', 'interrupted'].includes(state) ? state : 'interrupted', completed_at: new Date().toISOString() }
  : node.status === "queued" ? { ...node, status: "skipped", completed_at: new Date().toISOString() } : node);

async function reconcile(run, { publicationRows } = {}) {
  if (!run || run.execution_mode !== MODE) return run;
  if (publicationRecoveryNeeded(run)) {
    return await store.mergePublication(run.id,null,null,{ rows:publicationRows,run }) || run;
  }
  if (run.status !== 'running') return run;
  if (run.workflow_snapshot.runtime_contract?.orchestrator === "temporal") return run;
  const local = active.get(run.id);
  if (local?.queued) return { ...run, output_payload: { ...run.output_payload, execution_state: 'queued', queue_position: localQueue.position(run.id), summary: `Queued for a development worker slot (position ${localQueue.position(run.id)}).` } };
  const pending = pendingTerminals.get(run.id);
  if (pending) {
    await persistTerminal(pending.run, pending.status, pending.nodes, pending.output);
    return await store.get(run.id);
  }
  const deadline = Date.parse(run.workflow_snapshot?.runtime_contract?.deadline_at || "");
  if (!Number.isFinite(deadline) || deadline > Date.now()) return run;
  return stopRun(run, "interrupted", { summary: "This review exceeded its deadline or the worker stopped. Completed step results are preserved. Start a new review to retry.", error_code: "WORKFLOW_INTERRUPTED" });
}

async function reconcileMany(runs, { signal } = {}) {
  const assertActive = () => { if (signal?.aborted) throw execution.abortError(); };
  const result = new Array(runs.length);
  // Request-local only: a later poll must reread receipts, revisions and access.
  const receipts = new Map();
  for (let offset=0;offset<runs.length;offset+=8) {
    assertActive();
    const batch=runs.slice(offset,offset+8), pending=new Map();
    for (const run of batch) if (publicationRecoveryNeeded(run)) {
      const key=JSON.stringify([run.project_id,run.id]);
      if (!receipts.has(key)) pending.set(key,run);
    }
    if (pending.size) {
      const rows=await store.publicationRows([...pending.values()]);
      assertActive();
      const byId=new Map([...pending.values()].map(run=>[run.id,run]));
      for (const key of pending.keys()) receipts.set(key,[]);
      for (const row of rows) {
        const run=byId.get(row.run_id);
        if (!run) continue;
        const values=receipts.get(JSON.stringify([run.project_id,run.id]));
        values.push(row);
        if (values.length>2000) throw error('Recorded publication receipts exceed the workflow limit.',409);
      }
    }
    const reconciled=await mapWithConcurrency(batch,2,run=>{
      assertActive();
      return reconcile(run,{publicationRows:receipts.get(JSON.stringify([run?.project_id,run?.id]))});
    });
    reconciled.forEach((run,index)=>{result[offset+index]=run;});
  }
  return result;
}

// Compare the saved node snapshot when stopping, so a stale cancellation or
// deadline check cannot overwrite progress persisted by another worker.
async function stopRun(run, state, details) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const current = await store.get(run.id);
    if (!current || current.status !== "running") return current || run;
    const nodes = current.node_results.map(node => {
      if (!["running", "queued"].includes(node.status)) return node;
      const stopped = { ...node, status: node.status === "running" ? state : "skipped", completed_at: new Date().toISOString(), logs: [...(node.logs || [])] };
      if (node.status === "queued") stopped.skip_reason = `Execution ${state} before this step started.`;
      else {
        stopped.duration_ms = events.duration(stopped);
        stopped.error = details.summary;
        stopped.error_details = { code: details.error_code, message: details.summary, retryable: false };
      }
      events.log(stopped, { event: `node_${stopped.status}`, level: "warning", code: details.error_code, message: stopped.skip_reason || details.summary });
      return stopped;
    });
    if (await store.save(run.id, state, nodes, { ...current.output_payload, status: state, ...details, summary: terminalSummary(current, state, nodes, details.summary) }, current.node_results)) {
      active.get(run.id)?.controller.abort();
      return await store.get(run.id);
    }
  }
  throw error("Execution progress changed while stopping. Retry the stop request.", 409);
}

function compactUpstream(run, node) {
  return scheduling.orderedEdges(array(run.workflow_snapshot.edges), node.id).flatMap(edge => {
    const id = edge.source;
    const prior = run.node_results.find(result => result.node_id === id);
    if (!scheduling.selectedEdge(edge, prior, kindOf(node), run.loop_owner)) return [];
    const output = prior.output?.routes ? { ...prior.output, data: prior.output.routes[edge.sourceHandle] } : prior.output;
    return [{ node_id: id, output_key: run.workflow_snapshot.nodes.find(item => item.id === id)?.data?.outputKey, node_name: prior.node_name, status: prior.status, output, execution_context: prior.execution_context, error: prior.error, error_details: prior.error_details, input: prior.status === "failed" ? prior.input : undefined, attempts: prior.attempts }];
  });
}

// Upstream model text is a labelled proposal, never promoted to authoritative
// project evidence. Every specialist independently retrieves permitted evidence.
const {specialistPrompt,collectReviews,reviewSource}=require('../workflows/nodes/shared/reviewContext');
const needsAttention = source => source.status === 'failed' || ['limited','limited_evidence','insufficient_evidence'].includes(source.output?.readiness?.status) || source.output?.verification?.status === 'needs_input' || array(source.iterations).some(item => needsAttention(item));

function terminalSummary(run, status, nodes, fallback) {
  const saved = new Map();
  for (const node of nodes.flatMap(node => [...array(node.iterations), node])) for (const receipt of array(node.output?.library_publication?.receipts)) {
    if (receipt.saved === true && text(receipt.id) && ['manual', 'automation'].includes(receipt.kind)) saved.set(`${receipt.kind}:${receipt.id}`, receipt);
  }
  if (!saved.size) return fallback;
  const count = kind => [...saved.values()].filter(receipt => receipt.kind === kind).length;
  const manual = count('manual'), automation = count('automation');
  const messages = [];
  if (manual) messages.push(`Saved ${manual} manual Test Case${manual === 1 ? '' : 's'} pending review.`);
  if (automation) messages.push(`Saved ${automation} automation Test Case${automation === 1 ? '' : 's'} pending review and unverified.`);
  if (typeof fallback === 'string' && fallback.startsWith(messages.join(' '))) return fallback;
  if (status === 'needs_review') messages.push(nodes.flatMap(node => [...array(node.iterations), node]).some(node => node.output?.verification?.status === 'needs_input')
    ? 'Additional automation inputs are still needed.' : 'The remaining workflow findings need attention.');
  else if (status !== 'completed' || run.workflow_snapshot?.runtime_contract?.target_node_id) messages.push(fallback);
  return messages.filter(Boolean).join(' ');
}

async function executeNode(run, node, user, signal, onAttempt, onProgress = async () => {}, onEvent = async () => {}, state = {}) {
  try { return await require("@hellotest/platform/backend/src/utils/llmTraceContext").run(
    { project_id: run.project_id, actor_id: user.id, run_id: run.id, node_id: node.id },
    () => {
      const kind=kindOf(node), effect=kind==='mcpTool'||(['apiTool','apiAgent'].includes(kind)&&!['GET','HEAD','OPTIONS'].includes(operations._internals.httpMethod(kind,node.data)));
      const runTask=()=>executeNodeTask(run,node,user,signal,onAttempt,onProgress,onEvent,state);
      const aiNode=['agent','llmAgent','customAI','artifactTask','repositoryAgent'].includes(kind) || kind==='loop' && node.data.loopAction==='customAI';
      const dispatch=()=>aiNode ? nodeAiConfiguration.runNode(node,{revision:run.workflow_snapshot?.updated_at || run.workflow_snapshot?.id},runTask) : runTask();
      return effect ? require('../workflows/operationJournal').invoke({run,node,user,input:compactUpstream(run,node)},dispatch) : dispatch();
    }); }
  catch (failure) {
    if (failure.code === "DEADLINE_EXCEEDED" && !signal.aborted) throw Object.assign(error(`${nodeName(node)} reached its step timeout. Increase the timeout or reduce the work in this step.`, 504), { code: "NODE_TIMEOUT" });
    throw failure;
  }
}
async function executeNodeTask(run, node, user, signal, onAttempt, onProgress, onEvent, state = {}) {
  const registered = nodeRegistry.get(kindOf(node));
  if (!registered?.executable) throw error('This node has no registered executable adapter.', 422);
  return executeRegisteredNodeTask(run,node,user,signal,onAttempt,onProgress,onEvent,state);
}
async function executeRegisteredNodeTask(run,node,user,signal,onAttempt,onProgress,onEvent,state={}) {
  const registered=nodeRegistry.get(kindOf(node)),data=object(node.data),kind=kindOf(node),sources=compactUpstream(run,node);
  const context={run,node,user,signal,sources,onAttempt,onProgress,onEvent,requireRunAccess,
    review:(itemRun,itemNode)=>executeNode(itemRun,itemNode,user,signal,attempt=>onAttempt(attempt,{item_index:itemRun.iteration_index}),onProgress,event=>onEvent({...event,item_index:itemRun.iteration_index})),
    executeConnectedLoop:()=>executeLoopBody(run,node,user,signal,state.persist,onProgress)};
  if(registered.executor==='flow')return execution.bounded(nodeSignal=>registered.implementation.execute({...context,context:contextFor(run,sources),signal:nodeSignal}),{timeoutMs:Number(data.timeoutMs)||30000,signal});
  if(registered.executor!=='operation')return registered.implementation.execute(context);
  if(registered.connectedLoop?.(data))return registered.implementation.execute(context);
  if(registered.specialistAlias)return registered.implementation.execute(context);
  return execution.bounded(async nodeSignal=>{
    const retries=!['loop','customAI'].includes(kind)&&events.canRetry(kind,data)?Number(data.retryCount||0):0;
    for(let attempt=0;;attempt++){
      await requireRunAccess(user,run.project_id);
      if(kind!=='loop'||data.loopAction!=='customAI')await onAttempt(attempt+1);
      try{return await registered.implementation.execute({...context,signal:nodeSignal,review:(itemRun,itemNode)=>executeNode(itemRun,itemNode,user,nodeSignal,attempt=>onAttempt(attempt,{item_index:itemRun.iteration_index}),onProgress,event=>onEvent({...event,item_index:itemRun.iteration_index}))});}
      catch(failure){if(nodeSignal.aborted||attempt>=retries||!events.retryable(failure))throw failure;
        const delay=Number(data.retryDelayMs??300)*(attempt+1);
        await onEvent({level:'warning',event:'retry_scheduled',attempt:attempt+1,retry_delay_ms:delay,status_code:failure.statusCode,message:`Attempt ${attempt+1} failed. Retrying in ${delay} ms.`});
        await execution.bounded(()=>new Promise(resolve=>setTimeout(resolve,delay)),{timeoutMs:delay+1000,signal:nodeSignal});
      }
    }
  },{timeoutMs:Number(data.timeoutMs)||30000,signal});
}

async function runStep(run, node, user, signal, persist, shouldRun) {
  await requireRunAccess(user, run.project_id);
  if (signal.aborted) throw execution.abortError();
  const result = run.node_results.find(item => item.node_id === node.id);
  const incomingEdges = run.workflow_snapshot.edges.filter(edge => edge.target === node.id);
  const activeEdges = incomingEdges.filter(edge => scheduling.selectedEdge(edge, run.node_results.find(item => item.node_id === edge.source), kindOf(node), run.loop_owner));
  if (shouldRun === false || (shouldRun == null && kindOf(node) !== "trigger" && !activeEdges.length)) {
    result.status = "skipped";
    result.skip_reason = kindOf(node) === "errorHandler" ? "No upstream failure to recover." : "No selected upstream branch reached this node.";
    result.completed_at = new Date().toISOString();
    events.log(result, { event: "node_skipped", message: result.skip_reason });
    if (kindOf(node) === 'loop' && node.data.loopAction === 'workflow') for (const id of graphContract.loopBodies(run.workflow_snapshot.nodes, run.workflow_snapshot.edges)[node.id]) {
      const child = run.node_results.find(item => item.node_id === id);
      child.status = 'skipped'; child.skip_reason = 'The loop branch was not selected.'; child.completed_at = result.completed_at;
    }
    await persist();
    return { routed: true };
  }
  result.status = "running";
  result.started_at = new Date().toISOString();
  const upstream = compactUpstream(run, node);
  result.input = {
    input_mode: kindOf(node) === "artifactTask" ? "native_task_context" : "connected_results",
    ...contextFor(run, upstream, { internal: kindOf(node) === "artifactTask" }),
    ...(kindOf(node) === 'aggregator' ? { merge_mode: node.data?.mergeMode || 'waitAllAppend' } : {}),
    source_node_ids: upstream.map(source => source.node_id),
    // Keep inspectable data bounded. Full upstream output is stored on its own node.
    upstream: upstream.map(source => ({ node_id: source.node_id, status: source.status,
      preview: JSON.stringify(source.output ?? { error: source.error }).slice(0, 2_000), truncated: JSON.stringify(source.output ?? { error: source.error }).length > 2_000 })),
    ...(["agent", "llmAgent", "customAI"].includes(kindOf(node)) ? { prompt: specialistPrompt(run, node, upstream) } : {})
  };
  events.log(result, { event: "node_started", message: "Started the node with its connected input." });
  await persist();
  try {
    const returned = await executeNode(run, node, user, signal,
      async (attempt, detail = {}) => {
        result.attempts += 1;
        events.log(result, { event: "attempt_started", attempt, ...detail, message: `${detail.item_index == null ? "" : `Item ${detail.item_index + 1}: `}attempt ${attempt} started.` });
        await persist();
      },
      async progress => {
        if (progress.current_item && progress.current_item !== result.progress?.current_item) events.log(result, { event: "item_started", item_index: progress.current_item - 1, message: `Processing item ${progress.current_item} of ${progress.total_items}.` });
        result.progress = progress; await persist();
      },
      async event => { events.log(result, event); await persist(); }, { persist });
    // Native artifact work keeps its revision-bound lineage in the recorded
    // execution checkpoint. The public node output contains only that node's
    // result; downstream native tasks explicitly hydrate the internal context.
    const native = kindOf(node) === "artifactTask" ? returned?.__workflow_result : null;
    const output = native ? native.output : returned;
    if (native && (!native.output || !native.context || typeof native.output !== "object" || typeof native.context !== "object")) throw error("The native task returned an invalid execution checkpoint.", 502);
    const outputLimit = run.workflow_snapshot.nodes.some(item => item.data?.kind === "artifactTask") ? 2 * 1024 * 1024 : 128 * 1024;
    if (Buffer.byteLength(JSON.stringify(native || output)) > outputLimit) throw error(`Node output exceeded ${outputLimit / 1024} KB. Reduce the Sprint scope or number of cases per Story.`, 422);
    result.output = output;
    if (native) result.execution_context = native.context;
    else if (["condition", "log", "wait", "aggregator", "output"].includes(kindOf(node))) {
      const selectedEdge = kindOf(node) === 'aggregator' && node.data?.mergeMode === 'chooseInput'
        ? scheduling.orderedEdges(run.workflow_snapshot.edges, node.id)[Number(node.data.mergeChooseInput ?? 1) - 1] : null;
      const inherited = mergeExecutionContext(selectedEdge ? upstream.filter(source => source.node_id === selectedEdge.source) : upstream);
      if (inherited) result.execution_context = inherited;
    }
  } catch (failure) {
    failure = events.withNode(failure, run, node);
    if (signal.aborted || failure.outcome_unknown || [401,403,499].includes(failure.statusCode) || node.data?.onError !== "errorOutput") throw failure;
    result.status = "failed";
    result.error_details = events.failureInfo(failure);
    result.error = result.error_details.message;
    result.completed_at = new Date().toISOString();
    result.duration_ms = events.duration(result);
    events.log(result, { event: "node_failed", level: "error", ...result.error_details });
    events.log(result, { event: "error_routed", level: "warning", message: "Failure routed to the connected Error handler. The successful path will be skipped." });
    await persist();
    return { routed: true };
  }
  if (signal.aborted) throw execution.abortError();
  result.status = "completed";
  result.completed_at = new Date().toISOString();
  result.duration_ms = events.duration(result);
  result.output_size_bytes = Buffer.byteLength(JSON.stringify(result.output));
  result.attempts = Math.max(result.attempts, 1);
  if (kindOf(node) === "log") events.log(result, { event: "user_log", message: result.output.message });
  if (kindOf(node) === "condition") events.log(result, { event: "branch_selected", message: `Selected the ${result.output.matched ? "true" : "false"} branch.` });
  events.log(result, { event: "node_completed", duration_ms: result.duration_ms, ...(node.data?.logLevel === "audit" ? { output_size_bytes: result.output_size_bytes, source_node_ids: upstream.map(source => source.node_id) } : {}), message: result.output.session_id ? "Specialist review saved with its evidence and provenance." : "Node completed with its connected results." });
  run.output_payload.completed_steps = run.node_results.filter(item => item.status === 'completed').length;
  await persist();
  const settings = run.workflow_snapshot.settings || {};
  if (kindOf(node) === 'artifactTask' && ['test-case-generation', 'automation-engineer'].includes(node.data.artifactTask)
    && settings.template_id === 'sprint-automator' && settings.library_publication_mode === 'automatic') {
    const recordPublication = publication => {
      result.output.library_publication = publication;
      if (array(publication?.receipts).some(receipt => receipt.saved === true && text(receipt.id))) run.output_payload.project_changes_applied = true;
    };
    const checkpointPublication = async publication => {
      if (!array(publication?.receipts).some(receipt => receipt.saved === true && text(receipt.id))) return;
      try { await execution.run({signal:undefined},()=>store.mergePublication(run.id,node.id,publication.status)); }
      catch (failure) { recordFailure(run,'publication_metadata',failure,node.id); }
    };
    await requireRunAccess(user, run.project_id);
    if (signal.aborted) throw execution.abortError();
    try {
      recordPublication(await require('../workflows/acceptDraft').publishNodeArtifacts({ run, node, user, signal }));
      await checkpointPublication(result.output.library_publication);
      events.log(result, { event: 'library_publication_completed', message: 'Generated artifacts were saved for review; approval and execution remain separate.' });
      await persist();
    } catch (failure) {
      failure = events.withNode(failure, run, node);
      if (failure.library_publication) { recordPublication(failure.library_publication); await checkpointPublication(failure.library_publication); }
      result.status = 'failed';
      result.error_details = events.failureInfo(failure);
      result.error = result.error_details.message;
      run.output_payload.completed_steps = run.node_results.filter(item => item.status === 'completed').length;
      await persist();
      throw failure;
    }
  }
  return { needsReview: result.output.readiness?.status === "insufficient_evidence", needsAttention: result.output.verification?.status === 'needs_input' };
}

async function executeLoopBody(run, node, user, signal, persist = async () => {}, onProgress = async () => {}) {
  const incoming = compactUpstream(run, node);
  const context = contextFor(run, incoming);
  const inputLineage = mergeExecutionContext(incoming);
  const items = operations._internals.readPath(context, node.data.loopSourceKey || 'input.items');
  if (!Array.isArray(items)) throw error('Loop Over Items must read an array. Select its Items path in the Input panel.', 422);
  const max = Number(node.data.loopMaxIterations), size = Number(node.data.loopBatchSize || 1);
  if (items.length > max) throw error(`Loop Over Items received ${items.length} items; its configured limit is ${max}. Reduce the input or increase the limit to at most 100.`, 422);
  const bodyIds = graphContract.loopBodies(run.workflow_snapshot.nodes, run.workflow_snapshot.edges)[node.id];
  // Native stages already permit 2 MB artifacts. A connected Sprint loop must
  // retain the same output budget instead of failing at the generic 128 KB cap.
  const nativeBody = run.workflow_snapshot.nodes.some(step => bodyIds.includes(step.id) && kindOf(step) === 'artifactTask');
  const collectionLimit = nativeBody ? 2 * 1024 * 1024 : 128 * 1024;
  const historyLimit = nativeBody ? 16 * 1024 * 1024 : 2 * 1024 * 1024;
  const bodies = graphContract.loopBodies(run.workflow_snapshot.nodes, run.workflow_snapshot.edges);
  const nestedIds = new Set(Object.entries(bodies).filter(([id]) => bodyIds.includes(id)).flatMap(([, ids]) => ids));
  const directIds = bodyIds.filter(id => !nestedIds.has(id));
  const bodyNodes = run.workflow_snapshot.execution_order.filter(id => directIds.includes(id)).map(id => run.workflow_snapshot.nodes.find(item => item.id === id));
  const loopResult = run.node_results.find(result => result.node_id === node.id);
  const collected = [], paired_items = [], batches = Math.ceil(items.length / size);
  let limited = false;
  let lineageComplete = true;
  let collectedLineage = null;
  const budget = run.loop_budget || (run.loop_budget = { batches: 0, node_executions: 0 });
  loopBudget.estimate({ workflow: run.workflow_snapshot, node, items, context, used: budget });
  const budgetStart = { ...budget };
  await execution.bounded(async loopSignal => {
    for (let batchIndex = 0; batchIndex < batches; batchIndex++) {
      if (++budget.batches > loopBudget.LIMITS.batches) throw error(`Connected loops support at most ${loopBudget.LIMITS.batches} total batches, including nested loops. Reduce the input or increase batch size.`, 422);
      const batch = items.slice(batchIndex * size, (batchIndex + 1) * size);
      const child = { ...run, loop_owner: node.id, loop_item: size === 1 ? batch[0] : batch,
        iteration_index: batchIndex, iteration_total: batches, loop_batch_size: batch.length,
        iteration_path: [...(run.iteration_path || []), node.id, batchIndex] };
      loopResult.output = { data: batch, loop_mode: 'workflow', current_batch: batchIndex + 1, total_batches: batches };
      delete loopResult.execution_context;
      if (inputLineage) {
        const selected = batch.map(item => {
          const storyMatch = inputLineage.data.find(packet => item?.story_id === packet.story_id
            && JSON.stringify(item.story_revision) === JSON.stringify(packet.story_revision));
          if (storyMatch) return storyMatch;
          // Nested Sprint loops iterate a case draft while its private native
          // checkpoint remains Story-scoped. Bind by the exact draft identity
          // and content, never by an untrusted array position alone.
          if (typeof item?.client_id === 'string' && item.client_id) {
            const fingerprint = require('../workflows/artifactTasks').fingerprint;
            const matches = inputLineage.data.filter(packet => packet.cases?.some(draft => draft?.client_id === item.client_id
              && fingerprint(draft) === fingerprint(item)));
            return matches.length === 1 ? matches[0] : null;
          }
          return null;
        });
        if (selected.some(packet => !packet)) throw error('A loop over native artifact results must select Story items with their exact Story identity and revision.', 409);
        loopResult.execution_context = { data: selected };
      }
      for (const id of bodyIds) {
        const index = run.node_results.findIndex(result => result.node_id === id), prior = run.node_results[index];
        run.node_results[index] = { node_id: prior.node_id, node_name: prior.node_name, node_type: prior.node_type, specialist_id: prior.specialist_id,
          status: 'queued', execution_mode: MODE, attempts: 0, logs: [], iterations: prior.iterations || [] };
      }
      const pending = new Set(directIds);
      await onProgress({ percent: Math.round(batchIndex / batches * 100), current_item: batchIndex * size + 1, total_items: items.length, current_batch: batchIndex + 1, total_batches: batches, batch_size: batch.length });
      try {
        while (pending.size) {
          if (loopSignal.aborted) throw execution.abortError();
          const next = scheduling.readyBatch({ nodes: bodyNodes, edges: run.workflow_snapshot.edges, results: run.node_results, pending, maxParallel: 1, loopOwner: node.id });
          if (!next.length) throw error('The loop body has unresolved dependencies.', 409);
          const step = next[0];
          if (++budget.node_executions > loopBudget.LIMITS.node_executions) throw error(`Connected loops support at most ${loopBudget.LIMITS.node_executions} body step executions. Reduce the input or simplify the body.`, 422);
          let outcome;
          try { outcome = await runStep(child, step, user, loopSignal, persist); }
          catch (failure) {
            failure = events.withNode(failure, child, step);
            const stopped = run.node_results.find(item => item.node_id === step.id);
            stopped.status = loopSignal.aborted ? 'cancelled' : 'failed'; stopped.error_details = events.failureInfo(failure); stopped.error = stopped.error_details.message;
            stopped.completed_at = new Date().toISOString(); stopped.duration_ms = events.duration(stopped);
            events.log(stopped, { event: 'node_' + stopped.status, level: 'error', ...stopped.error_details });
            throw failure;
          }
          pending.delete(step.id);
          if (outcome?.needsReview) { limited = true; break; }
        }
        const returnEdges = run.workflow_snapshot.edges.filter(edge => edge.target === node.id && scheduling.isReturn(edge));
        const nativeSources = [];
        for (const edge of returnEdges) {
          const source = run.node_results.find(result => result.node_id === edge.source);
          if (!scheduling.selectedEdge({ ...edge, targetHandle: undefined }, source, 'loop')) continue;
          nativeSources.push(source);
          const value = source.output?.routes ? source.output.routes[edge.sourceHandle] : Object.hasOwn(source.output || {}, 'data') ? source.output.data : source.output;
          const values = Array.isArray(value) ? value : [value];
          for (let index = 0; index < values.length; index++) {
            collected.push(values[index]); paired_items.push({ batch_index: batchIndex, source_node_id: edge.source, source_item_index: index, input_start_index: batchIndex * size, input_item_count: batch.length });
          }
        }
        if (nativeSources.some(source => !source.execution_context)) lineageComplete = false;
        const inherited = lineageComplete ? mergeExecutionContext([...(collectedLineage ? [{ execution_context: collectedLineage }] : []), ...nativeSources]) : null;
        if (inherited) collectedLineage = inherited;
        if (Buffer.byteLength(JSON.stringify(collected)) > collectionLimit || collected.length > 1000) throw error(`Collected loop output exceeds 1000 items or ${collectionLimit / 1024} KB. Reduce the input or aggregate inside the body.`, 422);
      } finally {
        for (const id of bodyIds) {
          const result = run.node_results.find(item => item.node_id === id);
          if (result.status === 'queued') { result.status = 'skipped'; result.skip_reason = limited ? 'An earlier body step needs evidence.' : 'This batch stopped before the step ran.'; }
          if (!directIds.includes(id)) continue;
          const { iterations, ...snapshot } = result;
          iterations.push({ ...structuredClone(snapshot), batch_index: batchIndex, iteration_path: child.iteration_path, input_start_index: batchIndex * size, input_item_count: batch.length });
        }
        if (Buffer.byteLength(JSON.stringify(run.node_results)) > historyLimit) throw error(`Loop execution records exceed ${historyLimit / 1024 / 1024} MB. Reduce the loop input or step output.`, 422);
        await persist();
      }
      if (limited) break;
    }
  }, { timeoutMs: Number(node.data.timeoutMs) || MAX_DURATION_MS, signal });
  if (!batches) for (const id of bodyIds) {
    const result = run.node_results.find(item => item.node_id === id);
    result.status = 'skipped'; result.skip_reason = 'The loop received no input items.'; result.completed_at = new Date().toISOString();
  }
  delete loopResult.execution_context;
  if (lineageComplete && collectedLineage) loopResult.execution_context = collectedLineage;
  await onProgress({ percent: limited ? loopResult.progress?.percent || 0 : 100, total_items: items.length, total_batches: batches, completed_batches: run.node_results.find(result => bodyIds.includes(result.node_id))?.iterations?.length || 0 });
  return { data: collected, paired_items, loop_mode: 'workflow', processed: limited ? Math.min(items.length, (run.node_results.find(result => bodyIds.includes(result.node_id))?.iterations?.length || 0) * size) : items.length,
    total_batches: batches, execution_usage: { batches: budget.batches - budgetStart.batches, node_executions: budget.node_executions - budgetStart.node_executions }, ...(limited ? { readiness: { status: 'insufficient_evidence' } } : {}) };
}

async function perform(run, user, controller) {
  let currentNode = null;
  let checking = false;
  let heartbeatErrorLogged = false;
  const checkState = async () => {
    if (checking || controller.signal.aborted) return;
    checking = true;
    try {
      const current = await store.get(run.id);
      heartbeatErrorLogged = false;
      if (current?.status !== "running") controller.abort();
    } catch (failure) {
      // A database acquisition/read failure does not establish that a person
      // cancelled the workflow. Native/step deadlines still bound the work;
      // only an observed terminal record can stop it through this heartbeat.
      if (!heartbeatErrorLogged) recordFailure(run, 'heartbeat_read', failure, currentNode);
      heartbeatErrorLogged = true;
    }
    finally { checking = false; }
  };
  const heartbeat = setInterval(() => void checkState(), 1_000);
  heartbeat.unref?.();
  let persistence = Promise.resolve();
  const persist = () => {
    const next = persistence.then(async () => {
      if (controller.signal.aborted) throw execution.abortError();
      if (!await store.save(run.id, 'running', structuredClone(run.node_results), structuredClone(run.output_payload))) { controller.abort(); throw execution.abortError(); }
    });
    persistence = next.catch(() => {});
    return next;
  };
  try {
    await execution.bounded(async signal => {
      const bodyIds = new Set(Object.values(graphContract.loopBodies(run.workflow_snapshot.nodes, run.workflow_snapshot.edges)).flat());
      const pending = new Set(run.workflow_snapshot.execution_order.filter(id => !bodyIds.has(id)));
      const plan = processing(run.workflow_snapshot);
      while (pending.size) {
        await requireRunAccess(user, run.project_id);
        if (signal.aborted) throw execution.abortError();
        const batch = scheduling.readyBatch({ nodes: run.workflow_snapshot.execution_order.map(id => run.workflow_snapshot.nodes.find(node => node.id === id)), edges: run.workflow_snapshot.edges, results: run.node_results, pending, maxParallel: plan.max_parallel_nodes });
        if (!batch.length) throw error('No workflow node can run because its dependencies have not finished.', 409);
        const batchController = new AbortController();
        const abort = () => batchController.abort();
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
        let batchFailure;
        const outcomes = await Promise.allSettled(batch.map(async node => {
          currentNode = node.id;
          try { return await runStep(run, node, user, batchController.signal, persist); }
          catch (failure) {
            failure = events.withNode(failure, run, node);
            const observed = run.node_results.find(item => item.node_id === node.id);
            if (observed) {
              observed.error_details = events.failureInfo(failure);
              observed.error = observed.error_details.message;
              events.log(observed, {event:'node_failure_observed',level:failure.name==='AbortError'?'warning':'error',...observed.error_details});
            }
            if (!batchFailure) { batchFailure = failure; currentNode = node.id; batchController.abort(); }
            throw failure;
          }
        }));
        signal.removeEventListener('abort', abort);
        if (batchFailure) throw batchFailure;
        batch.forEach(node => pending.delete(node.id));
        const stopped = outcomes.findIndex(outcome => outcome.value?.needsReview);
        if (stopped >= 0) {
          const node = batch[stopped];
          currentNode = node.id;
          run.node_results = terminalNodes(run.node_results, currentNode, "completed");
          await persistTerminal(run, "needs_review", run.node_results, { ...run.output_payload, status: "needs_review", summary: `${nodeName(node)} needs additional evidence.`, review_session_ids: run.node_results.map(item => item.output?.session_id).filter(Boolean) });
          return;
        }
      }
      const reviews = collectReviews(run.node_results.filter(reviewSource)).map(({ response, citation_ids, ...review }) => review);
      const targetId = run.workflow_snapshot.runtime_contract.target_node_id;
      const noResult = targetId ? run.node_results.find(item => item.node_id === targetId)?.status === "skipped" : !run.node_results.some(item => item.node_type === "output" && item.status === "completed");
      const limited = noResult || reviews.some(review => review.readiness?.status !== "ready_for_review") || run.node_results.some(needsAttention);
      if (signal.aborted) throw execution.abortError();
      await persistTerminal(run, limited ? "needs_review" : "completed", run.node_results, { ...run.output_payload, status: limited ? "needs_review" : "completed",
        summary: noResult ? "The selected branch did not reach an output or the requested step. Check the condition and its connections." : run.node_results.some(item => item.status === "failed") ? "Workflow finished through its error recovery path. Inspect the failed steps and recovery results before acting." : limited ? "Review workflow finished with evidence limitations. Inspect each review before acting." : targetId ? "Selected step and its preceding steps completed. Downstream steps were not executed." : "Review workflow completed. Evidence and proposed next actions are ready for human review.",
        reviews, review_session_ids: reviews.map(review => review.session_id).filter(Boolean),
        results: run.node_results.filter(item => item.node_type === "output" && item.status === "completed").map(item => ({ node_id: item.node_id, output: item.output })) });
    }, { timeoutMs: Math.max(1, Date.parse(run.workflow_snapshot.runtime_contract.deadline_at) - Date.now()), signal: controller.signal });
  } catch (failure) {
    if (failure.code === 'WORKFLOW_TERMINAL_PERSISTENCE') throw failure;
    const failedNode = run.workflow_snapshot.nodes.find(node => node.id === currentNode);
    if (failedNode) failure = events.withNode(failure, run, failedNode);
    recordFailure(run, 'execution', failure, currentNode);
    const timedOut = failure.code === "DEADLINE_EXCEEDED";
    const state = timedOut ? "interrupted" : controller.signal.aborted || failure.name === "AbortError" ? "cancelled" : "failed";
    const message = timedOut ? "The review reached its deadline. Completed results are preserved."
      : state === "cancelled" ? "Review execution stopped. Completed results are preserved."
        : failure.statusCode === 403 ? "Access changed while this review was running. Further steps were stopped."
          : events.safeMessage(failure.publicMessage, "A workflow node could not finish. Review its configuration and completed output before retrying.");
    run.node_results = terminalNodes(run.node_results, currentNode, state);
    const failedStep = run.node_results.find(node => node.node_id === currentNode && node.status === state);
    if (failedStep) {
      failedStep.error = message;
      failedStep.error_details = { ...events.failureInfo(failure), message };
      failedStep.duration_ms = events.duration(failedStep);
      events.log(failedStep, { event: "node_" + state, level: "error", ...failedStep.error_details });
    }
    const diagnostic = events.failureInfo(failure);
    await persistTerminal(run, state, run.node_results, { ...run.output_payload, status: state, summary: message,
      failed_node_id: diagnostic.origin?.node_id || currentNode,
      ...(diagnostic.origin?.node_id && diagnostic.origin.node_id !== currentNode ? {failed_parent_node_id:currentNode} : {}),
      error_code: timedOut ? "WORKFLOW_DEADLINE" : state === "cancelled" ? "WORKFLOW_CANCELLED" : diagnostic.code,
      error_details:diagnostic });
  } finally { clearInterval(heartbeat); }
}

async function start(workflow, input = {}, user, trusted = {}) {
  await requireRunAccess(user, workflow.project_id);
  require('../workflows/executionRuntimePolicy').assertExecutionRuntime({durable:require('../workflows/temporal/control').enabled()});
  const targetNodeId = input.target_node_id || "";
  if (input.input_payload !== undefined && (input.input_payload === null || typeof input.input_payload !== "object" || Array.isArray(input.input_payload))) throw error("Workflow input must be a JSON object.");
  const payload = object(input.input_payload);
  if (Buffer.byteLength(JSON.stringify(payload)) > MAX_INPUT_BYTES) throw error("Review input is limited to 16 KB.");
  const report = await checkReadiness(workflow, targetNodeId, user, payload);
  if (!report.ready) throw Object.assign(error(report.blockers.map(item => item.message).join(" "), 422), { readiness: report });
  const durationMs = workflowDuration(workflow);
  const needsRequestSource = report.steps.some(step => step.kind === "repositoryAgent" && workflow.edges.filter(edge => edge.target === step.node_id).every(edge => kindOf(workflow.nodes.find(node => node.id === edge.source)) === "trigger"));
  if (needsRequestSource && (object(payload.source).type !== "github" || !text(object(payload.source).repository_url))) throw error("Add source.type = github and source.repository_url to Workflow input before starting source analysis.");
  workflow = structuredClone(workflow);
  for (const node of workflow.nodes) {
    delete node.data.agentSnapshot;
    delete node.data.mcpToolHash;
    if (kindOf(node) === "mcpTool" && report.steps.some(step => step.node_id === node.id)) {
      const { connection } = await require("../workflows/connections").resolve(node.data.connectionId, workflow.project_id, null, "mcp");
      const tool = connection.toolDefinitions?.find(item => item.name === node.data.mcpTool);
      if (!tool) throw error("Discover and save the MCP tool catalog in Integrations before running this workflow.", 422);
      node.data.mcpToolHash = require("../workflows/mcpClient")._internals.schemaHash(tool);
    }
    if (report.steps.some(step => step.node_id === node.id) && String(node.data.agentId || "").startsWith("agent-")) {
      const pinned = await agentRegistry.resolve(node.data.agentId, node.data.agentVersion, workflow.project_id);
      agentContract.validateInputs(pinned.definition, payload);
      node.data = { ...agentContract.toNodeData(pinned.definition), ...node.data, agentVersion: pinned.version, agentSnapshot: pinned };
    }
  }
  const requestKey = text(input.request_id);
  if (requestKey && !/^[a-zA-Z0-9_-]{8,128}$/.test(requestKey)) throw error("Use a request ID of 8–128 letters, digits, underscores or hyphens.");
  // A transport retry may save the same definition again. Audit timestamps are
  // not execution input; changing them must not invalidate the idempotency key.
  const requestFingerprint = hash({ workflow: { ...workflow, updated_at: undefined, updated_by: undefined, run_count: undefined, latest_run_at: undefined, latest_run_status: undefined }, payload, targetNodeId, ...(trusted.resume ? {resume:{...trusted.resume,seeds:trusted.resume.seeds.map(row=>({node_id:row.node_id,result_hash:row.result_hash}))}} : {}) });
  const id = requestKey ? `review-${hash([workflow.id, user.id, requestKey]).slice(0, 40)}` : randomUUID();
  const existing = await store.get(id);
  if (existing) {
    if (existing.workflow_snapshot.runtime_contract?.request_fingerprint !== requestFingerprint) throw error("This request ID was already used with a different workflow or input. Start a new review.", 409);
    return reconcile(existing);
  }
  const durable = require("../workflows/temporal/control");
  const automaticLibraryPublication = workflow.settings?.template_id === 'sprint-automator' && workflow.settings?.library_publication_mode === 'automatic';
  const runtime = { mode: "bounded-review-workflow", execution_mode: MODE, simulated: false, arbitrary_code_execution: false,
    scheduler_version: trusted.resume ? 3 : 2,
    ...(trusted.resume ? {resume:{source_run_id:trusted.resume.source_run_id,node_id:trusted.resume.node_id,source_hash:trusted.resume.source_hash,reconciliations:trusted.resume.reconciliations}} : {}),
    ...(automaticLibraryPublication ? { automatic_library_publication: true, initial_project_changes_applied: false } : { project_changes_applied: false }),
    processing: processing(workflow),
    external_write_tools: report.steps.some(step => ["mcpTool", "apiTool", "apiAgent"].includes(step.kind)), requires_human_review: true, max_duration_ms: durationMs, target_node_id: targetNodeId || null,
    deadline_at: new Date(Date.now() + durationMs).toISOString(), request_fingerprint: requestFingerprint,
    orchestrator: durable.enabled() ? "temporal" : "local",
    recovery: durable.enabled() ? "Temporal resumes from durable step receipts. Uncertain operations require reconciliation." : "Interrupted work is preserved; it is never automatically replayed." };
  const run = { id, workflow_id: workflow.id, project_id: workflow.project_id, app_type_id: workflow.app_type_id || null, workflow_name: workflow.name,
    created_by: user.id, execution_mode: MODE, status: "running", trigger_kind: trusted.triggerKind || "manual", input_payload: payload,
    workflow_snapshot: { ...structuredClone(workflow), execution_mode: MODE, runtime_contract: runtime, execution_order: report.steps.map(step => step.node_id), snapped_at: new Date().toISOString() },
    node_results: report.steps.map(step => ({ node_id: step.node_id, node_name: step.name, node_type: step.kind, specialist_id: step.specialist_id, status: "queued", execution_mode: MODE, attempts: 0, logs: [] })),
    output_payload: { execution_mode: MODE, status: "running", project_changes_applied: false, completed_steps: 0, total_steps: report.steps.length, summary: "Review workflow started.", requires_human_review: true, runtime_contract: runtime } };
  if(trusted.resume){
    run.resume_seeds=trusted.resume.seeds;
    run.node_results=run.node_results.map(result=>{const seed=trusted.resume.seeds.find(row=>row.node_id===result.node_id);return seed ? {...seed.result,reused_from_run:trusted.resume.source_run_id} : result;});
    run.output_payload.summary="Resumed from verified prior receipts; remaining steps are queued.";
  }
  if (durable.enabled()) {
    await durable.enqueue(run, () => store.insert(run));
    const persisted = await store.get(id);
    if (persisted?.workflow_snapshot.runtime_contract?.request_fingerprint !== requestFingerprint) throw error("This request ID was already used with different workflow input. Start a new review.", 409);
    return persisted;
  }
  const controller = new AbortController();
  let accepted;
  const inserted = new Promise(resolve => { accepted = resolve; });
  let persisted = false;
  let executionStarted = false;
  const entry = { controller, promise: null, queued: false };
  const job = localQueue.enqueue(id, async ({ queued }) => {
    if (!await inserted) return;
    const current = await store.get(id);
    if (current?.status !== 'running' || controller.signal.aborted) return;
    entry.queued = false;
    run.output_payload = { ...run.output_payload, execution_state: 'running', queue_position: 0, summary: 'Review workflow started.' };
    if (queued) {
      run.workflow_snapshot.runtime_contract.deadline_at = new Date(Date.now() + durationMs).toISOString();
      run.output_payload.runtime_contract = run.workflow_snapshot.runtime_contract;
      if (!await store.activateLocal(id, run.workflow_snapshot, run.output_payload)) return;
    } else if (!await store.save(id, 'running', run.node_results, run.output_payload)) return;
    executionStarted = true;
    await perform(run, user, controller);
  }, { signal: controller.signal, onPosition: async ({ state, position }) => {
    entry.queued = state === 'queued';
    if (state !== 'queued' || !persisted) return;
    const current = await store.get(id);
    if (current?.status !== 'running') return;
    await store.save(id, 'running', current.node_results, { ...current.output_payload, execution_state: 'queued', queue_position: position,
      summary: `Queued for a development worker slot (position ${position}).` }, current.node_results);
  } });
  entry.queued = job.queued;
  run.output_payload.execution_state = job.queued ? 'queued' : 'running';
  run.output_payload.queue_position = localQueue.position(id);
  if (job.queued) run.output_payload.summary = `Queued for a development worker slot (position ${localQueue.position(id)}).`;
  entry.promise = job.promise.catch(async failure => {
    recordFailure(run, 'detached_completion', failure);
    const pending = pendingTerminals.get(run.id);
    if (!executionStarted && !pending) {
      // Queue activation failed before any node dispatch. Preserve an explicit
      // terminal receipt; a later poll may recover it without replaying work.
      const output = { ...run.output_payload, status: 'failed', execution_state: 'failed', queue_position: 0,
        error_code: 'WORKFLOW_START_FAILED', summary: 'The development worker could not start this review. No workflow steps were executed. Start a new review after the service recovers.' };
      try { await persistTerminal(run, 'failed', terminalNodes(run.node_results, '', 'failed'), output); }
      catch { /* The owned pending terminal snapshot remains recoverable on read. */ }
    }
    if (pending) {
      try { await persistTerminal(pending.run, pending.status, pending.nodes, pending.output); }
      catch { /* A later read can recover only this recorded terminal snapshot. */ }
    }
  }).finally(() => { if (active.get(id)?.controller === controller) active.delete(id); });
  active.set(id, entry);
  try {
    const saved = await store.insert(run);
    persisted = Boolean(saved); accepted(persisted);
    if (!saved) {
      controller.abort();
      const concurrent = await store.get(id);
      if (concurrent?.workflow_snapshot.runtime_contract?.request_fingerprint !== requestFingerprint) throw error('This request ID was already used with different workflow input. Start a new review.', 409);
      return concurrent;
    }
    return await store.get(id);
  } catch (failure) {
    accepted(false); controller.abort();
    if (active.get(id)?.controller === controller) active.delete(id);
    throw failure;
  }

}

async function cancel(run, user) {
  await requireRunAccess(user, run.project_id, { allowDisabled: true });
  if (run.execution_mode !== MODE) throw error("Workflow previews cannot be cancelled.", 409);
  if (run.status !== "running") return run;
  if (run.workflow_snapshot.runtime_contract?.orchestrator === "temporal") { await require("../workflows/temporal/control").cancel(run); return store.get(run.id); }
  return stopRun(run, "cancelled", { summary: "Review execution cancelled. Completed step results are preserved.", error_code: "WORKFLOW_CANCELLED", cancelled_by: user.id });
}

const startOnce = async (workflow, input = {}, user) => {
  const key = input.request_id ? hash([workflow.id, user?.id, input.request_id]) : randomUUID();
  if (starting.has(key)) {
    await starting.get(key);
    // Revalidate permission and payload fingerprint on the coalesced request.
    return start(workflow, input, user);
  }
  const promise = start(workflow, input, user);
  starting.set(key, promise);
  try { return await promise; } finally { starting.delete(key); }
};

module.exports = { readiness, checkReadiness, start: startOnce, startResumed: (workflow,input,user,resume) => start(workflow,input,user,{resume}), startTriggered: (workflow,input,user,triggerKind) => { if (!require("../workflows/temporal/control").enabled() || workflow.status!=="active" || triggerKind!==workflow.trigger_kind || !["schedule","webhook","release","event"].includes(triggerKind) || input.target_node_id) throw error("This durable trigger is unavailable.",409); return start(workflow,input,user,{triggerKind}); }, cancel, reconcile, reconcileMany, _internals: { store, active, localQueue, pendingTerminals, persistTerminal, diagnostics, perform, requireRunAccess, specialistPrompt, collectReviews, reviewSource, needsAttention, terminalSummary, executeNode, runStep, terminalNodes, MAX_DURATION_MS } };
