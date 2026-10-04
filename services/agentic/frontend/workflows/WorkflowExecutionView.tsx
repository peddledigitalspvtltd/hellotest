import { useEffect, useState } from "react";
import { WorkflowExecutionLog, executionDuration } from "./WorkflowExecutionLog";
import { IconArrowLeft, IconRefresh } from "@tabler/icons-react";
import type {
  AgenticWorkflowNode,
  AgenticWorkflowEdge,
  AgenticWorkflowRun,
} from "@hellotest/platform/frontend/src/types";
import { WorkflowReviewSummary } from "../agents/WorkflowReviewSummary";
import { WorkflowCanvas } from "./WorkflowCanvas";
import { WorkflowNodeInspector } from "./WorkflowNodeInspector";
import { decorateFlowEdge } from "./workflowGraph";
import "./WorkflowStudio.css";

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
  const [tab, setTab] = useState<"steps" | "summary" | "logs">("steps"),
    [selectedId, setSelectedId] = useState(""),
    [expanded, setExpanded] = useState(false);
  useEffect(() => { setSelectedId(""); setExpanded(false); }, [run.id]);
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
  const selected =
    nodes.find((node) => node.id === selectedId) ||
    nodes.find((node) => ["failed", "interrupted", "cancelled"].includes(String(node.data.runStatus))) ||
    nodes.find((node) => node.data.runStatus === "running") ||
    nodes.find((node) => node.data.kind === "output" && node.data.runStatus === "completed") ||
    nodes[0];
  const result = run.node_results.find((item) => item.node_id === selected?.id);
  const runtime = run.workflow_snapshot.runtime_contract as
    | Record<string, unknown>
    | undefined;
  return (
    <section
      className="workflow-studio studio-execution"
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
          <h2>{run.workflow_name}</h2>
        </div>
        <span className="studio-status" role="status">
          {run.status.replace(/_/g, " ")}
        </span>
        {onRetry && canRun && !["running", "queued"].includes(run.status) && (
          <button className="ghost-button" type="button" onClick={onRetry}>
            <IconRefresh size={16} />
            Open in editor
          </button>
        )}
      </header>
      <div className="studio-toolbar">
        {canViewTraces && run.execution_mode === "review" && <a className="ghost-button compact" href={`/ops-telemetry?monitoring=ai&run_id=${encodeURIComponent(run.id)}`}>Model calls</a>}
        <nav aria-label="Execution views">
          <button
            type="button"
            aria-pressed={tab === "steps"}
            onClick={() => setTab("steps")}
          >
            Steps & data
          </button>
          <button
            type="button"
            aria-pressed={tab === "summary"}
            onClick={() => setTab("summary")}
          >
            Review summary
          </button>
          <button type="button" aria-pressed={tab === "logs"} onClick={() => setTab("logs")}>Execution log</button>
        </nav>
        <span>
          {run.execution_mode !== "review"
            ? "Graph preview · simulated data"
            : runtime?.target_node_id
              ? "Partial execution · through selected step"
              : "Saved execution"}
        </span>
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
      {error && (
        <p className="studio-notice" role="alert">
          {error}{" "}
          <button type="button" onClick={onRefresh}>
            Retry execution details
          </button>
        </p>
      )}
      <p className="studio-execution-summary" role="status">
        {String(
          run.output_payload?.summary ||
            (run.summary_only
              ? "Loading saved results…"
              : "Preparing execution…"),
        )}
      </p>
      <div className="studio-run-metrics" aria-label="Execution metrics">
        <span><strong>{executionDuration(run.started_at || run.created_at, run.completed_at)}</strong>elapsed</span>
        <span><strong>{run.node_results.filter(item => item.status === "completed").length}/{run.node_results.length}</strong>completed</span>
        <span><strong>{run.node_results.filter(item => item.status === "failed").length}</strong>failed</span>
        <span><strong>{run.node_results.filter(item => item.status === "skipped").length}</strong>skipped</span>
      </div>
      {tab === "logs" ? <div className="studio-run-log"><WorkflowExecutionLog logs={logs} onSelectNode={id => { setSelectedId(id); setTab("steps"); }} /></div> : tab === "summary" ? (
        <div className="studio-review-summary">
          <WorkflowReviewSummary
            run={run}
            canStop={false}
            stopping={stopping}
            onStop={onStop}
            onOpenReview={onOpenReview}
            onSelectStep={(id) => {
              setSelectedId(id);
              setTab("steps");
            }}
          />
        </div>
      ) : (
        <div className="studio-workspace has-library has-inspector">
          <aside className="studio-execution-steps">
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
                    onClick={() => setSelectedId(String(item.node_id))}
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
          </aside>
          <WorkflowCanvas
            nodes={nodes.map((node) => ({
              ...node,
              selected: node.id === selected?.id,
            }))}
            edges={edges}
            nodesDraggable={false}
            nodesConnectable={false}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onNodeDoubleClick={(_, node) => {
              setSelectedId(node.id);
              setExpanded(true);
            }}
          />
          {selected && (
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
              onClose={() => setExpanded(false)}
              onExpand={() => setExpanded((value) => !value)}
              onOpenReview={onOpenReview}
              onOpenSource={onOpenSource}
            />
          )}
        </div>
      )}
    </section>
  );
}
