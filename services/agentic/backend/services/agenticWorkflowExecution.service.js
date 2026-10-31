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

// Every offered node has a bounded adapter. Legacy unsupported definitions
// fail readiness before a run starts; no simulated output is passed as real data.
const operations = require("../workflows/nodeOperations");
const { policy: specialistPolicy } = require("../workflows/specialistPolicy");
const { contextFor, appendInputs, mergeInputs, mergeExecutionContext } = operations._internals;
const events = require("../workflows/runtimeEvents");
const MODE = "review";
const MAX_DURATION_MS = 180_000;
const MAX_INPUT_BYTES = 16_384;
const MAX_ARTIFACT_DURATION_MS = 3_600_000;
const workflowDuration = workflow => Math.min(MAX_ARTIFACT_DURATION_MS, Math.max(1000, Number(workflow.settings?.maxDurationMs) || (workflow.nodes?.some(node => node.data?.kind === 'artifactTask') ? MAX_ARTIFACT_DURATION_MS : MAX_DURATION_MS)));
const MAX_PARALLEL_RUNS = 2;
const TERMINAL_SAVE_TIMEOUT_MS = 6000;
const SUPPORTED_KINDS = new Set(["trigger", "agent", "llmAgent", "repositoryAgent", "aggregator", "output", ...operations.KINDS, ...flowOperations.KINDS]);
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
const processing = workflow => ({ mode: workflow.settings?.processing_mode === 'parallel' ? 'parallel' : 'sequential',
  max_parallel_nodes: workflow.settings?.processing_mode === 'parallel' ? Math.min(8, Math.max(1, Number(workflow.settings?.max_parallel_nodes) || 2)) : 1 });
const nodeName = (node) => text(node.data?.label) || node.id;
const hydrate = (run) => run && ({ ...run, execution_mode: parse(run.workflow_snapshot, {}).execution_mode || "preview", workflow_snapshot: parse(run.workflow_snapshot, {}), input_payload: parse(run.input_payload, {}), output_payload: parse(run.output_payload, {}), node_results: parse(run.node_results, []) });

const store = {
  get: async (id) => hydrate(await db.prepare("SELECT * FROM agentic_workflow_runs WHERE id = ?").get(id)),
  insert: async (run) => db.prepare(`INSERT INTO agentic_workflow_runs
    (id, workflow_id, project_id, app_type_id, workflow_name, status, trigger_kind, input_payload, output_payload, workflow_snapshot, node_results, created_by, started_at)
    VALUES (?, ?, ?, ?, ?, 'running', 'manual', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT (id) DO NOTHING RETURNING id`).get(run.id, run.workflow_id, run.project_id, run.app_type_id, run.workflow_name, run.input_payload, run.output_payload, run.workflow_snapshot, run.node_results, run.created_by),
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
  mergePublication: async (id, nodeId = null, publicationStatus = null) => {
    const rows = await db.prepare(`SELECT acceptances.node_id,acceptances.receipt
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
    const updated = hydrate(await db.prepare(`UPDATE agentic_workflow_runs SET
      node_results=(SELECT jsonb_agg(CASE WHEN (?::jsonb -> (item.value->>'node_id')) IS NOT NULL
        THEN jsonb_set(item.value,'{output}',COALESCE(NULLIF(item.value->'output','null'::jsonb),'{}'::jsonb)
          || jsonb_build_object('library_publication',(?::jsonb -> (item.value->>'node_id')) ||
            CASE WHEN ?::text IS NULL THEN jsonb_build_object('status',COALESCE(item.value#>>'{output,library_publication,status}',
              CASE WHEN status IN ('cancelled','interrupted','failed') THEN 'partial' ELSE 'saved' END)) ELSE '{}'::jsonb END),true)
        ELSE item.value END ORDER BY item.ordinality)
        FROM jsonb_array_elements(node_results) WITH ORDINALITY AS item(value,ordinality)),
      output_payload=COALESCE(output_payload,'{}'::jsonb)||'{"project_changes_applied":true}'::jsonb,
      updated_at=CURRENT_TIMESTAMP WHERE id=? RETURNING *`).get(grouped,grouped,publicationStatus,id));
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
  const add = (node, message) => blockers.push({ node_id: node?.id || null, node_name: node ? nodeName(node) : null, message });
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
  if (settings.max_parallel_nodes != null && (typeof settings.max_parallel_nodes === 'boolean' || !Number.isInteger(Number(settings.max_parallel_nodes)) || Number(settings.max_parallel_nodes) < 1 || Number(settings.max_parallel_nodes) > 8)) add(null, 'Run between one and eight independent nodes at a time.');
  if (settings.maxDurationMs != null && (typeof settings.maxDurationMs === 'boolean' || !Number.isInteger(Number(settings.maxDurationMs)) || Number(settings.maxDurationMs) < 1000 || Number(settings.maxDurationMs) > MAX_ARTIFACT_DURATION_MS)) add(null, 'Choose a workflow deadline between 1000 and 3600000 milliseconds.');
  if (settings.requiresApproval || settings.approvalRequired || settings.human_approval_required) add(null, "Approval gates are preview-only. Remove the execution approval gate; results will still require human review before any artifact change.");
  if (settings.execution_mode && !["review", "sequential", "preview"].includes(settings.execution_mode)) add(null, "Only sequential review execution is supported. Parallel or custom execution modes are preview-only.");
  const specialists = nodes.filter(node => ["agent", "llmAgent", "repositoryAgent"].includes(kindOf(node)));
  if (["paused", "archived"].includes(workflow.status)) add(null, "Move this workflow to Draft or Active before executing a review.");
  if (workflow.trigger_kind && workflow.trigger_kind !== "manual") add(null, "Review execution supports manual starts. Change the trigger to Manual; schedules and webhooks are preview-only.");
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
    const incoming = edges.filter(edge => edge.target === node.id && !scheduling.isReturn(edge));
    const outgoing = edges.filter(edge => edge.source === node.id);
    if (!SUPPORTED_KINDS.has(kind)) add(node, `${kind} steps are preview-only. Use a registered specialist for evidence review.`);
    if (data.requiresApproval || data.approvalRequired || data.toolPolicy === "approval-required") add(node, "Approval gates are preview-only. Remove this gate before executing a read-only review.");
    if (data.parallel === true || Number(data.concurrency) > 1 || Number(data.maxConcurrency) > 1) add(node, "Configured parallel concurrency is preview-only. Review branches run in dependency order.");
    if (!["apiTool", "apiAgent"].includes(kind) && text(data.credentialId)) add(node, "Node credentials bind external tools and are preview-only. Remove the credential binding for a specialist evidence review.");
    if (text(data.outputSchema)) add(node, "Custom output schemas are preview-only. Clear the schema to use the specialist's validated evidence-review contract.");
    if (["topK", "maxContextChars", "maxOutputChars", "maxCompletionTokens"].some(key => data[key] != null && String(data[key]).trim())) add(node, "Custom model limits are preview-only. Clear model tuning to use the specialist's bounded retrieval and validated output.");
    if (data.redactSecrets === false || data.redactSecrets === "false") add(node, "Secret redaction is required for executed reviews.");
    if (data.logLevel && !["standard", "audit"].includes(data.logLevel)) add(node, "Use Standard or Audit logging. Debug payload logging is preview-only.");
    if (kind === "trigger" && incoming.length) add(node, "The request trigger cannot have incoming connections.");
    if (kind !== "trigger" && !incoming.length) add(node, "Connect this step to the request trigger or an earlier step.");
    if (kind === "output" && outgoing.length) add(node, "Output steps must finish a branch.");
    if (!["output", "stop"].includes(kind) && node.id !== targetNodeId && !outgoing.length) add(node, "Connect this branch to an Output step.");
    if (kind === "loop" && data.loopAction === "customAI") {
      try { specialistPolicy(data); } catch (failure) { add(node, failure.publicMessage); }
    }
    if (kind === "condition" && outgoing.some(edge => edge.sourceHandle && !["true", "false"].includes(edge.sourceHandle))) add(node, "Connect condition outputs using the true or false ports.");
    if (kind === 'dataOperation' && data.dataOperation === 'switch') {
      const effective = { ...require('../../shared/workflowDataOperations.json').switch.defaults, ...data };
      const routes = parse(effective.dataRoutes, []);
      const handles = new Set(array(routes).map(route => route?.id));
      if (effective.dataFallback === 'fallback') handles.add('fallback');
      if (outgoing.some(edge => !handles.has(edge.sourceHandle) && !(data.onError === 'errorOutput' && nodes.some(next => next.id === edge.target && kindOf(next) === 'errorHandler')))) add(node, 'Connect Switch outputs using a configured route ID or the enabled fallback port.');
    }
    if (kind === "errorHandler" && incoming.some(edge => nodes.find(parent => parent.id === edge.source)?.data.onError !== "errorOutput")) add(node, "Set each connected parent to Route to error handler.");
    if (kind === "repositoryAgent" && !require("../agents/catalog").AGENTS.some(agent => agent.id === data.repositoryAgentType)) add(node, "Choose a source analysis agent.");
    if (kind === "repositoryAgent" && Number(data.retryCount) > 0) add(node, "Source analysis uses its existing worker. Set retries to zero; review a failed analysis before starting a new execution.");
    if (["agent", "llmAgent", "customAI"].includes(kind)) {
      if (kind !== "customAI" && !assistant.AGENT_CATALOG[data.agentId] && !/^agent-[a-f0-9-]{36}$/.test(data.agentId || "")) add(node, "Choose a registered workspace specialist in the step inspector.");
      const prompt = text(data.prompt) || text(data.intent);
      if (!prompt) add(node, "Describe the task this specialist should review.");
      try { specialistPolicy(data); } catch (failure) { add(node, failure.publicMessage); }
    }
    if (text(data.inputExpression) || data.inputMode === "manualReferences") add(node, "Expression inputs are preview-only. Clear the expression and use connected step outputs.");
    if (kind !== "loop" && (text(data.loopSourceKey) || Number(data.loopMaxIterations) > 0)) add(node, "Loop policies are preview-only; remove this step's loop configuration.");
    if (!operations.KINDS.has(kind) && (text(data.apiUrl) || text(data.toolName) || text(data.testOpsAction))) add(node, "External tools and write actions are preview-only. Remove the tool binding to execute an evidence review.");
    if (data.onError && !["stop", "errorOutput"].includes(data.onError)) add(node, "Choose Stop workflow or Route to error handler.");
    if (data.onError === "errorOutput" && !outgoing.some(edge => nodes.some(next => next.id === edge.target && kindOf(next) === "errorHandler"))) add(node, "Connect an Error handler before routing failures.");
    for (const message of operations.validate(node)) add(node, message);
    for (const message of flowOperations.validate(node)) add(node, message);
    if (kind === 'aggregator') for (const message of mergeOperations.validate(data, incoming.length)) add(node, message);
    if (data.aiConfiguration !== undefined || data.reviewCriteria !== undefined) {
      try { nodeAiConfiguration.normalize(data.aiConfiguration); nodeAiConfiguration.reviewCriteria(data); }
      catch (failure) { add(node, failure.publicMessage || failure.message); }
    }
    if (data.mergeMode && kind !== 'aggregator' && !['waitAllAppend', 'waitAllMerge'].includes(data.mergeMode)) add(node, 'Configure Merge modes on a Merge step.');
    const maxTimeout = kind === "artifactTask" || (kind === 'loop' && data.loopAction === 'workflow') ? MAX_ARTIFACT_DURATION_MS : kind === "repositoryAgent" ? MAX_DURATION_MS : kind === "agent" || kind === "customAI" ? 150_000 : 70_000;
    if (data.timeoutMs != null && (!Number.isFinite(Number(data.timeoutMs)) || Number(data.timeoutMs) < 1_000 || Number(data.timeoutMs) > maxTimeout)) add(node, `Choose a step timeout between 1,000 and ${maxTimeout.toLocaleString("en-US")} milliseconds.`);
    if (data.retryCount != null && (!Number.isInteger(Number(data.retryCount)) || Number(data.retryCount) < 0 || Number(data.retryCount) > 2)) add(node, "Review steps support zero, one or two retries within their timeout.");
    if (data.retryDelayMs != null && (!Number.isFinite(Number(data.retryDelayMs)) || Number(data.retryDelayMs) < 0 || Number(data.retryDelayMs) > 10_000)) add(node, "Choose a retry delay between 0 and 10,000 milliseconds.");
  }
  if (nodes.some(node => node.data?.sampleOutput != null)) warnings.push("Execution uses actual connected results. Declared sample outputs are used only in previews.");
  warnings.push("AI and source analysis return reviewable results. HTTP methods and MCP tools can act on external systems only when enabled by the server connection policy.");
  warnings.push(processing(workflow).mode === 'parallel'
    ? `Up to ${processing(workflow).max_parallel_nodes} independent nodes run together after their dependencies finish. External mutations, loops and native artifact tasks run alone; merges preserve input order.`
    : 'Connected branches execute sequentially in dependency order. Each specialist retrieves fresh evidence with its own bounded context policy.');
  return { ready: blockers.length === 0, execution_mode: MODE, target_node_id: targetNodeId || null, blockers, warnings,
    processing: processing(workflow), limits: { max_steps: 100, max_specialists: 4, timeout_ms: workflowDuration(workflow), input_limit_bytes: MAX_INPUT_BYTES, max_parallel_nodes: processing(workflow).max_parallel_nodes },
    steps: ordered.map(node => ({ node_id: node.id, name: nodeName(node), kind: kindOf(node), specialist_id: node.data?.agentId || null })) };
}

async function requireRunAccess(user, projectId, { allowDisabled = false } = {}) {
  if (!user?.id || !await permissions.hasPermission(user, "agentic_workflow.run", projectId)) throw error("Permission required: agentic_workflow.run", 403);
  if (!allowDisabled && !await flags.areEnabled(flags.getFeatureKeysForPermission("agentic_workflow.run"), { user })) throw error("Agent workflows are disabled for this workspace.", 403);
}

async function checkReadiness(workflow, targetNodeId = "", user, inputPayload) {
  const report = readiness(workflow, targetNodeId);
  if (!report.ready) return report;
  const hasInput = inputPayload !== undefined;
  const payload = object(inputPayload);
  const trigger = workflow.nodes.find(node => kindOf(node) === 'trigger');
  const inputBlocker = message => report.blockers.push({ node_id: trigger?.id || null, node_name: trigger ? nodeName(trigger) : null, message });
  if (hasInput) {
    if (!inputPayload || typeof inputPayload !== 'object' || Array.isArray(inputPayload)) inputBlocker('Workflow input must be a JSON object.');
    else if (Buffer.byteLength(JSON.stringify(payload)) > MAX_INPUT_BYTES) inputBlocker('Workflow input is limited to 16 KB.');
    if (report.steps.some(step => step.kind === 'artifactTask')) {
      try { require('../workflows/artifactTasks').checkInput({ project_id: workflow.project_id, app_type_id: workflow.app_type_id, input_payload: payload,workflow_snapshot:workflow }); }
      catch (failure) { inputBlocker(failure.publicMessage || failure.message); }
    } else if (report.steps.some(step => workflow.nodes.find(node => node.id === step.node_id)?.data.apiResource === 'sprintStories')) {
      if (!text(payload.sprint_id)) inputBlocker('Choose a Sprint in Workflow input before reading Sprint Stories.');
      if (payload.project_id && payload.project_id !== workflow.project_id) inputBlocker('The trigger project must match the workflow project.');
    }
  } else if (report.steps.some(step => step.kind === 'artifactTask')) {
    report.warnings.push('Trigger values have not been checked. Choose a Sprint and supply the execution input before running native tasks.');
  }
  if (report.blockers.length) { report.ready = false; return report; }
  for (const step of report.steps) {
    const node = workflow.nodes.find(item => item.id === step.node_id);
    if (!["agent", "llmAgent", "customAI", "repositoryAgent", "artifactTask"].includes(step.kind) && !(step.kind === "loop" && node.data?.loopAction === "customAI")) continue;
    if (step.kind === "repositoryAgent" && !node.data.llmIntegrationId) continue;
    if (step.kind === "artifactTask") {
      try {
        const codes = node.data.artifactTask === 'story-assurance' ? ['requirement.view', 'requirement.ai'] : node.data.artifactTask === 'automation-engineer' ? ['requirement.view', 'automation.ai', 'automation.build', 'automation.code.view'] : ['requirement.view', 'testcase.ai'];
        if (workflow.settings?.template_id === 'sprint-automator' && workflow.settings?.library_publication_mode === 'automatic'
          && ['test-case-generation', 'automation-engineer'].includes(node.data.artifactTask)) {
          codes.push('agentic_workflow.view', 'testcase.create');
          if (node.data.artifactTask === 'automation-engineer') codes.push('automation.view');
        }
        await require('../workflows/artifactTasks').access(user, workflow.project_id, codes);
        if (node.data.artifactTask === 'automation-engineer') await require('../workflows/automationNodeInputs').resolveNodeInputs({ run:{project_id:workflow.project_id,input_payload:payload},node,user,
          access:require('../workflows/artifactTasks').access });
        await nodeAiConfiguration.runNode(node, {}, () => agentRegistry.resolveModel(workflow.project_id, user?.id, node.data.llmIntegrationId || text(payload.integration_id) || undefined,
          require('../workflows/artifactTasks').taskUsageKey(node.data.artifactTask)));
      } catch (failure) { report.blockers.push({ node_id: node.id, node_name: nodeName(node), message: failure.publicMessage || failure.message || "Check the native task model and permissions." }); }
      continue;
    }
    try {
      const registered = String(node.data.agentId || "").startsWith("agent-") ? await agentRegistry.resolve(node.data.agentId, node.data.agentVersion, workflow.project_id) : null;
      await nodeAiConfiguration.runNode(node, {}, () => agentRegistry.resolveModel(workflow.project_id, user?.id, node.data.llmIntegrationId || registered?.definition.integration_id));
    } catch (failure) { report.blockers.push({ node_id: node.id, node_name: nodeName(node), message: failure.publicMessage || "Check this agent's version and model connection." }); }
  }
  const connections = require("../workflows/connections");
  for (const step of report.steps.filter(step => ["mcpTool", "apiTool", "apiAgent", "webAgent"].includes(step.kind))) {
    const node = workflow.nodes.find(node => node.id === step.node_id), data = node.data || {};
    try {
      const { connection } = await connections.resolve(data.connectionId, workflow.project_id, step.kind === "mcpTool" ? null : data.apiUrl, step.kind === "mcpTool" ? "mcp" : "http");
      if (step.kind === "mcpTool" && !connection.tools?.includes(data.mcpTool)) throw error("Enable this tool in Integrations or choose an enabled tool.");
      if (step.kind !== "mcpTool" && !(connection?.methods || ["GET", "HEAD"]).includes(step.kind === "webAgent" ? "GET" : String(data.apiMethod || "GET").toUpperCase())) throw error("This HTTP method is not enabled for the selected connection.");
      if (step.kind === "mcpTool" && !connection.toolDefinitions?.some(tool => tool.name === data.mcpTool)) throw error("Discover and save this server tool in Integrations before running it.", 422);
      connections._internals.authHeaders(connection);
    } catch (failure) {
      report.blockers.push({ node_id: node.id, node_name: nodeName(node), message: failure.publicMessage || "This connection could not be checked. Review its settings in Admin Space." });
    }
  }
  report.ready = report.blockers.length === 0;
  return report;
}

const terminalNodes = (nodes, currentId, state) => nodes.map(node => node.status === "running"
  ? { ...node, status: node.node_id === currentId || ['cancelled', 'interrupted'].includes(state) ? state : 'interrupted', completed_at: new Date().toISOString() }
  : node.status === "queued" ? { ...node, status: "skipped", completed_at: new Date().toISOString() } : node);

async function reconcile(run) {
  if (!run || run.execution_mode !== MODE) return run;
  if (['cancelled','interrupted','failed'].includes(run.status) && run.workflow_snapshot?.settings?.template_id === 'sprint-automator'
    && run.workflow_snapshot?.settings?.library_publication_mode === 'automatic') {
    return await store.mergePublication(run.id) || run;
  }
  if (run.status !== 'running') return run;
  if (run.workflow_snapshot.runtime_contract?.orchestrator === "temporal") return run;
  const pending = pendingTerminals.get(run.id);
  if (pending) {
    await persistTerminal(pending.run, pending.status, pending.nodes, pending.output);
    return await store.get(run.id);
  }
  const deadline = Date.parse(run.workflow_snapshot?.runtime_contract?.deadline_at || "");
  if (!Number.isFinite(deadline) || deadline > Date.now()) return run;
  return stopRun(run, "interrupted", { summary: "This review exceeded its deadline or the worker stopped. Completed step results are preserved. Start a new review to retry.", error_code: "WORKFLOW_INTERRUPTED" });
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
function specialistPrompt(run, node, sources) {
  const data = node.data || {};
  // The saved node owns instructions, skills and guardrails. The assistant
  // receives connected data separately, with its original structure and
  // provenance; duplicating excerpts here made larger inputs look complete.
  return text(data.prompt) || text(data.intent) || text(data.agentSnapshot?.definition?.objective);
}

const collectReviews = (sources) => sources.flatMap(source => {
  if (array(source.iterations).length) return source.iterations.filter(item => item.status === 'completed').flatMap(item => collectReviews([item]).map(review => ({ ...review, iteration_path: item.iteration_path, batch_index: item.batch_index })));
  const out = source.output || {};
  return out.response ? [{ node_id: source.node_id, session_id: out.session_id, repository_run_id: out.repository_run_id, repository_agent_type: out.repository_agent_type, response: out.response, readiness: out.readiness, citation_ids: out.citation_ids }]
    : array(out.items).filter(item => item.session_id).map(item => ({ node_id: source.node_id, item_index: item.index, session_id: item.session_id, response: item.response, readiness: item.readiness, citation_ids: item.citation_ids })).concat(array(out.reviews));
}).filter((review, index, all) => all.findIndex(other => other.node_id === review.node_id && other.item_index === review.item_index && JSON.stringify(other.iteration_path) === JSON.stringify(review.iteration_path)) === index).slice(0, 1000);
const reviewSource = source => source.status === 'completed' || array(source.iterations).some(item => item.status === 'completed');
const needsAttention = source => source.status === 'failed' || ['limited','limited_evidence','insufficient_evidence'].includes(source.output?.readiness?.status) || source.output?.verification?.status === 'needs_input' || array(source.iterations).some(item => needsAttention(item));

function terminalSummary(run, status, nodes, fallback) {
  const saved = new Map();
  for (const node of nodes) for (const receipt of array(node.output?.library_publication?.receipts)) {
    if (receipt.saved === true && text(receipt.id) && ['manual', 'automation'].includes(receipt.kind)) saved.set(`${receipt.kind}:${receipt.id}`, receipt);
  }
  if (!saved.size) return fallback;
  const count = kind => [...saved.values()].filter(receipt => receipt.kind === kind).length;
  const manual = count('manual'), automation = count('automation');
  const messages = [];
  if (manual) messages.push(`Saved ${manual} manual Test Case${manual === 1 ? '' : 's'} pending review.`);
  if (automation) messages.push(`Saved ${automation} automation Test Case${automation === 1 ? '' : 's'} pending review and unverified.`);
  if (typeof fallback === 'string' && fallback.startsWith(messages.join(' '))) return fallback;
  if (status === 'needs_review') messages.push(nodes.some(node => node.output?.verification?.status === 'needs_input')
    ? 'Additional automation inputs are still needed.' : 'The remaining workflow findings need attention.');
  else if (status !== 'completed' || run.workflow_snapshot?.runtime_contract?.target_node_id) messages.push(fallback);
  return messages.filter(Boolean).join(' ');
}

async function executeNode(run, node, user, signal, onAttempt, onProgress = async () => {}, onEvent = async () => {}, state = {}) {
  try { return await require("@hellotest/platform/backend/src/utils/llmTraceContext").run(
    { project_id: run.project_id, actor_id: user.id, run_id: run.id, node_id: node.id },
    () => {
      const kind=kindOf(node), effect=kind==='mcpTool'||(['apiTool','apiAgent'].includes(kind)&&!['GET','HEAD'].includes(node.data.apiMethod||'GET'));
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
  const sources = compactUpstream(run, node);
  const kind = kindOf(node);
  if (kind === "trigger") return { request: run.input_payload };
  if (kind === "aggregator" || kind === "output") {
    const ancestors = new Set();
    const bodies = graphContract.loopBodies(run.workflow_snapshot.nodes, run.workflow_snapshot.edges);
    const visit = id => {
      for (const edge of run.workflow_snapshot.edges.filter(item => item.target === id && !scheduling.isReturn(item))) {
        if (!ancestors.has(edge.source)) { ancestors.add(edge.source); visit(edge.source); }
      }
      for (const child of bodies[id] || []) if (!ancestors.has(child)) { ancestors.add(child); visit(child); }
    };
    visit(node.id);
    if (kind === 'aggregator' && ['combinePosition', 'combineMatching', 'combineAll'].includes(node.data?.mergeMode) && sources.some(source => source.execution_context)) throw error('Generic field joins cannot combine revision-bound native artifact checkpoints. Use Append, Combine fields or Choose input for native Story branches.', 422);
    const mergeSources = kind === 'output' ? sources : scheduling.orderedEdges(run.workflow_snapshot.edges, node.id).map(edge => sources.find(source => source.node_id === edge.source && (!source.output?.routes || source.output.data === source.output.routes[edge.sourceHandle])) || { node_id: edge.source, status: 'skipped', output: { data: [] } });
    return { reviews: collectReviews(run.node_results.filter(item => ancestors.has(item.node_id) && reviewSource(item))), ...(kind === 'output' ? { data: contextFor(run, sources).input } : mergeOperations.execute(node.data || {}, mergeSources, { appendInputs, mergeInputs })), sources: mergeSources.map(source => ({ node_id: source.node_id, node_name: source.node_name, output_key: source.output_key, status: source.status })), requires_human_review: true };
  }
  const data = object(node.data);
  if (kind === 'loop' && data.loopAction === 'workflow') return executeLoopBody(run, node, user, signal, state.persist, onProgress);
  if (flowOperations.KINDS.has(kind)) return execution.bounded(nodeSignal => flowOperations.execute({ node, context: contextFor(run, sources), signal: nodeSignal }), { timeoutMs: Number(data.timeoutMs) || 30000, signal });
  if (kind === "customAI") return executeNode(run, { ...node, data: { ...data, kind: "agent", agentId: "quality-evaluator", customTask: true } }, user, signal, onAttempt, onProgress, onEvent);
  if (operations.KINDS.has(kind)) {
    return execution.bounded(async nodeSignal => {
      const retries = !["loop", "customAI"].includes(kind) && events.canRetry(kind, data) ? Number(data.retryCount || 0) : 0;
      for (let attempt = 0; ; attempt++) {
        await requireRunAccess(user, run.project_id);
        if (kind !== "loop" || data.loopAction !== "customAI") await onAttempt(attempt + 1);
        try { return await operations.execute({ run, node, sources, user, signal: nodeSignal, onProgress,
          review: (itemRun, itemNode) => executeNode(itemRun, itemNode, user, nodeSignal,
            attempt => onAttempt(attempt, { item_index: itemRun.iteration_index }), onProgress,
            event => onEvent({ ...event, item_index: itemRun.iteration_index }))
        }); } catch (failure) {
          if (nodeSignal.aborted || attempt >= retries || !events.retryable(failure)) throw failure;
          const delay = Number(data.retryDelayMs ?? 300) * (attempt + 1);
          await onEvent({ level: "warning", event: "retry_scheduled", attempt: attempt + 1, retry_delay_ms: delay, status_code: failure.statusCode, message: `Attempt ${attempt + 1} failed. Retrying in ${delay} ms.` });
          await execution.bounded(() => new Promise(resolve => setTimeout(resolve, delay)), { timeoutMs: delay + 1000, signal: nodeSignal });
        }
      }
    }, { timeoutMs: Number(data.timeoutMs) || 30000, signal });
  }
  if (kind === "repositoryAgent") {
    const repositoryAgents = require("../agents/repositoryAgents.service");
    const connected = contextFor(run, sources).input;
    const source = object(connected?.source || run.input_payload.source);
    if (source.type !== "github" || !text(source.repository_url)) throw error("Supply source.type = github and source.repository_url in the workflow input. ZIP uploads are available in the source agent workspace.");
    await onAttempt(1);
    const job = await repositoryAgents.createRun({ project_id: run.project_id, app_type_id: run.app_type_id,
      agent_type: data.repositoryAgentType, llm_integration_id: text(data.llmIntegrationId) || undefined, source }, user, { requestKey: `workflow-${run.id}-${node.id}${run.iteration_path ? `-${hash(run.iteration_path).slice(0,16)}` : ''}`, workflowTrace: { run_id: run.id, node_id: node.id } });
    let lastProgress = "";
    try {
      return await execution.bounded(async childSignal => {
        while (!childSignal.aborted) {
          await requireRunAccess(user, run.project_id);
          const current = await repositoryAgents.getRun(job.id, user, "agentic_workflow.run");
          const progress = { repository_run_id: job.id, repository_agent_type: data.repositoryAgentType, status: current.status, percent: current.progress || 0, stages: current.stages || [] };
          const signature = JSON.stringify(progress);
          if (signature !== lastProgress) { await onProgress(progress); lastProgress = signature; }
          if (["failed", "cancelled"].includes(current.status)) throw error("Source analysis did not complete. Inspect the source agent execution for details.", 502);
          if (["completed", "partial"].includes(current.status)) {
            const review = current.result?.llm_review;
            const sourceFindings=current.result?.findings?.[require('../agents/catalog').FINDING_KEYS[data.repositoryAgentType]];
            const noReviewTargets=current.status==='partial'&&Array.isArray(sourceFindings)&&!sourceFindings.length
              &&current.result?.summary?.model_calls===0&&current.stages?.some(stage=>stage.id==='model_review'&&stage.status==='skipped');
            if (data.llmIntegrationId && review?.provenance?.generation_mode !== "llm"&&!noReviewTargets) throw agentContract.fail("The requested source review did not complete.", "AGENT_OUTPUT_INVALID");
            return {
            repository_run_id: job.id, repository_agent_type: data.repositoryAgentType,
            session_id: review?.session_id, response: review?.response, citation_ids: review?.citation_ids,
            findings: current.result?.findings, review_findings: review?.findings, evidence_gaps: review?.evidence_gaps, verification: review?.verification,
            model_execution: review?.model_execution, provenance: review?.provenance || { generation_mode: "deterministic", compiler_version: current.compiler_version },
            source: current.source, stages: current.stages, warnings: current.warnings,
            readiness: { status: current.status === "partial" ? "limited_evidence" : "ready_for_review" },
            requires_human_review: true
          };
          }
          await execution.bounded(() => new Promise(resolve => setTimeout(resolve, 1_000)), { signal: childSignal, timeoutMs: 2_000 });
        }
        throw execution.abortError();
      }, { signal, timeoutMs: Number(data.timeoutMs) || MAX_DURATION_MS });
    } finally {
      const current = await repositoryAgents.getRun(job.id, user, "agentic_workflow.run").catch(() => null);
      if (current && ["queued", "running"].includes(current.status)) await repositoryAgents.cancelRun(job.id, user).catch(() => {});
    }
  }
  const deadline = Date.now() + (Number(data.timeoutMs) || 150_000);
  const retries = kind === "loop" && data.loopAction === "customAI" ? 0 : Number(data.retryCount) || 0;
  const policy = specialistPolicy(data);
  // One ledger spans transport retries, JSON compatibility and output repairs for this node.
  const modelBudget = { used: 0, max: data.agentSnapshot?.definition?.limits?.max_model_calls || data.aiConfiguration?.agent_execution?.max_model_calls || 2 };
  const scopes = policy.context_scopes;
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    await requireRunAccess(user, run.project_id);
    if (signal.aborted) throw execution.abortError();
    await onAttempt(attempt + 1);
    try {
      const review = await execution.bounded((nodeSignal) => assistant.respond({ user, project_id: run.project_id, app_type_id: run.app_type_id,
        mode: "agent", agent_id: data.agentId, workflow_policy: { ...policy, model_budget: modelBudget, agent_definition: data.agentSnapshot, custom_task: data.customTask === true || Boolean(data.agentSnapshot), connected_input: { request: run.input_payload, input: contextFor(run, sources).input,
          provenance:{request:'user_supplied_task_data',input:'unverified_connected_node_data',...(collectReviews(sources).length?{upstream_reviews:'untrusted_model_analysis_not_source_evidence'}:{})} } }, prompt: specialistPrompt(run, node, sources), context_scopes: scopes,
        integration_id: text(data.llmIntegrationId) || undefined,
        smart_context: { query: text(data.knowledgeQuery) || text(data.prompt), source_ids: array(data.knowledgeSourceIds), source_kinds: array(data.knowledgeSourceKinds) },
        signal: nodeSignal
      }), { timeoutMs: deadline - Date.now(), signal });
      if (review.provenance?.generation_mode !== "llm") throw agentContract.fail("The AI node did not return a model-generated review.", "AGENT_OUTPUT_INVALID");
      return { session_id: review.transaction.id, specialist_id: data.agentId, ...review.result, provenance: review.provenance };
    } catch (failure) {
      lastError = failure;
      if (signal.aborted || modelBudget.used >= modelBudget.max || !events.retryable(failure) || attempt >= retries || Date.now() >= deadline) throw failure;
      const delay = Math.min(Number(data.retryDelayMs ?? 500) * (attempt + 1), deadline - Date.now());
      await onEvent({ level: "warning", event: "retry_scheduled", attempt: attempt + 1, retry_delay_ms: delay, status_code: failure.statusCode, message: `AI attempt ${attempt + 1} failed. Retrying in ${delay} ms.` });
      await execution.bounded(() => new Promise(resolve => setTimeout(resolve, delay)), { timeoutMs: deadline - Date.now(), signal });
    }
  }
  throw lastError;
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
    if (signal.aborted || [401,403,499].includes(failure.statusCode) || node.data?.onError !== "errorOutput") throw failure;
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
  const budgetStart = { ...budget };
  await execution.bounded(async loopSignal => {
    for (let batchIndex = 0; batchIndex < batches; batchIndex++) {
      if (++budget.batches > 100) throw error('Connected loops support at most 100 total batches, including nested loops. Reduce the input or increase batch size.', 422);
      const batch = items.slice(batchIndex * size, (batchIndex + 1) * size);
      const child = { ...run, loop_owner: node.id, loop_item: size === 1 ? batch[0] : batch,
        iteration_index: batchIndex, iteration_total: batches, loop_batch_size: batch.length,
        iteration_path: [...(run.iteration_path || []), node.id, batchIndex] };
      loopResult.output = { data: batch, loop_mode: 'workflow', current_batch: batchIndex + 1, total_batches: batches };
      delete loopResult.execution_context;
      if (inputLineage) {
        const selected = batch.map(item => inputLineage.data.find(packet => item?.story_id === packet.story_id && JSON.stringify(item.story_revision) === JSON.stringify(packet.story_revision)));
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
          if (++budget.node_executions > 1000) throw error('Connected loops support at most 1000 body step executions. Reduce the input or simplify the body.', 422);
          let outcome;
          try { outcome = await runStep(child, step, user, loopSignal, persist); }
          catch (failure) {
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
        if (Buffer.byteLength(JSON.stringify(collected)) > 128 * 1024 || collected.length > 1000) throw error('Collected loop output exceeds 1000 items or 128 KB. Reduce the input or aggregate inside the body.', 422);
      } finally {
        for (const id of bodyIds) {
          const result = run.node_results.find(item => item.node_id === id);
          if (result.status === 'queued') { result.status = 'skipped'; result.skip_reason = limited ? 'An earlier body step needs evidence.' : 'This batch stopped before the step ran.'; }
          if (!directIds.includes(id)) continue;
          const { iterations, ...snapshot } = result;
          iterations.push({ ...structuredClone(snapshot), batch_index: batchIndex, iteration_path: child.iteration_path, input_start_index: batchIndex * size, input_item_count: batch.length });
        }
        if (Buffer.byteLength(JSON.stringify(run.node_results)) > 2 * 1024 * 1024) throw error('Loop execution records exceed 2 MB. Reduce the loop input or step output.', 422);
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
    await persistTerminal(run, state, run.node_results, { ...run.output_payload, status: state, summary: message, failed_node_id: currentNode, error_code: timedOut ? "WORKFLOW_DEADLINE" : state === "cancelled" ? "WORKFLOW_CANCELLED" : failure.code === "NODE_TIMEOUT" ? "NODE_TIMEOUT" : "WORKFLOW_STEP_FAILED" });
  } finally { clearInterval(heartbeat); }
}

async function start(workflow, input = {}, user) {
  await requireRunAccess(user, workflow.project_id);
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
  const requestFingerprint = hash({ workflow: { ...workflow, updated_at: undefined, updated_by: undefined, run_count: undefined, latest_run_at: undefined, latest_run_status: undefined }, payload, targetNodeId });
  const id = requestKey ? `review-${hash([workflow.id, user.id, requestKey]).slice(0, 40)}` : randomUUID();
  const existing = await store.get(id);
  if (existing) {
    if (existing.workflow_snapshot.runtime_contract?.request_fingerprint !== requestFingerprint) throw error("This request ID was already used with a different workflow or input. Start a new review.", 409);
    return reconcile(existing);
  }
  const durable = require("../workflows/temporal/control");
  if (!durable.enabled() && active.size >= MAX_PARALLEL_RUNS) throw error("Two review workflows are already running on this worker. Try again after one finishes.", 429);
  const automaticLibraryPublication = workflow.settings?.template_id === 'sprint-automator' && workflow.settings?.library_publication_mode === 'automatic';
  const runtime = { mode: "bounded-review-workflow", execution_mode: MODE, simulated: false, arbitrary_code_execution: false,
    scheduler_version: 2,
    ...(automaticLibraryPublication ? { automatic_library_publication: true, initial_project_changes_applied: false } : { project_changes_applied: false }),
    processing: processing(workflow),
    external_write_tools: report.steps.some(step => ["mcpTool", "apiTool", "apiAgent"].includes(step.kind)), requires_human_review: true, max_duration_ms: durationMs, target_node_id: targetNodeId || null,
    deadline_at: new Date(Date.now() + durationMs).toISOString(), request_fingerprint: requestFingerprint,
    orchestrator: durable.enabled() ? "temporal" : "local",
    recovery: durable.enabled() ? "Temporal resumes from durable step receipts. Uncertain operations require reconciliation." : "Interrupted work is preserved; it is never automatically replayed." };
  const run = { id, workflow_id: workflow.id, project_id: workflow.project_id, app_type_id: workflow.app_type_id || null, workflow_name: workflow.name,
    created_by: user.id, execution_mode: MODE, status: "running", trigger_kind: "manual", input_payload: payload,
    workflow_snapshot: { ...structuredClone(workflow), execution_mode: MODE, runtime_contract: runtime, execution_order: report.steps.map(step => step.node_id), snapped_at: new Date().toISOString() },
    node_results: report.steps.map(step => ({ node_id: step.node_id, node_name: step.name, node_type: step.kind, specialist_id: step.specialist_id, status: "queued", execution_mode: MODE, attempts: 0, logs: [] })),
    output_payload: { execution_mode: MODE, status: "running", project_changes_applied: false, completed_steps: 0, total_steps: report.steps.length, summary: "Review workflow started.", requires_human_review: true, runtime_contract: runtime } };
  if (durable.enabled()) {
    await durable.enqueue(run, () => store.insert(run));
    const persisted = await store.get(id);
    if (persisted?.workflow_snapshot.runtime_contract?.request_fingerprint !== requestFingerprint) throw error("This request ID was already used with different workflow input. Start a new review.", 409);
    return persisted;
  }
  const controller = new AbortController();
  active.set(id, { controller, promise: null });
  try {
    const inserted = await store.insert(run);
    if (!inserted) {
      active.delete(id);
      const concurrent = await store.get(id);
      if (concurrent?.workflow_snapshot.runtime_contract?.request_fingerprint !== requestFingerprint) throw error("This request ID was already used with different workflow input. Start a new review.", 409);
      return concurrent;
    }
    // Persist before returning or scheduling any model calls. The task is bounded;
    // stale rows become interrupted on reads rather than being silently replayed.
    const promise = Promise.resolve().then(() => perform(run, user, controller)).catch(async failure => {
      recordFailure(run, 'detached_completion', failure);
      const pending = pendingTerminals.get(run.id);
      if (pending) {
        try { await persistTerminal(pending.run, pending.status, pending.nodes, pending.output); }
        catch { /* The recorded pending snapshot allows recovery on a later read. */ }
      }
    }).finally(() => { if (active.get(id)?.controller === controller) active.delete(id); });
    active.set(id, { controller, promise });
    return await store.get(id);
  } catch (failure) { if (active.get(id)?.controller === controller) active.delete(id); throw failure; }
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

module.exports = { readiness, checkReadiness, start: startOnce, cancel, reconcile, _internals: { store, active, pendingTerminals, persistTerminal, diagnostics, perform, requireRunAccess, specialistPrompt, collectReviews, reviewSource, needsAttention, terminalSummary, executeNode, runStep, terminalNodes, MAX_DURATION_MS } };
