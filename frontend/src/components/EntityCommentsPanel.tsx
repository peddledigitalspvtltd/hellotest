import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { QairaEntityType } from "../types";
import { ToastMessage } from "./ToastMessage";

const commentTimestamp = (value: string | null) => {
  if (!value) return "Time unavailable";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Time unavailable" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(parsed);
};

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "QU";

export function EntityCommentsPanel({ projectId, entityType, entityId, canView, canComment, title = "Comments" }: {
  projectId: string;
  entityType: QairaEntityType;
  entityId: string;
  canView: boolean;
  canComment: boolean;
  title?: string;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const scope = { project_id: projectId, entity_type: entityType, entity_id: entityId } as const;
  const queryKey = ["entity-comments", projectId, entityType, entityId];
  const comments = useQuery({ queryKey, queryFn: () => api.comments.list(scope), enabled: Boolean(projectId && entityId && canView), staleTime: 15_000 });
  const createComment = useMutation({
    mutationFn: () => api.comments.create(scope, draft),
    onSuccess: async () => {
      setDraft("");
      setMessageTone("success");
      setMessage("Comment posted.");
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Unable to post the comment.");
    }
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (draft.trim() && !createComment.isPending) createComment.mutate();
  };

  if (!canView || !projectId || !entityId) return null;

  return (
    <section className="entity-evidence-panel" aria-label={`${title} for ${entityId}`}>
      <div className="entity-evidence-head"><div><strong>{title}</strong><span>{comments.data?.length || 0} notes</span></div></div>
      {canComment ? (
        <form className="entity-comment-composer" onSubmit={submit}>
          <textarea aria-label="Add comment" maxLength={5000} onChange={(event) => setDraft(event.target.value)} placeholder="Add context, a decision, or a traceability note…" rows={3} value={draft} />
          <div><span>{draft.length.toLocaleString()}/5,000</span><button className="primary-button compact" disabled={!draft.trim() || createComment.isPending} type="submit">{createComment.isPending ? "Posting…" : "Comment"}</button></div>
        </form>
      ) : null}
      {comments.isLoading ? <div className="entity-evidence-loading">Loading comments…</div> : null}
      {comments.error ? <div className="inline-error">{comments.error instanceof Error ? comments.error.message : "Unable to load comments."}</div> : null}
      <div className="entity-comment-list">
        {(comments.data || []).map((comment) => {
          const author = comment.author?.displayName || "HelloTest user";
          const avatar = comment.author?.avatarUrls?.["32x32"];
          return (
            <article className="entity-comment-card" key={comment.id}>
              {avatar ? <img alt="" src={avatar} /> : <span className="entity-comment-avatar" aria-hidden="true">{initials(author)}</span>}
              <div><div className="entity-comment-meta"><strong>{author}</strong><span>{commentTimestamp(comment.created)}</span></div><p>{comment.body}</p></div>
            </article>
          );
        })}
        {!comments.isLoading && !comments.data?.length ? <div className="empty-state compact">No comments yet.</div> : null}
      </div>
      {message ? <ToastMessage message={message} onDismiss={() => setMessage("")} tone={messageTone} /> : null}
    </section>
  );
}
