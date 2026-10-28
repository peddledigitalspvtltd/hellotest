import { useEffect, useId, useRef, useState } from "react";
import { WorkflowExecutionLog, executionDuration } from "./WorkflowExecutionLog";
import { IconArrowLeft, IconDownload, IconRefresh, IconArrowsMaximize, IconArrowsMinimize, IconLayoutSidebarLeftCollapse, IconLayoutSidebarRightCollapse, IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import type {
  AgenticWorkflowNode,
  AgenticWorkflowEdge,
  AgenticWorkflowRun,
} from "@hellotest/platform/frontend/src/types";
import { WorkflowSprintDrafts } from "./WorkflowSprintDrafts";
import { WorkflowReviewSummary } from "../agents/WorkflowReviewSummary";
import { WorkflowCanvas } from "./WorkflowCanvas";
import { WorkflowNodeInspector } from "./WorkflowNodeInspector";
import { decorateFlowEdge } from "./workflowGraph";
import "./WorkflowStudio.css";

function LiveDuration({ start, end, active }: { start?: string | null; end?: string | null; active: boolean }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => tick(value => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [active, start]);
  return <>{executionDuration(start, end)}</>;
}

export function WorkflowExecutionView({
  run,
  onBack,
  onRetry,
  canRun,
  canViewTraces = false,
  stopping,
  onStop,
  error,
  onRefresh,
  onOpenReview,
  onOpenSource,
}: {
  run: AgenticWorkflowRun;
  onBack: () => void;
  onRetry?: () => void;
  canRun: boolean;
  canViewTraces?: boolean;
  stopping: boolean;
  onStop: () => void;
  error?: string;
  onRefresh: () => void;
  onOpenReview: (agent: string, session: string) => void;
  onOpenSource: (agent: string, run: string) => void;
}) {
  const [tab, setTab] = useState<"steps" | "results" | "summary" | "logs">("steps"),
    [selectedId, setSelectedId] = useState(""),
    [expanded, setExpanded] = useState(false);
  const [stepsOpen, setStepsOpen] = useState(() => typeof window === "undefined" || window.matchMedia("(min-width: 1151px)").matches);
  const [detailsOpen, setDetailsOpen] = useState(() => typeof window === "undefined" || window.matchMedia("(min-width: 801px)").matches);
  const [maximized, setMaximized] = useState(false);
  const stepsId = useId(), detailsId = useId();
  const detailsRef = useRef<HTMLDivElement>(null), detailsToggleRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [exportNotice, setExportNotice] = useState("");
  const active = ["running", "queued"].includes(run.status);
  useEffect(() => { setSelectedId(""); setExpanded(false); setTab("steps"); }, [run.id]);
  useEffect(() => setExportNotice(""), [run.id]);
  useEffect(() => { if (contentRef.current) contentRef.current.scrollTop = 0; }, [tab, run.id]);
  useEffect(() => {
    if (selectedId && detailsOpen && window.matchMedia("(max-width: 800px)").matches) {
      detailsRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedId, detailsOpen, tab]);
  const exportRun = () => {
    const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), run }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `workflow-run-${run.id.replace(/[^a-zA-Z0-9_-]/g, '')}.json`;
    document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExportNotice('Execution snapshot downloaded.');
  };
  const logs = run.node_results.flatMap(result => (Array.isArray(result.logs) ? result.logs : []).map(entry => ({ ...entry as Record<string, unknown>, node_id: result.node_id, node_name: result.node_name })))
    .sort((a, b) => String((a as Record<string, unknown>).at || "").localeCompare(String((b as Record<string, unknown>).at || "")));
  const nodes = (
    Array.isArray(run.workflow_snapshot.nodes)
      ? (run.workflow_snapshot.nodes as AgenticWorkflowNode[])
      : []
  ).map((node) => ({
    ...node,
    type: "agenticStep",
    data: {
      ...node.data,
      runStatus: String(
        run.node_results.find((result) => result.node_id === node.id)?.status ||
          "not run",
      ),
    },
  }));
  const edges = (
    Array.isArray(run.workflow_snapshot.edges)
      ? (run.workflow_snapshot.edges as AgenticWorkflowEdge[])
      : []
  ).map(decorateFlowEdge);
  const inputRequiredNode = run.node_results.find(item => {
    const output = item.output as Record<string, unknown> | undefined;
    return (output?.verification as Record<string, unknown> | undefined)?.status === "needs_input";
  })?.node_id;
  const selected =
    nodes.find((node) => node.id === selectedId) ||
    nodes.find((node) => ["failed", "interrupted", "cancelled"].includes(String(node.data.runStatus))) ||
    nodes.find((node) => node.data.runStatus === "running") ||
    nodes.find((node) => node.id === inputRequiredNode) ||
    nodes.find((node) => node.data.kind === "output" && node.data.runStatus === "completed") ||
    nodes[0];
  const result = run.node_results.find((item) => item.node_id === selected?.id);
  const selectedIndex = nodes.findIndex(node => node.id === selected?.id);
  const completedCount = run.node_results.filter(item => item.status === "completed").length;
  const hasSprintResults = run.node_results.some(item => {
    const packets = (item.output as { data?: Array<{ cases?: unknown[] }> })?.data;
    return item.node_type === "artifactTask" && Array.isArray(packets) && packets.some(packet => packet?.cases?.length);
  });
  const selectNode = (id: string) => { setSelectedId(id); setDetailsOpen(true); setTab("steps"); };
  const hideDetails = () => { setDetailsOpen(false); detailsToggleRef.current?.focus(); };
  const runtime = run.workflow_snapshot.runtime_contract as
    | Record<string, unknown>
    | undefined;
  return (
    <section
      className={`workflow-studio studio-execution${maximized ? " is-maximized" : ""}`}
      aria-label="Workflow execution"
    >
      <header className="studio-header">
        <button
          type="button"
          className="studio-icon-button"
          aria-label="Back"
          onClick={onBack}
        >
          <IconArrowLeft size={19} />
        </button>
        <div className="studio-title">
          <span>Agentic Studio / Executions</span>
          <h2 title={run.workflow_name}>{run.workflow_name}</h2>
        </div>
        <span className="studio-status" role="status" data-status={run.status}>
          {run.status.replace(/_/g, " ")}
        </span>
        <button type="button" className="studio-icon-button" aria-label="Download execution snapshot" title="Download execution snapshot" onClick={exportRun} disabled={run.summary_only}><IconDownload size={18} /></button>
        <button type="button" className="studio-icon-button studio-execution-resize" aria-label={maximized ? "Restore execution" : "Maximize execution"} title={maximized ? "Restore execution" : "Maximize execution"} onClick={() => setMaximized(value => !value)}>{maximized ? <IconArrowsMinimize size={18} /> : <IconArrowsMaximize size={18} />}</button>
        {onRetry && canRun && !["running", "queued"].includes(run.status) && (
          <button className="ghost-button" type="button" aria-label="Open in editor" title="Open in editor" onClick={onRetry}>
            <IconRefresh size={16} />
            <span>Open in editor</span>
          </button>
        )}
      </header>
      <div className="studio-toolbar">
        <nav aria-label="Execution views">
          <button
            type="button"
            aria-pressed={tab === "steps"}
            onClick={() => setTab("steps")}
          >
            Steps & data
          </button>
          {hasSprintResults && <button type="button" aria-pressed={tab === "results"} onClick={() => setTab("results")}>Results</button>}
          <button
            type="button"
            aria-pressed={tab === "summary"}
            onClick={() => setTab("summary")}
          >
            Review summary
          </button>
          <button type="button" aria-pressed={tab === "logs"} onClick={() => setTab("logs")}>Execution log</button>
        </nav>
        <span className="studio-execution-mode">
          {run.execution_mode !== "review"
            ? "Graph preview · simulated data"
            : runtime?.target_node_id
              ? "Partial execution · through selected step"
              : "Saved execution"}
        </span>
        {canViewTraces && run.execution_mode === "review" && <a className="ghost-button compact" href={`/ops-telemetry?monitoring=ai&run_id=${encodeURIComponent(run.id)}`}>Model calls</a>}
        {canRun && run.status === "running" && (
          <button
            className="ghost-button"
            disabled={stopping}
            type="button"
            onClick={onStop}
          >
            {stopping ? "Stopping…" : "Stop review"}
          </button>
        )}
      </div>
      <div ref={contentRef} className="studio-execution-content" role="region" tabIndex={0} aria-label="Execution content">
      {exportNotice && <p className="studio-export-notice" role="status">{exportNotice}</p>}
      {error && (
        <p className="studio-notice" role="alert">
          {error}{" "}
          <button type="button" onClick={onRefresh}>
            Retry execution details
          </button>
        </p>
      )}
      <details className="studio-execution-context">
      <summary><span>Run details</span><span>{run.status.replace(/_/g, " ")} · {completedCount}/{run.node_results.length} complete · <LiveDuration start={run.started_at || run.created_at} end={run.completed_at} active={active} /></span></summary>
      <p className="studio-execution-summary" role="status">
        {String(
          run.output_payload?.summary ||
            (run.summary_only
              ? "Loading saved results…"
              : "Preparing execution…"),
        )}
      </p>
      <div className="studio-run-metrics" aria-label="Execution metrics">
        <span><strong><LiveDuration start={run.started_at || run.created_at} end={run.completed_at} active={active} /></strong>elapsed</span>
        <span><strong>{run.node_results.filter(item => item.status === "completed").length}/{run.node_results.length}</strong>completed</span>
        <span><strong>{run.node_results.filter(item => item.status === "failed").length}</strong>failed</span>
        <span><strong>{run.node_results.filter(item => item.status === "skipped").length}</strong>skipped</span>
      </div>
      </details>
      {active && <div className="studio-run-progress"><progress aria-label="Recorded execution progress" max={Math.max(1, run.node_results.length)} value={run.summary_only || !run.node_results.length ? undefined : run.node_results.filter(item => ["completed", "failed", "skipped", "cancelled", "interrupted"].includes(String(item.status))).length} /><span>{run.status === "queued" ? "Waiting for a worker" : "Execution in progress"}</span></div>}
      {hasSprintResults && <div className="studio-execution-document" hidden={tab !== "results"}><WorkflowSprintDrafts key={run.id} run={run} /></div>}
      {tab === "results" ? null : tab === "logs" ? <div className="studio-run-log"><WorkflowExecutionLog logs={logs} onSelectNode={selectNode} /></div> : tab === "summary" ? (
        <div className="studio-review-summary">
          <WorkflowReviewSummary
            run={run}
            canStop={false}
            stopping={stopping}
            onStop={onStop}
            onOpenReview={onOpenReview}
            onSelectStep={selectNode}
          />
        </div>
      ) : (
        <>
        <div className="studio-execution-layout-tools" role="group" aria-label="Execution layout">
          <button type="button" aria-label={stepsOpen ? "Hide steps" : "Show steps"} aria-expanded={stepsOpen} aria-controls={stepsId} onClick={() => setStepsOpen(value => !value)}><IconLayoutSidebarLeftCollapse size={17} /><span>Steps</span><small>{run.node_results.length}</small></button>
          <div className="studio-execution-step-navigation"><button type="button" className="studio-icon-button" aria-label="Previous step" disabled={selectedIndex <= 0} onClick={() => selectNode(nodes[selectedIndex - 1].id)}><IconChevronLeft size={17} /></button><span>{selectedIndex < 0 ? "No recorded steps" : `Step ${selectedIndex + 1} of ${nodes.length}`}</span><button type="button" className="studio-icon-button" aria-label="Next step" disabled={selectedIndex < 0 || selectedIndex >= nodes.length - 1} onClick={() => selectNode(nodes[selectedIndex + 1].id)}><IconChevronRight size={17} /></button></div>
          <button ref={detailsToggleRef} type="button" aria-label={detailsOpen ? "Hide details" : "Show details"} aria-expanded={detailsOpen} aria-controls={detailsId} disabled={!selected} onClick={() => setDetailsOpen(value => !value)}><IconLayoutSidebarRightCollapse size={17} /><span>Node details</span></button>
        </div>
        <div className={`studio-execution-workspace${stepsOpen ? " steps-open" : ""}${detailsOpen && selected ? " details-open" : ""}`}>
          {stepsOpen && <aside id={stepsId} className="studio-execution-steps" aria-label="Execution steps" tabIndex={0}>
            <header>
              <strong>Execution steps</strong>
              <small>
                {
                  run.node_results.filter((item) => item.status === "completed")
                    .length
                }
                /{run.node_results.length} complete
              </small>
            </header>
            <ol>
              {run.node_results.map((item, index) => (
                <li key={String(item.node_id)}>
                  <button
                    type="button"
                    aria-pressed={selected?.id === item.node_id}
                    onClick={() => selectNode(String(item.node_id))}
                  >
                    <span className="studio-step-number">{index + 1}</span>
                    <span>
                      <strong>{String(item.node_name)}</strong>
                      <small>
                        {String(item.status).replace(/_/g, " ")}
                        {item.started_at ? ` · ${executionDuration(item.started_at, item.completed_at)}` : ""}
                        {Number(item.attempts) > 1
                          ? ` · ${item.attempts} attempts`
                          : ""}
                      </small>
                    </span>
                    <i data-status={String(item.status)} />
                  </button>
                </li>
              ))}
            </ol>
            <p className="studio-caption">
              {run.started_at ? new Date(run.started_at).toLocaleString() : ""}
            </p>
          </aside>}
          <div className="studio-execution-graph">
          <WorkflowCanvas
            focusNodeId={selected?.id}
            autoFitOnResize={false}
            nodes={nodes.map((node) => ({
              ...node,
              selected: node.id === selected?.id,
            }))}
            edges={edges}
            nodesDraggable={false}
            nodesConnectable={false}
            zoomOnScroll={false}
            preventScrolling={false}
            onNodeClick={(_, node) => selectNode(node.id)}
            onNodeDoubleClick={(_, node) => {
              selectNode(node.id);
              setExpanded(true);
            }}
          />
          <p className="studio-execution-graph-help">Drag to pan · Use + / − to zoom · Select a node for its data</p>
          </div>
          {selected && detailsOpen && (
            <div id={detailsId} ref={detailsRef} className="studio-execution-details">
            <WorkflowNodeInspector
              key={run.id}
              node={selected}
              incoming={nodes.filter((node) =>
                edges.some(
                  (edge) =>
                    edge.source === node.id && edge.target === selected.id,
                ),
              )}
              result={result}
              run={run}
              editable={false}
              canRun={false}
              busy={false}
              expanded={expanded}
              projectId={run.project_id}
              appTypeId={run.app_type_id || ""}
              canKnowledge={false}
              providers={[
                { value: "", label: "Saved connection", modelLabel: "" },
              ]}
              onChange={() => {}}
              onExecute={() => {}}
              onDelete={() => {}}
              onClose={() => expanded ? setExpanded(false) : hideDetails()}
              onExpand={() => setExpanded((value) => !value)}
              collapsible
              onOpenReview={onOpenReview}
              onOpenSource={onOpenSource}
            />
            </div>
          )}
        </div>
        </>
      )}
      </div>
    </section>
  );
}
