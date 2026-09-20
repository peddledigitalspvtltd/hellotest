import { formatDefectFieldLabel } from "../lib/defectTerminology";
import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { IssueHistoryEntry } from "../types";
import { JiraCommentsPanel } from "./JiraCommentsPanel";
import { LoadingState } from "./LoadingState";
import { richTextToPlainText } from "./RichTextEditor";

const RICH_TEXT_FIELDS = new Set(["message", "steps_to_reproduce", "expected_result", "actual_result"]);
const formatValue = (value: IssueHistoryEntry["changes"][number]["old_value"], field: string) => {
  if (value === null || value === "" || value === undefined) return "Not set";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "None";
  return RICH_TEXT_FIELDS.has(field) ? richTextToPlainText(value) || "Not set" : value;
};

const timestamp = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Time unavailable"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" }).format(date);
};

export function IssueActivityPanel({ issueId, issueKey, projectId, canComment }: {
  issueId: string;
  issueKey: string;
  projectId: string;
  canComment: boolean;
}) {
  const [activeTab, setActiveTab] = useState<"comments" | "history">("comments");
  const panelId = useId();
  const history = useQuery({
    queryKey: ["bug-history", projectId, issueId],
    queryFn: () => api.issues.history(issueId),
    enabled: activeTab === "history" && Boolean(issueId && projectId),
    staleTime: 15_000
  });

  return (
    <section className="issue-activity-panel" aria-label={`Activity for ${issueKey}`}>
      <div className="issue-activity-tabs" role="tablist" aria-label="Defect activity">
        {(["comments", "history"] as const).map((tab) => (
          <button
            aria-controls={`${panelId}-${tab}-panel`}
            aria-selected={activeTab === tab}
            id={`${panelId}-${tab}-tab`}
            key={tab}
            onClick={() => setActiveTab(tab)}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === "Home" ? "comments" : event.key === "End" ? "history" : tab === "comments" ? "history" : "comments";
              setActiveTab(next);
              document.getElementById(`${panelId}-${next}-tab`)?.focus();
            }}
            role="tab"
            tabIndex={activeTab === tab ? 0 : -1}
            type="button"
          >
            {tab === "comments" ? "Comments" : "History"}
          </button>
        ))}
      </div>
      <div aria-labelledby={`${panelId}-comments-tab`} hidden={activeTab !== "comments"} id={`${panelId}-comments-panel`} role="tabpanel" tabIndex={0}>
        <JiraCommentsPanel canComment={canComment} entityId={issueId} entityType="issue" hideHeading issueKey={issueKey} projectId={projectId} />
      </div>
      <div aria-labelledby={`${panelId}-history-tab`} hidden={activeTab !== "history"} id={`${panelId}-history-panel`} role="tabpanel" tabIndex={0}>
        <p className="issue-history-caption">Field changes, newest first. Times are shown in your local time zone.</p>
        {history.isLoading ? <LoadingState label="Loading Defect history" /> : null}
        {history.error ? <div className="inline-error" role="alert">{history.error instanceof Error ? history.error.message : "Unable to load history."} <button onClick={() => void history.refetch()} type="button">Retry</button></div> : null}
        {!history.isLoading && !history.error && !history.data?.length ? <div className="empty-state compact">No history yet.</div> : null}
        <ol className="issue-history-list">
          {(history.data || []).map((entry) => (
            <li className="issue-history-event" key={entry.id}>
              <div className="issue-history-event-meta">
                <span><strong title={entry.actor_email || undefined}>{entry.actor_name}</strong> {entry.action === "created" ? "created this Defect" : "updated this Defect"}</span>
                <time dateTime={entry.created_at} title={timestamp(entry.created_at)}>{timestamp(entry.created_at)}</time>
              </div>
              {entry.legacy ? <p className="issue-history-caption">Created before history tracking began. Earlier field changes are unavailable.</p> : null}
              {entry.changes.length ? (
                <details className="issue-history-changes" open={entry.action === "updated"}>
                  <summary>{entry.action === "created" ? "Initial values" : "Changes"} · {entry.changes.length} field{entry.changes.length === 1 ? "" : "s"}</summary>
                  {entry.changes.map((change) => (
                    <div className="issue-history-change" key={change.field}>
                      <strong>{formatDefectFieldLabel(change.field, change.label)}</strong>
                      <div className="issue-history-values">
                        <div><span>Previous</span><p>{formatValue(change.old_display !== undefined ? change.old_display : change.old_value, change.field)}</p></div>
                        <div><span>New</span><p>{formatValue(change.new_display !== undefined ? change.new_display : change.new_value, change.field)}</p></div>
                      </div>
                    </div>
                  ))}
                </details>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
