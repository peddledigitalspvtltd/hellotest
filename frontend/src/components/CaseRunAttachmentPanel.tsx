import { useEffect, useRef, useState, type DragEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { downloadExecutionAttachment, executionAttachmentMimeType, MAX_EXECUTION_ATTACHMENT_BYTES, prepareExecutionAttachment } from "../lib/executionAttachments";
import type { ExecutionStepEvidence } from "../lib/executionLogs";
import type { ExecutionResultAttachment } from "../types";
import { LoadingState } from "./LoadingState";
import "./CaseRunAttachmentPanel.css";

const formatSize = (size: number) => size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : size >= 1024 ? `${(size / 1024).toFixed(1)} KB` : `${size} B`;
const isLegacyDataUrl = (value?: string) => /^data:(image|video)\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i.test(value || "");

export function CaseRunAttachmentPanel({
  resultId, executionId, testCaseId, iterationKey = "default", canView, canUpload, canDelete,
  ensureResult, onEvidenceChange, legacyEvidence = {}
}: {
  resultId?: string | null;
  executionId: string;
  testCaseId: string;
  iterationKey?: string;
  canView: boolean;
  canUpload: boolean;
  canDelete: boolean;
  ensureResult: () => Promise<{ id: string; revision?: number }>;
  onEvidenceChange?: () => void | Promise<void>;
  legacyEvidence?: Record<string, ExecutionStepEvidence>;
}) {
  const queryClient = useQueryClient();
  const scopeKey = `${executionId}/${testCaseId}/${iterationKey}`;
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  const input = useRef<HTMLInputElement>(null);
  const [ensuredResult, setEnsuredResult] = useState<{ scopeKey: string; id: string } | null>(null);
  const activeResultId = resultId || (ensuredResult?.scopeKey === scopeKey ? ensuredResult.id : "");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<ExecutionResultAttachment | null>(null);
  useEffect(() => { setMessage(""); setError(""); setDeleteCandidate(null); setIsDragging(false); }, [scopeKey]);
  const files = useQuery({
    queryKey: ["execution-result-attachments", activeResultId],
    queryFn: () => api.executionResultAttachments.list(activeResultId),
    enabled: Boolean(canView && activeResultId),
    staleTime: 15_000
  });
  const refresh = async (id: string) => {
    await queryClient.invalidateQueries({ queryKey: ["execution-result-attachments", id] });
    await onEvidenceChange?.();
  };
  const upload = useMutation({
    mutationFn: async (selected: File[]) => {
      const selectedScope = scopeKey;
      if (!canUpload) throw new Error("You do not have permission to attach case evidence.");
      if (!selected.length || selected.length > 10) throw new Error("Choose between 1 and 10 files.");
      for (const file of selected) {
        if (!file.size) throw new Error(`${file.name} is empty.`);
        if (file.size > MAX_EXECUTION_ATTACHMENT_BYTES) throw new Error(`${file.name} exceeds the 25 MB evidence limit.`);
        executionAttachmentMimeType(file);
      }
      const meta = await api.attachments.meta();
      if (!meta.enabled) throw new Error("Attachments are unavailable because file storage is disabled.");
      const prepared: File[] = [];
      for (const file of selected) prepared.push(await prepareExecutionAttachment(file, meta.uploadLimit));
      // This only creates a pending result when needed. Starting the case is a
      // separate action owned by the run lifecycle controls.
      const result = activeResultId ? { id: activeResultId } : await ensureResult();
      if (!result.id) throw new Error("The case result could not be prepared for attachments.");
      if (currentScope.current === selectedScope) setEnsuredResult({ scopeKey: selectedScope, id: result.id });
      let added = 0;
      const failures: string[] = [];
      for (let offset = 0; offset < prepared.length; offset += 2) {
        const outcomes = await Promise.allSettled(prepared.slice(offset, offset + 2).map(file => api.executionResultAttachments.upload(result.id, file)));
        outcomes.forEach((outcome, index) => {
          if (outcome.status === "fulfilled") added++;
          else failures.push(`${prepared[offset + index].name}: ${outcome.reason instanceof Error ? outcome.reason.message : "Upload failed"}`);
        });
      }
      await refresh(result.id);
      return { scopeKey: selectedScope, added, failures };
    },
    onMutate: () => { setError(""); setMessage(""); },
    onSuccess: (outcome) => {
      if (currentScope.current !== outcome.scopeKey) return;
      if (outcome.added) setMessage(`${outcome.added} attachment${outcome.added === 1 ? "" : "s"} saved for this case run.`);
      if (outcome.failures.length) setError(outcome.failures.join(" "));
    },
    onError: (failure) => setError(failure instanceof Error ? failure.message : "Unable to upload attachments.")
  });
  const remove = useMutation({
    mutationFn: async (attachment: ExecutionResultAttachment) => {
      if (!canDelete) throw new Error("You do not have permission to delete case evidence.");
      await api.executionResultAttachments.delete(attachment.entity_id, attachment.id);
      await refresh(attachment.entity_id);
    },
    onSuccess: () => { setDeleteCandidate(null); setMessage("Attachment removed."); setError(""); },
    onError: failure => setError(failure instanceof Error ? failure.message : "Unable to remove the attachment.")
  });
  const download = async (evidence: { attachmentId?: string; dataUrl?: string; fileName?: string }) => {
    try {
      if (evidence.attachmentId) await downloadExecutionAttachment(evidence.attachmentId, evidence.fileName || "Case evidence");
      else if (isLegacyDataUrl(evidence.dataUrl)) {
        const link = document.createElement("a");
        link.href = evidence.dataUrl as string;
        link.download = evidence.fileName || "Case evidence";
        link.rel = "noreferrer";
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to download the attachment."); }
  };
  const selectFiles = (selected: FileList | null) => {
    if (canUpload && !upload.isPending && selected?.length) upload.mutate(Array.from(selected));
    if (input.current) input.current.value = "";
  };
  const drop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setIsDragging(false); selectFiles(event.dataTransfer.files); };
  const nativeIds = new Set(files.data?.map(file => file.id));
  const legacy = Object.entries(legacyEvidence).filter(([, evidence]) =>
    evidence.attachmentId ? !nativeIds.has(evidence.attachmentId) : isLegacyDataUrl(evidence.dataUrl));
  if (!canView) return null;

  return <section className="case-run-attachment-panel" aria-label="Case attachments">
    <header><strong>Case attachments</strong><span>Files for this case and data iteration</span></header>
    {canUpload ? <div className={isDragging ? "case-run-attachment-dropzone is-dragging" : "case-run-attachment-dropzone"}
      onDragEnter={event => { event.preventDefault(); setIsDragging(true); }} onDragOver={event => event.preventDefault()}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragging(false); }} onDrop={drop} aria-busy={upload.isPending}>
      <input aria-label="Choose case attachments" hidden multiple ref={input} type="file" onChange={event => selectFiles(event.target.files)} />
      <span>{upload.isPending ? "Saving attachments…" : "Drop evidence files here"}</span>
      <button disabled={upload.isPending} type="button" onClick={() => input.current?.click()}>Browse files</button>
      <small>Images, video, PDF, text or ZIP · up to 25 MB each</small>
    </div> : null}
    {files.isLoading && activeResultId ? <LoadingState label="Loading case attachments" /> : null}
    {files.error ? <p className="inline-error" role="alert">{files.error instanceof Error ? files.error.message : "Unable to load case attachments."}</p> : null}
    <div className="case-run-attachment-list">
      {(files.data || []).map(file => <article key={file.id}>
        <div><strong>{file.filename}</strong><span>{formatSize(file.size)}{file.step_id ? " · Step evidence" : ""}</span>
          {file.author?.displayName || file.created ? <small>{file.author?.displayName}{file.author?.displayName && file.created ? " · " : ""}{file.created ? new Date(file.created).toLocaleString() : ""}</small> : null}
        </div>
        <div className="case-run-attachment-actions">
          <button type="button" onClick={() => void download({ attachmentId: file.id, fileName: file.filename })} aria-label={`Download ${file.filename}`}>Download</button>
          {canDelete ? <button disabled={remove.isPending} type="button" onClick={() => setDeleteCandidate(file)} aria-label={`Delete ${file.filename}`}>Delete</button> : null}
        </div>
      </article>)}
    </div>
    {!files.isLoading && !files.error && !files.data?.length ? <p className="empty-state compact">No attachments saved for this case run yet.</p> : null}
    {legacy.length ? <div className="case-run-attachment-legacy"><strong>Earlier step evidence</strong><p>Evidence already saved with this case remains available.</p>
      {legacy.map(([stepId, evidence]) => <button key={stepId} type="button" onClick={() => void download(evidence)}>Download {evidence.fileName || "earlier step evidence"}</button>)}
    </div> : null}
    {deleteCandidate ? <div className="case-run-attachment-confirm" role="alert"><span>Delete {deleteCandidate.filename}?</span><div>
      <button type="button" disabled={remove.isPending} onClick={() => setDeleteCandidate(null)}>Cancel</button>
      <button type="button" disabled={remove.isPending} onClick={() => remove.mutate(deleteCandidate)}>Delete attachment</button>
    </div></div> : null}
    {message ? <p role="status">{message}</p> : null}
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
  </section>;
}
