import { StepIconShell, StepMoveUpIcon, StepMoveDownIcon, StepDeleteIcon, StepActionMenu } from "./CaseStepCards";
import { useEffect, useRef, useState } from "react";
import { SearchIcon, SelectionToggleIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import { DisplayIdBadge } from "@hellotest/platform/frontend/src/shared/components/DisplayIdBadge";
import { DialogCloseButton } from "@hellotest/platform/frontend/src/shared/components/DialogCloseButton";
import { FormField } from "@hellotest/platform/frontend/src/shared/components/FormField";
import { InfoTooltip } from "@hellotest/platform/frontend/src/shared/components/InfoTooltip";
import { InlineLoadingState } from "@hellotest/platform/frontend/src/shared/components/LoadingSkeleton";
import { richTextToPlainText } from "@hellotest/platform/frontend/src/platform/components/RichTextEditor";
import { AutomationCodeIcon, SharedGroupLevelIcon, StepIconButton as InlineStepToolButton } from "@hellotest/automation/frontend/components/StepAutomationEditor";
import { SharedStepsIcon as SharedStepsIconGraphic } from "./../../components/SharedStepsIcon";
import { useDialogFocus } from "@hellotest/platform/frontend/src/shared/hooks/useDialogFocus";
import type { SharedStepGroup, TestStep } from "@hellotest/platform/frontend/src/types";

export function StepGroupIcon() {
  return (
    <StepIconShell>
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H10l2 2h5.5A2.5 2.5 0 0 1 20 9.5v7A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z" />
      <path d="M4 10h16" />
    </StepIconShell>
  );
}

export function StepSharedGroupIcon() {
  return <SharedStepsIconGraphic size={16} />;
}

export function StepGroupChevronIcon() {
  return (
    <StepIconShell>
      <path d="m7 10 5 5 5-5" />
    </StepIconShell>
  );
}

export function StepUngroupIcon() {
  return (
    <StepIconShell>
      <path d="M5 7h6v6H5z" />
      <path d="M13 11h6v6h-6z" />
      <path d="m9 16-3 3" />
      <path d="m6 16 3 3" />
      <path d="m18 5-3 3" />
      <path d="m15 5 3 3" />
    </StepIconShell>
  );
}

export function StepGroupHeader({
  name,
  kind,
  stepCount,
  isExpanded,
  canMoveUp,
  canMoveDown,
  showAutomationTools,
  selectionState,
  onConvertToLocal,
  onConvertToShared,
  onToggle,
  onMoveUp,
  onMoveDown,
  onPreviewCode,
  onRemoveGroup,
  onUngroup,
  onToggleSelect
}: {
  name: string;
  kind: TestStep["group_kind"];
  stepCount: number;
  isExpanded: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  showAutomationTools: boolean;
  selectionState: "all" | "some" | "none";
  onConvertToLocal: () => void;
  onConvertToShared: () => void;
  onToggle: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onPreviewCode: () => void;
  onRemoveGroup: () => void;
  onUngroup: () => void;
  onToggleSelect: (checked: boolean) => void;
}) {
  const isSharedGroup = kind === "reusable";
  const unlinkTitle = isSharedGroup ? "Unlink Shared Step Group from this case" : "Ungroup steps";
  const removeTitle = isSharedGroup ? "Remove Shared Step Group from this case" : "Remove group and steps";
  const selectionRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!selectionRef.current) {
      return;
    }
    selectionRef.current.indeterminate = selectionState === "some";
  }, [selectionState]);

  return (
    <div className="step-group-header">
      <div
        aria-expanded={isExpanded}
        aria-label={`${isExpanded ? "Collapse" : "Expand"} ${name}`}
        className="step-group-toggle"
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle();
          }
        }}
        role="button"
        tabIndex={0}
      >
        <label className="checkbox-field step-group-select" onClick={(event) => event.stopPropagation()}>
          <input
            aria-label={`Select steps in ${name}`}
            checked={selectionState === "all"}
            onChange={(event) => onToggleSelect(event.target.checked)}
            ref={selectionRef}
            type="checkbox"
          />
        </label>
        <span aria-hidden="true" className={isExpanded ? "step-group-chevron is-expanded" : "step-group-chevron"}>
          <StepGroupChevronIcon />
        </span>
        <span className="step-group-title">
          <span className="step-group-title-row">
            <span aria-hidden="true" className={isSharedGroup ? "step-group-icon is-shared" : "step-group-icon is-local"}>
              <SharedGroupLevelIcon kind={kind} />
            </span>
            <strong>{name}</strong>
          </span>
        </span>
      </div>
      <div className="step-group-meta">
        <span className="step-group-count">
          {stepCount} step{stepCount === 1 ? "" : "s"}
        </span>
        {showAutomationTools ? (
          <InlineStepToolButton
            ariaLabel={`Preview automation for ${name}`}
            className="step-inline-tool--group"
            onClick={onPreviewCode}
            title="Preview consolidated automation"
          >
            <AutomationCodeIcon />
          </InlineStepToolButton>
        ) : null}
        <StepActionMenu
          className="step-group-header-actions step-card-menu--flat"
          label="Group actions"
          actions={[
            {
              label: "Move group up",
              icon: <StepMoveUpIcon />,
              onClick: onMoveUp,
              disabled: !canMoveUp
            },
            {
              label: "Move group down",
              icon: <StepMoveDownIcon />,
              onClick: onMoveDown,
              disabled: !canMoveDown
            },
            ...(isSharedGroup
              ? [{
                  label: "Convert to local group",
                  icon: <StepGroupIcon />,
                  onClick: onConvertToLocal
                }]
              : [{
                  label: "Convert to Shared Step Group",
                  icon: <StepSharedGroupIcon />,
                  onClick: onConvertToShared
                }]),
            {
              label: unlinkTitle,
              icon: <StepUngroupIcon />,
              onClick: onUngroup
            },
            {
              label: removeTitle,
              icon: <StepDeleteIcon />,
              onClick: onRemoveGroup,
              tone: "danger"
            }
          ]}
        />
      </div>
    </div>
  );
}

export function StepGroupModal({
  name,
  reusable,
  selectedCount,
  isSaving,
  onNameChange,
  setReusable,
  onSave,
  onClose
}: {
  name: string;
  reusable: boolean;
  selectedCount: number;
  isSaving: boolean;
  onNameChange: (value: string) => void;
  setReusable: (value: boolean) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>({ closeDisabled: isSaving, onClose });

  return (
    <div className="modal-backdrop" onClick={() => !isSaving && onClose()} role="presentation">
      <div
        aria-label="Create step group"
        aria-modal="true"
        className="modal-card suite-create-modal"
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="suite-create-header">
          <div className="suite-create-title">
            <h2 className="dialog-title">Create step group</h2>
            <p>Name this group and decide whether it should stay local to this case or become a linked Shared Step Group used in other cases.</p>
          </div>
          <DialogCloseButton disabled={isSaving} label="Close create step group" onClick={onClose} />
        </div>

        <div className="form-grid">
          <FormField label="Group name" required>
            <input
              data-autofocus="true"
              required
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
            />
          </FormField>

          <label className="checkbox-field">
            <input checked={reusable} onChange={(event) => setReusable(event.target.checked)} type="checkbox" />
            Save as Shared Step Group
          </label>

          <div className="detail-summary">
            <strong>{selectedCount} step{selectedCount === 1 ? "" : "s"} selected</strong>
            <span>{reusable ? "Shared Step Groups stay linked across every test case that references them." : "Local groups only organize the current case."}</span>
          </div>
        </div>

        <div className="action-row">
          <button className="ghost-button" disabled={isSaving} onClick={onClose} type="button">
            Cancel
          </button>
          <button className="primary-button" disabled={isSaving} onClick={onSave} type="button">
            {isSaving ? "Saving…" : reusable ? "Create Shared Step Group" : "Create group"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SharedGroupPickerModal({
  groups,
  selectedGroupIds,
  selectedGroups,
  isLoading,
  isInserting,
  searchValue,
  onSearchChange,
  setSelectedGroupIds,
  onConfirm,
  onClose
}: {
  groups: SharedStepGroup[];
  selectedGroupIds: string[];
  selectedGroups: SharedStepGroup[];
  isLoading: boolean;
  isInserting: boolean;
  searchValue: string;
  onSearchChange: (value: string) => void;
  setSelectedGroupIds: (value: string[]) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>({ onClose });
  const [usageFilter, setUsageFilter] = useState<"all" | "linked" | "unused">("all");
  const visibleGroups = groups.filter((group) => {
    const usageCount = group.usage_count ?? group.used_test_cases?.length ?? 0;
    return usageFilter === "all" || (usageFilter === "linked" ? usageCount > 0 : usageCount === 0);
  });

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        aria-label="Insert Shared Step Group"
        aria-modal="true"
        className="modal-card suite-create-modal shared-group-picker-modal"
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="suite-create-header">
          <div className="suite-create-title">
            <div className="modal-title-info-row">
              <h2 className="dialog-title">Insert Shared Step Group</h2>
              <InfoTooltip
                content="Choose a Shared Step Group to insert into this case. Edits inside the group stay linked across every referencing test case."
                label="Insert Shared Step Group information"
              />
            </div>
          </div>
          <DialogCloseButton label="Close Shared Step Group picker" onClick={onClose} />
        </div>

        <div className="shared-group-picker-body">
          <div className="shared-group-picker-toolbar">
            <label className="shared-group-picker-search">
              <span className="sr-only">Search Shared Step Groups</span>
              <SearchIcon />
              <input
                data-autofocus="true"
                placeholder="Search by ID, name, description, or step text"
                value={searchValue}
                onChange={(event) => onSearchChange(event.target.value)}
              />
            </label>
            <label className="shared-group-picker-filter">
              <span className="sr-only">Filter Shared Step Groups</span>
              <select value={usageFilter} onChange={(event) => setUsageFilter(event.target.value as typeof usageFilter)}>
                <option value="all">All groups</option>
                <option value="linked">Linked to cases</option>
                <option value="unused">Not yet linked</option>
              </select>
            </label>
            <button
              className="ghost-button compact"
              disabled={!visibleGroups.length}
              onClick={() => setSelectedGroupIds([...new Set([...selectedGroupIds, ...visibleGroups.map((group) => group.id)])])}
              type="button"
            >
              <SelectionToggleIcon checked />
              Select All
            </button>
            <button className="ghost-button compact" disabled={!selectedGroupIds.length} onClick={() => setSelectedGroupIds([])} type="button"><SelectionToggleIcon checked={false} />Clear</button>
            <span className="shared-group-picker-selected-count">{selectedGroupIds.length} selected</span>
          </div>

          <div className="shared-group-picker-list" role="list">
            {isLoading ? <InlineLoadingState label="Loading Shared Step Groups" /> : null}
            {!isLoading && visibleGroups.map((group) => {
              const stepCount = group.step_count ?? group.steps.length;
              const linkedCaseCount = group.usage_count ?? group.used_test_cases?.length ?? 0;
              const isSelected = selectedGroupIds.includes(group.id);

              return (
              <div className={isSelected ? "shared-group-picker-row is-selected" : "shared-group-picker-row"} key={group.id} role="listitem">
                <input
                  aria-label={`Select ${group.name}`}
                  checked={isSelected}
                  onChange={(event) => setSelectedGroupIds(event.target.checked ? [...new Set([...selectedGroupIds, group.id])] : selectedGroupIds.filter((id) => id !== group.id))}
                  type="checkbox"
                />
                <span className="shared-group-picker-identity">
                  <span className="step-group-title-row">
                    <span aria-hidden="true" className="step-kind-badge is-shared">
                      <SharedStepsIconGraphic size={14} />
                    </span>
                    <DisplayIdBadge value={group.display_id || group.id} />
                  </span>
                  <strong>{group.name}</strong>
                  <span>{group.description ? richTextToPlainText(group.description) : "No description provided."}</span>
                </span>
                <span className="shared-group-picker-metrics">
                  <span><strong>{stepCount}</strong> {stepCount === 1 ? "step" : "steps"}</span>
                  <span><strong>{linkedCaseCount}</strong> linked {linkedCaseCount === 1 ? "case" : "cases"}</span>
                  {linkedCaseCount ? (
                    <a
                      href={`/shared-steps?group=${encodeURIComponent(group.id)}&usage=1`}
                      onClick={(event) => event.stopPropagation()}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open associated cases
                    </a>
                  ) : <span className="shared-group-picker-no-link">No associated cases</span>}
                </span>
              </div>
            );})}
            {!isLoading && !visibleGroups.length ? <div className="empty-state compact">No Shared Step Groups match this search and filter.</div> : null}
          </div>

          {selectedGroups.length ? (
            <div className="detail-summary">
              <div className="step-group-title-row">
                <span aria-hidden="true" className="step-kind-badge is-shared">
                  <SharedStepsIconGraphic size={14} />
                </span>
                <strong>{selectedGroups.length === 1 ? selectedGroups[0].name : `${selectedGroups.length} Shared Step Groups`}</strong>
              </div>
              <span>
                {selectedGroups.reduce((count, group) => count + (group.step_count ?? group.steps.length), 0)} linked steps will be inserted in selection order.
              </span>
            </div>
          ) : null}
        </div>

        <div className="action-row">
          <button className="ghost-button" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="primary-button" disabled={!selectedGroupIds.length || isLoading || isInserting} onClick={onConfirm} type="button">
            {isInserting ? "Inserting…" : `Insert ${selectedGroupIds.length || "selected"} group${selectedGroupIds.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
