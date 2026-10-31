const normalizeText = value => typeof value === "string" ? value.trim() : "";
const workflowError = message => Object.assign(new Error(message), { statusCode: 400, publicMessage: message });
const isLoop = node => (node?.data?.kind || node?.type) === 'loop' && node?.data?.loopAction === 'workflow';
const isLoopReturn = edge => edge?.targetHandle === 'continue';

function validateWorkflowGraph(nodes, edges, { requireNodes = false } = {}) {
  if (!Array.isArray(nodes) || !Array.isArray(edges)) throw workflowError("Workflow nodes and connections must be arrays.");
  if (nodes.length > 100 || edges.length > 300) throw workflowError("A workflow supports up to 100 steps and 300 connections.");
  if (requireNodes && !nodes.length) throw workflowError("Add at least one step before previewing this workflow.");
  const byId = new Map();
  for (const node of nodes) {
    const id = normalizeText(node?.id);
    if (!id || id.length > 160 || byId.has(id)) throw workflowError("Every workflow step needs a unique ID of at most 160 characters.");
    if (id !== node.id) throw workflowError("Workflow step IDs cannot contain surrounding whitespace.");
    byId.set(id, node);
  }
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  const edgeIds = new Set();
  for (const edge of edges) {
    if (!byId.has(edge?.source) || !byId.has(edge?.target)) throw workflowError("Each connection must refer to existing workflow steps.");
    if (edge.source === edge.target) throw workflowError("A workflow step cannot connect to itself.");
    if (edge.id && edgeIds.has(edge.id)) throw workflowError("Workflow connection IDs must be unique.");
    if (edge.id) edgeIds.add(edge.id);
    if (isLoopReturn(edge)) {
      if (!isLoop(byId.get(edge.target))) throw workflowError('A Continue connection must return to a Loop Over Items workflow body.');
      continue;
    }
    indegree.set(edge.target, indegree.get(edge.target) + 1);
    outgoing.get(edge.source).push(edge.target);
  }
  const queue = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  const ordered = [];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const id = queue[cursor];
    ordered.push(byId.get(id));
    for (const target of outgoing.get(id)) {
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }
  if (ordered.length !== nodes.length) throw workflowError("The workflow contains a cycle. Remove the circular connection before saving or previewing.");
  if (requireNodes) loopBodies(nodes, edges);
  return ordered;
}

// Only explicit loop return ports introduce repetition. The remaining graph is
// a DAG, and every body is isolated: data cannot leak to a done branch early or
// acquire an extra entry point that would run work outside its batch.
function loopBodies(nodes, edges) {
  const bodies = {};
  const forward = edges.filter(edge => !isLoopReturn(edge));
  for (const loop of nodes.filter(isLoop)) {
    const starts = forward.filter(edge => edge.source === loop.id && edge.sourceHandle === 'loop').map(edge => edge.target);
    const returns = edges.filter(edge => edge.target === loop.id && isLoopReturn(edge));
    const body = new Set();
    const visit = id => {
      if (body.has(id)) return;
      if (id === loop.id) throw workflowError('A loop body must return through the Continue input.');
      body.add(id);
      forward.filter(edge => edge.source === id).forEach(edge => visit(edge.target));
    };
    starts.forEach(visit);
    if (!starts.length || !returns.length) throw workflowError('Connect the Loop output to its body and return the final body step to Continue.');
    if (forward.some(edge => edge.source === loop.id && !['loop', 'done'].includes(edge.sourceHandle))) throw workflowError('Choose the Loop or Done output on Loop Over Items.');
    if (returns.some(edge => !body.has(edge.source))) throw workflowError('A Continue connection must come from that loop’s body.');
    if (forward.some(edge => body.has(edge.target) && !body.has(edge.source) && !(edge.source === loop.id && edge.sourceHandle === 'loop'))) throw workflowError('A loop body may only receive data through its Loop output.');
    const reachingReturn = new Set(returns.map(edge => edge.source));
    for (let changed = true; changed;) {
      changed = false;
      for (const edge of edges) if (body.has(edge.source) && body.has(edge.target) && reachingReturn.has(edge.target) && !reachingReturn.has(edge.source)) { reachingReturn.add(edge.source); changed = true; }
    }
    if ([...body].some(id => !reachingReturn.has(id))) throw workflowError('Every loop body branch must return to Continue. Use the Done output for steps after the loop.');
    if (nodes.some(node => body.has(node.id) && (node.data?.kind || node.type) === 'output')) throw workflowError('Place Output after the loop’s Done port.');
    bodies[loop.id] = [...body];
  }
  const entries = Object.entries(bodies);
  for (let i = 0; i < entries.length; i++) {
    const [id, ids] = entries[i];
    if (entries.filter(([other, body]) => other !== id && body.includes(id)).length > 3) throw workflowError('Use at most four levels of connected loops.');
    for (const [other, body] of entries.slice(i + 1)) {
      if (!ids.some(nodeId => body.includes(nodeId))) continue;
      if (ids.includes(other) && body.every(nodeId => ids.includes(nodeId))) continue;
      if (body.includes(id) && ids.every(nodeId => body.includes(nodeId))) continue;
      throw workflowError(`Loop bodies cannot share steps outside a nested loop (${id} and ${other}).`);
    }
  }
  return bodies;
}

module.exports = { validateWorkflowGraph, loopBodies, isLoopReturn, isLoop };
