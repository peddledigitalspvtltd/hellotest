import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgenticWorkflowNode, AgenticWorkflowEdge } from '@hellotest/platform/frontend/src/types';
import { createWorkflowHistory, recordWorkflowGraph, redoWorkflowGraph, sameWorkflowGraph, snapshotWorkflowGraph, undoWorkflowGraph, type WorkflowGraphSnapshot, type WorkflowCanvasNode } from '../workflows/workflowHistory';

export function useWorkflowHistory(nodes: WorkflowCanvasNode[], edges: AgenticWorkflowEdge[], onRestore: (snapshot: WorkflowGraphSnapshot) => void) {
  const snapshot = useMemo(() => snapshotWorkflowGraph(nodes, edges), [nodes, edges]);
  const history = useRef(createWorkflowHistory(snapshot));
  const current = useRef(snapshot);
  current.current = snapshot;
  const timer = useRef<number>();
  const [, render] = useState(0);
  const dragging = nodes.some(node => node.dragging);
  const signature = JSON.stringify(snapshot);
  useEffect(() => {
    if (dragging || sameWorkflowGraph(history.current.present, current.current)) return;
    const structure = (graph: WorkflowGraphSnapshot) => JSON.stringify([graph.nodes.map(node => node.id), graph.edges.map(edge => [edge.id, edge.source, edge.target, edge.sourceHandle, edge.targetHandle])]);
    if (structure(history.current.present) !== structure(current.current)) {
      // Adding or deleting a step must remain a separate recoverable action.
      history.current = recordWorkflowGraph(history.current, current.current);
      render(value => value + 1);
      return;
    }
    // Coalesce typing and drag gestures into one meaningful undo operation.
    timer.current = window.setTimeout(() => {
      history.current = recordWorkflowGraph(history.current, current.current);
      render(value => value + 1);
    }, 350);
    return () => window.clearTimeout(timer.current);
  }, [signature, dragging]);
  const move = useCallback((direction: 'undo' | 'redo') => {
    window.clearTimeout(timer.current);
    const flushed = recordWorkflowGraph(history.current, current.current);
    const next = direction === 'undo' ? undoWorkflowGraph(flushed) : redoWorkflowGraph(flushed);
    if (next === flushed) return;
    history.current = next;
    current.current = next.present;
    onRestore(structuredClone(next.present));
    render(value => value + 1);
  }, [onRestore]);
  return {
    canUndo: history.current.past.length > 0 || !sameWorkflowGraph(history.current.present, snapshot),
    canRedo: history.current.future.length > 0 && sameWorkflowGraph(history.current.present, snapshot),
    undo: () => move('undo'), redo: () => move('redo'),
  };
}
