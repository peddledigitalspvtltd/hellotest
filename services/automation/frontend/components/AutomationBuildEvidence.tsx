export type AutomationBuildChange = { id: string; title: string; before: string; after: string };
export function AutomationBuildEvidence({ status, receipt, changes, retryCount, onOpenJobs, onReview, onRetry }: {
  status: string; receipt: string; changes: AutomationBuildChange[]; retryCount: number;
  onOpenJobs: () => void; onReview: () => void; onRetry: () => void;
}) {
  if (!receipt) return null;
  return <section className="automation-build-evidence" aria-label="Automation build evidence" data-status={status}>
    <header><span className="automation-evidence-status">{status === "queued" || status === "running" ? <span className="automation-live-dot" /> : null}{status === "completed" ? "Output ready" : status === "failed" ? "Build needs attention" : status === "paused" ? "Tracking paused" : "Agent working"}</span><button className="ghost-button compact" onClick={onOpenJobs} type="button">Build activity ↗</button></header>
    <p role="status" aria-live="polite">{receipt}</p>
    {changes.length ? <details><summary>{changes.length} changed section{changes.length === 1 ? "" : "s"} · Compare saved output</summary><div className="automation-build-diffs">{changes.map(change => <details key={change.id}><summary>{change.title}</summary><div><section><span>Before</span><pre>{change.before || "No executable instructions"}</pre></section><section><span>After</span><pre>{change.after || "No executable instructions"}</pre></section></div></details>)}</div></details> : null}
    <footer>{status === "completed" ? <button className="primary-button compact" onClick={onReview} type="button">Review generated plan</button> : null}{retryCount ? <button className="ghost-button compact" onClick={onRetry} type="button">Retry {retryCount} unfinished case{retryCount === 1 ? "" : "s"}</button> : null}</footer>
  </section>;
}
