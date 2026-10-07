import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { api } from "@hellotest/platform/frontend/src/lib/api";
import { useDialogFocus } from "@hellotest/platform/frontend/src/shared/hooks/useDialogFocus";
import { DialogCloseButton } from "@hellotest/platform/frontend/src/shared/components/DialogCloseButton";
import { inspectAutomationTargets, type AutomationReadiness } from "../lib/automationReadiness";

export type AutomationRunReviewRequest = { mode: "local" | "remote"; caseIds: string[]; projectId: string; appTypeId: string };
export function AutomationRunReviewDialog({ request, unsavedStepIds, verifySource, busy, error, pendingRunId, retryAllowed = true, executionProfile, onClose, onOpenCase, onRun, onRetryStart, onOpenRun }: {
  request: AutomationRunReviewRequest; unsavedStepIds: string[]; verifySource: boolean; busy: boolean; error: string; pendingRunId?: string; retryAllowed?: boolean;
  executionProfile: ReactNode; onClose: () => void; onOpenCase: (id: string) => void;
  onRun: (results: AutomationReadiness[]) => void; onRetryStart: () => void; onOpenRun: () => void;
}) {
  const [results, setResults] = useState<AutomationReadiness[]>([]);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const ref = useDialogFocus<HTMLDivElement>({ onClose, closeDisabled: busy });
  // The request owns the exact target snapshot. Selection changes underneath a
  // dialog cannot add a case to a run that the user has not reviewed.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setReadError("");
    void inspectAutomationTargets(request.caseIds, request.appTypeId, {
      getCase: (id, signal) => api.testCases.get(id, { project_id: request.projectId }, { signal }),
      getSteps: (id, signal) => api.testSteps.list({ test_case_id: id }, { signal })
    }, "run", unsavedStepIds, controller.signal, verifySource).then(result => {
      if (!controller.signal.aborted) setResults(result);
    }).catch(error => {
      if (!controller.signal.aborted) setReadError(error instanceof Error ? error.message : "Readiness checks could not be loaded.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [request, refresh]);
  const blocked = results.filter(result => !result.ready).length;
  const ready = !loading && !readError && results.length === request.caseIds.length && !blocked;
  return createPortal(<div className="modal-backdrop automation-review-backdrop" onClick={() => { if (!busy) onClose(); }} role="presentation">
    <div aria-labelledby="automation-run-review-title" aria-modal="true" className="modal-card automation-run-review" onClick={event => event.stopPropagation()} ref={ref} role="dialog" tabIndex={-1}>
      <header className="modal-header"><div><span className="eyebrow">Run review · {request.mode === "local" ? "Local engine" : "Remote engine"}</span><h2 id="automation-run-review-title">{pendingRunId ? "Reconnect this run" : "Ready to execute?"}</h2><p>{request.caseIds.length} selected case{request.caseIds.length === 1 ? "" : "s"} · Saved instructions are checked before dispatch.</p></div><DialogCloseButton disabled={busy} onClick={onClose} /></header>
      <div className="modal-body automation-review-body">
        {pendingRunId ? <section className="automation-recovery" role="alert"><strong>The run is saved</strong><p>{error}</p><code>{pendingRunId}</code><span>{retryAllowed ? "Retry checks this execution and resumes its start." : "Open the run to review dispatch details and recover unfinished cases."}</span></section> : <>
          <div className="automation-readiness-heading" role="status"><strong>{loading ? "Checking saved plans…" : readError ? "Check interrupted" : blocked ? `${blocked} case${blocked === 1 ? " needs" : "s need"} attention` : "Saved plans are ready"}</strong><button className="ghost-button compact" disabled={loading || busy} onClick={() => setRefresh(value => value + 1)} type="button">Recheck</button></div>
          {readError ? <p className="automation-validation-error" role="alert">{readError}</p> : null}
          {!loading && !readError ? <div className="automation-readiness-list">{results.map(result => <article className="automation-readiness-case" data-ready={result.ready} key={result.id}><header><div><strong>{result.title}</strong><span>{result.runtimes.join(" + ").toUpperCase()} · {verifySource ? `${result.runnableCount} executable` : `${result.stepCount} saved steps`}{result.skippedCount ? ` · ${result.skippedCount} skipped` : ""}</span></div><span className="automation-readiness-badge">{result.ready ? "Ready" : "Needs attention"}</span></header>{result.issues.length ? <ul>{result.issues.map((issue, index) => <li data-severity={issue.severity} key={index}>{issue.order ? `Step ${issue.order} · ` : ""}{issue.message}</li>)}</ul> : null}<footer><span>Revision {result.revision || "—"}{result.updatedAt ? ` · Saved ${new Date(result.updatedAt).toLocaleString()}` : ""}</span><button className="ghost-button compact" disabled={busy} onClick={() => onOpenCase(result.id)} type="button">Open plan</button></footer></article>)}</div> : null}
          <details className="automation-run-profile"><summary>Execution profile</summary>{executionProfile}</details>
          {error ? <p className="automation-validation-error" role="alert">{error}</p> : null}
        </>}
      </div>
      <footer className="modal-footer"><button className="ghost-button" disabled={busy} onClick={pendingRunId && retryAllowed ? onOpenRun : onClose} type="button">{pendingRunId && retryAllowed ? "View saved run" : "Cancel"}</button><button className="primary-button" disabled={busy || (!pendingRunId && !ready)} onClick={pendingRunId ? retryAllowed ? onRetryStart : onOpenRun : () => onRun(results)} type="button">{busy ? "Starting…" : pendingRunId ? retryAllowed ? "Retry start" : "View saved run" : `Start ${request.mode} run`}</button></footer>
    </div>
  </div>, document.body);
}
