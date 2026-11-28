// Pure scheduling rules shared with Temporal's deterministic workflow sandbox.
const terminal = result => ['completed', 'skipped', 'failed'].includes(result?.status);
const providesOutput = result => result?.status === 'completed' || result?.status === 'skipped' && result.bypassed === true;
const isReturn = edge => edge.targetHandle === 'continue';
function selectedEdge(edge, result, targetKind, loopOwner) {
  if (isReturn(edge)) return false;
  if (loopOwner === edge.source && edge.sourceHandle === 'loop') return true;
  if (targetKind === 'errorHandler') return result?.status === 'failed';
  if (!providesOutput(result)) return false;
  if (result.bypassed) {
    const handle = (result.node_type || result.kind) === 'condition' ? edge.sourceHandle || 'true' : edge.sourceHandle || null;
    return result.bypass_handle === undefined || handle === result.bypass_handle;
  }
  const kind = result.node_type || result.kind;
  if (kind === 'condition') return (result.output?.matched ?? result.matched) === (edge.sourceHandle !== 'false');
  const routes = result.output?.routes || result.routes;
  if (routes) return Array.isArray(routes[edge.sourceHandle]) ? routes[edge.sourceHandle].length > 0 : Boolean(routes[edge.sourceHandle]);
  if (kind === 'dataOperation' && result.output?.item_count === 0) return false;
  if (kind === 'loop' && (result.output?.loop_mode === 'workflow' || result.loop_mode === 'workflow')) return edge.sourceHandle === 'done';
  return true;
}
function exclusive(node) {
  if (!Object.hasOwn(node, 'data') && node.exclusive != null) return node.exclusive;
  const data = node.data || node, kind = data.kind || node.type;
  if (data.disabled === true) return false;
  // Accepted Temporal plans carry a pinned `exclusive` value above. Registry
  // changes therefore affect only newly accepted plans and the local runner.
  const rule = require('../../shared/workflowNodeKinds.json').kinds[kind]?.exclusive;
  if (rule === 'repository_review') {
    // These evidence branches write only distinct, idempotent analysis receipts.
    return data.repositoryOptional !== true || !['object_repository', 'api_tests'].includes(data.repositoryAgentType);
  }
  return rule === 'always' || rule === 'http_write' && !['GET', 'HEAD'].includes(String(data.apiMethod || 'GET').toUpperCase());
}
function readyBatch({ nodes, edges, results, pending, maxParallel = 1, loopOwner }) {
  const ready = nodes.filter(node => pending.has(node.id) && edges.filter(edge => edge.target === node.id && !isReturn(edge)).every(edge => edge.source === loopOwner || terminal(results.find(result => result.node_id === edge.source))));
  const batch = [];
  for (const node of ready) {
    if (batch.length >= maxParallel || (batch.length && exclusive(node))) break;
    batch.push(node);
    if (exclusive(node)) break;
  }
  return batch;
}
function orderedEdges(edges, target) {
  const index = edge => /^input-([1-9]\d*)$/.test(edge.targetHandle || '') ? Number(edge.targetHandle.slice(6)) : Number.MAX_SAFE_INTEGER;
  return edges.filter(edge => edge.target === target && !isReturn(edge)).sort((a, b) => index(a) - index(b));
}
module.exports = { terminal, providesOutput, isReturn, selectedEdge, exclusive, readyBatch, orderedEdges };
