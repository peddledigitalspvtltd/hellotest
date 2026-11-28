const evidenceAccess = require('@hellotest/platform/backend/services/optionalEvidenceAccess.service');
const agentInvocation = require('../agents/agentInvocation');
const requiredPermissions = ['automation.view', 'automation.code.view'];
const hidden = () => ({ automation_source_hidden: true, required_permissions: requiredPermissions,
  message: 'Automation output requires permission to view automation and generated code.' });

// Inspect typed source fields, rather than looking for JavaScript-like text in
// ordinary Stories or JSON. An iterative walk also covers nested native task
// inputs, completed-item progress and aggregate review packets.
function hasAutomationSource(value, automationNodeIds = new Set()) {
  const pending = [value], seen = new WeakSet();
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    seen.add(item);
    if (!Array.isArray(item)) {
      if (item.artifact_task === 'automation-engineer' || item.specialist_id === 'automation-engineer'
        || (automationNodeIds.has(item.node_id) && typeof item.response === 'string')
        || (item.automation_code != null && item.automation_code !== '')
        || (item.step_type === 'api' && item.api_request != null && item.api_request !== '')
        || (item.executable?.code != null && item.executable.code !== '')
        || (Array.isArray(item.automation) && item.automation.some(Boolean))) return true;
    }
    for (const child of Object.values(item)) if (child && typeof child === 'object') pending.push(child);
  }
  return false;
}

// Iteration snapshots contain the same private native lineage/resume state as
// the current result. Strip it before either the authorized or restricted
// projection, including snapshots embedded in aggregate output packets.
function withoutPrivateState(value) {
  if (!value || typeof value !== 'object') return value;
  const copy = item => Array.isArray(item) ? [] : item instanceof Date ? new Date(item) : {};
  const put = (target, key, value) => Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
  const result = copy(value), seen = new WeakMap([[value, result]]), pending = [[value, result]];
  while (pending.length) {
    const [source, target] = pending.pop();
    for (const [key, item] of Object.entries(source)) {
      if (key === 'execution_context' || key === 'automation_checkpoint') continue;
      if (!item || typeof item !== 'object') { put(target, key, item); continue; }
      if (!seen.has(item)) { seen.set(item, copy(item)); pending.push([item, seen.get(item)]); }
      put(target, key, seen.get(item));
    }
  }
  return result;
}

const lifecycleEvents = new Set(['node_started', 'node_completed', 'node_failed', 'node_failure_observed',
  'node_cancelled', 'node_interrupted', 'node_skipped', 'error_routed', 'library_publication_completed']);
function omitAgentProgress(result, definitions) {
  const data = definitions.get(result.node_id)?.data;
  const kind = result.node_type || data?.kind || (data?.artifactTask ? 'artifactTask' : undefined);
  if (agentInvocation.forWorkflowNode(kind, data).progress) return;
  const snapshots = [result];
  while (snapshots.length) {
    const snapshot = snapshots.pop();
    delete snapshot.progress;
    if (Array.isArray(snapshot.logs)) snapshot.logs = snapshot.logs.filter(event => lifecycleEvents.has(event?.event));
    if (Array.isArray(snapshot.iterations)) snapshots.push(...snapshot.iterations.filter(item => item && typeof item === 'object'));
  }
}

async function publicRun(run, user, accessCache = new Map(), { includeManualAutomationSaves = false } = {}) {
  if (!run) return run;
  const nodes = withoutPrivateState(run.node_results || []);
  const visibleRun = { ...run, node_results: nodes,
    ...(run.output_payload !== undefined ? { output_payload: withoutPrivateState(run.output_payload) } : {}) };
  const snapshotNodes = run.workflow_snapshot?.nodes || [];
  const definitions = new Map(snapshotNodes.map(node => [node.id, node]));
  const origins = new Set(nodes.filter(result => {
    const data = definitions.get(result.node_id)?.data || {};
    return data.artifactTask === 'automation-engineer' || data.agentId === 'automation-engineer'
      || result.specialist_id === 'automation-engineer' || hasAutomationSource(result);
  }).map(result => result.node_id));
  const protectedNodes = new Set(origins);
  // A downstream transform, log or model may turn a source object into plain
  // text. Propagate its read boundary through the graph, so changing output
  // shape cannot bypass the native automation permission.
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of run.workflow_snapshot?.edges || []) if (protectedNodes.has(edge.source) && !protectedNodes.has(edge.target)) {
      protectedNodes.add(edge.target); changed = true;
    }
  }
  const needsAccess = protectedNodes.size || nodes.some(node => hasAutomationSource(node.input) || hasAutomationSource(node.progress))
    || hasAutomationSource(visibleRun.output_payload);
  // Existing runs can still carry the old live payload. Strip it after source
  // classification and only from the response copy, never from replay state.
  nodes.forEach(result => omitAgentProgress(result, definitions));
  if (!needsAccess) return visibleRun;
  if (!accessCache.has(run.project_id)) accessCache.set(run.project_id,
    evidenceAccess.getOptionalEvidenceAccess(user, run.project_id, requiredPermissions));
  const access = await accessCache.get(run.project_id);
  if (requiredPermissions.every(permission => access[permission] === true)) {
    if (includeManualAutomationSaves) await require('./acceptDraft').projectManualAutomationSaves(run, nodes, user);
    return visibleRun;
  }
  const projectSnapshot = (node, parentNodeId) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return node;
    const result = { ...node };
    const nodeId = node.node_id || parentNodeId;
    const derived = (run.workflow_snapshot?.edges || []).some(edge => edge.target === nodeId && protectedNodes.has(edge.source));
    for (const field of ['input', 'output', 'progress']) if (node[field] !== undefined
      && ((field !== 'input' && protectedNodes.has(nodeId)) || derived || hasAutomationSource(node[field], protectedNodes))) result[field] = hidden();
    if (Array.isArray(node.iterations)) result.iterations = node.iterations.map(item => projectSnapshot(item, nodeId));
    if (protectedNodes.has(nodeId)) {
      result.automation_source_hidden = true;
      if (node.logs) result.logs = [];
      if (node.error) result.error = 'Automation details require permission to view generated code.';
      if (node.error_details) result.error_details = hidden();
    }
    return result;
  };
  return { ...visibleRun, node_results: nodes.map(node => projectSnapshot(node)),
    ...(visibleRun.output_payload && (protectedNodes.size || hasAutomationSource(visibleRun.output_payload)) ? {
      output_payload: { execution_mode: visibleRun.output_payload.execution_mode, status: visibleRun.output_payload.status,
        completed_steps: visibleRun.output_payload.completed_steps, total_steps: visibleRun.output_payload.total_steps,
        summary: 'Automation output requires permission to view generated code.', ...hidden() }
    } : {}) };
}

module.exports = { publicRun };
