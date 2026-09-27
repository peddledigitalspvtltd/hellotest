import { useState } from "react";
import { parseExecutionLogs, type ExecutionStepEvidence } from "../lib/executionLogs";
import { downloadExecutionAttachment } from "../lib/executionAttachments";
import { StatusBadge } from "@hellotest/platform/frontend/src/shared/components/StatusBadge";
import "./ExecutionHookResults.css";

export function ExecutionHookResults({ logs, canViewEvidence = false, canViewAutomationCode = false, onOpenEvidence }: {
  logs: string | null;
  canViewEvidence?: boolean;
  canViewAutomationCode?: boolean;
  onOpenEvidence?: (evidence: ExecutionStepEvidence, stepId: string) => void | Promise<void>;
}) {
  const [error, setError] = useState("");
  const parsed = parseExecutionLogs(logs);
  const hooks = [...new Set([...Object.keys(parsed.stepStatuses || {}), ...Object.keys(parsed.stepAutomationDetails || {})])]
    .filter(id => /^(test|suite|run):(pre|post):/.test(id));
  if (!hooks.length) return null;
  const failures = hooks.filter(id => ["failed", "blocked"].includes(parsed.stepStatuses?.[id] || "")).length;
  const openEvidence = async (evidence: ExecutionStepEvidence, stepId: string) => {
    setError("");
    try {
      if (onOpenEvidence) await onOpenEvidence(evidence, stepId);
      else if (evidence.attachmentId) await downloadExecutionAttachment(evidence.attachmentId, evidence.fileName || "Hook evidence");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to open hook evidence."); }
  };
  return <details className="execution-hook-results" open={failures > 0}>
    <summary><strong>Setup & teardown</strong><span>{hooks.length} step{hooks.length === 1 ? "" : "s"}{failures ? ` · ${failures} need attention` : ""}</span></summary>
    <ol aria-label="Setup and teardown results">
      {hooks.map(id => {
        const note = typeof parsed.stepNotes?.[id] === "string" ? parsed.stepNotes[id] : "";
        const [title, ...body] = note.split("\n");
        const detail = parsed.stepAutomationDetails?.[id];
        const api = parsed.stepApiDetails?.[id];
        const evidence = parsed.stepEvidence?.[id];
        const lines = detail?.line_results || [];
        const status = parsed.stepStatuses?.[id] || detail?.status || "queued";
        const phase = id.split(":")[1] === "pre" ? "Before test" : "After test";
        return <li key={id} data-hook-step-id={id}>
          <div className="execution-hook-result-heading"><div><small>{phase}{detail?.engine ? ` · ${detail.engine.toUpperCase()}` : ""}</small><strong>{title || phase}</strong></div><StatusBadge value={status} /></div>
          {body.join("\n").trim() ? <p>{body.join("\n")}</p> : null}
          {api?.response?.status != null ? <span className="execution-hook-result-fact">HTTP {api.response.status}{api.assertions?.length ? ` · ${api.assertions.filter(assertion => assertion.passed).length}/${api.assertions.length} assertions passed` : ""}</span> : null}
          {lines.length ? <details className="execution-hook-lines"><summary>{lines.length} recorded code statement{lines.length === 1 ? "" : "s"}</summary><table><thead><tr><th>Line</th><th>Attempt</th><th>Result</th><th>Duration</th></tr></thead><tbody>{lines.map((line, index) => <tr key={`${line.line}:${line.attempt}:${index}`}><td>{line.line}</td><td>{line.attempt}</td><td><StatusBadge value={line.status} /></td><td>{line.duration_ms} ms</td></tr>)}</tbody></table></details> : null}
          {canViewAutomationCode && detail?.code ? <details className="execution-hook-code"><summary>Executed code</summary><pre>{detail.code}</pre></details> : null}
          {canViewEvidence && evidence ? evidence.attachmentId || onOpenEvidence ? <button className="ghost-button" type="button" onClick={() => void openEvidence(evidence, id)}>Open hook evidence</button> : evidence.dataUrl ? <a className="ghost-button" href={evidence.dataUrl} download={evidence.fileName || "Hook evidence"}>Download hook evidence</a> : null : null}
        </li>;
      })}
    </ol>
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
  </details>;
}
