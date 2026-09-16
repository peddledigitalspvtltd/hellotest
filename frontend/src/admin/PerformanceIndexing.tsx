import { useCallback, useEffect, useRef, useState } from "react";
import { IconBolt, IconRefresh } from "@tabler/icons-react";
import { adminApi, type PerformanceIndexingState } from "./api";
import "./performance-indexing.css";

export function PerformanceIndexing({ disabled, onRunningChange }: { disabled: boolean; onRunningChange: (running: boolean) => void }) {
  const [state, setState] = useState<PerformanceIndexingState | null>(null);
  const [error, setError] = useState("");
  const [startError, setStartError] = useState("");
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [revision, setRevision] = useState(0);
  const mounted = useRef(false);
  const generation = useRef(0);
  const running = Boolean(state?.running);
  const refresh = useCallback(() => setRevision(value => value + 1), []);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { onRunningChange(starting || running); }, [onRunningChange, starting, running]);
  useEffect(() => {
    const controller = new AbortController();
    const requestGeneration = generation.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const next = await adminApi.performanceIndexing({ signal: controller.signal });
        if (controller.signal.aborted || generation.current !== requestGeneration) return;
        setState(next); setError(""); setLoading(false);
        if (next.running) timer = setTimeout(() => void load(), 1500);
      } catch (reason) {
        if (controller.signal.aborted || generation.current !== requestGeneration) return;
        setError(reason instanceof Error ? reason.message : "Indexing status could not be loaded.");
        setLoading(false);
        // Preserve a known running job and keep polling after transient errors.
        timer = setTimeout(() => void load(), 5000);
      }
    };
    void load();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [revision]);

  const start = async () => {
    if (disabled || starting || running || loading) return;
    generation.current += 1;
    setStarting(true); setError(""); setStartError("");
    try {
      const next = await adminApi.startPerformanceIndexing();
      if (mounted.current) setState(next);
    } catch (reason) {
      if (mounted.current) setStartError(reason instanceof Error ? reason.message : "Performance indexing could not be started.");
    } finally {
      if (mounted.current) { setStarting(false); refresh(); }
    }
  };
  const job = state?.job;
  const complete = job?.indexes.filter(index => index.status === "created" || index.status === "existing").length || 0;
  const total = job?.indexes.length || state?.catalog.length || 0;
  const failures = job?.indexes.filter(index => index.status === "failed") || [];
  const activeIndex = running ? job?.indexes.find(index => index.status === "running") : null;
  const summary = running ? `${job?.completed || 0} of ${total} index checks completed${activeIndex ? ` · ${activeIndex.label}` : ""}`
    : job?.status === "completed" ? `${complete} of ${total} performance indexes are ready.`
      : job?.status === "partial" ? `${complete} of ${total} indexes are ready. ${failures.length} need another attempt.`
        : job?.error || "Add missing indexes for faster project lists, catalogs, run history and sign-in.";

  return <div className="performance-indexing" aria-busy={starting || running}>
    <div className="performance-indexing-heading"><div><h4>Performance indexing</h4><p>Checks the shared database and builds missing indexes while normal reads and writes continue.</p></div>
      <button className="secondary-button" disabled={disabled || starting || running || loading} onClick={() => void start()} type="button">
        <IconBolt size={16} aria-hidden="true" />{starting ? "Starting indexing…" : running ? "Indexing…" : "Run performance indexing"}
      </button>
    </div>
    <p className="performance-indexing-status" role="status">{loading ? "Checking indexing status…" : summary}</p>
    {running && total ? <progress aria-label="Performance indexing progress" value={job?.completed || 0} max={total} /> : null}
    {error || startError ? <div className="performance-indexing-error" role="alert"><span>{error || startError}</span><button className="secondary-button" onClick={refresh} type="button"><IconRefresh size={14} aria-hidden="true" /> Refresh status</button></div> : null}
    {job ? <details className="performance-indexing-results"><summary>View index results</summary><ul>{job.indexes.map(index => <li key={index.name}><div><strong>{index.label}</strong>{index.error ? <span>{index.error}</span> : null}</div><span className={`index-result is-${index.status}`}>{index.status === "existing" ? "Already present" : index.status === "created" ? "Created" : index.status === "running" && !running ? "Interrupted" : index.status}</span></li>)}</ul></details> : null}
  </div>;
}
