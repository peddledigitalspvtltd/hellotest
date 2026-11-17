import { type StepDraft, type StepActionMenuAction } from "./testCaseWorkspaceTypes";
import { StepKindIconBadge } from "./../../components/StepKindIconBadge";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { RecordIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import { FormField } from "@hellotest/platform/frontend/src/shared/components/FormField";
import { InfoTooltip } from "@hellotest/platform/frontend/src/shared/components/InfoTooltip";
import { LoadingState } from "@hellotest/platform/frontend/src/shared/components/LoadingState";
import { RichTextAiRephraseIcon, RichTextEditor, richTextToPlainText } from "@hellotest/platform/frontend/src/platform/components/RichTextEditor";
import { StepParameterizedText } from "./../../components/StepParameterizedText";
import { AutomationCodeIcon, StepIconButton as InlineStepToolButton, StepTypePickerButton } from "@hellotest/automation/frontend/components/StepAutomationEditor";
import { normalizeApiRequest, normalizeAutomationCode, normalizeStepType, stepHasAutomation } from "@hellotest/automation/frontend/lib/stepAutomation";
import { type StepParameterDefinition } from "@hellotest/platform/frontend/src/shared/lib/stepParameters";
import type { TestStep } from "@hellotest/platform/frontend/src/types";

export const normalizeSharedGroupComparableText = (value?: string | null) =>
  richTextToPlainText(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

export const normalizeComparableAutomationCode = (value?: string | null) => normalizeAutomationCode(value).trim();

export const normalizeComparableApiRequest = (value?: TestStep["api_request"]) =>
  JSON.stringify(normalizeApiRequest(value) || null);

export const areComparableStepAutomationEqual = (
  left: Pick<TestStep, "step_type" | "automation_code" | "api_request">,
  right: Pick<TestStep, "step_type" | "automation_code" | "api_request">
) =>
  normalizeStepType(left.step_type) === normalizeStepType(right.step_type)
  && normalizeComparableAutomationCode(left.automation_code) === normalizeComparableAutomationCode(right.automation_code)
  && normalizeComparableApiRequest(left.api_request) === normalizeComparableApiRequest(right.api_request);

export function StepIconShell({ children }: { children: ReactNode }) {
  return (
    <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" viewBox="0 0 24 24" width="16">
      {children}
    </svg>
  );
}

export function StepAiIcon() {
  return <RichTextAiRephraseIcon />;
}

export function StepMoveUpIcon() {
  return (
    <StepIconShell>
      <path d="m12 6-4 4" />
      <path d="m12 6 4 4" />
      <path d="M12 6v12" />
    </StepIconShell>
  );
}

export function StepMoveDownIcon() {
  return (
    <StepIconShell>
      <path d="m12 18-4-4" />
      <path d="m12 18 4-4" />
      <path d="M12 6v12" />
    </StepIconShell>
  );
}

export function StepSaveIcon() {
  return (
    <StepIconShell>
      <path d="M5 6.5A1.5 1.5 0 0 1 6.5 5h9l3.5 3.5V17.5A1.5 1.5 0 0 1 17.5 19h-11A1.5 1.5 0 0 1 5 17.5z" />
      <path d="M9 5v5h6V6" />
      <path d="M9 15h6" />
    </StepIconShell>
  );
}

export function StepDeleteIcon() {
  return (
    <StepIconShell>
      <path d="M4 7h16" />
      <path d="M9 7V5.8A1.8 1.8 0 0 1 10.8 4h2.4A1.8 1.8 0 0 1 15 5.8V7" />
      <path d="M7 7l.8 11.1A2 2 0 0 0 9.8 20h4.4a2 2 0 0 0 2-1.9L17 7" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </StepIconShell>
  );
}

export function StepCopyIcon() {
  return (
    <StepIconShell>
      <rect x="9" y="9" width="10" height="10" rx="2" />
      <path d="M7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1" />
    </StepIconShell>
  );
}

export function StepInsertAboveIcon() {
  return (
    <StepIconShell>
      <path d="M12 19V7" />
      <path d="m8.5 10.5 3.5-3.5 3.5 3.5" />
      <path d="M6 4h12" />
      <path d="M8 15h8" />
    </StepIconShell>
  );
}

export function StepInsertBelowIcon() {
  return (
    <StepIconShell>
      <path d="M12 5v12" />
      <path d="m8.5 13.5 3.5 3.5 3.5-3.5" />
      <path d="M8 9h8" />
      <path d="M6 20h12" />
    </StepIconShell>
  );
}

export function StepCutIcon() {
  return (
    <StepIconShell>
      <circle cx="6" cy="7" r="2" />
      <circle cx="6" cy="17" r="2" />
      <path d="M8 8.5 19 18" />
      <path d="M8 15.5 19 6" />
    </StepIconShell>
  );
}

export function StepPasteAboveIcon() {
  return (
    <StepIconShell>
      <path d="M8 5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7H8z" />
      <path d="M7 7h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" />
      <path d="M12 16V10" />
      <path d="m8.5 12.5 3.5-3.5 3.5 3.5" />
    </StepIconShell>
  );
}

export function StepPasteBelowIcon() {
  return (
    <StepIconShell>
      <path d="M8 5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7H8z" />
      <path d="M7 7h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" />
      <path d="M12 10v6" />
      <path d="m8.5 15.5 3.5 3.5 3.5-3.5" />
    </StepIconShell>
  );
}

export function StepKebabIcon() {
  return (
    <StepIconShell>
      <circle cx="12" cy="6" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="18" r="1.5" />
    </StepIconShell>
  );
}

export function getStepKindMeta(groupKind?: TestStep["group_kind"] | null) {
  if (groupKind === "reusable") {
    return { label: "Shared Step Group step", tone: "shared" as const };
  }

  if (groupKind === "local") {
    return { label: "Local group step", tone: "local" as const };
  }

  return { label: "Standard step", tone: "default" as const };
}

export const STEP_ACTION_HOVER_EXIT_DELAY_MS = 1000;

export function StepActionMenu({
  className = "",
  label,
  actions,
  previewActions,
  openOnHover = false
}: {
  className?: string;
  label: string;
  actions: StepActionMenuAction[];
  previewActions?: StepActionMenuAction[];
  openOnHover?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [menuPlacement, setMenuPlacement] = useState<"below" | "above">("below");
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const hoverExitTimeoutRef = useRef<number | null>(null);

  const updateMenuPlacement = () => {
    const trigger = triggerRef.current;
    if (!trigger || typeof window === "undefined") {
      return;
    }

    const rect = trigger.getBoundingClientRect();
    const estimatedMenuHeight = Math.max(menuRef.current?.offsetHeight || 260, 220);
    const bottomRoom = window.innerHeight - rect.bottom;
    const topRoom = rect.top;
    setMenuPlacement(bottomRoom < estimatedMenuHeight + 24 && topRoom > bottomRoom ? "above" : "below");
  };

  const clearHoverExitTimeout = () => {
    if (hoverExitTimeoutRef.current === null) {
      return;
    }

    window.clearTimeout(hoverExitTimeoutRef.current);
    hoverExitTimeoutRef.current = null;
  };

  const handleHoverEnter = () => {
    if (!openOnHover) {
      return;
    }

    clearHoverExitTimeout();
    setIsHovering(true);
  };

  const handleHoverLeave = () => {
    if (!openOnHover) {
      return;
    }

    clearHoverExitTimeout();
    hoverExitTimeoutRef.current = window.setTimeout(() => {
      setIsHovering(false);
      hoverExitTimeoutRef.current = null;
    }, STEP_ACTION_HOVER_EXIT_DELAY_MS);
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointer = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setIsOpen(false);
    };

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointer);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handlePointer);
      window.removeEventListener("keydown", handleKey);
    };
  }, [isOpen]);

  useEffect(
    () => () => {
      if (hoverExitTimeoutRef.current !== null) {
        window.clearTimeout(hoverExitTimeoutRef.current);
      }
    },
    []
  );

  return (
    <div
      className={["step-card-menu", className].filter(Boolean).join(" ")}
      onMouseEnter={handleHoverEnter}
      onMouseLeave={handleHoverLeave}
    >
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={label}
        className="step-card-menu-trigger"
        onClick={() => {
          updateMenuPlacement();
          setIsOpen((current) => !current);
        }}
        ref={triggerRef}
        title={label}
        type="button"
      >
        <StepKebabIcon />
      </button>
      {openOnHover && previewActions?.length && isHovering && !isOpen ? (
        <div className="step-card-menu-panel is-horizontal" role="menu">
          {previewActions.map((action) => (
            <button
              aria-label={action.label}
              className={["step-card-menu-item", action.tone ? `is-${action.tone}` : ""].filter(Boolean).join(" ")}
              disabled={action.disabled}
              key={action.label}
              onClick={() => {
                action.onClick();
                setIsHovering(false);
              }}
              role="menuitem"
              title={action.label}
              type="button"
            >
              {action.icon}
            </button>
          ))}
        </div>
      ) : null}
      {isOpen ? (
        <div className={["step-card-menu-panel", menuPlacement === "above" ? "is-open-above" : ""].filter(Boolean).join(" ")} ref={menuRef} role="menu">
          {actions.map((action) => (
            <button
              className={["step-card-menu-item", action.tone ? `is-${action.tone}` : ""].filter(Boolean).join(" ")}
              disabled={action.disabled}
              key={action.label}
              onClick={() => {
                action.onClick();
                setIsOpen(false);
              }}
              role="menuitem"
              title={action.label}
              type="button"
            >
              {action.icon}
              <span className="step-card-menu-item-content">
                <span className="step-card-menu-item-label-row">
                  <span className="step-card-menu-item-label">{action.label}</span>
                  {action.description ? (
                    <InfoTooltip
                      content={action.description}
                      label={`${action.label} information`}
                      trigger="span"
                    />
                  ) : null}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function EditableStepCard({
  step,
  draft,
  displayLabel,
  parameterValues,
  availableParameters,
  isExpanded,
  isSelected,
  isRephrasing,
  canPaste,
  canMoveUp,
  canMoveDown,
  showAutomationTools,
  showRecorderTools,
  onSave,
  onDraftChange,
  onCopy,
  onCut,
  onDelete,
  onInsertAbove,
  onInsertBelow,
  onToggle,
  onToggleSelect,
  onMoveUp,
  onMoveDown,
  onChangeStepType,
  onEditAutomation,
  onInspect,
  onRephrase,
  onPasteAbove,
  onPasteBelow
}: {
  step: TestStep;
  draft: StepDraft;
  displayLabel?: string;
  parameterValues: Record<string, string>;
  availableParameters: StepParameterDefinition[];
  isExpanded: boolean;
  isSelected: boolean;
  isRephrasing: boolean;
  canPaste: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  showAutomationTools: boolean;
  showRecorderTools: boolean;
  onSave: (input: StepDraft) => void;
  onDraftChange: (input: StepDraft) => void;
  onCopy: () => void;
  onCut: () => void;
  onDelete: () => void;
  onInsertAbove: () => void;
  onInsertBelow: () => void;
  onToggle: () => void;
  onToggleSelect: (checked: boolean) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onChangeStepType: (nextType: TestStep["step_type"]) => void;
  onEditAutomation: () => void;
  onInspect: () => void;
  onRephrase: () => void;
  onPasteAbove: () => void;
  onPasteBelow: () => void;
}) {
  const stepKind = getStepKindMeta(step.group_kind);
  const isDirty =
    normalizeSharedGroupComparableText(draft.action) !== normalizeSharedGroupComparableText(step.action)
    || normalizeSharedGroupComparableText(draft.expected_result) !== normalizeSharedGroupComparableText(step.expected_result)
    || !areComparableStepAutomationEqual(draft, step);
  const stepActions: StepActionMenuAction[] = [
    {
      label: "Insert above",
      description: "Open a new step slot right above this step.",
      icon: <StepInsertAboveIcon />,
      onClick: onInsertAbove
    },
    {
      label: "Insert below",
      description: "Open a new step slot right below this step.",
      icon: <StepInsertBelowIcon />,
      onClick: onInsertBelow
    },
    ...(canPaste
      ? [{
          label: "Paste above",
          description: "Insert the clipboard steps before this step.",
          icon: <StepPasteAboveIcon />,
          onClick: onPasteAbove
        }, {
          label: "Paste below",
          description: "Insert the clipboard steps after this step.",
          icon: <StepPasteBelowIcon />,
          onClick: onPasteBelow
        }]
      : []),
    {
      label: "Copy step",
      description: "Place this step in the clipboard.",
      icon: <StepCopyIcon />,
      onClick: onCopy
    },
    {
      label: "Cut step",
      description: "Move this step after you paste it somewhere else.",
      icon: <StepCutIcon />,
      onClick: onCut
    },
    {
      label: "Move up",
      description: "Shift this step earlier in its current order.",
      icon: <StepMoveUpIcon />,
      onClick: onMoveUp,
      disabled: !canMoveUp
    },
    {
      label: "Move down",
      description: "Shift this step later in its current order.",
      icon: <StepMoveDownIcon />,
      onClick: onMoveDown,
      disabled: !canMoveDown
    },
    ...(showRecorderTools
      ? [{
          label: "Inspect and record",
          description: "Open the recorder for this step action.",
          icon: <RecordIcon size={16} />,
          onClick: onInspect
        }]
      : []),
    {
      label: isRephrasing ? "Rephrasing with AI…" : "Rephrase with AI",
      description: "Improve the action and expected result without changing the test intent.",
      icon: <StepAiIcon />,
      onClick: onRephrase,
      disabled: isRephrasing
    },
    ...(showAutomationTools
      ? [{
          label: stepHasAutomation(draft) ? "View or edit automation" : "Edit step automation",
          description: "Manage the automation mapped to this step.",
          icon: <AutomationCodeIcon />,
          onClick: onEditAutomation
        }]
      : []),
    {
      label: isDirty ? "Save all changes" : "Save test case",
      description: "Save case details, Test Params, preconditions, and all edited steps together.",
      icon: <StepSaveIcon />,
      onClick: () => onSave(draft),
      tone: "primary"
    },
    {
      label: "Delete step",
      description: "Remove this step from the current test case.",
      icon: <StepDeleteIcon />,
      onClick: onDelete,
      tone: "danger"
    }
  ];

  return (
    <article
      className={[
        isExpanded ? "step-card is-expanded" : "step-card",
        displayLabel ? "step-card--plain-label" : "",
        step.group_kind === "reusable" ? "step-card--shared" : "",
        step.group_kind === "local" ? "step-card--grouped" : ""
      ].filter(Boolean).join(" ")}
    >
      <div className="step-card-top">
        <label className="checkbox-field step-card-select">
          <input
            aria-label={`Select step ${step.step_order}`}
            checked={isSelected}
            onChange={(event) => onToggleSelect(event.target.checked)}
            type="checkbox"
          />
        </label>
        <div className="step-card-type-tool">
          <StepTypePickerButton value={draft.step_type || step.step_type} onChange={onChangeStepType} />
        </div>
        <button
          aria-label={isExpanded ? `Hide step ${step.step_order} details` : `Show step ${step.step_order} details`}
          className="step-card-toggle"
          onClick={onToggle}
          type="button"
        >
          <div className="step-card-summary">
            <div className="step-card-summary-row">
              <div className="step-card-summary-top">
                <StepKindIconBadge label={stepKind.label} tone={stepKind.tone} />
                <strong>{displayLabel || `Step ${step.step_order}`}</strong>
              </div>
              <StepParameterizedText
                className="step-card-parameterized"
                fallback="No action written yet"
                text={richTextToPlainText(draft.action)}
                values={parameterValues}
              />
            </div>
          </div>
        </button>
        <div className="step-inline-tools">
          {showRecorderTools ? <InlineStepToolButton
            ariaLabel={`Inspect and record action for step ${step.step_order}`}
            onClick={onInspect}
            title="Inspect and record this step action"
          >
            <RecordIcon size={16} />
          </InlineStepToolButton> : null}
          <InlineStepToolButton
            ariaLabel={`Rephrase step ${step.step_order} with AI`}
            className={isRephrasing ? "is-active" : ""}
            disabled={isRephrasing}
            onClick={onRephrase}
            title={isRephrasing ? "AI is rephrasing this step" : "Rephrase step with AI"}
          >
            {isRephrasing ? <LoadingState label={`Rephrasing step ${step.step_order}`} /> : <StepAiIcon />}
          </InlineStepToolButton>
          {showAutomationTools ? <InlineStepToolButton
            ariaLabel={`Edit automation for step ${step.step_order}`}
            className={stepHasAutomation(draft) ? "is-active" : ""}
            onClick={onEditAutomation}
            title={stepHasAutomation(draft) ? "View or edit mapped automation for this step" : "Edit step automation"}
          >
            <AutomationCodeIcon />
          </InlineStepToolButton> : null}
        </div>
        <StepActionMenu
          className="step-card-menu--floating"
          label={`Step ${step.step_order} actions`}
          openOnHover
          previewActions={stepActions}
          actions={stepActions}
        />
      </div>

      {isExpanded ? (
        <div className="step-card-body">
          <FormField label="Action">
            <RichTextEditor availableParameters={availableParameters} parameterValues={parameterValues} value={draft.action} onChange={(value) => onDraftChange({ ...draft, action: value })} />
          </FormField>
          <FormField label="Expected result">
            <RichTextEditor availableParameters={availableParameters} parameterValues={parameterValues} value={draft.expected_result} onChange={(value) => onDraftChange({ ...draft, expected_result: value })} />
          </FormField>
        </div>
      ) : null}
    </article>
  );
}

export function DraftStepCard({
  step,
  displayLabel,
  parameterValues,
  availableParameters,
  isSelected,
  isExpanded,
  isRephrasing,
  canPaste,
  canMoveUp,
  canMoveDown,
  showAutomationTools,
  showRecorderTools,
  onChange,
  onCopy,
  onCut,
  onDelete,
  onInsertAbove,
  onInsertBelow,
  onToggle,
  onToggleSelect,
  onMoveUp,
  onMoveDown,
  onChangeStepType,
  onEditAutomation,
  onInspect,
  onRephrase,
  onPasteAbove,
  onPasteBelow
}: {
  step: { id: string; step_order: number; action: string; expected_result: string; step_type: TestStep["step_type"]; automation_code: string; api_request: TestStep["api_request"]; group_id: string | null; group_name: string | null; group_kind: "local" | "reusable" | null; reusable_group_id: string | null };
  displayLabel?: string;
  parameterValues: Record<string, string>;
  availableParameters: StepParameterDefinition[];
  isSelected: boolean;
  isExpanded: boolean;
  isRephrasing: boolean;
  canPaste: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  showAutomationTools: boolean;
  showRecorderTools: boolean;
  onChange: (input: StepDraft) => void;
  onCopy: () => void;
  onCut: () => void;
  onDelete: () => void;
  onInsertAbove: () => void;
  onInsertBelow: () => void;
  onToggle: () => void;
  onToggleSelect: (checked: boolean) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onChangeStepType: (nextType: TestStep["step_type"]) => void;
  onEditAutomation: () => void;
  onInspect: () => void;
  onRephrase: () => void;
  onPasteAbove: () => void;
  onPasteBelow: () => void;
}) {
  const stepKind = getStepKindMeta(step.group_kind);
  const stepActions: StepActionMenuAction[] = [
    {
      label: "Insert above",
      description: "Open a new step slot right above this draft step.",
      icon: <StepInsertAboveIcon />,
      onClick: onInsertAbove
    },
    {
      label: "Insert below",
      description: "Open a new step slot right below this draft step.",
      icon: <StepInsertBelowIcon />,
      onClick: onInsertBelow
    },
    ...(canPaste
      ? [{
          label: "Paste above",
          description: "Insert the clipboard steps before this draft step.",
          icon: <StepPasteAboveIcon />,
          onClick: onPasteAbove
        }, {
          label: "Paste below",
          description: "Insert the clipboard steps after this draft step.",
          icon: <StepPasteBelowIcon />,
          onClick: onPasteBelow
        }]
      : []),
    {
      label: "Copy step",
      description: "Place this draft step in the clipboard.",
      icon: <StepCopyIcon />,
      onClick: onCopy
    },
    {
      label: "Cut step",
      description: "Move this draft step after you paste it somewhere else.",
      icon: <StepCutIcon />,
      onClick: onCut
    },
    {
      label: "Move up",
      description: "Shift this draft step earlier in its current order.",
      icon: <StepMoveUpIcon />,
      onClick: onMoveUp,
      disabled: !canMoveUp
    },
    {
      label: "Move down",
      description: "Shift this draft step later in its current order.",
      icon: <StepMoveDownIcon />,
      onClick: onMoveDown,
      disabled: !canMoveDown
    },
    ...(showRecorderTools
      ? [{
          label: "Inspect and record",
          description: "Open the recorder for this draft step action.",
          icon: <RecordIcon size={16} />,
          onClick: onInspect
        }]
      : []),
    {
      label: isRephrasing ? "Rephrasing with AI…" : "Rephrase with AI",
      description: "Improve the draft action and expected result without changing the test intent.",
      icon: <StepAiIcon />,
      onClick: onRephrase,
      disabled: isRephrasing
    },
    ...(showAutomationTools
      ? [{
          label: stepHasAutomation(step) ? "View or edit automation" : "Edit step automation",
          description: "Manage the automation mapped to this draft step.",
          icon: <AutomationCodeIcon />,
          onClick: onEditAutomation
        }]
      : []),
    {
      label: "Delete step",
      description: "Remove this draft step from the test case.",
      icon: <StepDeleteIcon />,
      onClick: onDelete,
      tone: "danger"
    }
  ];

  return (
    <article
      className={[
        isExpanded ? "step-card is-expanded" : "step-card",
        displayLabel ? "step-card--plain-label" : "",
        step.group_kind === "reusable" ? "step-card--shared" : "",
        step.group_kind === "local" ? "step-card--grouped" : ""
      ].filter(Boolean).join(" ")}
    >
      <div className="step-card-top">
        <label className="checkbox-field step-card-select">
          <input
            aria-label={`Select step ${step.step_order}`}
            checked={isSelected}
            onChange={(event) => onToggleSelect(event.target.checked)}
            type="checkbox"
          />
        </label>
        <div className="step-card-type-tool">
          <StepTypePickerButton value={step.step_type} onChange={onChangeStepType} />
        </div>
        <button
          aria-label={isExpanded ? `Hide step ${step.step_order} details` : `Show step ${step.step_order} details`}
          className="step-card-toggle"
          onClick={onToggle}
          type="button"
        >
          <div className="step-card-summary">
            <div className="step-card-summary-row">
              <div className="step-card-summary-top">
                <StepKindIconBadge label={stepKind.label} tone={stepKind.tone} />
                <strong>{displayLabel || `Step ${step.step_order}`}</strong>
              </div>
              <StepParameterizedText
                className="step-card-parameterized"
                fallback="Draft step details"
                text={richTextToPlainText(step.action || step.expected_result)}
                values={parameterValues}
              />
            </div>
          </div>
        </button>
        <div className="step-inline-tools">
          {showRecorderTools ? <InlineStepToolButton
            ariaLabel={`Inspect and record action for step ${step.step_order}`}
            onClick={onInspect}
            title="Inspect and record this step action"
          >
            <RecordIcon size={16} />
          </InlineStepToolButton> : null}
          <InlineStepToolButton
            ariaLabel={`Rephrase step ${step.step_order} with AI`}
            className={isRephrasing ? "is-active" : ""}
            disabled={isRephrasing}
            onClick={onRephrase}
            title={isRephrasing ? "AI is rephrasing this step" : "Rephrase step with AI"}
          >
            {isRephrasing ? <LoadingState label={`Rephrasing step ${step.step_order}`} /> : <StepAiIcon />}
          </InlineStepToolButton>
          {showAutomationTools ? <InlineStepToolButton
            ariaLabel={`Edit automation for step ${step.step_order}`}
            className={stepHasAutomation(step) ? "is-active" : ""}
            onClick={onEditAutomation}
            title={stepHasAutomation(step) ? "View or edit mapped automation for this step" : "Edit step automation"}
          >
            <AutomationCodeIcon />
          </InlineStepToolButton> : null}
        </div>
        <StepActionMenu
          className="step-card-menu--floating"
          label={`Step ${step.step_order} actions`}
          openOnHover
          previewActions={stepActions}
          actions={stepActions}
        />
      </div>

      {isExpanded ? (
        <div className="step-card-body">
          <FormField label="Action">
            <RichTextEditor availableParameters={availableParameters} parameterValues={parameterValues}
              value={step.action}
              onChange={(value) =>
                onChange({
                  action: value,
                  expected_result: step.expected_result,
                  step_type: step.step_type,
                  automation_code: step.automation_code,
                  api_request: step.api_request
                })
              }
            />
          </FormField>
          <FormField label="Expected result">
            <RichTextEditor availableParameters={availableParameters} parameterValues={parameterValues}
              value={step.expected_result}
              onChange={(value) =>
                onChange({
                  action: step.action,
                  expected_result: value,
                  step_type: step.step_type,
                  automation_code: step.automation_code,
                  api_request: step.api_request
                })
              }
            />
          </FormField>
        </div>
      ) : null}
    </article>
  );
}
