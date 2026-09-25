import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  useNodesInitialized,
  useReactFlow,
  type ReactFlowProps,
} from "@xyflow/react";
import { useEffect, useRef, type RefObject } from "react";
import { IconCheck } from "@tabler/icons-react";
import { WorkflowNodeIcon } from "./WorkflowNodeIcon";
import type {
  AgenticWorkflowNode,
  AgenticWorkflowEdge,
  AgenticWorkflowNodeData,
} from "@hellotest/platform/frontend/src/types";
import { nodeKindLabels, type WorkflowNodeKind } from "./workflowGraph";

export const EXECUTABLE_NODE_KINDS = new Set(Object.keys(nodeKindLabels));
function WorkflowNode({
  data,
  selected,
}: {
  data: AgenticWorkflowNodeData;
  selected?: boolean;
}) {
  const kind = String(data.kind || "agent") as WorkflowNodeKind;
  const status = String(data.runStatus || "");
  return (
    <div
      className={`studio-node ${selected ? "is-selected" : ""}`}
      data-kind={kind}
      data-status={status}
    >
      {kind !== "trigger" && <Handle type="target" position={Position.Left} />}
      <span className="studio-node-icon">
        <WorkflowNodeIcon kind={kind} size={23} />
      </span>
      <div>
        <small>{nodeKindLabels[kind] || kind}</small>
        <strong>{String(data.label || "Untitled step")}</strong>
        <span>
          {status
            ? status.replace(/_/g, " ")
            : EXECUTABLE_NODE_KINDS.has(kind)
              ? kind === "trigger"
                ? "On manual execution"
                : kind === "output"
                  ? "Review the results"
                  : "Open to configure"
              : "Preview only"}
        </span>
      </div>
      {status === "completed" && (
        <IconCheck className="studio-node-check" size={15} />
      )}
      {kind === "condition" ? (
        <>
          <Handle
            type="source"
            id="true"
            position={Position.Right}
            style={{ top: "32%" }}
          />
          <span className="studio-port-label is-true">true</span>
          <Handle
            type="source"
            id="false"
            position={Position.Right}
            style={{ top: "76%" }}
          />
          <span className="studio-port-label is-false">false</span>
        </>
      ) : (
        kind !== "output" && <Handle type="source" position={Position.Right} />
      )}
    </div>
  );
}
const nodeTypes = { agenticStep: WorkflowNode };
function FitCanvas({ container }: { container: RefObject<HTMLDivElement> }) {
  const initialized = useNodesInitialized();
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (!initialized || !container.current) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(
        () => void fitView({ padding: 0.2, maxZoom: 1 }),
      );
    });
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [initialized, fitView, container]);
  return null;
}
export function WorkflowCanvas(
  props: ReactFlowProps<AgenticWorkflowNode, AgenticWorkflowEdge>,
) {
  const container = useRef<HTMLDivElement>(null);
  return (
    <div ref={container} className="studio-canvas">
      <ReactFlow<AgenticWorkflowNode, AgenticWorkflowEdge>
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        minZoom={0.15}
        maxZoom={1.8}
        deleteKeyCode={null}
        {...props}
      >
        <FitCanvas container={container} />
        <Background gap={22} size={1} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeColor="var(--studio-accent)" />
      </ReactFlow>
    </div>
  );
}
