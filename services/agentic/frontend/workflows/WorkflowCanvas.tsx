import {
  Background,
  Controls,
  ControlButton,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
  useNodesInitialized,
  useReactFlow,
  type ReactFlowProps,
} from "@xyflow/react";
import { createContext, useContext, useEffect, useRef, type RefObject } from "react";
import { IconCheck, IconPlus, IconFocusCentered } from "@tabler/icons-react";
import { WorkflowNodeIcon } from "./WorkflowNodeIcon";
import type {
  AgenticWorkflowNode,
  AgenticWorkflowEdge,
  AgenticWorkflowNodeData,
} from "@hellotest/platform/frontend/src/types";
import { nodeKindLabels, type WorkflowNodeKind, type NodeInsertion } from "./workflowGraph";

const InsertionContext = createContext<((insertion: NodeInsertion) => void) | undefined>(undefined);
const ConnectedPortsContext = createContext(new Set<string>());

export const EXECUTABLE_NODE_KINDS = new Set(Object.keys(nodeKindLabels));
function WorkflowNode({
  id,
  data,
  selected,
}: {
  id: string;
  data: AgenticWorkflowNodeData;
  selected?: boolean;
}) {
  const kind = String(data.kind || "agent") as WorkflowNodeKind;
  const status = String(data.runStatus || "");
  const onInsert = useContext(InsertionContext);
  const connectedPorts = useContext(ConnectedPortsContext);
  const addButton = (handle?: string) => onInsert && !connectedPorts.has(`${id}:${handle || ""}`) && (
    <button type="button" className={`studio-node-add nodrag nopan ${handle ? `is-${handle}` : ""}`}
      aria-label={`Add node after ${String(data.label || id)}${handle ? ` (${handle})` : ""}`}
      onClick={event => { event.stopPropagation(); onInsert({ sourceId: id, sourceHandle: handle }); }}>
      <IconPlus size={15} />
    </button>
  );
  return (
    <div
      className={`studio-node ${selected ? "is-selected" : ""}`}
      data-kind={kind}
      data-status={status}
    >
      {kind !== "trigger" && <Handle type="target" position={Position.Left} />}
      {status === "running" && <svg className="studio-node-progress" aria-hidden="true"><rect x="1.5" y="1.5" width="calc(100% - 3px)" height="calc(100% - 3px)" rx="12" /></svg>}
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
          {addButton("true")}{addButton("false")}
        </>
      ) : (
        kind !== "output" && <><Handle type="source" position={Position.Right} />{addButton()}</>
      )}
    </div>
  );
}
const nodeTypes = { agenticStep: WorkflowNode };
function WorkflowEdge(props: EdgeProps) {
  const onInsert = useContext(InsertionContext);
  const [path, x, y] = getBezierPath(props);
  return <>
    <BaseEdge id={props.id} path={path} markerStart={props.markerStart} markerEnd={props.markerEnd} style={props.style}
      label={props.label} labelX={x} labelY={onInsert ? y - 22 : y} labelStyle={props.labelStyle}
      labelShowBg={props.labelShowBg} labelBgStyle={props.labelBgStyle} labelBgPadding={props.labelBgPadding} labelBgBorderRadius={props.labelBgBorderRadius} />
    {onInsert && <EdgeLabelRenderer>
      <button type="button" className="studio-edge-add nodrag nopan" aria-label="Insert node on connection"
        style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}
        onClick={event => { event.stopPropagation(); onInsert({ edgeId: props.id }); }}><IconPlus size={14} /></button>
    </EdgeLabelRenderer>}
  </>;
}
const edgeTypes = { workflow: WorkflowEdge };
function FitCanvas({ container, enabled = true }: { container: RefObject<HTMLDivElement>; enabled?: boolean }) {
  const initialized = useNodesInitialized();
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (!enabled || !initialized || !container.current) return;
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
  }, [initialized, fitView, container, enabled]);
  return null;
}
function FocusSelectedStep({ id }: { id: string }) {
  const { fitView } = useReactFlow();
  return <ControlButton title="Focus selected step" aria-label="Focus selected step" onClick={() => void fitView({ nodes: [{ id }], padding: 0.35, minZoom: 0.6, maxZoom: 1, duration: 200 })}><IconFocusCentered size={16} /></ControlButton>;
}
function FollowExecution({ id }: { id?: string }) {
  const initialized = useNodesInitialized();
  const { fitView, getNode } = useReactFlow();
  useEffect(() => {
    if (!initialized || !id || !getNode(id)) return;
    // The camera follows a new running step, never every polling update. Users
    // can still pan/zoom while the same step runs or disable following entirely.
    void fitView({ nodes: [{ id }], padding: 0.45, minZoom: 0.8, maxZoom: 1.05, duration: 350 });
  }, [id, initialized, fitView, getNode]);
  return null;
}
export function WorkflowCanvas(
  { onInsert, focusNodeId, followNodeId, autoFitOnResize = true, ...props }: ReactFlowProps<AgenticWorkflowNode, AgenticWorkflowEdge> & { onInsert?: (insertion: NodeInsertion) => void; focusNodeId?: string; followNodeId?: string; autoFitOnResize?: boolean },
) {
  const container = useRef<HTMLDivElement>(null);
  return (
    <InsertionContext.Provider value={onInsert}><ConnectedPortsContext.Provider value={new Set(props.edges?.filter(edge => props.nodes?.find(node => node.id === edge.target)?.data.kind !== "errorHandler").map(edge => `${edge.source}:${edge.sourceHandle || ""}`))}><div ref={container} className="studio-canvas">
      <ReactFlow<AgenticWorkflowNode, AgenticWorkflowEdge>
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        minZoom={0.15}
        maxZoom={1.8}
        deleteKeyCode={null}
        {...props}
        edgeTypes={edgeTypes}
        edges={props.edges?.map(edge => ({ ...edge, type: onInsert && props.nodes?.find(node => node.id === edge.target)?.data.kind !== "errorHandler" ? "workflow" : edge.type }))}
      >
        <FitCanvas container={container} enabled={autoFitOnResize} />
        <FollowExecution id={followNodeId} />
        <Background gap={22} size={1} />
        <Controls showInteractive={false}>{focusNodeId && <FocusSelectedStep id={focusNodeId} />}</Controls>
        <MiniMap pannable zoomable nodeColor="var(--studio-accent)" />
      </ReactFlow>
    </div></ConnectedPortsContext.Provider></InsertionContext.Provider>
  );
}
