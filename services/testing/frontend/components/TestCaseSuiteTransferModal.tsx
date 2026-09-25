import { useEffect, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AddIcon, CopyIcon, MoveIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import { DialogCloseButton } from "@hellotest/platform/frontend/src/shared/components/DialogCloseButton";
import { FormField } from "@hellotest/platform/frontend/src/shared/components/FormField";
import { InfoTooltip } from "@hellotest/platform/frontend/src/shared/components/InfoTooltip";
import { useDialogFocus } from "@hellotest/platform/frontend/src/shared/hooks/useDialogFocus";
import { useCapabilityAccess } from "@hellotest/platform/frontend/src/platform/hooks/useCapabilityAccess";
import { optionalQueryView } from "@hellotest/platform/frontend/src/shared/lib/optionalQueryView";
import { testingApi as api } from "../api.client";
import { asArray } from "@hellotest/platform/frontend/src/shared/lib/collectionGuards";
import { AppType, Project } from "@hellotest/platform/frontend/src/types";

export type SuiteTransferAction = "add" | "move" | "copy";

export function TestCaseSuiteTransferModal({
  action,
  caseCount,
  projects,
  appTypes,
  currentAppTypeId,
  targetProjectId,
  targetAppTypeId,
  selectedSuiteIds,
  isSaving,
  onActionChange,
  onProjectChange,
  onAppTypeChange,
  onSuiteIdsChange,
  onClose,
  onSubmit
}: {
  action: SuiteTransferAction;
  caseCount: number;
  projects: Pick<Project, "id" | "display_id" | "name">[];
  appTypes: AppType[];
  currentAppTypeId: string;
  targetProjectId: string;
  targetAppTypeId: string;
  selectedSuiteIds: string[];
  isSaving: boolean;
  onActionChange: (action: SuiteTransferAction) => void;
  onProjectChange: (projectId: string) => void;
  onAppTypeChange: (appTypeId: string) => void;
  onSuiteIdsChange: (suiteIds: string[]) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>({ closeDisabled: isSaving, onClose });
  const { can } = useCapabilityAccess(targetProjectId);
  const targetAppType = appTypes.find((item) => item.id === targetAppTypeId) || null;
  const targetSuitesQuery = optionalQueryView(useQuery({
    queryKey: ["test-case-suites", targetAppTypeId],
    queryFn: () => api.testSuites.list({ app_type_id: targetAppTypeId }),
    enabled: can("suite.view") && Boolean(targetAppTypeId)
  }), can("suite.view"));
  const targetSuites = asArray(targetSuitesQuery.data);
  const selectedSuiteSet = useMemo(() => new Set(selectedSuiteIds), [selectedSuiteIds]);
  const scopedAppTypes = useMemo(
    () =>
      appTypes
        .filter((item) => String(item.project_id) === String(targetProjectId))
        .slice()
        .sort((left, right) => left.name.localeCompare(right.name)),
    [appTypes, targetProjectId]
  );
  const isCrossAppType = Boolean(targetAppTypeId && currentAppTypeId && targetAppTypeId !== currentAppTypeId);

  useEffect(() => {
    if (!targetProjectId && projects[0]?.id) {
      onProjectChange(projects[0].id);
    }
  }, [onProjectChange, projects, targetProjectId]);

  useEffect(() => {
    if (!targetAppTypeId && scopedAppTypes[0]?.id) {
      onAppTypeChange(scopedAppTypes[0].id);
      return;
    }

    if (targetAppTypeId && !scopedAppTypes.some((item) => item.id === targetAppTypeId)) {
      onAppTypeChange(scopedAppTypes[0]?.id || "");
    }
  }, [onAppTypeChange, scopedAppTypes, targetAppTypeId]);

  const toggleSuite = (suiteId: string) => {
    if (selectedSuiteSet.has(suiteId)) {
      onSuiteIdsChange(selectedSuiteIds.filter((id) => id !== suiteId));
      return;
    }

    onSuiteIdsChange([...selectedSuiteIds, suiteId]);
  };

  const actionCopy = {
    add: "Add keeps existing suite links and app scope. Use it when the same cases should run from several suites.",
    move: "Move replaces suite links. If you choose another app type or project, the case ownership moves with it.",
    copy: "Copy creates new cases with the same steps in the target suite scope."
  }[action];

  return (
    <div className="modal-backdrop" onClick={() => !isSaving && onClose()} role="presentation">
      <div
        aria-label="Move or copy test cases to suites"
        aria-modal="true"
        className="modal-card suite-create-modal suite-link-modal"
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="suite-create-header">
          <div className="suite-create-title">
            <div className="modal-title-info-row">
              <h2 className="dialog-title">Suite transfer</h2>
              <InfoTooltip
                content={`Choose an existing suite target for ${caseCount} selected case${caseCount === 1 ? "" : "s"}. Multi-suite links are preserved when you add.`}
                label="Suite transfer information"
              />
            </div>
          </div>
          <DialogCloseButton disabled={isSaving} label="Close suite transfer" onClick={onClose} />
        </div>

        <form
          className="suite-modal-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <div className="suite-link-modal-body">
            <div className="suite-transfer-config-grid">
              <FormField label="Action" hint={isCrossAppType && action === "add" ? "Add is available only inside the current app type. Use Copy or Move for cross-project work." : actionCopy}>
                <div className="segmented-control">
                  {([
                    ["add", "Add links", <AddIcon key="add-icon" />],
                    ["move", "Move", <MoveIcon key="move-icon" />],
                    ["copy", "Copy", <CopyIcon key="copy-icon" />]
                  ] as Array<[SuiteTransferAction, string, ReactNode]>).map(([value, label, icon]) => (
                    <button
                      aria-pressed={action === value}
                      className={action === value ? "is-active" : ""}
                      disabled={isSaving}
                      key={value}
                      onClick={() => onActionChange(value)}
                      type="button"
                    >
                      {icon}
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </FormField>

              <div className="suite-transfer-scope-grid">
                <FormField label="Target project">
                  <select
                    disabled={isSaving}
                    value={targetProjectId}
                    onChange={(event) => {
                      onProjectChange(event.target.value);
                      onAppTypeChange("");
                      onSuiteIdsChange([]);
                    }}
                  >
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>{project.name}</option>
                    ))}
                  </select>
                </FormField>

                <FormField label="Target app type">
                  <select
                    disabled={isSaving || !scopedAppTypes.length}
                    value={targetAppTypeId}
                    onChange={(event) => {
                      onAppTypeChange(event.target.value);
                      onSuiteIdsChange([]);
                    }}
                  >
                    {scopedAppTypes.map((appType) => (
                      <option key={appType.id} value={appType.id}>{appType.name}</option>
                    ))}
                  </select>
                </FormField>
              </div>
            </div>

            <div className="suite-link-list-shell">
              <div className="suite-link-list-header">
                <strong>Target suites</strong>
                <span>{targetSuitesQuery.isLoading ? "Loading" : `${targetSuites.length} available`}</span>
              </div>

              {targetSuites.length ? (
                <div className="suite-link-list">
                  {targetSuites.map((suite, index) => {
                    const isSelected = selectedSuiteSet.has(suite.id);

                    return (
                      <div className={isSelected ? "suite-link-row is-linked" : "suite-link-row"} key={suite.id}>
                        <div className="suite-link-row-copy">
                          <strong>{suite.name}</strong>
                          {suite.display_id ? <span>{suite.display_id}</span> : null}
                        </div>
                        <div className="suite-link-row-actions">
                          {isSelected ? <span className="suite-link-row-status">Selected</span> : null}
                          <button
                            aria-label={`${isSelected ? "Remove" : "Select"} ${suite.name}`}
                            className={isSelected ? "ghost-button suite-link-toggle is-linked" : "ghost-button suite-link-toggle"}
                            data-autofocus={index === 0 ? "true" : undefined}
                            disabled={isSaving}
                            onClick={() => toggleSuite(suite.id)}
                            type="button"
                          >
                            {isSelected ? <SuiteUnlinkIcon /> : <AddIcon />}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-state compact">No suites exist for this app type yet. Create the suite first, then return here to link, move, or copy cases.</div>
              )}
            </div>

            <div className="detail-summary">
              <strong>{selectedSuiteIds.length} selected suite{selectedSuiteIds.length === 1 ? "" : "s"}</strong>
              <span>{targetAppType?.name || "Choose an app type"} will receive the selected case scope. Cross-project copies drop story links because stories belong to one project.</span>
            </div>
          </div>

          <div className="action-row suite-modal-actions">
            <button className="ghost-button" disabled={isSaving} onClick={onClose} type="button">Cancel</button>
            <button className="primary-button" disabled={isSaving || !targetAppTypeId || !selectedSuiteIds.length || (isCrossAppType && action === "add")} type="submit">
              {isSaving ? "Saving…" : action === "copy" ? "Copy cases" : action === "add" ? "Add suite links" : "Move cases"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SuiteUnlinkIcon({
  size = 16,
  strokeWidth = 1.9
}: {
  size?: number;
  strokeWidth?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      width={size}
    >
      <path d="M5 12h14" />
    </svg>
  );
}
