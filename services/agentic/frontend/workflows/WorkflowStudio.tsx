import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useWorkflowHistory } from "../hooks/useWorkflowHistory";
import { validateWorkflowInput, type WorkflowGraphSnapshot } from "./workflowHistory";
import { executionDuration } from "./WorkflowExecutionLog";
import {
  IconArrowLeft,
  IconPlus,
  IconSearch,
  IconPlayerPlay,
  IconDeviceFloppy,
  IconLayoutGrid,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconBraces,
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
  canConnectWorkflow,
  type NodeInsertion,
  type WorkflowDraft,
  type WorkflowNodeKind,
} from "./workflowGraph";
import "./WorkflowStudio.css";
import { WorkflowConnections } from "./WorkflowConnections";
import { WorkflowNodeIcon } from "./WorkflowNodeIcon";

import type { ProjectAgent } from "../agents/agentDefinitions";

type Props = {
  projectAgents?: ProjectAgent[];
  onAddAgent?: (agent: ProjectAgent, insertion?: NodeInsertion) => void;
  draft: WorkflowDraft;
  nodes: AgenticWorkflowNode[];
  edges: AgenticWorkflowEdge[];
  selectedNodeId: string;
  editable: boolean;
  canRun: boolean;
  busy: boolean;
  error: string;
  input: string;
  inputSetup?: ReactNode;
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
  onAdd: (kind: WorkflowNodeKind, insertion?: NodeInsertion) => void;
  onNodesChange: OnNodesChange<AgenticWorkflowNode>;
  onEdgesChange: OnEdgesChange<AgenticWorkflowEdge>;
  onConnect: OnConnect;
  onLayout: () => void;
  onRestoreGraph: (snapshot: WorkflowGraphSnapshot) => void;
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
  const root = useRef<HTMLElement>(null);
  const inputId = useId();
  const inputValidation = validateWorkflowInput(props.input);
  const graphHistory = useWorkflowHistory(props.nodes, props.edges, props.onRestoreGraph);
  const [tab, setTab] = useState<"editor" | "executions" | "settings">(
    "editor",
  );
  const [insertion, setInsertion] = useState<NodeInsertion>();
  const [runStatus, setRunStatus] = useState("all");
  const visibleRuns = props.runs.filter(run => runStatus === "all" || run.status === runStatus);
  const openLibrary = (target?: NodeInsertion) => { setInsertion(target); setQuery(""); setLibrary(true); };
  const [selectedEdgeId, setSelectedEdgeId] = useState("");
  const [library, setLibrary] = useState(false),
    [query, setQuery] = useState(""),
    [expanded, setExpanded] = useState(false);
  const [inputOpen, setInputOpen] = useState(false),
    [readinessOpen, setReadinessOpen] = useState(false);
  const matchingProjectAgents = props.nodes.length ? (props.projectAgents || []).filter(agent => `${(agent.active_definition || agent.definition).name} ${(agent.active_definition || agent.definition).description}`.toLowerCase().includes(query.trim().toLowerCase())) : [];
  const selected = props.nodes.find((node) => node.id === props.selectedNodeId);
  useEffect(() => {
    if (props.error || props.readiness) setReadinessOpen(true);
  }, [props.error, props.readiness]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      // Shortcuts belong to this editor; nested dialogs and text fields keep theirs.
      if (!root.current?.contains(event.target as Node) || (event.target as Element)?.closest('[role="dialog"]')) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (props.editable && !props.busy) props.onSave();
      }
      const typing = (event.target as Element)?.closest('input, textarea, select, [contenteditable="true"]');
      if (!typing && props.editable && !props.busy && (event.metaKey || event.ctrlKey)) {
        if (event.key.toLowerCase() === "z") {
          event.preventDefault();
          if (event.shiftKey) graphHistory.redo(); else graphHistory.undo();
        } else if (event.key.toLowerCase() === "y") {
          event.preventDefault(); graphHistory.redo();
        }
      }
      if (event.key === "Escape" && !expanded) {
        setLibrary(false);
        setInputOpen(false);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [props.onSave, props.editable, props.busy, expanded, graphHistory.undo, graphHistory.redo]);
  return (
    <section ref={root} className="workflow-studio" aria-label="Workflow editor" tabIndex={-1}>
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
              {props.draft.id ? "Save changes" : "Create Workflow"}
            </button>
          )}
          {props.canRun && (
            <button
              type="button"
              className="primary-button"
              onClick={() => inputValidation.error ? setInputOpen(true) : props.onExecute()}
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
            aria-controls={inputId}
            data-invalid={Boolean(inputValidation.error)}
          >
            <IconBraces size={15} aria-hidden="true" /> Workflow input{inputValidation.error ? " · check JSON" : ""}
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
      {tab === "editor" && props.inputSetup}
      {inputOpen && (
        <section id={inputId} className="studio-input-drawer" aria-label="Workflow input">
          <header>
            <div>
              <strong>Workflow input</strong>
              <p>
                A JSON object passed to the trigger.
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
              disabled={props.busy}
              aria-invalid={Boolean(inputValidation.error)}
              aria-describedby={`${inputId}-feedback`}
            />
          </label>
          <div className="studio-input-feedback" id={`${inputId}-feedback`}>
            <span role={inputValidation.error ? "alert" : "status"}>{inputValidation.error || `${Object.keys(inputValidation.value || {}).length} input fields · valid JSON`}</span>
            <button type="button" className="ghost-button compact" disabled={Boolean(inputValidation.error) || props.busy} onClick={() => props.onInput(JSON.stringify(inputValidation.value, null, 2))}>Format JSON</button>
          </div>
          <details className="studio-input-help"><summary>Repository source input</summary><p>Source agents expect <code>source.repository_url</code>. Add <code>source.ref</code> or <code>source.integration_id</code> when needed.</p></details>
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
              Execution uses the saved definition and current input. Generated Library cases remain pending review or draft.
            </p>
          </div>
          {!props.editable && <button
            type="button"
            className="ghost-button"
            disabled={props.busy}
            onClick={props.onCheck}
          >
            Check readiness
          </button>}
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
                  autoFocus
                />
              </label>
              <div className="studio-library-list">
                {matchingProjectAgents.length > 0 && <section><h3>Project agents</h3>{matchingProjectAgents.map(agent => <button key={agent.id} type="button" disabled={!props.editable || props.busy} onClick={() => { props.onAddAgent?.(agent, insertion); setLibrary(false); }}><span className="studio-library-icon" data-kind="agent"><WorkflowNodeIcon kind="agent" /></span><span><strong>{(agent.active_definition || agent.definition).name}</strong><small>Version {agent.active_version} · LLM required</small></span></button>)}</section>}
                {nodePaletteGroups.map((group) => {
                  const kinds = group.kinds.filter(kind => !props.nodes.length ? kind === "trigger" : kind !== "trigger" && !(insertion?.edgeId && ["output", "stop", "errorHandler"].includes(kind))).filter((kind) =>
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
                            props.onAdd(kind, insertion);
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
                {!matchingProjectAgents.length && !Object.keys(nodeKindLabels).some((kind) =>
                  `${nodeKindLabels[kind as WorkflowNodeKind]} ${nodeKindDescriptions[kind as WorkflowNodeKind]}`
                    .toLowerCase()
                    .includes(query.toLowerCase()),
                ) && <p className="studio-empty">No matching nodes.</p>}
              </div>
            </aside>
          )}
          <div className="studio-canvas-workspace">
            <div className="studio-canvas-actions">
              {props.editable && <div className="studio-history-actions" role="group" aria-label="Edit history">
                <button type="button" className="studio-icon-button" disabled={props.busy || !graphHistory.canUndo} onClick={graphHistory.undo} aria-label="Undo graph edit" title="Undo graph edit (⌘/Ctrl Z)"><IconArrowBackUp size={18} /></button>
                <button type="button" className="studio-icon-button" disabled={props.busy || !graphHistory.canRedo} onClick={graphHistory.redo} aria-label="Redo graph edit" title="Redo graph edit (⌘/Ctrl Shift Z)"><IconArrowForwardUp size={18} /></button>
              </div>}
              {props.editable && (
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => library ? setLibrary(false) : openLibrary()}
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
              onInsert={props.editable && !props.busy ? openLibrary : undefined}
              isValidConnection={connection => canConnectWorkflow(props.nodes, props.edges, connection.source, connection.target, connection.sourceHandle, connection.targetHandle)}
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
                {props.editable && <button type="button" className="studio-start-button" disabled={props.busy} aria-label="Add manual trigger" onClick={() => props.onAdd("trigger")}><IconPlus size={30} /></button>}
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
                  onClick={() => inputValidation.error ? setInputOpen(true) : props.onPreview()}
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
              workflowInput={props.input}
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
          <div className="studio-history-filter"><label><span>Status</span><select aria-label="Filter execution status" value={runStatus} onChange={event => setRunStatus(event.target.value)}>{["all", "running", "completed", "needs_review", "failed", "cancelled", "interrupted"].map(value => <option key={value} value={value}>{value === "all" ? "All executions" : value.replace(/_/g, " ")}</option>)}</select></label><small>{visibleRuns.length} of {props.runs.length} executions</small></div>
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
            visibleRuns.length ? visibleRuns.map((run) => (
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
                  {run.started_at ? ` · ${executionDuration(run.started_at, run.completed_at)}` : ""}
                </span>
                <span className="studio-status">
                  {run.status.replace(/_/g, " ")}
                </span>
              </button>
            )) : <p className="studio-empty">No executions match this status.</p>
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
            <label>
              <span>Node processing</span>
              <select aria-label="Node processing" value={props.draft.settings.processing_mode === "parallel" ? "parallel" : "sequential"}
                onChange={event => props.onDraft({ settings: { ...props.draft.settings, processing_mode: event.target.value, max_parallel_nodes: props.draft.settings.max_parallel_nodes ?? 2 } })}>
                <option value="sequential">Sequential</option>
                <option value="parallel">Parallel independent branches</option>
              </select>
            </label>
            {props.draft.settings.processing_mode === "parallel" && <label><span>Maximum concurrent nodes</span><input type="number" aria-label="Maximum concurrent nodes" min={1} max={8} step={1} value={String(props.draft.settings.max_parallel_nodes ?? 2)} onChange={event => props.onDraft({ settings: { ...props.draft.settings, max_parallel_nodes: event.target.value === "" ? "" : Number(event.target.value) } })} /></label>}
            <p>Only independent ready nodes run together, up to the configured limit (1–8). Connected steps wait for their inputs. Loop batches remain sequential; Merge waits for its connected branches.</p>
            <label><span>Workflow deadline (ms, optional)</span><input type="number" aria-label="Workflow deadline (ms, optional)" min={1000} max={3600000} step={1000} placeholder="Automatic" value={String(props.draft.settings.maxDurationMs ?? "")} onChange={event => { const settings = { ...props.draft.settings }; if (event.target.value === "") delete settings.maxDurationMs; else settings.maxDurationMs = Number(event.target.value); props.onDraft({ settings }); }} /></label>
            <p className="studio-caption">Total time for all steps, waits and loop batches, up to one hour. Automatic uses three minutes, or one hour when native AI tasks are present. Individual node timeouts still apply.</p>
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
