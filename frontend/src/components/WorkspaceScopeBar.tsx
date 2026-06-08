import type { AppType, Project } from "../types";
import { AppTypeDropdown, AppTypeInlineValue } from "./AppTypeDropdown";
import { ProjectDropdown } from "./ProjectDropdown";

export function WorkspaceScopeBar({
  projects,
  projectId,
  appTypes,
  appTypeId,
  onProjectChange,
  onAppTypeChange,
  projectLabel = "Project",
  appTypeLabel = "App Type",
  disabled = false,
  projectValueLabel,
  appTypeValueLabel,
  sticky = false
}: {
  projects: Project[];
  projectId: string;
  appTypes: AppType[];
  appTypeId: string;
  onProjectChange: (value: string) => void;
  onAppTypeChange: (value: string) => void;
  projectLabel?: string;
  appTypeLabel?: string;
  disabled?: boolean;
  projectValueLabel?: string;
  appTypeValueLabel?: string;
  sticky?: boolean;
}) {
  const resolvedProjectLabel =
    projectValueLabel || projects.find((project) => String(project.id) === String(projectId))?.name || "No project selected";
  const resolvedAppType = appTypes.find((appType) => appType.id === appTypeId) || null;
  const resolvedAppTypeLabel =
    appTypeValueLabel || resolvedAppType?.name || "No app type selected";

  const className = [
    "design-context-bar",
    "workspace-scope-bar",
    sticky ? "is-sticky" : "is-modal-field",
    disabled ? "is-read-only" : ""
  ].filter(Boolean).join(" ");

  return (
    <div className={className}>
      <div className="context-field">
        <span>{projectLabel}</span>
        {disabled ? (
          <div aria-label={`${projectLabel} snapshot`} className="context-value" role="textbox">
            {resolvedProjectLabel}
          </div>
        ) : (
          <ProjectDropdown
            ariaLabel={`Select ${projectLabel.toLowerCase()}`}
            onChange={onProjectChange}
            projects={projects}
            value={projectId}
          />
        )}
      </div>

      <label className="context-field">
        <span>{appTypeLabel}</span>
        {disabled ? (
          <div aria-label={`${appTypeLabel} snapshot`} className="context-value" role="textbox">
            <AppTypeInlineValue
              isUnified={resolvedAppType?.is_unified}
              label={resolvedAppTypeLabel}
              type={resolvedAppType?.type}
            />
          </div>
        ) : (
          <AppTypeDropdown
            ariaLabel={`Select ${appTypeLabel.toLowerCase()}`}
            disabled={!projectId}
            emptyLabel={!projectId ? `Select ${projectLabel.toLowerCase()} first` : "No app types available"}
            onChange={onAppTypeChange}
            options={appTypes.map((appType) => ({
              value: appType.id,
              label: appType.name,
              type: appType.type,
              isUnified: appType.is_unified
            }))}
            placeholder={`Select ${appTypeLabel.toLowerCase()}`}
            value={appTypeId}
          />
        )}
      </label>
    </div>
  );
}
