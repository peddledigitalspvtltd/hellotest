import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";

type DeleteConfirmationState = {
  message: string;
  confirmLabel: string;
};

type DeleteConfirmationOptions = {
  message: string;
  confirmLabel?: string;
};

export function useDeleteConfirmation() {
  const [state, setState] = useState<DeleteConfirmationState | null>(null);
  const resolverRef = useRef<((confirmed: boolean) => void) | null>(null);

  const close = useCallback((confirmed: boolean) => {
    resolverRef.current?.(confirmed);
    resolverRef.current = null;
    setState(null);
  }, []);

  const confirmDelete = useCallback(({ message, confirmLabel = "Confirm delete" }: DeleteConfirmationOptions) =>
    new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setState({ message, confirmLabel });
    }), []);

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
              <h3>Warning, can't revert</h3>
              <p>{state.message}</p>
            </div>
          </div>
          <div className="delete-confirmation-actions">
            <button className="ghost-button" onClick={() => close(false)} type="button">
              Cancel
            </button>
            <button className="primary-button danger-button" onClick={() => close(true)} type="button">
              {state.confirmLabel}
            </button>
          </div>
        </div>
      </div>,
      document.body
    )
    : null;

  return { confirmDelete, confirmationDialog };
}
