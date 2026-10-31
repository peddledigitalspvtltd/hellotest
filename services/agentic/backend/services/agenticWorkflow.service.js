const { randomUUID: uuid } = require("crypto");
const db = require("@hellotest/platform/backend/src/db");
const { validateWorkflowGraph } = require("@hellotest/platform/backend/src/utils/agenticWorkflowGraph");
const { sanitizeAiText } = require("@hellotest/platform/backend/src/security/aiTextPolicy");
const { mapWithConcurrency } = require("@hellotest/platform/backend/src/utils/boundedConcurrency");
const { withNativeTaskDefaults } = require("../workflows/taskProfiles");
const nodeAiConfiguration = require('../workflows/nodeAiConfiguration');
const workflowCredentialPolicy = require('../workflows/workflowCredentialPolicy');

const workflowError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode, publicMessage: message });

const selectProject = db.prepare(`
  SELECT id
  FROM projects
  WHERE id = ?
`);

const selectAppType = db.prepare(`
  SELECT id, project_id
  FROM app_types
  WHERE id = ?
`);

const selectWorkflow = db.prepare(`
  SELECT *
  FROM agentic_workflows
  WHERE id = ?
`);

const insertWorkflow = db.prepare(`
  INSERT INTO agentic_workflows (
    id,
    project_id,
    app_type_id,
    name,
    description,
    status,
    trigger_kind,
    nodes,
    edges,
    settings,
    n8n_payload,
    created_by,
    updated_by
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const updateWorkflow = db.prepare(`
  UPDATE agentic_workflows
  SET project_id = ?,
      app_type_id = ?,
      name = ?,
      description = ?,
      status = ?,
      trigger_kind = ?,
      nodes = ?,
      edges = ?,
      settings = ?,
      n8n_payload = ?,
      updated_by = ?,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const deleteWorkflow = db.prepare(`
  DELETE FROM agentic_workflows
  WHERE id = ?
`);

const selectWorkflowRun = db.prepare(`
  SELECT *
  FROM agentic_workflow_runs
  WHERE id = ?
`);

const insertWorkflowRun = db.prepare(`
  INSERT INTO agentic_workflow_runs (
    id,
    workflow_id,
    project_id,
    app_type_id,
    workflow_name,
    status,
    trigger_kind,
    input_payload,
    output_payload,
    workflow_snapshot,
    node_results,
    created_by,
    started_at,
    completed_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
`);

const normalizeText = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
};

const normalizeWorkflowStatus = (value) => {
  const normalized = String(value || "draft").trim().toLowerCase();
  return ["draft", "active", "paused", "archived"].includes(normalized) ? normalized : "draft";
};

const normalizeTriggerKind = (value) => {
  const normalized = String(value || "manual").trim().toLowerCase();
  return ["manual", "webhook", "schedule", "release", "event"].includes(normalized) ? normalized : "manual";
};

const parseJsonValue = (value, fallback) => {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  return value;
};

const normalizeArray = (value) => Array.isArray(value) ? value : [];

const normalizeObject = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};

const API_TEST_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const API_TEST_RESPONSE_STYLES = new Set(["json", "items", "text", "binary"]);
const API_TEST_RESPONSE_LIMIT_BYTES = 96 * 1024;

const normalizeApiTestMethod = (value) => {
  const method = String(value || "GET").trim().toUpperCase();
  if (!API_TEST_METHODS.has(method)) throw workflowError("Choose a supported HTTP method.");
  return method;
};

const normalizeApiResponseStyle = (value) => {
  const style = String(value || "json").trim().toLowerCase();
  return API_TEST_RESPONSE_STYLES.has(style) ? style : "json";
};

const parseApiResponsePreview = (buffer, contentType, responseStyle) => {
  const text = buffer.toString("utf8");

  if (responseStyle === "binary") {
    return {
      bytes: buffer.length,
      content_type: contentType || "application/octet-stream",
      preview_omitted: "Binary bodies are omitted from the diagnostic preview."
    };
  }

  if (responseStyle === "text") {
    return text;
  }

  if (contentType.includes("application/json") || responseStyle === "json" || responseStyle === "items") {
    try {
      const parsed = JSON.parse(text || "null");
      return responseStyle === "items" && !Array.isArray(parsed) ? [parsed] : parsed;
    } catch {
      return text;
    }
  }

  return text;
};

const hydrateWorkflow = (workflow) => {
  if (!workflow) {
    return workflow;
  }

  return workflowCredentialPolicy.safeDefinition({
    ...workflow,
    nodes: withNativeTaskDefaults(normalizeArray(parseJsonValue(workflow.nodes, []))),
    edges: normalizeArray(parseJsonValue(workflow.edges, [])),
    settings: normalizeObject(parseJsonValue(workflow.settings, {})),
    n8n_payload: normalizeObject(parseJsonValue(workflow.n8n_payload, {})),
    run_count: Number(workflow.run_count || 0),
    latest_run_at: workflow.latest_run_at || null,
    latest_run_status: workflow.latest_run_status || null
  });
};

const hydrateWorkflowRun = (run) => {
  if (!run) {
    return run;
  }

  return {
    ...run,
    execution_mode: normalizeObject(parseJsonValue(run.workflow_snapshot, {})).execution_mode === "review" ? "review" : "preview",
    input_payload: normalizeObject(parseJsonValue(run.input_payload, {})),
    output_payload: parseJsonValue(run.output_payload, null),
    workflow_snapshot: workflowCredentialPolicy.safeDefinition(normalizeObject(parseJsonValue(run.workflow_snapshot, {}))),
    node_results: normalizeArray(parseJsonValue(run.node_results, []))
  };
};

async function validateWorkflowScope(projectId, appTypeId) {
  if (!projectId) {
    throw workflowError("project_id is required");
  }

  const project = await selectProject.get(projectId);

  if (!project) {
    throw workflowError("Project not found", 404);
  }

  if (!appTypeId) {
    return;
  }

  const appType = await selectAppType.get(appTypeId);

  if (!appType) {
    throw workflowError("App type not found", 404);
  }

  if (appType.project_id !== projectId) {
    throw workflowError("App type must belong to the selected project");
  }
}

function buildWorkflowRecord(input = {}, existing = null, actorId = null) {
  const projectId = Object.prototype.hasOwnProperty.call(input, "project_id") ? normalizeText(input.project_id) : existing?.project_id;
  const appTypeId = Object.prototype.hasOwnProperty.call(input, "app_type_id") ? normalizeText(input.app_type_id) : existing?.app_type_id || null;

  return {
    project_id: projectId,
    app_type_id: appTypeId,
    name: Object.prototype.hasOwnProperty.call(input, "name")
      ? normalizeText(input.name) || "Untitled agentic workflow"
      : existing?.name || "Untitled agentic workflow",
    description: Object.prototype.hasOwnProperty.call(input, "description")
      ? normalizeText(input.description)
      : existing?.description || null,
    status: Object.prototype.hasOwnProperty.call(input, "status")
      ? normalizeWorkflowStatus(input.status)
      : existing?.status || "draft",
    trigger_kind: Object.prototype.hasOwnProperty.call(input, "trigger_kind")
      ? normalizeTriggerKind(input.trigger_kind)
      : existing?.trigger_kind || "manual",
    nodes: withNativeTaskDefaults(Object.prototype.hasOwnProperty.call(input, "nodes")
      ? normalizeArray(input.nodes)
      : existing?.nodes || []),
    edges: Object.prototype.hasOwnProperty.call(input, "edges")
      ? normalizeArray(input.edges)
      : existing?.edges || [],
    settings: Object.prototype.hasOwnProperty.call(input, "settings")
      ? normalizeObject(input.settings)
      : existing?.settings || {},
    n8n_payload: Object.prototype.hasOwnProperty.call(input, "n8n_payload")
      ? normalizeObject(input.n8n_payload)
      : existing?.n8n_payload || {},
    actor_id: actorId || normalizeText(input.updated_by) || normalizeText(input.created_by) || existing?.updated_by || existing?.created_by || null
  };
}

const normalizePositiveInteger = (value, fallback, max = 1000) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return Math.min(parsed, max);
};

const normalizeNodeErrorPolicy = (value) => {
  const normalized = String(value || "stop").trim();
  return ["stop", "continue", "errorOutput"].includes(normalized) ? normalized : "stop";
};

const buildNodeRuntimePolicy = (nodeData) => ({
  timeout_ms: normalizePositiveInteger(nodeData.timeoutMs, 30000, 300000),
  retry_count: normalizePositiveInteger(nodeData.retryCount, 0, 10),
  retry_delay_ms: normalizePositiveInteger(nodeData.retryDelayMs, 1000, 60000),
  on_error: normalizeNodeErrorPolicy(nodeData.onError),
  log_level: String(nodeData.logLevel || "standard"),
  redact_secrets: String(nodeData.redactSecrets ?? "true") !== "false"
});

const buildNodeLoopPolicy = (nodeData) => ({
  source_key: normalizeText(nodeData.loopSourceKey) || null,
  batch_size: normalizePositiveInteger(nodeData.loopBatchSize, 0, 1000),
  max_iterations: normalizePositiveInteger(nodeData.loopMaxIterations, 0, 10000)
});

const buildNodeToolPolicy = (nodeData) => ({
  tool_name: normalizeText(nodeData.toolName) || null,
  tool_policy: normalizeText(nodeData.toolPolicy) || "approved-tools-only",
  credential_id: normalizeText(nodeData.credentialId) || null,
  llm_integration_id: normalizeText(nodeData.llmIntegrationId) || null,
  knowledge_scope: normalizeText(nodeData.knowledgeScope) || null,
  knowledge_query: normalizeText(nodeData.knowledgeQuery) || null,
  knowledge_source_ids: normalizeArray(nodeData.knowledgeSourceIds).map(normalizeText).filter(Boolean).slice(0, 100),
  knowledge_source_kinds: normalizeArray(nodeData.knowledgeSourceKinds).map(normalizeText).filter(Boolean).slice(0, 20),
  reviewed_context_fingerprint: normalizeText(nodeData.reviewedContextFingerprint) || null,
  repository_scope: normalizeText(nodeData.repositoryScope) || null,
  testops_action: normalizeText(nodeData.testOpsAction) || null,
  api: {
    method: normalizeApiTestMethod(nodeData.apiMethod),
    url_configured: Boolean(normalizeText(nodeData.apiUrl)),
    response_style: normalizeApiResponseStyle(nodeData.apiResponseStyle)
  }
});

const getNodeOutputKey = (node, index = 0) => {
  const nodeData = normalizeObject(node?.data);
  return normalizeText(nodeData.outputKey) || normalizeText(nodeData.output_key) || `step_${index + 1}`;
};

const groupEdgesByTarget = (edges) => edges.reduce((groups, edge) => {
  const target = normalizeText(edge?.target);
  if (!target) {
    return groups;
  }

  groups[target] = groups[target] || [];
  groups[target].push(edge);
  return groups;
}, Object.create(null));

const groupEdgesBySource = (edges) => edges.reduce((groups, edge) => {
  const source = normalizeText(edge?.source);
  if (!source) {
    return groups;
  }

  groups[source] = groups[source] || [];
  groups[source].push(edge);
  return groups;
}, Object.create(null));

const buildNodeDataPolicy = (nodeData, incomingEdges) => {
  const hasMultipleIncoming = incomingEdges.length > 1;
  const inputMode = normalizeText(nodeData.inputMode) || (hasMultipleIncoming ? "allIncoming" : "previousOutput");
  const mergeMode = normalizeText(nodeData.mergeMode) || (hasMultipleIncoming ? "waitAllAppend" : null);

  return {
    input_mode: inputMode,
    input_expression: normalizeText(nodeData.inputExpression) || null,
    merge_mode: mergeMode,
    aggregate_key: normalizeText(nodeData.aggregateKey) || null
  };
};

const boundedPreviewValue = (value, maxChars = 4_000) => {
  const serialized = JSON.stringify(value ?? null);
  return serialized.length <= maxChars ? value : { preview: serialized.slice(0, maxChars), truncated: true, note: "Preview shortened; full input remains in the saved snapshot." };
};

function buildRunArtifacts(workflow, inputPayload, runId) {
  const snappedAt = new Date().toISOString();
  const originalNodes = normalizeArray(workflow.nodes);
  const workflowEdges = normalizeArray(workflow.edges);
  const orderedNodes = validateWorkflowGraph(originalNodes, workflowEdges, { requireNodes: true });
  const previewInput = boundedPreviewValue(inputPayload);
  const nodesById = new Map(originalNodes.map((node, index) => [node.id, { node, index }]));
  const incoming = groupEdgesByTarget(workflowEdges);
  const outgoing = groupEdgesBySource(workflowEdges);
  const runtimeContract = {
    mode: "workflow-preview", execution_mode: "preview", simulated: true,
    arbitrary_code_execution: false, tools_executed: false, model_called: false,
    project_changes_applied: false, external_services: "not-called",
    data_flow: "topological preview of declared connections; conditions, loops, transforms and tool adapters are not executed",
    limitations: ["This preview validates the graph and shows declared sample outputs. It does not execute agents, call APIs, retrieve knowledge, evaluate expressions, or apply project changes."]
  };
  const snapshot = {
    id: workflow.id, project_id: workflow.project_id, app_type_id: workflow.app_type_id,
    name: workflow.name, description: workflow.description, status: workflow.status,
    trigger_kind: workflow.trigger_kind, nodes: originalNodes, edges: workflowEdges,
    settings: normalizeObject(workflow.settings), n8n_payload: workflow.n8n_payload,
    execution_mode: "preview", runtime_contract: runtimeContract, snapped_at: snappedAt
  };
  const resultsById = new Map();
  const nodeResults = orderedNodes.map((node) => {
    const { index } = nodesById.get(node.id);
    const data = normalizeObject(node.data);
    const nodeKind = data.kind || node.type || "agent";
    const outputKey = getNodeOutputKey(node, index);
    const incomingEdges = incoming[node.id] || [];
    const outgoingEdges = outgoing[node.id] || [];
    const dataPolicy = buildNodeDataPolicy(data, incomingEdges);
    const runtimePolicy = buildNodeRuntimePolicy(data);
    const sources = incomingEdges.map((edge) => {
      const upstream = nodesById.get(edge.source);
      return {
        edge_id: edge.id || null, source_node_id: edge.source,
        source_node_name: upstream.node.data?.label || upstream.node.data?.name || edge.source,
        source_output_key: getNodeOutputKey(upstream.node, upstream.index),
        output_available: resultsById.has(edge.source),
        output: boundedPreviewValue(resultsById.get(edge.source)?.output || null, 2_000)
      };
    });
    const sample = boundedPreviewValue(data.sampleOutput ?? data.sample_output ?? null);
    const output = {
      [outputKey]: nodeKind === "trigger" ? previewInput
        : nodeKind === "aggregator" ? { merge_mode: dataPolicy.merge_mode || "waitAllAppend", source_count: sources.length, sources }
          : sample,
      node_kind: nodeKind, source_node_ids: sources.map((source) => source.source_node_id),
      execution_mode: "preview", sample_only: true,
      ...(sample == null && !["trigger", "aggregator"].includes(nodeKind) ? { note: "No sample output configured. This step has not been executed." } : {})
    };
    const result = {
      node_id: node.id, node_name: data.label || data.name || `Step ${index + 1}`,
      node_type: nodeKind, status: "previewed", execution_mode: "preview",
      started_at: snappedAt, completed_at: snappedAt, attempts: 0,
      retry_policy: { max_retries: runtimePolicy.retry_count, max_attempts: runtimePolicy.retry_count + 1, delay_ms: runtimePolicy.retry_delay_ms, timeout_ms: runtimePolicy.timeout_ms, applied: false },
      error_policy: runtimePolicy.on_error, loop_policy: { ...buildNodeLoopPolicy(data), applied: false },
      tool_policy: { ...buildNodeToolPolicy(data), applied: false }, data_policy: dataPolicy,
      incoming_edges: incomingEdges, outgoing_edges: outgoingEdges,
      logs: [{ at: snappedAt, level: "info", node_id: node.id, message: "Previewed declared inputs and sample output. No model, tool, expression, or external action was executed." }],
      input: incomingEdges.length ? { mode: dataPolicy.input_mode, expression: dataPolicy.input_expression, sources } : { mode: "workflowInput", payload: previewInput },
      output
    };
    resultsById.set(node.id, result);
    return result;
  });
  return {
    snapshot, nodeResults,
    outputPayload: {
      run_id: runId, workflow_id: workflow.id, status: "completed", execution_mode: "preview",
      runtime_contract: runtimeContract, summary: `Graph preview completed for ${nodeResults.length} steps. No agents or tools were executed.`,
      final_node_id: orderedNodes[orderedNodes.length - 1]?.id || null,
      terminal_node_ids: orderedNodes.filter((node) => !(outgoing[node.id] || []).length).map((node) => node.id),
      aggregation_nodes: nodeResults.filter((result) => result.node_type === "aggregator").map((result) => ({ node_id: result.node_id, merge_mode: result.data_policy.merge_mode, aggregate_key: result.data_policy.aggregate_key })),
      results: nodeResults.map((result) => ({ node_id: result.node_id, node_name: result.node_name, status: result.status, attempts: 0, source_node_ids: result.output.source_node_ids, output: result.output }))
    }
  };
}

exports.createWorkflow = async (input = {}, actorId = null) => {
  workflowCredentialPolicy.assertDefinition(input);
  const record = workflowCredentialPolicy.safeDefinition(buildWorkflowRecord(input, null, actorId));
  validateWorkflowGraph(record.nodes, record.edges);
  for (const node of record.nodes) { nodeAiConfiguration.normalize(node.data?.aiConfiguration); nodeAiConfiguration.reviewCriteria(node.data || {}); }
  for (const node of record.nodes) if (node.data?.kind === 'artifactTask' && node.data.artifactTask === 'automation-engineer') require('../workflows/automationNodeInputs').validateNodeOptions(node.data);
  for (const node of record.nodes) if (node.data?.kind === 'artifactTask' && node.data.artifactTask === 'test-case-generation') require('../workflows/generationNodeOptions').generationOptions(node.data);
  await validateWorkflowScope(record.project_id, record.app_type_id);

  const id = uuid();

  await insertWorkflow.run(
    id,
    record.project_id,
    record.app_type_id,
    record.name,
    record.description,
    record.status,
    record.trigger_kind,
    record.nodes,
    record.edges,
    record.settings,
    record.n8n_payload,
    record.actor_id,
    record.actor_id
  );

  return exports.getWorkflow(id);
};

exports.updateWorkflow = async (id, input = {}, actorId = null) => {
  const existing = await exports.getWorkflow(id);
  workflowCredentialPolicy.assertDefinition(input);
  const record = workflowCredentialPolicy.safeDefinition(buildWorkflowRecord(input, existing, actorId));
  validateWorkflowGraph(record.nodes, record.edges);
  for (const node of record.nodes) { nodeAiConfiguration.normalize(node.data?.aiConfiguration); nodeAiConfiguration.reviewCriteria(node.data || {}); }
  for (const node of record.nodes) if (node.data?.kind === 'artifactTask' && node.data.artifactTask === 'automation-engineer') require('../workflows/automationNodeInputs').validateNodeOptions(node.data);
  for (const node of record.nodes) if (node.data?.kind === 'artifactTask' && node.data.artifactTask === 'test-case-generation') require('../workflows/generationNodeOptions').generationOptions(node.data);
  await validateWorkflowScope(record.project_id, record.app_type_id);

  await updateWorkflow.run(
    record.project_id,
    record.app_type_id,
    record.name,
    record.description,
    record.status,
    record.trigger_kind,
    record.nodes,
    record.edges,
    record.settings,
    record.n8n_payload,
    record.actor_id,
    id
  );

  return exports.getWorkflow(id);
};

const addAccessibleProjectFilter = (query, params, user, column) => {
  if (user?.role === "admin" || user?.is_workspace_admin) return query;
  if (!user?.id) return `${query} AND FALSE`;
  params.push(user.id, "agentic_workflow.view");
  return `${query} AND EXISTS (
    SELECT 1 FROM project_members member
    JOIN role_permissions role_permission ON role_permission.role_id = member.role_id
    JOIN permissions permission ON permission.id = role_permission.permission_id
    WHERE member.project_id = ${column} AND member.user_id = ? AND permission.code = ?
  )`;
};

exports.listWorkflows = async ({ project_id, app_type_id, status, user, limit = 100 } = {}) => {
  let query = `
    SELECT workflows.*,
      COALESCE(run_counts.run_count, 0) AS run_count,
      run_counts.latest_run_at,
      run_counts.latest_status AS latest_run_status
    FROM agentic_workflows workflows
    LEFT JOIN (
      SELECT workflow_id,
        COUNT(*) AS run_count,
        MAX(created_at) AS latest_run_at,
        (ARRAY_AGG(status ORDER BY created_at DESC))[1] AS latest_status
      FROM agentic_workflow_runs
      GROUP BY workflow_id
    ) run_counts ON run_counts.workflow_id = workflows.id
    WHERE 1 = 1
  `;
  const params = [];
  query = addAccessibleProjectFilter(query, params, user, "workflows.project_id");

  if (project_id) {
    query += ` AND workflows.project_id = ?`;
    params.push(project_id);
  }

  if (app_type_id) {
    query += ` AND workflows.app_type_id = ?`;
    params.push(app_type_id);
  }

  if (status) {
    query += ` AND workflows.status = ?`;
    params.push(status);
  } else {
    query += ` AND workflows.status <> 'archived'`;
  }

  query += ` ORDER BY workflows.updated_at DESC, workflows.created_at DESC LIMIT ?`;
  params.push(Math.max(1, normalizePositiveInteger(limit, 100, 200)));

  const rows = await db.prepare(query).all(...params);
  return rows.map(hydrateWorkflow);
};

exports.getWorkflow = async (id) => {
  const workflow = hydrateWorkflow(await selectWorkflow.get(id));

  if (!workflow) {
    throw workflowError("Agentic workflow not found", 404);
  }

  return workflow;
};

exports.deleteWorkflow = async (id) => {
  await exports.getWorkflow(id);
  await deleteWorkflow.run(id);
  return { deleted: true };
};

const redactDiagnostic = (value, secrets = [], depth = 0) => {
  if (depth > 12) return "[Nested preview omitted]";
  if (typeof value === "string") {
    let text = value;
    for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) text = text.split(secret).join("[REDACTED]");
    return sanitizeAiText(text).text;
  }
  if (Array.isArray(value)) return value.slice(0, 500).map((item) => redactDiagnostic(item, secrets, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0, 500).map(([key, item]) => [key,
    /^(?:authorization|cookie|set-cookie|password|secret|token|api[-_]?key|access[-_]?token|refresh[-_]?token)$/i.test(key) ? "[REDACTED]" : redactDiagnostic(item, secrets, depth + 1)
  ]));
  return value;
};

exports.testApiAgent = async (input = {}) => {
  const method = normalizeApiTestMethod(input.method);
  const started = Date.now();
  // Diagnostic tests use the identical project/destination/credential policy
  // and pinned transport as workflow HTTP nodes, including public reads.
  const result = await require("../workflows/connections").callHttp({
    projectId: input.project_id,
    data: { connectionId: input.connectionId || input.connection_id, apiUrl: input.url, apiMethod: method, apiBody: input.body, timeoutMs: input.timeoutMs,
      ...(input.credential || input.auth ? { apiAuth: "inline-credential" } : {}) },
    signal: input.signal,
  });
  const responseStyle = normalizeApiResponseStyle(input.responseStyle);
  const body = Buffer.from(typeof result.data === "string" ? result.data : JSON.stringify(result.data));
  return { ...result, ok: true, method, responseStyle, redirect_followed: false, durationMs: Date.now() - started,
    truncated: body.length > API_TEST_RESPONSE_LIMIT_BYTES,
    preview: parseApiResponsePreview(body.subarray(0, API_TEST_RESPONSE_LIMIT_BYTES), result.content_type, responseStyle),
    headers: { "content-type": result.content_type } };
};

exports.createWorkflowRun = async (workflowId, input = {}, actorId = null) => {
  const workflow = await exports.getWorkflow(workflowId);
  const runId = uuid();
  const inputPayload = normalizeObject(input.input_payload || input.payload || {});
  const { snapshot, nodeResults, outputPayload } = buildRunArtifacts(workflow, inputPayload, runId);

  await insertWorkflowRun.run(
    runId,
    workflow.id,
    workflow.project_id,
    workflow.app_type_id,
    workflow.name,
    "completed",
    normalizeTriggerKind(input.trigger_kind || workflow.trigger_kind),
    inputPayload,
    outputPayload,
    snapshot,
    nodeResults,
    actorId || normalizeText(input.created_by) || null
  );

  return exports.getWorkflowRun(runId);
};

exports.listWorkflowRuns = async ({ project_id, app_type_id, workflow_id, status, user, limit = 100, summary_only = false } = {}) => {
  let query = `
    SELECT *
    FROM agentic_workflow_runs
    WHERE 1 = 1
  `;
  const params = [];
  query = addAccessibleProjectFilter(query, params, user, "agentic_workflow_runs.project_id");

  if (project_id) {
    query += ` AND project_id = ?`;
    params.push(project_id);
  }

  if (app_type_id) {
    query += ` AND app_type_id = ?`;
    params.push(app_type_id);
  }

  if (workflow_id) {
    query += ` AND workflow_id = ?`;
    params.push(workflow_id);
  }

  if (status) {
    query += ` AND status = ?`;
    params.push(status);
  }

  query += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(Math.max(1, normalizePositiveInteger(limit, 100, 200)));

  const rows = await db.prepare(query).all(...params);
  const execution = require("./agenticWorkflowExecution.service");
  const runs = await mapWithConcurrency(rows, 4, row => execution.reconcile(hydrateWorkflowRun(row)));
  if (!summary_only) return runs;
  return runs.map(run => ({ ...run, summary_only: true, input_payload: {},
    workflow_snapshot: { execution_mode: run.execution_mode },
    output_payload: { execution_mode: run.execution_mode, summary: run.output_payload?.summary || null, completed_steps: run.output_payload?.completed_steps || 0 },
    node_results: run.node_results.map(node => ({ node_id: node.node_id, node_name: node.node_name, node_type: node.node_type, specialist_id: node.specialist_id, status: node.status, attempts: node.attempts }))
  }));
};

exports.getWorkflowRun = async (id) => {
  const run = hydrateWorkflowRun(await selectWorkflowRun.get(id));

  if (!run) {
    throw workflowError("Agentic workflow run not found", 404);
  }

  return require("./agenticWorkflowExecution.service").reconcile(run);
};

exports._internals = { validateWorkflowGraph, buildRunArtifacts, redactDiagnostic, normalizeApiTestMethod, addAccessibleProjectFilter };
