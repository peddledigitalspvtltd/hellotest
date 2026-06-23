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

function buildRunArtifacts(workflow, inputPayload, runId) {
  const snappedAt = new Date().toISOString();
  const snapshot = {
    id: workflow.id,
    project_id: workflow.project_id,
    app_type_id: workflow.app_type_id,
    name: workflow.name,
    description: workflow.description,
    status: workflow.status,
    trigger_kind: workflow.trigger_kind,
    nodes: workflow.nodes,
    edges: workflow.edges,
    settings: workflow.settings,
    n8n_payload: workflow.n8n_payload,
    snapped_at: snappedAt
  };
  const nodeResults = workflow.nodes.map((node, index) => {
    const nodeData = normalizeObject(node.data);
    const outputKey = nodeData.outputKey || nodeData.output_key || `step_${index + 1}`;

    return {
      node_id: node.id,
      node_name: nodeData.label || nodeData.name || `Step ${index + 1}`,
      node_type: nodeData.kind || node.type || "agent",
      status: "completed",
      started_at: snappedAt,
      completed_at: snappedAt,
      input: index === 0 ? inputPayload : { from_previous_step: true },
      output: {
        [outputKey]: nodeData.sampleOutput || nodeData.sample_output || `Completed ${nodeData.label || nodeData.name || `step ${index + 1}`}`
      }
    };
  });
  const outputPayload = {
    run_id: runId,
    workflow_id: workflow.id,
    status: "completed",
    final_node_id: workflow.nodes[workflow.nodes.length - 1]?.id || null,
    results: nodeResults.map((result) => ({
      node_id: result.node_id,
      node_name: result.node_name,
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
