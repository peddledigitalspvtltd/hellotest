import { LoadingState } from "../components/LoadingState";
import { IconArrowRight, IconCheck, IconClock, IconPlayerStop, IconShieldCheck } from "@tabler/icons-react";
import type { AgenticWorkflowRun } from "../types";

const stateLabels: Record<string, string> = {
  running: "In progress", queued: "Waiting", completed: "Completed", needs_review: "Review required",
  failed: "Failed", cancelled: "Stopped", interrupted: "Interrupted", skipped: "Not reached"
};

export function WorkflowReviewSummary({ run, canStop, stopping, onStop, onOpenReview, onSelectStep }: {
  run: AgenticWorkflowRun; canStop: boolean; stopping: boolean; onStop: () => void;
  onOpenReview: (agentId: string, sessionId: string) => void; onSelectStep: (id: string) => void;
}) {
  const completed = run.node_results.filter(step => step.status === "completed").length;
  const total = run.node_results.length;
  const summary = String(run.output_payload?.summary || "The review is preparing its first step.");
  const reviews = run.node_results.filter(step => (step.output as Record<string, unknown> | undefined)?.session_id);
  return <section className="workflow-review-summary" aria-label="Review workflow progress">
    <div className="workflow-review-summary__header">
      <div><span className="workflow-review-kicker"><IconShieldCheck size={17} /> Evidence review</span><h2>{stateLabels[run.status] || run.status}</h2><p role="status">{summary}</p></div>
      {run.status === "running" && canStop && <button className="ghost-button" type="button" onClick={onStop} disabled={stopping}><IconPlayerStop size={16} />{stopping ? "Stopping…" : "Stop review"}</button>}
    </div>
    <div className="workflow-review-progress"><span>{completed} of {total} steps completed</span><span><IconClock size={15} /> Up to 3 minutes</span></div>
    <progress max={Math.max(total, 1)} value={completed} aria-label="Completed review steps" />
    <ol className="workflow-review-steps">{run.node_results.map(step => <li key={String(step.node_id)} data-status={String(step.status)}>
      <button type="button" onClick={() => onSelectStep(String(step.node_id))}>
        <span className="workflow-review-step-icon">{step.status === "completed" ? <IconCheck size={18} /> : step.status === "running" ? <LoadingState label={`Running ${String(step.node_name)}`} /> : <IconClock size={18} />}</span>
        <span><strong>{String(step.node_name)}</strong><small>{stateLabels[String(step.status)] || String(step.status)}{Number(step.attempts) > 1 ? ` · ${step.attempts} attempts` : ""}</small></span>
      </button>
    </li>)}</ol>
    {reviews.length > 0 && <div className="workflow-review-deliverables"><h3>Saved specialist reviews</h3><p>Open a review to inspect its sources, findings and next actions.</p>
      <div>{reviews.map(step => {
        const result = step.output as Record<string, unknown>;
        const readiness = result.readiness as { status?: string; evidence_count?: number } | undefined;
        const provenance = result.provenance as { generation_mode?: string } | undefined;
        return <article key={String(step.node_id)}>
          <div><strong>{String(step.node_name)}</strong><span className={`workflow-review-evidence ${readiness?.status === "ready_for_review" ? "is-ready" : "has-gaps"}`}>{readiness?.status === "ready_for_review" ? "Evidence reviewed" : "Evidence gaps"}</span></div>
          <p>{String(result.executive_summary || result.response || "Review saved.").slice(0, 280)}</p>
          <footer><small>{provenance?.generation_mode === "llm" ? "Model-assisted" : "Evidence summary"} · {readiness?.evidence_count || 0} evidence sources</small>
            <button className="ghost-button compact" type="button" onClick={() => onOpenReview(String(step.specialist_id || result.specialist_id), String(result.session_id))}>Open review<IconArrowRight size={15} /></button></footer>
        </article>;
      })}</div>
    </div>}
  </section>;
}
