// Pure scheduling rules shared with Temporal's deterministic workflow sandbox.
const terminal = result => ['completed', 'skipped', 'failed'].includes(result?.status);
const isReturn = edge => edge.targetHandle === 'continue';
function selectedEdge(edge, result, targetKind, loopOwner) {
  if (isReturn(edge)) return false;
  if (loopOwner === edge.source && edge.sourceHandle === 'loop') return true;
  if (targetKind === 'errorHandler') return result?.status === 'failed';
  if (result?.status !== 'completed') return false;
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
  return ['loop', 'stop', 'artifactTask', 'repositoryAgent', 'mcpTool'].includes(kind)
    || (['apiTool', 'apiAgent'].includes(kind) && !['GET', 'HEAD'].includes(String(data.apiMethod || 'GET').toUpperCase()));
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
module.exports = { terminal, isReturn, selectedEdge, exclusive, readyBatch, orderedEdges };
