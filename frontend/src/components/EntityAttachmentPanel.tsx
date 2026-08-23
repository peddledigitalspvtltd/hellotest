import { useRef, useState, type DragEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { HelloTestAttachment, HelloTestEntityType } from "../types";
import { ToastMessage } from "./ToastMessage";

type EntityScope = {
  project_id: string;
  entity_type: HelloTestEntityType;
  entity_id: string;
};

function formatBytes(value: number) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function attachmentKind(attachment: HelloTestAttachment) {
  if (attachment.mimeType.startsWith("image/")) return "Image";
  if (attachment.mimeType.startsWith("video/")) return "Video";
  if (attachment.mimeType === "application/pdf") return "PDF";
  if (attachment.mimeType.startsWith("text/")) return "Text";
  return "File";
}

async function downloadAttachment(attachment: HelloTestAttachment) {
  const blob = await api.attachments.download(attachment.id);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = attachment.filename;
  anchor.rel = "noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function EntityAttachmentPanel({
  projectId,
  entityType,
  entityId,
  canView,
  canUpload,
  canDelete,
  title = "Attachments"
}: {
  projectId: string;
  entityType: HelloTestEntityType;
  entityId: string;
  canView: boolean;
  canUpload: boolean;
  canDelete: boolean;
  title?: string;
}) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<HelloTestAttachment | null>(null);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const scope: EntityScope = { project_id: projectId, entity_type: entityType, entity_id: entityId };
  const queryKey = ["entity-attachments", projectId, entityType, entityId];
  const attachmentMeta = useQuery({
    queryKey: ["attachment-meta"],
    queryFn: api.attachments.meta,
    enabled: Boolean(canUpload),
    staleTime: 5 * 60_000
  });
  const attachments = useQuery({
    queryKey,
    queryFn: () => api.attachments.list(scope),
    enabled: Boolean(projectId && entityId && canView),
    staleTime: 30_000
  });
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      if (attachmentMeta.data?.enabled === false) throw new Error("Attachments are disabled until object storage is configured.");
      if (!files.length || files.some((file) => file.size <= 0)) throw new Error("Choose one or more non-empty files.");
      if (files.length > 10) throw new Error("Upload at most 10 files at a time.");
      const limit = Number(attachmentMeta.data?.uploadLimit || 0);
      const oversized = limit > 0 ? files.filter((file) => file.size > limit) : [];
      if (oversized.length) throw new Error(`${oversized.map((file) => file.name).join(", ")} exceed the ${formatBytes(limit)} upload limit.`);
      const uploaded: HelloTestAttachment[] = [];
      const failures: string[] = [];
      for (let offset = 0; offset < files.length; offset += 2) {
        const batch = files.slice(offset, offset + 2);
        const results = await Promise.allSettled(batch.map((file) => api.attachments.upload(scope, file)));
        results.forEach((result, index) => {
          if (result.status === "fulfilled") uploaded.push(result.value);
          else failures.push(`${batch[index].name}: ${result.reason instanceof Error ? result.reason.message : "upload failed"}`);
        });
      }
      if (failures.length) throw new Error(`${uploaded.length} uploaded; ${failures.length} failed. ${failures.join(" ")}`);
      return uploaded;
    },
    onSuccess: (items) => {
      setMessageTone("success");
      setMessage(`${items.length} attachment${items.length === 1 ? "" : "s"} uploaded.`);
    },
    onError: (error) => {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Unable to upload attachments.");
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey })
  });
  const remove = useMutation({
    mutationFn: api.attachments.delete,
    onSuccess: () => {
      setDeleteCandidate(null);
      setMessageTone("success");
      setMessage("Attachment deleted.");
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Unable to delete the attachment.");
    }
  });
  const download = useMutation({
    mutationFn: downloadAttachment,
    onError: (error) => {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Unable to download the attachment.");
    }
  });

  if (!canView || !projectId || !entityId) return null;

  const chooseFiles = (files: FileList | null) => {
    if (!canUpload || !files?.length || upload.isPending) return;
    upload.mutate(Array.from(files));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    chooseFiles(event.dataTransfer.files);
  };

  return (
    <section className="entity-evidence-panel" aria-label={`${title} for ${entityId}`}>
      <div className="entity-evidence-head">
        <div><strong>{title}</strong><span>{attachments.data?.length || 0} files</span></div>
        {attachmentMeta.data?.provider ? <small>{attachmentMeta.data.provider} object storage</small> : null}
      </div>

      {canUpload && attachmentMeta.data?.enabled !== false ? (
        <div
          className={isDragging ? "entity-attachment-dropzone is-dragging" : "entity-attachment-dropzone"}
          onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragging(false); }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          <input hidden multiple onChange={(event) => chooseFiles(event.target.files)} ref={fileInputRef} type="file" />
          <span aria-hidden="true" className="entity-attachment-icon">↥</span>
          <span>{upload.isPending ? "Uploading files…" : "Drop evidence here or"}</span>
          <button className="ghost-button compact" disabled={upload.isPending} onClick={() => fileInputRef.current?.click()} type="button">Browse</button>
        </div>
      ) : null}
      {canUpload && attachmentMeta.data?.enabled === false ? <div className="inline-error">Object storage is not configured. Set the MinIO environment values to enable attachments.</div> : null}
      {attachmentMeta.error ? <div className="inline-error">{attachmentMeta.error instanceof Error ? attachmentMeta.error.message : "Unable to load attachment settings."}</div> : null}
      {attachments.isLoading ? <div className="entity-evidence-loading">Loading attachments…</div> : null}
      {attachments.error ? <div className="inline-error">{attachments.error instanceof Error ? attachments.error.message : "Unable to load attachments."}</div> : null}

      <div className="entity-attachment-grid">
        {(attachments.data || []).map((attachment) => (
          <article className="entity-attachment-card" key={attachment.id}>
            <button className="entity-attachment-preview" disabled={download.isPending} onClick={() => download.mutate(attachment)} type="button">
              <span aria-hidden="true">{attachmentKind(attachment) === "Image" ? "▧" : "◫"}</span>
              <small>{attachmentKind(attachment)}</small>
            </button>
            <div className="entity-attachment-copy">
              <strong title={attachment.filename}>{attachment.filename}</strong>
              <span>{formatBytes(attachment.size)} · {attachment.author?.displayName || "HelloTest user"}</span>
            </div>
            <div className="entity-attachment-actions">
              <button className="ghost-button compact" disabled={download.isPending} onClick={() => download.mutate(attachment)} type="button">Download</button>
              {canDelete ? <button className="ghost-button compact danger" disabled={remove.isPending} onClick={() => setDeleteCandidate(attachment)} type="button">Delete</button> : null}
            </div>
          </article>
        ))}
      </div>
      {!attachments.isLoading && !attachments.data?.length ? <div className="empty-state compact">No attachments yet.</div> : null}

      {deleteCandidate ? (
        <div className="entity-attachment-confirm" role="alert">
          <span>Delete {deleteCandidate.filename}?</span>
          <div>
            <button className="ghost-button compact" onClick={() => setDeleteCandidate(null)} type="button">Cancel</button>
            <button className="ghost-button compact danger" disabled={remove.isPending} onClick={() => remove.mutate(deleteCandidate.id)} type="button">Delete</button>
          </div>
        </div>
      ) : null}
      {message ? <ToastMessage message={message} onDismiss={() => setMessage("")} tone={messageTone} /> : null}
    </section>
  );
}
