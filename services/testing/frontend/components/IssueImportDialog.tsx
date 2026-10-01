import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "@hellotest/platform/frontend/src/lib/api";
import { useDialogFocus } from "@hellotest/platform/frontend/src/shared/hooks/useDialogFocus";
import { DialogCloseButton } from "@hellotest/platform/frontend/src/shared/components/DialogCloseButton";
import { downloadCsvRecords } from "@hellotest/platform/frontend/src/shared/lib/csvExport";
import { ExportIcon, ImportIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import { buildIssueImportTemplate, MAX_BUG_IMPORT_BYTES, MAX_BUG_IMPORT_ROWS, parseIssueCsv, type IssueImportPreview, type IssueImportRow } from "../lib/issueImport";
import "./IssueImportDialog.css";

export function IssueImportDialog({ projectId, people, canViewBatchProcess, onQueued, onClose }: {
  projectId: string; people: Map<string, string>; canViewBatchProcess: boolean; onQueued: (id: string) => void; onClose: () => void;
}) {
  const client = useQueryClient();
  const [rows, setRows] = useState<IssueImportRow[]>([]);
  const [preview, setPreview] = useState<IssueImportPreview | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [transactionId, setTransactionId] = useState("");
  const importId = useRef(crypto.randomUUID());
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const dialogRef = useDialogFocus<HTMLDivElement>({ onClose, closeDisabled: busy });
  const progress = useQuery({
    queryKey: ["bug-import", projectId, transactionId],
    queryFn: () => api.issues.importStatus(transactionId, projectId), enabled: Boolean(transactionId),
    refetchInterval: query => ["completed", "failed"].includes(query.state.data?.status || "") ? false : 2000,
    retry: 1
  });
  const validate = async (input: IssueImportRow[]) => {
    setBusy(true); setError(""); setPreview(null);
    try {
      const result = await api.issues.previewImport({ project_id: projectId, rows: input });
      if (alive.current) setPreview(result);
    } catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : "Unable to validate the CSV. Try again."); }
    finally { if (alive.current) setBusy(false); }
  };
  const readFile = async (file?: File) => {
    if (!file || busy) return;
    setRows([]); setPreview(null); setError(""); setFileName(file.name); setBusy(true);
    importId.current = crypto.randomUUID();
    try {
      if (!/\.csv$/i.test(file.name)) throw new Error("Choose a CSV file using the Bug template.");
      if (file.size > MAX_BUG_IMPORT_BYTES) throw new Error("The CSV exceeds 4 MB. Split it into smaller imports.");
      const parsed = parseIssueCsv(await file.text());
      if (!alive.current) return;
      setRows(parsed);
      await validate(parsed);
    } catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : "Unable to read the CSV."); }
    finally { if (alive.current) setBusy(false); }
  };
  const submit = async () => {
    if (!preview || preview.errors.length || busy || transactionId) return;
    setBusy(true); setError("");
    try {
      // Keep the same ID for a retry if the queue receipt is lost in transit.
      const response = await api.issues.bulkImport({ project_id: projectId, rows, import_id: importId.current });
      if (alive.current) {
        setTransactionId(response.transaction_id);
        onQueued(response.transaction_id);
      }
      void client.invalidateQueries({ queryKey: ["workspace-transactions"] });
    } catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : "Unable to queue the import. Try again."); }
    finally { if (alive.current) setBusy(false); }
  };
  const shownRows = preview && !preview.errors.length ? preview.rows : rows;
  return <div className="modal-backdrop" role="presentation" onClick={() => { if (!busy) onClose(); }}>
    <div className="modal-card import-modal-card issue-import-dialog" role="dialog" aria-modal="true" aria-labelledby="bug-import-title" ref={dialogRef} tabIndex={-1} onClick={event => event.stopPropagation()}>
      <header className="import-modal-header">
        <div className="import-modal-title"><h2 className="dialog-title" id="bug-import-title">Bulk import Bugs</h2><p>Create bugs in the current project from a reviewed CSV.</p></div>
        <div className="issue-import-header-actions"><button type="button" className="ghost-button compact" onClick={() => downloadCsvRecords("hellotest-bug-import-template.csv", buildIssueImportTemplate())}><ExportIcon /><span>Bug template</span></button><DialogCloseButton label="Close Bug import" disabled={busy} onClick={onClose} /></div>
      </header>
      <div className="import-modal-body">
        {!transactionId ? <>
          <label className="form-field"><span>CSV file</span><input type="file" accept=".csv,text/csv" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void readFile(file); }} /></label>
          <p className="muted">Title and Description are required. Use project member names, emails or IDs for Assignee and Reported by. A blank reporter defaults to you; a blank assignee stays unassigned. Up to {MAX_BUG_IMPORT_ROWS} bugs / 4 MB.</p>
          <details className="issue-import-guidance"><summary>Supported values and CSV tips</summary><p>Status: open, triaged, in_progress, resolved, reopened, verified, closed, deferred, duplicate, wont_fix. Severity: critical, high, medium, low. Priority: Highest, High, Medium, Low, Lowest.</p><p>Labels accept a JSON list or comma-separated text. Quote multiline cells and values containing commas. Sprint, Release and Fix version use their display names. Root causes and Defect type use the configured project choices. This import creates new bugs; it does not update existing ones.</p></details>
          <div className="detail-summary" role="status"><strong>{fileName || "No CSV loaded yet"}</strong><span>{busy ? "Validating…" : preview ? `${preview.total} ${preview.total === 1 ? "row" : "rows"} · ${preview.errors.length ? `${preview.errors.length} issues to correct` : "Ready to import"}` : `${rows.length} rows parsed`}</span></div>
          {preview?.errors.length ? <div className="issue-import-errors" role="alert"><strong>Correct the CSV and reload it.</strong><ul>{preview.errors.slice(0, 20).map(item => <li key={item.row}>Row {item.row}: {item.message}</li>)}</ul>{preview.errors.length > 20 ? <p>{preview.errors.length - 20} more validation issues.</p> : null}</div> : null}
          {shownRows.length ? <div className="table-wrap import-preview-table"><table className="data-table"><thead><tr><th>Row</th><th>Title</th><th>Status</th><th>Priority</th><th>Assignee</th><th>Reported by</th></tr></thead><tbody>{shownRows.slice(0, 25).map((row, index) => <tr key={index}><td>{index + 2}</td><td>{row.title}</td><td>{String(row.status || "open")}</td><td>{String(row.priority || "Not set")}</td><td>{people.get(String(row.assignee_id)) || String(row.assignee_id || "Unassigned")}</td><td>{people.get(String(row.user_id)) || String(row.user_id || "You")}</td></tr>)}</tbody></table>{shownRows.length > 25 ? <p className="muted">Showing 25 of {shownRows.length} bugs. All validated rows will be imported.</p> : null}</div> : null}
        </> : <section className="issue-import-progress" aria-live="polite"><strong>{progress.data?.status === "completed" ? "Import completed" : progress.data?.status === "failed" ? "Import needs attention" : "Bug import queued"}</strong><p>{progress.data?.description || "Your import will continue in the background. You can close this dialog."}</p><progress max={100} value={Number(progress.data?.metadata?.progress_percent || 0)} aria-label="Bug import progress" /><p>{Number(progress.data?.metadata?.imported || 0)} of {rows.length} bugs imported.</p>{canViewBatchProcess ? <Link className="link-button" to={`/testops?process=${encodeURIComponent(transactionId)}`}>View import progress and results</Link> : null}{progress.isError ? <div role="alert">Progress could not be loaded. <button className="ghost-button compact" type="button" onClick={() => void progress.refetch()}>Retry progress</button></div> : null}</section>}
        {error ? <div className="issue-import-errors" role="alert">{error}</div> : null}
      </div>
      <footer className="action-row import-modal-actions">
        <button className="ghost-button" type="button" disabled={busy} onClick={onClose}>{transactionId ? "Done" : "Cancel"}</button>
        {!transactionId && rows.length && !preview && !busy ? <button className="ghost-button" type="button" onClick={() => void validate(rows)}>Retry validation</button> : null}
        {!transactionId ? <button className="primary-button" type="button" disabled={busy || !preview?.rows.length || Boolean(preview.errors.length)} onClick={() => void submit()}><ImportIcon /><span>{busy ? "Processing…" : `Import ${preview?.rows.length || ""} ${preview?.rows.length === 1 ? "Bug" : "Bugs"}`}</span></button> : null}
      </footer>
    </div>
  </div>;
}
