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
  useUpdateNodeInternals,
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
import { isLoopReturnEdge, isWorkflowLoop, nodeKindLabels, workflowSourceHandles, type WorkflowNodeKind, type NodeInsertion } from "./workflowGraph";

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
  const ports = workflowSourceHandles({ id, data } as AgenticWorkflowNode);
  const connectedLoop = isWorkflowLoop({ id, data } as AgenticWorkflowNode);
  const mergeInputs = kind === "aggregator" && !["waitAllAppend", "waitAllMerge"].includes(String(data.mergeMode || "waitAllAppend"));
  const updateNodeInternals = useUpdateNodeInternals();
  const portSignature = JSON.stringify([ports, connectedLoop, mergeInputs]);
  useEffect(() => { updateNodeInternals(id); }, [id, portSignature, updateNodeInternals]);
  const addButton = (handle?: string, top?: string) => onInsert && !connectedPorts.has(`${id}:${handle || ""}`) && (
    <button type="button" className="studio-node-add nodrag nopan" style={top ? { top: `calc(${top} - 12px)` } : undefined}
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
      data-multi-output={ports.length > 0 || undefined}
      style={ports.length > 2 ? { minHeight: `${56 + ports.length * 34}px` } : undefined}
    >
      {kind !== "trigger" && (mergeInputs ? <>{[1, 2].map((number, index) => <span key={number}><Handle type="target" id={`input-${number}`} position={Position.Left} style={{ top: `${32 + index * 44}%` }} aria-label={`Merge input ${number}`} /><span className="studio-input-port-label" style={{ top: `${25 + index * 44}%` }}>{number}</span></span>)}</> : <Handle type="target" position={Position.Left} aria-label="Input" style={connectedLoop ? { top: "32%" } : undefined} />)}
      {connectedLoop && <><Handle type="target" id="continue" position={Position.Left} style={{ top: "76%" }} aria-label="Continue loop with batch result" /><span className="studio-input-port-label" style={{ top: "69%" }}>continue</span></>}
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
      {ports.length ? (
        ports.map((port, index) => {
          const top = `${ports.length === 2 ? 32 + index * 44 : ((index + 1) / (ports.length + 1)) * 100}%`;
          return <span key={port.id}><Handle type="source" id={port.id} position={Position.Right} style={{ top }} aria-label={`Output ${port.label}`} /><span className="studio-port-label" style={{ top: `calc(${top} - 9px)` }} title={port.label}>{port.label}</span>{addButton(port.id, top)}</span>;
        })
      ) : (
        !["output", "stop"].includes(kind) && !(kind === "dataOperation" && data.dataOperation === "switch") && <><Handle type="source" position={Position.Right} />{addButton()}</>
      )}
    </div>
  );
}
const nodeTypes = { agenticStep: WorkflowNode };
function WorkflowEdge(props: EdgeProps) {
  const onInsert = useContext(InsertionContext);
  const [defaultPath, defaultX, defaultY] = getBezierPath(props);
  const returning = props.data?.loopReturn === true;
  const laneY = Math.max(props.sourceY, props.targetY) + 90;
  const path = returning ? `M ${props.sourceX},${props.sourceY} C ${props.sourceX + 80},${props.sourceY} ${props.sourceX + 80},${laneY} ${props.sourceX},${laneY} L ${props.targetX},${laneY} C ${props.targetX - 80},${laneY} ${props.targetX - 80},${props.targetY} ${props.targetX},${props.targetY}` : defaultPath;
  const x = returning ? (props.sourceX + props.targetX) / 2 : defaultX;
  const y = returning ? laneY : defaultY;
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
        edges={props.edges?.map(edge => {
          const returning = isLoopReturnEdge(edge, props.nodes || []);
          return { ...edge,
            data: { ...(edge.data && typeof edge.data === "object" ? edge.data : {}), loopReturn: returning },
            label: edge.label || (returning ? "continue" : edge.sourceHandle === "loop" ? "batch" : edge.sourceHandle === "done" ? "done" : undefined),
            style: { ...(edge.style && typeof edge.style === "object" ? edge.style : {}), ...(returning ? { strokeDasharray: "5 4" } : {}) },
            type: returning || onInsert && props.nodes?.find(node => node.id === edge.target)?.data.kind !== "errorHandler" ? "workflow" : edge.type,
          };
        })}
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
