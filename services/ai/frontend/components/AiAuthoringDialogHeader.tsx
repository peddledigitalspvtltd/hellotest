import type { ReactNode } from "react";
import { SparkIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import { DialogCloseButton } from "@hellotest/platform/frontend/src/shared/components/DialogCloseButton";

type AiAuthoringDialogHeaderProps = {
  titleId: string;
  title: string;
  description: string;
  descriptionId?: string;
  eyebrow: string;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
  closeDisabled?: boolean;
  closeLabel: string;
  onClose: () => void;
  className?: string;
};

/**
 * Shared identity and command bar for review-first AI authoring dialogs.
 * Feature-specific context and review controls stay in each owning workflow.
 */
export function AiAuthoringDialogHeader({
  titleId,
  title,
  description,
  descriptionId,
  eyebrow,
  primaryAction,
  secondaryAction,
  closeDisabled = false,
  closeLabel,
  onClose,
  className
}: AiAuthoringDialogHeaderProps) {
  return (
    <header className={`ai-authoring-dialog-header${className ? ` ${className}` : ""}`}>
      <div className="ai-authoring-dialog-identity">
        <span className="ai-authoring-dialog-icon" aria-hidden="true">
          <SparkIcon size={18} />
        </span>
        <div className="ai-authoring-dialog-copy">
          <p className="dialog-context-label">{eyebrow}</p>
          <h2 className="dialog-title" id={titleId}>{title}</h2>
          <p className="ai-authoring-dialog-description" id={descriptionId}>{description}</p>
        </div>
      </div>
      <div className="ai-authoring-dialog-header-actions">
        {secondaryAction ? <div className="ai-authoring-dialog-secondary">{secondaryAction}</div> : null}
        {primaryAction ? <div className="ai-authoring-dialog-primary">{primaryAction}</div> : null}
        <span className="ai-authoring-dialog-action-divider" aria-hidden="true" />
        <DialogCloseButton disabled={closeDisabled} label={closeLabel} onClick={onClose} />
      </div>
    </header>
  );
}
