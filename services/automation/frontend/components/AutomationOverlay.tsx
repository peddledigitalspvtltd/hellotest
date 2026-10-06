import { useId, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "@hellotest/platform/frontend/src/shared/hooks/useDialogFocus";
import { DialogCloseButton } from "@hellotest/platform/frontend/src/shared/components/DialogCloseButton";

export function AutomationIconButton({ label, children, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button {...props} aria-label={label} title={label} className={`automation-icon-button ${className}`} type="button">{children}</button>;
}

/** Keep editor focus and drafts in place while the plan remains visible behind it. */
export function AutomationOverlay({ title, subtitle, icon, onClose, closeDisabled = false, variant = "drawer", children }: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  onClose: () => void;
  closeDisabled?: boolean;
  variant?: "drawer" | "dialog";
  children: ReactNode;
}) {
  const titleId = useId();
  const ref = useDialogFocus<HTMLDivElement>({ active: true, onClose, closeDisabled });
  return createPortal(<div className={`automation-overlay is-${variant}`} onClick={(event) => {
    if (event.target === event.currentTarget && !closeDisabled) onClose();
  }}>
    <div className="automation-overlay-card" ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <header className="automation-overlay-header"><div>{icon}<div><h2 id={titleId}>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div></div><DialogCloseButton disabled={closeDisabled} onClick={onClose} /></header>
      <div className="automation-overlay-body">{children}</div>
    </div>
  </div>, document.body);
}
