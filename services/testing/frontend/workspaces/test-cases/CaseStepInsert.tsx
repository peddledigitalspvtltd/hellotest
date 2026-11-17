import { type StepDraft } from "./testCaseWorkspaceTypes";
import { FormEvent, type ReactNode } from "react";
import { FormField } from "@hellotest/platform/frontend/src/shared/components/FormField";
import { RichTextEditor } from "@hellotest/platform/frontend/src/platform/components/RichTextEditor";
import { type StepParameterDefinition } from "@hellotest/platform/frontend/src/shared/lib/stepParameters";

export function StepIconButton({
  children,
  ariaLabel,
  title,
  onClick,
  count = 0,
  disabled = false,
  tone = "ghost",
  type = "button"
}: {
  children: ReactNode;
  ariaLabel: string;
  title: string;
  onClick: () => void;
  count?: number;
  disabled?: boolean;
  tone?: "ghost" | "primary" | "danger";
  type?: "button" | "submit" | "reset";
}) {
  const className =
    tone === "primary"
      ? "step-action-button step-action-button--primary"
      : tone === "danger"
        ? "step-action-button step-action-button--danger"
        : "step-action-button";

  return (
    <button aria-label={ariaLabel} className={count ? `${className} has-count` : className} disabled={disabled} onClick={onClick} title={title} type={type}>
      {children}
      {count ? <span className="step-action-count">{count}</span> : null}
    </button>
  );
}

export function InlineStepInsertSlot({
  availableParameters,
  parameterValues,
  index,
  isActive,
  draft,
  onCancel,
  onChange,
  onSubmit
}: {
  availableParameters: StepParameterDefinition[];
  parameterValues: Record<string, string>;
  index: number;
  isActive: boolean;
  draft: StepDraft;
  onCancel: () => void;
  onChange: (draft: StepDraft) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  if (!isActive) {
    return null;
  }

  return (
    <div className="step-insert-slot is-active">
      <form className="step-create step-create--inline" onSubmit={onSubmit}>
        <strong>{index === 0 ? "+ Add Step" : "+ Insert Step"}</strong>
        <FormField label="Action">
          <RichTextEditor availableParameters={availableParameters} parameterValues={parameterValues}
            autoFocus
            value={draft.action}
            onChange={(value) => onChange({ ...draft, action: value })}
          />
        </FormField>
        <FormField label="Expected result">
          <RichTextEditor availableParameters={availableParameters} parameterValues={parameterValues}
            value={draft.expected_result}
            onChange={(value) => onChange({ ...draft, expected_result: value })}
          />
        </FormField>
        <div className="action-row">
          <button className="ghost-button" onClick={onCancel} type="button">
            Cancel
          </button>
          <button className="primary-button" type="submit">Save step</button>
        </div>
      </form>
    </div>
  );
}
