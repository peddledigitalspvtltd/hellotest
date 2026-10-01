import { useState } from "react";
import { IconCopy, IconCheck } from "@tabler/icons-react";
import { RichTextContent } from "@hellotest/platform/frontend/src/platform/components/RichTextEditor";

function fields(value: unknown, root: string) {
  const rows: Array<{ path: string; value: unknown; reference: boolean }> = [];
  const visit = (item: unknown, path: string, depth: number, reference: boolean) => {
    if (rows.length >= 100) return;
    const entries = item && typeof item === "object" ? Object.entries(item) : [];
    if (!entries.length || depth >= 6) { rows.push({ path, value: item, reference }); return; }
    for (const [key, child] of entries) {
      if (rows.length >= 100) break;
      visit(child, `${path}.${key}`, depth + 1, reference && /^[\w-]+$/.test(key) && !["constructor", "prototype", "__proto__"].includes(key));
    }
  };
  visit(value, root, 0, true);
  return rows;
}
const display = (value: unknown) => typeof value === "string" ? value : JSON.stringify(value);

/** Text uses the application's sanitized renderer; all JSON values are escaped by React. */
export function WorkflowDataView({ value, empty = "No data yet. Execute this step to inspect its result.", pathPrefix }: { value: unknown; empty?: string; pathPrefix?: string }) {
  const [mode, setMode] = useState<"readable" | "json" | "fields" | "table">("readable");
  const [copied, setCopied] = useState("");
  const [copyError, setCopyError] = useState("");
  if (value === undefined) return <p className="studio-empty">{empty}</p>;
  const object = value && typeof value === "object" ? value as Record<string, unknown> : null;
  const response = object?.response || object?.summary;
  const reviews = Array.isArray(object?.reviews) ? object.reviews as Record<string, unknown>[] : [];
  const readable = typeof value === "string" || typeof response === "string" || reviews.length > 0;
  const items = Array.isArray(value) ? value : Array.isArray(object?.data) ? object.data : null;
  const table = items && items.length > 0 && items.every(item => item && typeof item === "object" && !Array.isArray(item)) ? items as Record<string, unknown>[] : null;
  const columns = table ? [...new Set(table.slice(0, 100).flatMap(item => Object.keys(item)))].slice(0, 12) : [];
  const formatted = JSON.stringify(value, null, 2);
  const copy = async (text: string, label: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(label); setCopyError(""); }
    catch { setCopyError("Could not access the clipboard. Select and copy the value manually."); }
  };
  return <div className="studio-data">
    <div className="studio-data-toolbar"><span>{items ? `${items.length} items` : value === null ? "null" : object ? `${Object.keys(object).length} fields` : typeof value}</span><button type="button" className="studio-icon-button" aria-label="Copy data as JSON" onClick={() => void copy(formatted, "data")}>{copied === "data" ? <IconCheck size={14} /> : <IconCopy size={14} />}</button></div>
    <div className="studio-data-tabs" role="group" aria-label="Data format">
      {readable && <button type="button" aria-pressed={mode === "readable"} onClick={() => setMode("readable")}>Readable</button>}
      <button type="button" aria-pressed={mode === "json" || (mode === "readable" && !readable)} onClick={() => setMode("json")}>JSON</button>
      {table && <button type="button" aria-pressed={mode === "table"} onClick={() => setMode("table")}>Table</button>}
      {pathPrefix && <button type="button" aria-pressed={mode === "fields"} onClick={() => setMode("fields")}>Fields</button>}
    </div>
    {copyError && <p role="status" className="studio-caption">{copyError}</p>}
    {mode === "fields" && pathPrefix ? <div className="studio-data-fields"><p className="studio-caption">Copy a path into field mappings or tool arguments. Showing up to 100 fields.</p>{fields(value, pathPrefix).map(row => <div className="studio-data-field" key={row.path}><code>{row.path}</code><span title={display(row.value)}>{String(display(row.value)).slice(0, 200)}</span>{row.reference && <button type="button" className="studio-icon-button" aria-label={`Copy ${row.path}`} onClick={() => void copy(row.path, row.path)}>{copied === row.path ? <IconCheck size={14} /> : <IconCopy size={14} />}</button>}</div>)}</div>
      : mode === "table" && table ? <><div className="studio-data-table"><table><thead><tr>{columns.map(key => <th key={key}>{key}</th>)}</tr></thead><tbody>{table.slice(0, 100).map((item, index) => <tr key={index}>{columns.map(key => <td key={key}>{String(display(item[key]) ?? "—").slice(0, 500)}</td>)}</tr>)}</tbody></table></div><p className="studio-caption">Showing up to 100 rows and 12 columns. JSON contains the full result.</p></>
      : readable && mode === "readable" ? <div className="studio-data-prose">{typeof value === "string" || typeof response === "string" ? <RichTextContent value={String(response || value)} /> : reviews.map((review, index) => <article key={`${review.node_id}-${index}`}><strong>{String(review.node_id || `Review ${index + 1}`)}{review.item_index != null ? ` · item ${Number(review.item_index) + 1}` : ""}</strong><RichTextContent value={String(review.response || "")} /></article>)}{Array.isArray(object?.citation_ids) && object.citation_ids.length > 0 && <p className="studio-caption">Sources: {object.citation_ids.map(String).join(", ")}. Open the saved review to inspect evidence.</p>}</div>
      : <pre>{formatted}</pre>}
  </div>;
}
