import { useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconDatabase, IconX } from "@tabler/icons-react";
import { useDialogFocus } from "@hellotest/platform/frontend/src/shared/hooks/useDialogFocus";
import "./AgenticAuthoringCanvas.css";

/** Keep attachment and template state mounted when the context peek closes. */
export function AiContextPeek({ open, onClose, children, id, title = "Context & options", description = "Choose the evidence and boundaries for this proposal." }: {
  open: boolean; onClose: () => void; children: ReactNode; id?: string; title?: string; description?: string;
}) {
  const titleId = useId();
  const ref = useDialogFocus<HTMLElement>({ active: open, onClose });
  const peek = <div className="ai-context-peek-backdrop" hidden={!open} onClick={event => {
    if (event.target === event.currentTarget) onClose();
  }} role="presentation">
    <aside aria-label={title} aria-labelledby={titleId} aria-modal="true" className="ai-context-peek ai-test-generator-context" id={id}
      onClick={event => event.stopPropagation()} ref={ref} role="dialog" tabIndex={-1}>
      <header className="ai-test-generator-pane-title"><IconDatabase size={18} aria-hidden="true" /><div><strong id={titleId}>{title}</strong><span>{description}</span></div><button aria-label={`Close ${title}`} className="ai-context-pane-close" onClick={onClose} type="button"><IconX size={16} /></button></header>
      {children}
    </aside>
  </div>;
  return typeof document !== "undefined" ? createPortal(peek, document.body) : peek;
}
