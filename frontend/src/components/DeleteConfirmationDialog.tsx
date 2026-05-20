import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";

type DeleteConfirmationState = {
  title: string;
  message: string;
  confirmLabel: string;
  tone: "danger" | "primary";
};

type DeleteConfirmationOptions = {
  message: string;
  confirmLabel?: string;
  title?: string;
  tone?: "danger" | "primary";
};

export function useDeleteConfirmation() {
  const [state, setState] = useState<DeleteConfirmationState | null>(null);
  const resolverRef = useRef<((confirmed: boolean) => void) | null>(null);

  const close = useCallback((confirmed: boolean) => {
    resolverRef.current?.(confirmed);
    resolverRef.current = null;
    setState(null);
  }, []);

  const confirmAction = useCallback(({ message, confirmLabel = "Confirm", title = "Confirm action", tone = "primary" }: DeleteConfirmationOptions) =>
    new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setState({ title, message, confirmLabel, tone });
    }), []);
  const confirmDelete = useCallback(({ message, confirmLabel = "Confirm delete", title = "Warning, can't revert" }: DeleteConfirmationOptions) =>
    confirmAction({ message, confirmLabel, title, tone: "danger" }), [confirmAction]);

  const confirmationDialog = state && typeof document !== "undefined"
    ? createPortal(
      <div className="modal-backdrop delete-confirmation-backdrop" onClick={() => close(false)} role="presentation">
        <div
          aria-modal="true"
          className="modal-card delete-confirmation-modal"
          onClick={(event) => event.stopPropagation()}
          role="dialog"
        >
          <div className="resource-modal-header">
            <div className="resource-modal-title">
              <h3>{state.title}</h3>
              <p>{state.message}</p>
            </div>
          </div>
          <div className="delete-confirmation-actions">
            <button className="ghost-button" onClick={() => close(false)} type="button">
              Cancel
            </button>
            <button className={state.tone === "danger" ? "primary-button danger-button" : "primary-button"} onClick={() => close(true)} type="button">
              {state.confirmLabel}
            </button>
          </div>
        </div>
      </div>,
      document.body
    )
    : null;

  return { confirmAction, confirmDelete, confirmationDialog };
}
