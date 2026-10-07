import { useEffect, useState } from "react";
import { IconCheck, IconCircle, IconSparkles } from "@tabler/icons-react";
import type { AgenticProcessingSnapshot } from "@hellotest/agentic/frontend/components/AgenticExperience";
import "./AiGenerationProgress.css";

export function AiGenerationProgress({ modelLabel = "Configured model", onCancel, processing }: { modelLabel?: string; onCancel?: () => void; processing?: AgenticProcessingSnapshot }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const labels: Record<string, string> = { intake: "Intent", context: "Evidence", guardrails: "Boundaries", specialist: "Generate", outcome: "Proposal", evaluation: "Check", review: "Review" };
  const stages = processing?.stages?.length ? processing.stages.map(stage => ({ id: stage.id, label: labels[stage.id] || stage.id, status: stage.status, detail: stage.detail }))
    : [{ id: "request", label: "Request sent", status: "complete", detail: "" }, { id: "response", label: "Model response", status: "running", detail: "Waiting for a complete response" }, { id: "review", label: "Your review", status: "queued", detail: "Starts when the proposal is ready" }];
  return <div className="ai-generation-progress">
    <div className="ai-generation-progress__icon" aria-hidden="true"><IconSparkles size={20} /></div>
    <div role="status" aria-live="polite"><strong>Generating your proposal</strong><p>{processing?.status_label || (elapsed >= 45 ? "The model is still responding. The proposal appears after validation." : `${modelLabel} · waiting for a complete, validated response`)}</p></div>
    <span className="ai-generation-progress__elapsed" aria-hidden="true">{elapsed}s</span>
    {onCancel ? <button onClick={onCancel} type="button">Stop</button> : null}
    <ol className="ai-generation-stages" aria-label="Generation stages">{stages.map(stage => <li data-status={stage.status} key={stage.id} title={stage.detail || undefined}><span aria-hidden="true">{stage.status === "complete" ? <IconCheck size={13} /> : <IconCircle size={10} />}</span><strong>{stage.label}</strong><small>{stage.status === "complete" ? "Complete" : stage.status === "running" || stage.status === "current" ? "Active" : stage.status === "failed" ? "Needs attention" : "Next"}</small></li>)}</ol>
    <div className="ai-generation-progress__track" aria-hidden="true"><span /></div>
  </div>;
}
