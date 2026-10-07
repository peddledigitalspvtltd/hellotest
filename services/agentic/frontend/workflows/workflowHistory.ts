import type { AgenticWorkflowEdge, AgenticWorkflowNode } from '@hellotest/platform/frontend/src/types';

export type WorkflowGraphSnapshot = { nodes: AgenticWorkflowNode[]; edges: AgenticWorkflowEdge[] };
export type WorkflowCanvasNode = AgenticWorkflowNode & { selected?: boolean; dragging?: boolean; measured?: { width?: number; height?: number } };
export type WorkflowGraphHistory = { past: WorkflowGraphSnapshot[]; present: WorkflowGraphSnapshot; future: WorkflowGraphSnapshot[] };

// React Flow selection, measurements and dragging are view state, not edits.
export function snapshotWorkflowGraph(nodes: WorkflowCanvasNode[], edges: AgenticWorkflowEdge[]): WorkflowGraphSnapshot {
  return structuredClone({
    nodes: nodes.map(({ selected, dragging, measured, ...node }) => node),
    edges: edges.map(({ selected, ...edge }) => edge),
  });
}
export const sameWorkflowGraph = (a: WorkflowGraphSnapshot, b: WorkflowGraphSnapshot) => JSON.stringify(a) === JSON.stringify(b);
export const createWorkflowHistory = (snapshot: WorkflowGraphSnapshot): WorkflowGraphHistory => ({ past: [], present: snapshot, future: [] });
export function recordWorkflowGraph(history: WorkflowGraphHistory, next: WorkflowGraphSnapshot, limit = 40): WorkflowGraphHistory {
  if (sameWorkflowGraph(history.present, next)) return history;
  return { past: [...history.past, history.present].slice(-limit), present: next, future: [] };
}
export function undoWorkflowGraph(history: WorkflowGraphHistory): WorkflowGraphHistory {
  const previous = history.past[history.past.length - 1];
  return previous ? { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] } : history;
}
export function redoWorkflowGraph(history: WorkflowGraphHistory): WorkflowGraphHistory {
  const next = history.future[0];
  return next ? { past: [...history.past, history.present], present: next, future: history.future.slice(1) } : history;
}

export function validateWorkflowInput(value: string): { value?: Record<string, unknown>; error: string } {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { error: 'Workflow input must be a JSON object, for example { "request": "Review checkout" }.' };
    return { value: parsed as Record<string, unknown>, error: '' };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Enter valid JSON.' };
  }
}
