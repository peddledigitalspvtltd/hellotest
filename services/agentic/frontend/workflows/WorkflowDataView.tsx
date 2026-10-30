import { useEffect, useMemo, useRef, useState } from "react";
import { IconCopy, IconCheck } from "@tabler/icons-react";
import { RichTextContent } from "@hellotest/platform/frontend/src/platform/components/RichTextEditor";
import { AgentStructuredValue } from '../components/AgentStructuredValue';
import { agentOutputText } from '../lib/agentOutputValue';

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
const display = agentOutputText;
const JSON_PAGE_SIZE = 100_000;

/** Native read-only text editing keeps selection, keyboard copying and find
 * accessible without loading another editor bundle for execution records. */
function WorkflowJsonEditor({ text, label }: { text: string; label: string }) {
  const [wrapped, setWrapped] = useState(false), [page, setPage] = useState(0);
  const gutter = useRef<HTMLDivElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setPage(0), [text]);
  useEffect(() => { if (gutter.current) gutter.current.scrollTop = editor.current?.scrollTop || 0; }, [page, wrapped]);
  const pages = Math.max(1, Math.ceil(text.length / JSON_PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1), start = currentPage * JSON_PAGE_SIZE;
  const content = text.slice(start, start + JSON_PAGE_SIZE);
  const firstLine = useMemo(() => text.slice(0, start).split("\n").length, [text, start]);
  const lines = content.split("\n").length;
  const totalLines = useMemo(() => text.split("\n").length, [text]);
  return <div className={`studio-json-editor${wrapped ? " is-wrapped" : ""}`}>
    <div className="studio-json-toolbar"><span>Read-only JSON · {totalLines.toLocaleString()} {totalLines === 1 ? "line" : "lines"}</span><button type="button" aria-pressed={wrapped} onClick={() => setWrapped(value => !value)} title="Wrap long lines. Turn wrapping off to show line numbers.">Wrap lines</button></div>
    {pages > 1 && <div className="studio-json-pages"><p className="studio-caption">Showing characters {(start + 1).toLocaleString()}–{Math.min(text.length, start + JSON_PAGE_SIZE).toLocaleString()} of {text.length.toLocaleString()}. Copy JSON includes the complete recorded value.</p><div role="group" aria-label={`${label} pages`}><button type="button" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Previous JSON page</button><span>{currentPage + 1} / {pages}</span><button type="button" disabled={currentPage === pages - 1} onClick={() => setPage(currentPage + 1)}>Next JSON page</button></div></div>}
    <div className="studio-json-body">
      {!wrapped && <div className="studio-json-lines" aria-hidden="true" ref={gutter}>{Array.from({ length: lines }, (_, index) => firstLine + index).join("\n")}</div>}
      <textarea ref={editor} key={currentPage} aria-label={label} readOnly spellCheck={false} autoCapitalize="off" autoCorrect="off" wrap={wrapped ? "soft" : "off"} value={content} onScroll={event => { if (gutter.current) gutter.current.scrollTop = event.currentTarget.scrollTop; }} />
    </div>
  </div>;
}

/** Text uses the application's sanitized renderer; all JSON values are escaped by React. */
export function WorkflowDataView({ value, empty = "No data yet. Execute this step to inspect its result.", pathPrefix, defaultMode = "readable", jsonLabel = "Data JSON", copyJsonLabel = "Copy data as JSON" }: { value: unknown; empty?: string; pathPrefix?: string; defaultMode?: "readable" | "json"; jsonLabel?: string; copyJsonLabel?: string }) {
  const [mode, setMode] = useState<"readable" | "json" | "fields" | "table">(defaultMode);
  const [copied, setCopied] = useState("");
  const [copyError, setCopyError] = useState("");
  const formatted = useMemo(() => value === undefined ? "" : JSON.stringify(value, null, 2), [value]);
  useEffect(() => { setCopied(""); setCopyError(""); }, [formatted]);
  if (value === undefined) return <p className="studio-empty">{empty}</p>;
  const object = value && typeof value === "object" ? value as Record<string, unknown> : null;
  const response = object?.response || object?.summary;
  const reviews = Array.isArray(object?.reviews) ? object.reviews as Record<string, unknown>[] : [];
  const items = Array.isArray(value) ? value : Array.isArray(object?.data) ? object.data : null;
  const table = items && items.length > 0 && items.every(item => item && typeof item === "object" && !Array.isArray(item)) ? items as Record<string, unknown>[] : null;
  const columns = table ? [...new Set(table.slice(0, 100).flatMap(item => Object.keys(item)))].slice(0, 12) : [];
  const copy = async (text: string, label: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(label); setCopyError(""); }
    catch { setCopyError("Could not access the clipboard. Select and copy the value manually."); }
  };
  return <div className="studio-data">
    <div className="studio-data-toolbar"><span>{items ? `${items.length} items` : value === null ? "null" : object ? `${Object.keys(object).length} fields` : typeof value}</span><button type="button" className="studio-icon-button" aria-label={copyJsonLabel} title={copied === "data" ? "JSON copied" : copyJsonLabel} onClick={() => void copy(formatted, "data")}>{copied === "data" ? <IconCheck size={14} /> : <IconCopy size={14} />}</button></div>
    <div className="studio-data-tabs" role="group" aria-label="Data format">
      <button type="button" aria-pressed={mode === "readable"} onClick={() => setMode("readable")}>Readable</button>
      <button type="button" aria-pressed={mode === "json"} onClick={() => setMode("json")}>JSON</button>
      {table && <button type="button" aria-pressed={mode === "table"} onClick={() => setMode("table")}>Table</button>}
      {pathPrefix && <button type="button" aria-pressed={mode === "fields"} onClick={() => setMode("fields")}>Fields</button>}
    </div>
    {copyError && <p role="status" className="studio-caption">{copyError}</p>}
    {mode === "fields" && pathPrefix ? <div className="studio-data-fields"><p className="studio-caption">Copy a path into field mappings or tool arguments. Showing up to 100 fields.</p>{fields(value, pathPrefix).map(row => <div className="studio-data-field" key={row.path}><code>{row.path}</code><span title={display(row.value)}>{String(display(row.value)).slice(0, 200)}</span>{row.reference && <button type="button" className="studio-icon-button" aria-label={`Copy ${row.path}`} onClick={() => void copy(row.path, row.path)}>{copied === row.path ? <IconCheck size={14} /> : <IconCopy size={14} />}</button>}</div>)}</div>
      : mode === "table" && table ? <><div className="studio-data-table"><table><thead><tr>{columns.map(key => <th key={key}>{key}</th>)}</tr></thead><tbody>{table.slice(0, 100).map((item, index) => <tr key={index}>{columns.map(key => <td key={key}>{String(display(item[key]) ?? "—").slice(0, 500)}</td>)}</tr>)}</tbody></table></div><p className="studio-caption">Showing up to 100 rows and 12 columns. JSON contains the full result.</p></>
      : mode === "readable" ? <div className="studio-data-prose">{typeof value === "string" || typeof response === "string" ? <><RichTextContent value={typeof response === 'string' ? response : value as string} />{object && Object.entries(object).filter(([key]) => !['response', 'summary', 'citation_ids'].includes(key)).length > 0 && <AgentStructuredValue value={Object.fromEntries(Object.entries(object).filter(([key]) => !['response', 'summary', 'citation_ids'].includes(key)))} />}</> : reviews.length ? reviews.map((review, index) => <article key={index}><strong>{typeof review.node_id === 'string' ? review.node_id : `Review ${index + 1}`}{typeof review.item_index === 'number' ? ` · item ${review.item_index + 1}` : ""}</strong><AgentStructuredValue value={review.response ?? review} /></article>) : <AgentStructuredValue value={value} />}{Array.isArray(object?.citation_ids) && object.citation_ids.length > 0 && <p className="studio-caption">Sources: {object.citation_ids.filter(item => typeof item === 'string').join(", ")}. Open the saved review to inspect evidence.</p>}</div>
      : <WorkflowJsonEditor text={formatted} label={jsonLabel} />}
  </div>;
}
