const normalizeText = value => typeof value === "string" ? value.trim() : "";
const workflowError = message => Object.assign(new Error(message), { statusCode: 400, publicMessage: message });

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
  return ordered;
}

module.exports = { validateWorkflowGraph };
