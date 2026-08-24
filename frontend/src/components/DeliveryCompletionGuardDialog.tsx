import { IconAlertTriangle, IconChecklist, IconProgressCheck } from "@tabler/icons-react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { DialogCloseButton } from "./DialogCloseButton";
import { DisplayIdBadge } from "./DisplayIdBadge";
import "./DeliveryCompletionGuardDialog.css";

export type IncompleteDeliveryStory = {
  id: string;
  displayId?: string | null;
  title: string;
  status?: string | null;
};

export function DeliveryCompletionGuardDialog({
  entityLabel,
  entityName,
  incompleteStories,
  onClose,
  totalStories
}: {
  entityLabel: "Sprint" | "Release";
  entityName: string;
  incompleteStories: IncompleteDeliveryStory[];
  onClose: () => void;
  totalStories: number;
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>({ active: true, onClose });
  const completedStories = Math.max(0, totalStories - incompleteStories.length);
  const visibleStories = incompleteStories.slice(0, 8);

  const dialog = (
    <div className="modal-backdrop delivery-completion-guard-backdrop" onClick={onClose} role="presentation">
      <div
        aria-describedby="delivery-completion-guard-description"
        aria-labelledby="delivery-completion-guard-title"
        aria-modal="true"
        className="modal-card delivery-completion-guard-dialog"
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="alertdialog"
        tabIndex={-1}
      >
        <header className="delivery-completion-guard-header">
          <span aria-hidden="true" className="delivery-completion-guard-icon"><IconAlertTriangle size={22} stroke={2.1} /></span>
          <div>
            <span className="eyebrow">Completion blocked</span>
            <h2 className="dialog-title" id="delivery-completion-guard-title">Finish every Story before completing this {entityLabel}</h2>
            <p id="delivery-completion-guard-description">“{entityName}” still contains {incompleteStories.length} unfinished {incompleteStories.length === 1 ? "Story" : "Stories"}. Move each one to a completed status, then try again.</p>
          </div>
          <DialogCloseButton label={`Close incomplete ${entityLabel} message`} onClick={onClose} />
        </header>

        <section aria-label={`${entityLabel} completion summary`} className="delivery-completion-guard-summary">
          <article><IconChecklist size={17} /><span>Total Stories</span><strong>{totalStories}</strong></article>
          <article className="is-complete"><IconProgressCheck size={17} /><span>Completed</span><strong>{completedStories}</strong></article>
          <article className="is-blocked"><IconAlertTriangle size={17} /><span>Still unfinished</span><strong>{incompleteStories.length}</strong></article>
        </section>

        <section className="delivery-completion-guard-list-section">
          <div className="delivery-completion-guard-list-heading">
            <div><strong>Stories requiring attention</strong><span>Accepted completion statuses include QA Done, Done, Resolved, Accepted, and Closed.</span></div>
          </div>
          <div className="delivery-completion-guard-list">
            {visibleStories.map((story) => (
              <article key={story.id}>
                <DisplayIdBadge value={story.displayId || story.id} />
                <div><strong>{story.title}</strong><span>Current status: {story.status || "Open"}</span></div>
              </article>
            ))}
          </div>
          {incompleteStories.length > visibleStories.length ? <p className="delivery-completion-guard-overflow">And {incompleteStories.length - visibleStories.length} more unfinished Stories.</p> : null}
        </section>

        <footer className="delivery-completion-guard-actions">
          <span>No lifecycle state was changed.</span>
          <button autoFocus className="primary-button" onClick={onClose} type="button">Close and review Stories</button>
        </footer>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(dialog, document.body) : dialog;
}
