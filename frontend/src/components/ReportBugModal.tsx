import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { DialogCloseButton } from "./DialogCloseButton";

type ReportBugModalProps = {
  backLabel?: string;
  children: ReactNode;
  closeDisabled?: boolean;
  onClose: () => void;
};

/**
 * Canonical manual Bug creation shell. Every Report Bug entry point resolves to
 * this modal while the Bugs workspace continues to own Jira-backed form state.
 */
export function ReportBugModal({
  backLabel = "Back",
  children,
  closeDisabled = false,
  onClose
}: ReportBugModalProps) {
  const dialogRef = useDialogFocus<HTMLElement>({
    active: true,
    closeDisabled,
    onClose
  });

  const dialog = (
    <div
      className="modal-backdrop report-bug-modal-backdrop"
      onClick={() => {
        if (!closeDisabled) onClose();
      }}
      role="presentation"
    >
      <section
        aria-labelledby="report-bug-modal-title"
        aria-modal="true"
        className="modal-card report-bug-modal"
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="report-bug-modal-header">
          <div className="report-bug-modal-title-row">
            <button
              aria-label={backLabel}
              className="report-bug-modal-back-button"
              disabled={closeDisabled}
              onClick={onClose}
              title={backLabel}
              type="button"
            >
              <svg aria-hidden="true" fill="none" height="24" viewBox="0 0 24 24" width="24">
                <path d="m10 6-6 6 6 6M4 12h16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
              </svg>
              <span>Back</span>
            </button>
            <h2 id="report-bug-modal-title">Report Bug</h2>
          </div>
          <DialogCloseButton
            disabled={closeDisabled}
            label="Close Report Bug"
            onClick={onClose}
          />
        </header>

        {children}
      </section>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(dialog, document.body) : dialog;
}
