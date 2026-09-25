import { useAuth } from "../../auth/AuthContext";
import type { useProjectDeletions } from "../hooks/useProjectDeletions";
import { hasPermission } from "../lib/permissions";
import { useDeleteConfirmation } from "../../shared/components/DeleteConfirmationDialog";
import "./ProjectDeletionProgress.css";

export function ProjectDeletionProgress({ deletions }: { deletions: ReturnType<typeof useProjectDeletions> }) {
  const { session } = useAuth();
  const { confirmDelete, confirmationDialog } = useDeleteConfirmation();
  if (!deletions.items.length) return null;
  return <>{confirmationDialog}
    <section className="project-deletion-progress" aria-label="Project deletion progress">
      <h2>Project deletion</h2>
      <p>Deletion continues in the background. You can leave this page and return to check progress.</p>
      {deletions.items.map((item) => (
        <article key={item.projectId} className="project-deletion-progress-item" data-project-id={item.projectId}>
          <div aria-live="polite">
            <strong>{item.projectName}</strong>
            <p>
              {item.submitting ? "Requesting deletion…"
                : item.job?.status === "queued" ? "Queued for deletion"
                : item.job?.status === "running" ? "Deleting project data…"
                : item.job?.status === "cleanup" ? "Cleaning up project files…"
                : item.job?.status === "completed" ? "Project deleted."
                : item.job?.status === "failed" ? "Deletion failed. You can retry to continue."
                : "Checking deletion status…"}
              {item.job && item.job.processed_rows > 0 ? ` ${item.job.processed_rows.toLocaleString()} records processed.` : ""}
            </p>
            {item.job?.error ? <p className="project-deletion-error">{item.job.error}</p> : null}
            {item.submissionError ? <p className="project-deletion-error">{item.submissionError} Checking whether the request was accepted.</p> : null}
            {item.pollingError ? <p className="project-deletion-error">Unable to refresh deletion status. {item.pollingError}</p> : null}
          </div>
          <div className="action-row">
            {item.canRetry && !item.submitting && (item.job?.status === "failed" || hasPermission(session, "project.delete", item.projectId)) ? (
              <button className="ghost-button danger" type="button" onClick={async () => {
                if (await confirmDelete({ message: `Retry deletion of project "${item.projectName}" and all related data?`, confirmLabel: "Retry deletion" })) {
                  await deletions.submit(item.projectId, item.projectName);
                }
              }}>Retry deletion</button>
            ) : null}
            {item.pollingError && !item.submitting ? <button className="ghost-button" type="button" onClick={item.refresh}>Check status</button> : null}
            {item.job?.status === "completed" || item.canDismiss ? <button className="ghost-button" type="button" onClick={item.dismiss}>Dismiss</button> : null}
          </div>
        </article>
      ))}
    </section>

  </>;
}
