import type { AgenticWorkflowNode, AgenticWorkflowEdge } from '@hellotest/platform/frontend/src/types';
import { isLoopReturnEdge, isWorkflowLoop, nodeKindLabels, type WorkflowNodeKind } from './workflowGraph';

// Presentation only: these sets never enter saved definitions or scheduling.
export function loopPresentationBodies(nodes: AgenticWorkflowNode[], edges: AgenticWorkflowEdge[]) {
  const result: Record<string, Set<string>> = {};
  for (const owner of nodes.filter(isWorkflowLoop)) {
    const body = new Set<string>();
    const pending = edges.filter(edge => edge.source === owner.id && edge.sourceHandle === 'loop').map(edge => edge.target);
    const done = new Set(edges.filter(edge => edge.source === owner.id && edge.sourceHandle === 'done').map(edge => edge.target));
    while (pending.length) {
      const id = pending.shift()!;
      if (id === owner.id || done.has(id) || body.has(id)) continue;
      body.add(id);
      for (const edge of edges.filter(edge => edge.source === id && !isLoopReturnEdge(edge, nodes))) pending.push(edge.target);
    }
    result[owner.id] = body;
  }
  return result;
}
export function searchWorkflowNodes(nodes: AgenticWorkflowNode[], query: string) {
  const text = query.trim().toLowerCase();
  return text ? nodes.filter(node => `${node.id} ${node.data.label || ''} ${nodeKindLabels[node.data.kind as WorkflowNodeKind] || node.data.kind}`.toLowerCase().includes(text)) : [];
}
