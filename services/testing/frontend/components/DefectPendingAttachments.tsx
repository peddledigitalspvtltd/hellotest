import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { JiraAttachmentIcon } from "@hellotest/integration/frontend/components/JiraAttachmentPanel";
import type { DefectSourceAttachment } from "../workspaces/issues/useDefectSourceAttachments";

export function DefectPendingAttachments({ creating, busy, files, sources, loadingSources, sourceLoadFailed, onRetrySources, onFilesChange, onRemoveSource, onRetryUploads }: {
  creating: boolean;
  busy: boolean;
  files: File[];
  sources: DefectSourceAttachment[];
  loadingSources: boolean;
  sourceLoadFailed: boolean;
  onRetrySources: () => void;
  onFilesChange: Dispatch<SetStateAction<File[]>>;
  onRemoveSource: (id: string) => void;
  onRetryUploads: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const total = files.length + sources.length;
  const addFiles = (added: FileList | null) => {
    if (added?.length && !busy) onFilesChange(current => [...current, ...Array.from(added)].slice(0, 10));
  };

  return (
    <section id="defect-attachments" className="jira-attachment-panel" aria-label={creating ? "Attachments for new Defect" : "Retry failed Defect attachments"}>
      <div className="jira-attachment-head">
        <div><strong>Attachments</strong><span>{creating ? `${total} ready to attach after creation` : `${total} files retained for retry`}</span></div>
      </div>
      {loadingSources ? <p role="status">Loading execution attachments…</p> : null}
      {sourceLoadFailed ? <div className="inline-error" role="alert">
        Some execution attachments could not be loaded. <button className="ghost-button compact" type="button" disabled={busy} onClick={onRetrySources}>Retry loading attachments</button>
      </div> : null}
      <div
        className={dragging ? "jira-attachment-dropzone is-dragging" : "jira-attachment-dropzone"}
        onDragEnter={event => { event.preventDefault(); if (!busy) setDragging(true); }}
        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
        onDragOver={event => event.preventDefault()}
        onDrop={event => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files); }}
      >
        <input hidden multiple disabled={busy} onChange={event => { addFiles(event.currentTarget.files); event.currentTarget.value = ""; }} ref={fileInput} type="file" />
        <JiraAttachmentIcon />
        <span>Drop files to attach or</span>
        <button className="jira-attachment-browse-button" disabled={busy} onClick={() => fileInput.current?.click()} type="button">Browse</button>
      </div>
      <div className="jira-attachment-grid">
        {files.map((file, index) => (
          <article className="jira-attachment-card" key={`${file.name}-${file.size}-${index}`}>
            <div className="jira-attachment-preview"><JiraAttachmentIcon /></div>
            <div className="jira-attachment-copy"><strong title={file.name}>{file.name}</strong><span>{Math.max(1, Math.round(file.size / 1024)).toLocaleString()} KB · pending</span></div>
            <div className="jira-attachment-actions"><button className="ghost-button compact danger" disabled={busy} onClick={() => onFilesChange(current => current.filter((_, fileIndex) => fileIndex !== index))} type="button">Remove</button></div>
          </article>
        ))}
        {sources.map(source => (
          <article className="jira-attachment-card" key={source.id}>
            <div className="jira-attachment-preview"><JiraAttachmentIcon /></div>
            <div className="jira-attachment-copy">
              <strong title={source.name}>{source.name}</strong>
              <span>{source.kind === "execution" ? ["Execution evidence", source.detail].filter(Boolean).join(" · ") : "AI source evidence · retained privately"}</span>
            </div>
            <div className="jira-attachment-actions"><button className="ghost-button compact danger" type="button" disabled={busy} onClick={() => onRemoveSource(source.id)}>Remove</button></div>
          </article>
        ))}
      </div>
      {!total && !loadingSources ? <div className="empty-state compact">Drop a screenshot or log to add evidence.</div> : null}
      {!creating && total > 0 ? <button className="primary-button" disabled={busy} onClick={onRetryUploads} type="button">{busy ? "Uploading…" : "Retry file uploads"}</button> : null}
    </section>
  );
}
