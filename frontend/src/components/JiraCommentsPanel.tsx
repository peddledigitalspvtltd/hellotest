import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { LoadingState } from "./LoadingState";
import { ToastMessage } from "./ToastMessage";
import type { HelloTestEntityType } from "../types";

const commentTimestamp = (value: string | null) => {
  if (!value) return "Time unavailable";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "Time unavailable"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(parsed);
};

const initials = (name: string) => name
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((part) => part[0]?.toUpperCase())
  .join("") || "JU";

export function JiraCommentsPanel({ issueKey, projectId, entityType, entityId, canComment, onEvidenceChange }: { issueKey: string; projectId: string; entityType: HelloTestEntityType; entityId: string; canComment: boolean; onEvidenceChange?: () => void }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const scope = { project_id: projectId, entity_type: entityType, entity_id: entityId };
  const queryKey = ["hellotest-comments", projectId, entityType, entityId];
  const comments = useQuery({
    queryKey,
    queryFn: () => api.comments.list(scope),
    enabled: Boolean(projectId && entityId),
    staleTime: 15_000
  });
  const createComment = useMutation({
    mutationFn: () => api.comments.create(scope, draft),
    onSuccess: async () => {
      setDraft("");
      setMessageTone("success");
      setMessage("Comment posted to HelloTest.");
      await queryClient.invalidateQueries({ queryKey });
      onEvidenceChange?.();
    },
    onError: (error) => {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Unable to post the HelloTest comment.");
    }
  });

  const handleSubmit = () => {
    if (!draft.trim() || createComment.isPending) return;
    void createComment.mutateAsync();
  };

  return (
    <section className="jira-comments-panel" aria-label={`Comments for ${issueKey}`}>
      <div className="jira-comments-head">
        <div>
          <strong>HelloTest comments</strong>
          <span>{comments.data?.length || 0} visible to you on {issueKey}</span>
        </div>
      </div>

      {canComment ? (
        <div className="jira-comment-composer">
          <textarea
            aria-label="Add a HelloTest comment"
            maxLength={5_000}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Add context, a decision, or a traceability note…"
            rows={3}
            value={draft}
          />
          <div>
            <span>{draft.length.toLocaleString()}/5,000</span>
            <button className="primary-button compact" disabled={!draft.trim() || createComment.isPending} onClick={handleSubmit} type="button">
              {createComment.isPending ? "Posting…" : "Comment"}
            </button>
          </div>
        </div>
      ) : null}

      {comments.isLoading ? <LoadingState label="Loading HelloTest comments" /> : null}
      {comments.error ? <div className="inline-error">{comments.error instanceof Error ? comments.error.message : "Unable to load HelloTest comments."}</div> : null}
      <div className="jira-comment-list">
        {(comments.data || []).map((comment) => {
          const author = comment.author?.displayName || "HelloTest user";
          const avatar = comment.author?.avatarUrls?.["32x32"] || comment.author?.avatarUrls?.["24x24"];
          return (
            <article className="jira-comment-card" key={comment.id}>
              {avatar ? <img alt="" src={avatar} /> : <span className="jira-comment-avatar" aria-hidden="true">{initials(author)}</span>}
              <div>
                <div className="jira-comment-meta">
                  <strong>{author}</strong>
                  <span>{commentTimestamp(comment.created)}</span>
                </div>
                <p>{comment.body || "Comment has no readable text content."}</p>
              </div>
            </article>
          );
        })}
        {!comments.isLoading && !comments.data?.length ? <div className="empty-state compact">No comments yet.</div> : null}
      </div>
      {message ? <ToastMessage message={message} onDismiss={() => setMessage("")} tone={messageTone} /> : null}
    </section>
  );
}
