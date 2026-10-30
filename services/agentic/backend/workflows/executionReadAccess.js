const evidenceAccess = require('@hellotest/platform/backend/services/optionalEvidenceAccess.service');
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

async function publicRun(run, user, accessCache = new Map()) {
  if (!run) return run;
  const nodes = (run.node_results || []).map(({ execution_context, ...result }) => result);
  const snapshotNodes = run.workflow_snapshot?.nodes || [];
  const origins = new Set(nodes.filter(result => {
    const data = snapshotNodes.find(node => node.id === result.node_id)?.data || {};
    return data.artifactTask === 'automation-engineer' || data.agentId === 'automation-engineer'
      || result.specialist_id === 'automation-engineer' || hasAutomationSource(result.output);
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
    || hasAutomationSource(run.output_payload);
  if (!needsAccess) return { ...run, node_results: nodes };
  if (!accessCache.has(run.project_id)) accessCache.set(run.project_id,
    evidenceAccess.getOptionalEvidenceAccess(user, run.project_id, requiredPermissions));
  const access = await accessCache.get(run.project_id);
  if (requiredPermissions.every(permission => access[permission] === true)) return { ...run, node_results: nodes };
  const projected = nodes.map(node => {
    const result = { ...node };
    const derived = (run.workflow_snapshot?.edges || []).some(edge => edge.target === node.node_id && protectedNodes.has(edge.source));
    for (const field of ['input', 'output', 'progress']) if (node[field] !== undefined
      && ((field !== 'input' && protectedNodes.has(node.node_id)) || derived || hasAutomationSource(node[field], protectedNodes))) result[field] = hidden();
    if (protectedNodes.has(node.node_id)) {
      result.automation_source_hidden = true;
      if (node.logs) result.logs = [];
      if (node.error) result.error = 'Automation details require permission to view generated code.';
      if (node.error_details) result.error_details = hidden();
    }
    return result;
  });
  return { ...run, node_results: projected,
    ...(run.output_payload && (protectedNodes.size || hasAutomationSource(run.output_payload)) ? {
      output_payload: { execution_mode: run.output_payload.execution_mode, status: run.output_payload.status,
        completed_steps: run.output_payload.completed_steps, total_steps: run.output_payload.total_steps,
        summary: 'Automation output requires permission to view generated code.', ...hidden() }
    } : {}) };
}

module.exports = { publicRun };
