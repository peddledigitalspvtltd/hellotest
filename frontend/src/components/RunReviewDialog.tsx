import { useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconX } from "@tabler/icons-react";
import { useDialogFocus } from "../hooks/useDialogFocus";
import "./RunReviewDialog.css";

export function RunReviewDialog({ title, runName, onClose, children }: {
  title: string;
  runName: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const dialogRef = useDialogFocus<HTMLDivElement>({ onClose });
  return createPortal(
    <div className="modal-backdrop run-review-backdrop" role="presentation" onClick={onClose}>
      <div aria-labelledby={titleId} aria-modal="true" className="modal-card run-review-dialog" onClick={(event) => event.stopPropagation()} ref={dialogRef} role="dialog" tabIndex={-1}>
        <header className="run-review-heading">
          <div><h2 id={titleId}>{title}</h2><p>{runName}</p></div>
          <button aria-label={`Close ${title.toLowerCase()}`} className="ghost-button" onClick={onClose} type="button"><IconX size={20} /></button>
        </header>
        <div className="run-review-body">{children}</div>
        <footer className="run-review-footer"><button className="ghost-button" onClick={onClose} type="button">Done</button></footer>
      </div>
    </div>, document.body
  );
}
