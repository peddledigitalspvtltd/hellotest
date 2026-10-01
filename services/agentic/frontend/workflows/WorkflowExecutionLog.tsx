import { useState } from "react";

type LogEntry = { at?: string; level?: string; message?: string; attempt?: number; retry_delay_ms?: number; item_index?: number; node_name?: string; node_id?: string; code?: string; status_code?: number };
export function WorkflowExecutionLog({ logs, onSelectNode }: { logs: unknown; onSelectNode?: (id: string) => void }) {
  const [level, setLevel] = useState("all");
  const entries = (Array.isArray(logs) ? logs : []) as LogEntry[];
  const visible = entries.filter(entry => level === "all" || (entry.level || "info") === level);
  return <div className="studio-event-log">
    <div className="studio-log-toolbar"><span>{entries.length} events</span><label><span className="sr-only">Log level</span><select aria-label="Log level" value={level} onChange={event => setLevel(event.target.value)}><option value="all">All levels</option><option value="error">Errors</option><option value="warning">Warnings</option><option value="info">Information</option></select></label></div>
    {visible.length ? <ol>{visible.map((entry, index) => <li key={`${entry.at}-${index}`} data-level={entry.level || "info"}>
      <div className="studio-event-meta"><time dateTime={entry.at}>{entry.at ? new Date(entry.at).toLocaleTimeString() : "—"}</time><span>{entry.level || "info"}</span>{entry.node_id && onSelectNode ? <button type="button" onClick={() => onSelectNode(entry.node_id!)}>{entry.node_name || entry.node_id}</button> : entry.node_name && <span>{entry.node_name}</span>}</div>
      <p>{entry.message || "Execution event"}</p>
      {(entry.code || entry.status_code || entry.attempt || entry.item_index != null || entry.retry_delay_ms != null) && <small>{[entry.code, entry.status_code && `HTTP ${entry.status_code}`, entry.attempt && `Attempt ${entry.attempt}`, entry.item_index != null && `Item ${entry.item_index + 1}`, entry.retry_delay_ms != null && `Retry delay ${entry.retry_delay_ms} ms`].filter(Boolean).join(" · ")}</small>}
    </li>)}</ol> : <p className="studio-empty">{entries.length ? "No events match this level." : "No execution events recorded yet."}</p>}
  </div>;
}

export function executionDuration(start: unknown, end?: unknown): string {
  const started = Date.parse(String(start || ""));
  const completed = end ? Date.parse(String(end)) : Date.now();
  if (!Number.isFinite(started) || !Number.isFinite(completed)) return "—";
  const seconds = Math.max(0, completed - started) / 1000;
  return seconds < 1 ? `${Math.round(seconds * 1000)} ms` : seconds < 60 ? `${seconds.toFixed(1)} s` : `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
}
