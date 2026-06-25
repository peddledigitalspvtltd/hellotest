const { v4: uuid } = require("uuid");
const db = require("../db");

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

const API_TEST_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const API_TEST_RESPONSE_STYLES = new Set(["json", "items", "text", "binary"]);
const API_TEST_BODYLESS_METHODS = new Set(["GET", "HEAD"]);
const API_TEST_RESPONSE_LIMIT_BYTES = 96 * 1024;

const normalizeApiTestMethod = (value) => {
  const method = String(value || "GET").trim().toUpperCase();
  return API_TEST_METHODS.has(method) ? method : "GET";
};

const normalizeApiResponseStyle = (value) => {
  const style = String(value || "json").trim().toLowerCase();
  return API_TEST_RESPONSE_STYLES.has(style) ? style : "json";
};

const normalizeApiTestUrl = (value) => {
  let parsed;

  try {
    parsed = new URL(String(value || "").trim());
  } catch {
    throw new Error("A valid API endpoint URL is required.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("API agent tests only support HTTP and HTTPS endpoints.");
  }

  return parsed;
};

const readCredentialSecret = (credential) =>
  String(credential?.secretPreview || credential?.secret || credential?.token || credential?.value || "").trim();

const applyCredentialToRequest = ({ parsedUrl, headers, bodyText, credential, authExpression }) => {
  const normalizedCredential = normalizeObject(credential);
  const secret = readCredentialSecret(normalizedCredential);
  const keyName = String(normalizedCredential.keyName || normalizedCredential.key || "Authorization").trim() || "Authorization";
  const authType = String(normalizedCredential.authType || "apiKey").trim();
  const location = String(normalizedCredential.location || "header").trim();
  let nextBodyText = bodyText;

  if (authExpression) {
    headers.set("Authorization", String(authExpression).replace(/\{\{\s*credential\.secret\s*\}\}/g, secret));
    return nextBodyText;
  }

  if (!secret) {
    return nextBodyText;
  }

  if (location === "query") {
    parsedUrl.searchParams.set(keyName, secret);
    return nextBodyText;
  }

  if (location === "body") {
    const currentBody = normalizeObject(parseJsonValue(nextBodyText, {}));
    nextBodyText = JSON.stringify({ ...currentBody, [keyName]: secret });
    return nextBodyText;
  }

  if (authType === "bearer") {
    headers.set("Authorization", `Bearer ${secret}`);
    return nextBodyText;
  }

  if (authType === "basic") {
    headers.set("Authorization", `Basic ${Buffer.from(secret).toString("base64")}`);
    return nextBodyText;
  }

  if (keyName.toLowerCase() === "authorization") {
    headers.set("Authorization", secret.startsWith("Bearer ") || secret.startsWith("Basic ") ? secret : `Bearer ${secret}`);
    return nextBodyText;
  }

  headers.set(keyName, secret);
  return nextBodyText;
};

const parseApiResponsePreview = (buffer, contentType, responseStyle) => {
  const text = buffer.toString("utf8");

  if (responseStyle === "binary") {
    return {
      bytes: buffer.length,
      content_type: contentType || "application/octet-stream",
      base64_preview: buffer.subarray(0, Math.min(buffer.length, 512)).toString("base64")
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

  return {
    ...workflow,
    nodes: normalizeArray(parseJsonValue(workflow.nodes, [])),
    edges: normalizeArray(parseJsonValue(workflow.edges, [])),
    settings: normalizeObject(parseJsonValue(workflow.settings, {})),
    n8n_payload: normalizeObject(parseJsonValue(workflow.n8n_payload, {})),
    run_count: Number(workflow.run_count || 0),
    latest_run_at: workflow.latest_run_at || null,
    latest_run_status: workflow.latest_run_status || null
  };
};

const hydrateWorkflowRun = (run) => {
  if (!run) {
    return run;
  }

  return {
    ...run,
    input_payload: normalizeObject(parseJsonValue(run.input_payload, {})),
    output_payload: parseJsonValue(run.output_payload, null),
    workflow_snapshot: normalizeObject(parseJsonValue(run.workflow_snapshot, {})),
    node_results: normalizeArray(parseJsonValue(run.node_results, []))
  };
};

async function validateWorkflowScope(projectId, appTypeId) {
  if (!projectId) {
    throw new Error("project_id is required");
  }

  const project = await selectProject.get(projectId);

  if (!project) {
    throw new Error("Project not found");
  }

  if (!appTypeId) {
    return;
  }

  const appType = await selectAppType.get(appTypeId);

  if (!appType) {
    throw new Error("App type not found");
  }

  if (appType.project_id !== projectId) {
    throw new Error("App type must belong to the selected project");
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
    nodes: Object.prototype.hasOwnProperty.call(input, "nodes")
      ? normalizeArray(input.nodes)
      : existing?.nodes || [],
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
}, {});

const groupEdgesBySource = (edges) => edges.reduce((groups, edge) => {
  const source = normalizeText(edge?.source);
  if (!source) {
    return groups;
  }

  groups[source] = groups[source] || [];
  groups[source].push(edge);
  return groups;
}, {});

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

function buildRunArtifacts(workflow, inputPayload, runId) {
  const snappedAt = new Date().toISOString();
  const workflowSettings = normalizeObject(workflow.settings);
  const workflowNodes = normalizeArray(workflow.nodes);
  const workflowEdges = normalizeArray(workflow.edges);
  const nodesById = new Map(workflowNodes.map((node, index) => [node.id, { node, index }]));
  const incomingEdgesByTarget = groupEdgesByTarget(workflowEdges);
  const outgoingEdgesBySource = groupEdgesBySource(workflowEdges);
  const snapshot = {
    id: workflow.id,
    project_id: workflow.project_id,
    app_type_id: workflow.app_type_id,
    name: workflow.name,
    description: workflow.description,
    status: workflow.status,
    trigger_kind: workflow.trigger_kind,
    nodes: workflowNodes,
    edges: workflowEdges,
    settings: workflowSettings,
    n8n_payload: workflow.n8n_payload,
    runtime_contract: {
      mode: "isolated-qaira-orchestrator",
      arbitrary_code_execution: false,
      external_services: "adapter-only",
      failure_domain: "agentic workflow run only",
      data_flow: "edge-scoped input envelopes with explicit branch aggregation"
    },
    snapped_at: snappedAt
  };
  const resultsByNodeId = new Map();
  const nodeResults = workflowNodes.map((node, index) => {
    const nodeData = normalizeObject(node.data);
    const outputKey = getNodeOutputKey(node, index);
    const runtimePolicy = buildNodeRuntimePolicy(nodeData);
    const loopPolicy = buildNodeLoopPolicy(nodeData);
    const toolPolicy = buildNodeToolPolicy(nodeData);
    const incomingEdges = normalizeArray(incomingEdgesByTarget[node.id]);
    const outgoingEdges = normalizeArray(outgoingEdgesBySource[node.id]);
    const dataPolicy = buildNodeDataPolicy(nodeData, incomingEdges);
    const attempts = 1;
    const nodeKind = nodeData.kind || node.type || "agent";
    const sourceEnvelopes = incomingEdges.map((edge) => {
      const sourceRecord = nodesById.get(edge.source);
      const sourceResult = resultsByNodeId.get(edge.source);
      const sourceNode = sourceRecord?.node || null;
      return {
        edge_id: edge.id || null,
        source_node_id: edge.source || null,
        source_node_name: sourceNode ? normalizeObject(sourceNode.data).label || normalizeObject(sourceNode.data).name || sourceNode.id : edge.source || null,
        source_output_key: sourceRecord ? getNodeOutputKey(sourceRecord.node, sourceRecord.index) : null,
        output_available: Boolean(sourceResult),
        output: sourceResult?.output || null
      };
    });
    const inputEnvelope = incomingEdges.length
      ? {
        mode: dataPolicy.input_mode,
        expression: dataPolicy.input_expression,
        sources: sourceEnvelopes
      }
      : {
        mode: "workflowInput",
        payload: inputPayload
      };
    const logs = [
      {
        at: snappedAt,
        level: "info",
        message: `Node '${nodeData.label || nodeData.name || node.id}' accepted input.`,
        node_id: node.id
      },
      {
        at: snappedAt,
        level: runtimePolicy.log_level === "debug" ? "debug" : "info",
        message: `Runtime policy timeout=${runtimePolicy.timeout_ms}ms retries=${runtimePolicy.retry_count} onError=${runtimePolicy.on_error}.`,
        node_id: node.id
      },
      {
        at: snappedAt,
        level: "info",
        message: "Node is isolated to the agentic run failure domain; adapter outages do not block core QAira services.",
        node_id: node.id
      }
    ];

    if (incomingEdges.length) {
      logs.push({
        at: snappedAt,
        level: "info",
        message: `Data routed from ${incomingEdges.length} upstream source${incomingEdges.length === 1 ? "" : "s"} using ${dataPolicy.input_mode}.`,
        node_id: node.id
      });
    }

    if (dataPolicy.merge_mode) {
      logs.push({
        at: snappedAt,
        level: "info",
        message: `Merge policy '${dataPolicy.merge_mode}'${dataPolicy.aggregate_key ? ` using key '${dataPolicy.aggregate_key}'` : ""}.`,
        node_id: node.id
      });
    }

    if (loopPolicy.source_key) {
      logs.push({
        at: snappedAt,
        level: "info",
        message: `Loop configured for '${loopPolicy.source_key}' with batch size ${loopPolicy.batch_size || 1} and max ${loopPolicy.max_iterations || "unbounded"} iterations.`,
        node_id: node.id
      });
    }

    if (toolPolicy.tool_name) {
      logs.push({
        at: snappedAt,
        level: "info",
        message: `Tool adapter '${toolPolicy.tool_name}' resolved under policy '${toolPolicy.tool_policy}'.`,
        node_id: node.id
      });
    }

    const output = nodeKind === "aggregator"
      ? {
        [outputKey]: {
          merge_mode: dataPolicy.merge_mode || "waitAllAppend",
          aggregate_key: dataPolicy.aggregate_key,
          source_count: sourceEnvelopes.length,
          sources: sourceEnvelopes.map((source) => ({
            source_node_id: source.source_node_id,
            source_node_name: source.source_node_name,
            source_output_key: source.source_output_key,
            output: source.output
          }))
        },
        node_kind: nodeKind,
        source_node_ids: sourceEnvelopes.map((source) => source.source_node_id).filter(Boolean),
        logs_recorded: logs.length
      }
      : {
        [outputKey]: nodeData.sampleOutput || nodeData.sample_output || `Completed ${nodeData.label || nodeData.name || `step ${index + 1}`}`,
        node_kind: nodeKind,
        source_node_ids: sourceEnvelopes.map((source) => source.source_node_id).filter(Boolean),
        loop_iterations: loopPolicy.source_key ? Math.max(1, loopPolicy.batch_size || 1) : 0,
        logs_recorded: logs.length
      };

    const result = {
      node_id: node.id,
      node_name: nodeData.label || nodeData.name || `Step ${index + 1}`,
      node_type: nodeKind,
      status: "completed",
      started_at: snappedAt,
      completed_at: snappedAt,
      attempts,
      retry_policy: {
        max_retries: runtimePolicy.retry_count,
        max_attempts: runtimePolicy.retry_count + 1,
        delay_ms: runtimePolicy.retry_delay_ms,
        timeout_ms: runtimePolicy.timeout_ms
      },
      error_policy: runtimePolicy.on_error,
      loop_policy: loopPolicy,
      tool_policy: toolPolicy,
      data_policy: dataPolicy,
      incoming_edges: incomingEdges.map((edge) => ({
        id: edge.id || null,
        source: edge.source || null,
        target: edge.target || null,
        label: edge.label || null
      })),
      outgoing_edges: outgoingEdges.map((edge) => ({
        id: edge.id || null,
        source: edge.source || null,
        target: edge.target || null,
        label: edge.label || null
      })),
      logs,
      input: inputEnvelope,
      output
    };

    resultsByNodeId.set(node.id, result);
    return result;
  });
  const outputPayload = {
    run_id: runId,
    workflow_id: workflow.id,
    status: "completed",
    runtime_contract: snapshot.runtime_contract,
    final_node_id: workflowNodes[workflowNodes.length - 1]?.id || null,
    aggregation_nodes: nodeResults
      .filter((result) => result.node_type === "aggregator")
      .map((result) => ({
        node_id: result.node_id,
        merge_mode: result.data_policy.merge_mode,
        aggregate_key: result.data_policy.aggregate_key
      })),
    results: nodeResults.map((result) => ({
      node_id: result.node_id,
      node_name: result.node_name,
      attempts: result.attempts,
      source_node_ids: normalizeArray(result.output.source_node_ids),
      output: result.output
    }))
  };

  return {
    snapshot,
    nodeResults,
    outputPayload
  };
}

exports.createWorkflow = async (input = {}, actorId = null) => {
  const record = buildWorkflowRecord(input, null, actorId);
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
  const record = buildWorkflowRecord(input, existing, actorId);
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

exports.listWorkflows = async ({ project_id, app_type_id, status } = {}) => {
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

  query += ` ORDER BY workflows.updated_at DESC, workflows.created_at DESC`;

  const rows = await db.prepare(query).all(...params);
  return rows.map(hydrateWorkflow);
};

exports.getWorkflow = async (id) => {
  const workflow = hydrateWorkflow(await selectWorkflow.get(id));

  if (!workflow) {
    throw new Error("Agentic workflow not found");
  }

  return workflow;
};

exports.deleteWorkflow = async (id) => {
  await exports.getWorkflow(id);
  await deleteWorkflow.run(id);
  return { deleted: true };
};

exports.testApiAgent = async (input = {}) => {
  const method = normalizeApiTestMethod(input.method);
  const responseStyle = normalizeApiResponseStyle(input.responseStyle);
  const parsedUrl = normalizeApiTestUrl(input.url);
  const headers = new Headers({ Accept: "application/json, text/plain, */*" });
  const startedAt = Date.now();
  let bodyText = typeof input.body === "string" ? input.body.trim() : "";

  bodyText = applyCredentialToRequest({
    parsedUrl,
    headers,
    bodyText,
    credential: input.credential,
    authExpression: normalizeText(input.auth)
  });

  if (bodyText && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(parsedUrl.toString(), {
      method,
      headers,
      body: API_TEST_BODYLESS_METHODS.has(method) ? undefined : bodyText || undefined,
      signal: controller.signal
    });
    const contentType = response.headers.get("content-type") || "";
    const rawBuffer = Buffer.from(await response.arrayBuffer());
    const truncated = rawBuffer.length > API_TEST_RESPONSE_LIMIT_BYTES;
    const previewBuffer = truncated ? rawBuffer.subarray(0, API_TEST_RESPONSE_LIMIT_BYTES) : rawBuffer;

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      method,
      url: parsedUrl.toString(),
      responseStyle,
      durationMs: Date.now() - startedAt,
      truncated,
      headers: {
        "content-type": contentType,
        "content-length": response.headers.get("content-length") || null
      },
      preview: parseApiResponsePreview(previewBuffer, contentType, responseStyle)
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("API agent test timed out after 10 seconds.");
    }

    throw new Error(error?.message || "Unable to test API agent.");
  } finally {
    clearTimeout(timeout);
  }
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

exports.listWorkflowRuns = async ({ project_id, app_type_id, workflow_id, status } = {}) => {
  let query = `
    SELECT *
    FROM agentic_workflow_runs
    WHERE 1 = 1
  `;
  const params = [];

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

  query += ` ORDER BY created_at DESC`;

  const rows = await db.prepare(query).all(...params);
  return rows.map(hydrateWorkflowRun);
};

exports.getWorkflowRun = async (id) => {
  const run = hydrateWorkflowRun(await selectWorkflowRun.get(id));

  if (!run) {
    throw new Error("Agentic workflow run not found");
  }

  return run;
};
