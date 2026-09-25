import { useEffect, useState } from "react";
import {
  IconArrowLeft,
  IconPlus,
  IconSearch,
  IconPlayerPlay,
  IconDeviceFloppy,
  IconLayoutGrid,
  IconX,
} from "@tabler/icons-react";
import type { OnNodesChange, OnEdgesChange, OnConnect } from "@xyflow/react";
import type {
  AgenticWorkflowNode,
  AgenticWorkflowEdge,
  AgenticWorkflowReadiness,
  AgenticWorkflowRun,
} from "@hellotest/platform/frontend/src/types";
import { WorkflowCanvas, EXECUTABLE_NODE_KINDS } from "./WorkflowCanvas";
import {
  WorkflowNodeInspector,
  type WorkflowNodeInspectorProps,
} from "./WorkflowNodeInspector";
import {
  nodeKindLabels,
  nodeKindDescriptions,
  nodePaletteGroups,
  type WorkflowDraft,
  type WorkflowNodeKind,
} from "./workflowGraph";
import "./WorkflowStudio.css";
import { WorkflowConnections } from "./WorkflowConnections";
import { WorkflowNodeIcon } from "./WorkflowNodeIcon";

type Props = {
  draft: WorkflowDraft;
  nodes: AgenticWorkflowNode[];
  edges: AgenticWorkflowEdge[];
  selectedNodeId: string;
  editable: boolean;
  canRun: boolean;
  busy: boolean;
  error: string;
  input: string;
  onInput: (value: string) => void;
  onDraft: (patch: Partial<WorkflowDraft>) => void;
  onBack: () => void;
  onSave: () => void;
  onPreview: () => void;
  onExecute: (target?: string) => void;
  onCheck: () => void;
  readiness?: AgenticWorkflowReadiness;
  readinessCurrent: boolean;
  onSelect: (id: string) => void;
  onAdd: (kind: WorkflowNodeKind) => void;
  onNodesChange: OnNodesChange<AgenticWorkflowNode>;
  onEdgesChange: OnEdgesChange<AgenticWorkflowEdge>;
  onConnect: OnConnect;
  onLayout: () => void;
  inspector: Omit<
    WorkflowNodeInspectorProps,
    | "node"
    | "incoming"
    | "editable"
    | "canRun"
    | "busy"
    | "expanded"
    | "onExpand"
    | "onClose"
    | "onExecute"
  >;
  runs: AgenticWorkflowRun[];
  onOpenRun: (run: AgenticWorkflowRun) => void;
  historyLoading?: boolean;
  historyError?: string;
  onRetryHistory: () => void;
};
export function WorkflowStudio(props: Props) {
  const [tab, setTab] = useState<"editor" | "executions" | "settings">(
    "editor",
  );
  const [selectedEdgeId, setSelectedEdgeId] = useState("");
  const [library, setLibrary] = useState(false),
    [query, setQuery] = useState(""),
    [expanded, setExpanded] = useState(false);
  const [inputOpen, setInputOpen] = useState(false),
    [readinessOpen, setReadinessOpen] = useState(false);
  const selected = props.nodes.find((node) => node.id === props.selectedNodeId);
  useEffect(() => {
    if (props.error || props.readiness?.blockers.length) setReadinessOpen(true);
  }, [props.error, props.readiness]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (props.editable && !props.busy) props.onSave();
      }
      if (event.key === "Escape" && !expanded) {
        setLibrary(false);
        setInputOpen(false);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [props.onSave, props.editable, props.busy, expanded]);
  return (
    <section className="workflow-studio" aria-label="Workflow editor">
      <header className="studio-header">
        <button
          type="button"
          className="studio-icon-button"
          aria-label="Back to workflows"
          onClick={props.onBack}
          disabled={props.busy}
        >
          <IconArrowLeft size={19} />
        </button>
        <div className="studio-title">
          <span>Agentic Studio / Workflow</span>
          <h2>{props.draft.name || "Untitled workflow"}</h2>
        </div>
        <span className="studio-status">{props.draft.status}</span>
        <div className="studio-header-actions">
          {props.editable && (
            <button
              type="button"
              className="ghost-button"
              onClick={props.onSave}
              disabled={props.busy}
            >
              <IconDeviceFloppy size={16} />
              Save
            </button>
          )}
          {props.canRun && (
            <button
              type="button"
              className="primary-button"
              onClick={() => props.onExecute()}
              disabled={props.busy}
            >
              <IconPlayerPlay size={16} />
              {props.busy ? "Preparing…" : "Execute workflow"}
            </button>
          )}
        </div>
      </header>
      <div className="studio-toolbar">
        <nav aria-label="Workflow views">
          {(["editor", "executions", "settings"] as const).map((item) => (
            <button
              type="button"
              key={item}
              aria-pressed={tab === item}
              onClick={() => setTab(item)}
            >
              {item[0].toUpperCase() + item.slice(1)}
              {item === "executions" ? ` (${props.runs.length})` : ""}
            </button>
          ))}
        </nav>
        <div className="studio-tools">
          <button
            type="button"
            onClick={() => setInputOpen((value) => !value)}
            aria-expanded={inputOpen}
          >
            Workflow input
          </button>
          <button
            type="button"
            onClick={() => setReadinessOpen((value) => !value)}
            aria-expanded={readinessOpen}
          >
            {props.readinessCurrent
              ? props.readiness?.ready
                ? "Ready to execute"
                : "Needs attention"
              : "Readiness"}
          </button>
        </div>
      </div>
      {inputOpen && (
        <section className="studio-input-drawer">
          <header>
            <div>
              <strong>Workflow input</strong>
              <p>
                JSON request passed to the trigger. Source templates expect a
                GitHub URL in source.repository_url.
              </p>
            </div>
            <button
              type="button"
              className="studio-icon-button"
              aria-label="Close workflow input"
              onClick={() => setInputOpen(false)}
            >
              <IconX size={18} />
            </button>
          </header>
          <label>
            <span className="sr-only">Workflow input JSON</span>
            <textarea
              value={props.input}
              onChange={(event) => props.onInput(event.target.value)}
              spellCheck={false}
              rows={6}
            />
          </label>
        </section>
      )}
      {readinessOpen && (
        <section
          className="studio-readiness"
          aria-label="Review execution readiness"
        >
          <div>
            <strong>
              {props.readinessCurrent
                ? props.readiness?.ready
                  ? "Ready to execute a review"
                  : "Resolve these steps before execution"
                : "Check the current definition"}
            </strong>
            <p>
              Execution saves a snapshot and runs connected steps. Results
              require human review.
            </p>
          </div>
          <button
            type="button"
            className="ghost-button"
            disabled={props.busy}
            onClick={props.onCheck}
          >
            {props.editable ? "Save and check readiness" : "Check readiness"}
          </button>
          {props.readinessCurrent &&
            props.readiness?.blockers.map((item, index) => (
              <p key={index} className="studio-notice">
                {item.node_id && (
                  <button
                    type="button"
                    onClick={() => {
                      props.onSelect(item.node_id!);
                      setTab("editor");
                    }}
                  >
                    {item.node_name || "Open step"}
                  </button>
                )}{" "}
                {item.message}
              </p>
            ))}
          {props.error && (
            <p role="alert" className="studio-notice">
              {props.error}
            </p>
          )}
        </section>
      )}
      {tab === "editor" ? (
        <div
          className={`studio-workspace ${library ? "has-library" : ""} ${selected ? "has-inspector" : ""}`}
        >
          {library && (
            <aside className="studio-library">
              <header>
                <strong>Add a node</strong>
                <button
                  type="button"
                  className="studio-icon-button"
                  aria-label="Close node library"
                  onClick={() => setLibrary(false)}
                >
                  <IconX size={17} />
                </button>
              </header>
              <label className="studio-search">
                <IconSearch size={16} />
                <input
                  placeholder="Search nodes…"
                  aria-label="Search nodes"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <div className="studio-library-list">
                {nodePaletteGroups.map((group) => {
                  const kinds = group.kinds.filter((kind) =>
                    `${nodeKindLabels[kind]} ${nodeKindDescriptions[kind]}`
                      .toLowerCase()
                      .includes(query.toLowerCase()),
                  );
                  return kinds.length ? (
                    <section key={group.label}>
                      <h3>{group.label}</h3>
                      {kinds.map((kind) => (
                        <button
                          key={kind}
                          type="button"
                          disabled={!props.editable || props.busy}
                          onClick={() => {
                            props.onAdd(kind);
                            setLibrary(false);
                          }}
                        >
                          <span
                            className="studio-library-icon"
                            data-kind={kind}
                          >
                            <WorkflowNodeIcon kind={kind} />
                          </span>
                          <span>
                            <strong>{nodeKindLabels[kind]}</strong>
                            <small>{nodeKindDescriptions[kind]}</small>
                            {!EXECUTABLE_NODE_KINDS.has(kind) && (
                              <em>Preview only</em>
                            )}
                          </span>
                        </button>
                      ))}
                    </section>
                  ) : null;
                })}
                {!Object.keys(nodeKindLabels).some((kind) =>
                  `${nodeKindLabels[kind as WorkflowNodeKind]} ${nodeKindDescriptions[kind as WorkflowNodeKind]}`
                    .toLowerCase()
                    .includes(query.toLowerCase()),
                ) && <p className="studio-empty">No matching nodes.</p>}
              </div>
            </aside>
          )}
          <div className="studio-canvas-workspace">
            <div className="studio-canvas-actions">
              {props.editable && (
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => setLibrary((value) => !value)}
                  disabled={props.busy}
                >
                  <IconPlus size={16} />
                  Add node
                </button>
              )}
              {props.editable && (
                <button
                  className="ghost-button"
                  type="button"
                  onClick={props.onLayout}
                  disabled={props.busy}
                >
                  <IconLayoutGrid size={16} />
                  Arrange
                </button>
              )}
              {props.editable && selectedEdgeId && (
                <button
                  type="button"
                  className="ghost-button"
                  disabled={props.busy}
                  onClick={() => {
                    props.onEdgesChange([
                      { type: "remove", id: selectedEdgeId },
                    ]);
                    setSelectedEdgeId("");
                  }}
                >
                  Remove connection
                </button>
              )}
            </div>
            <WorkflowCanvas
              nodes={props.nodes.map((node) => ({
                ...node,
                selected: node.id === props.selectedNodeId,
              }))}
              edges={props.edges.map((edge) => ({
                ...edge,
                selected: edge.id === selectedEdgeId,
              }))}
              onEdgeClick={(_, edge) => setSelectedEdgeId(edge.id)}
              nodesDraggable={props.editable && !props.busy}
              nodesConnectable={props.editable && !props.busy}
              onNodesChange={
                props.editable && !props.busy ? props.onNodesChange : undefined
              }
              onEdgesChange={
                props.editable && !props.busy ? props.onEdgesChange : undefined
              }
              onConnect={
                props.editable && !props.busy ? props.onConnect : undefined
              }
              onNodeClick={(_, node) => {
                setSelectedEdgeId("");
                props.onSelect(node.id);
              }}
              onNodeDoubleClick={(_, node) => {
                props.onSelect(node.id);
                setExpanded(true);
              }}
              onPaneClick={() => {
                setSelectedEdgeId("");
                props.onSelect("");
              }}
            />
            {!props.nodes.length && (
              <div className="studio-canvas-empty">
                <h3>Your workflow starts here</h3>
                <p>
                  Add a trigger, connect your nodes, then inspect their input
                  and output.
                </p>
              </div>
            )}
            <footer className="studio-canvas-footer">
              <span>
                {props.nodes.length} nodes · {props.edges.length} connections
              </span>
              <span>Drag to connect · Double-click to inspect</span>
              {props.canRun && (
                <button
                  type="button"
                  onClick={props.onPreview}
                  disabled={props.busy}
                >
                  Preview graph
                </button>
              )}
            </footer>
          </div>
          {selected && (
            <WorkflowNodeInspector
              {...props.inspector}
              node={selected}
              incoming={props.nodes.filter((node) =>
                props.edges.some(
                  (edge) =>
                    edge.source === node.id && edge.target === selected.id,
                ),
              )}
              editable={props.editable}
              canRun={props.canRun}
              busy={props.busy}
              expanded={expanded}
              onExpand={() => setExpanded((value) => !value)}
              onClose={() => {
                setExpanded(false);
                props.onSelect("");
              }}
              onExecute={() => props.onExecute(selected.id)}
            />
          )}
        </div>
      ) : tab === "executions" ? (
        <section className="studio-history">
          <h3>Saved executions</h3>
          <p>
            The latest 50 executions for this workflow, each with its saved
            definition and results.
          </p>
          {props.historyError && (
            <p role="alert" className="studio-notice">
              {props.historyError}{" "}
              <button type="button" onClick={props.onRetryHistory}>
                Retry workflow history
              </button>
            </p>
          )}
          {props.historyLoading && (
            <p role="status">Loading workflow history…</p>
          )}
          {props.runs.length ? (
            props.runs.map((run) => (
              <button
                className="studio-history-row"
                key={run.id}
                type="button"
                onClick={() => props.onOpenRun(run)}
              >
                <span>
                  <strong>{run.workflow_name}</strong>
                  <small>
                    {new Date(
                      run.started_at || run.created_at || "",
                    ).toLocaleString()}
                  </small>
                </span>
                <span>
                  {run.execution_mode === "review" ? "Execution" : "Preview"}
                </span>
                <span className="studio-status">
                  {run.status.replace(/_/g, " ")}
                </span>
              </button>
            ))
          ) : !props.historyError && !props.historyLoading ? (
            <p className="studio-empty">
              No executions yet. Execute the workflow to record its first
              result.
            </p>
          ) : null}
        </section>
      ) : (
        <section className="studio-settings">
          <h3>Workflow settings</h3>
          <fieldset disabled={!props.editable || props.busy}>
            <label>
              <span>Workflow name</span>
              <input
                value={props.draft.name}
                onChange={(event) =>
                  props.onDraft({ name: event.target.value })
                }
              />
            </label>
            <label>
              <span>Description</span>
              <textarea
                rows={3}
                value={props.draft.description}
                onChange={(event) =>
                  props.onDraft({ description: event.target.value })
                }
              />
            </label>
            <label>
              <span>Status</span>
              <select
                value={props.draft.status}
                onChange={(event) =>
                  props.onDraft({
                    status: event.target.value as WorkflowDraft["status"],
                  })
                }
              >
                {["draft", "active", "paused", "archived"].map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Trigger</span>
              <select
                value={props.draft.trigger_kind}
                onChange={(event) =>
                  props.onDraft({
                    trigger_kind: event.target
                      .value as WorkflowDraft["trigger_kind"],
                  })
                }
              >
                <option value="manual">Manual</option>
                <option value="schedule">Schedule · preview only</option>
                <option value="webhook">Webhook · preview only</option>
              </select>
            </label>
          </fieldset>
          <WorkflowConnections projectId={props.inspector.projectId} />
          <p className="studio-caption">
            Models use your saved integrations. HTTP and MCP nodes select
            project connections managed by your administrator; secrets stay on
            the server.
          </p>
        </section>
      )}
    </section>
  );
}
