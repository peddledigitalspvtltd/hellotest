import { useState } from "react";
import { WorkflowDataView } from "./WorkflowDataView";

type LogEntry = { at?: string; level?: string; message?: string; attempt?: number; retry_delay_ms?: number; item_index?: number; node_name?: string; node_id?: string; code?: string; status_code?: number };
export function WorkflowExecutionLog({ logs, onSelectNode }: { logs: unknown; onSelectNode?: (id: string) => void }) {
  const [level, setLevel] = useState("all");
  const [format, setFormat] = useState<"events" | "json">("events"), [limit, setLimit] = useState(200);
  const entries = (Array.isArray(logs) ? logs : []).filter(entry => entry && typeof entry === "object") as LogEntry[];
  const visible = entries.filter(entry => level === "all" || (entry.level || "info") === level);
  return <div className="studio-event-log">
    <div className="studio-log-toolbar"><span>{entries.length} events</span><div role="group" aria-label="Execution log format"><button type="button" aria-pressed={format === "events"} onClick={() => setFormat("events")}>Events</button><button type="button" aria-pressed={format === "json"} onClick={() => setFormat("json")}>JSON</button></div><label><span className="sr-only">Log level</span><select aria-label="Log level" value={level} onChange={event => { setLevel(event.target.value); setLimit(200); }}><option value="all">All levels</option><option value="error">Errors</option><option value="warning">Warnings</option><option value="info">Information</option></select></label></div>
    {format === "json" ? <WorkflowDataView value={visible} defaultMode="json" jsonLabel="Execution log JSON" /> : visible.length ? <><ol>{visible.slice(0, limit).map((entry, index) => <li key={`${entry.at}-${index}`} data-level={entry.level || "info"}>
      <div className="studio-event-meta"><time dateTime={entry.at}>{entry.at ? new Date(entry.at).toLocaleTimeString() : "—"}</time><span>{entry.level || "info"}</span>{entry.node_id && onSelectNode ? <button type="button" onClick={() => onSelectNode(entry.node_id!)}>{entry.node_name || entry.node_id}</button> : entry.node_name && <span>{entry.node_name}</span>}</div>
      <p>{entry.message || "Execution event"}</p>
      {(entry.code || entry.status_code || entry.attempt || entry.item_index != null || entry.retry_delay_ms != null) && <small>{[entry.code, entry.status_code && `HTTP ${entry.status_code}`, entry.attempt && `Attempt ${entry.attempt}`, entry.item_index != null && `Item ${entry.item_index + 1}`, entry.retry_delay_ms != null && `Retry delay ${entry.retry_delay_ms} ms`].filter(Boolean).join(" · ")}</small>}
    </li>)}</ol>{visible.length > limit && <button type="button" className="ghost-button" onClick={() => setLimit(value => value + 200)}>Show more events ({visible.length - limit} remaining)</button>}</> : <p className="studio-empty">{entries.length ? "No events match this level." : "No execution events recorded yet."}</p>}
  </div>;
}

export function executionDuration(start: unknown, end?: unknown): string {
  const started = Date.parse(String(start || ""));
  const completed = end ? Date.parse(String(end)) : Date.now();
  if (!Number.isFinite(started) || !Number.isFinite(completed)) return "—";
  const seconds = Math.max(0, completed - started) / 1000;
  return seconds < 1 ? `${Math.round(seconds * 1000)} ms` : seconds < 60 ? `${seconds.toFixed(1)} s` : `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
}
