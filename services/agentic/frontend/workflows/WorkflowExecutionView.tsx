import { useState } from "react";
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
  stopping: boolean;
  onStop: () => void;
  error?: string;
  onRefresh: () => void;
  onOpenReview: (agent: string, session: string) => void;
  onOpenSource: (agent: string, run: string) => void;
}) {
  const [tab, setTab] = useState<"steps" | "summary">("steps"),
    [selectedId, setSelectedId] = useState(""),
    [expanded, setExpanded] = useState(false);
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
    nodes.find((node) => node.data.runStatus === "running") ||
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
      {tab === "summary" ? (
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
