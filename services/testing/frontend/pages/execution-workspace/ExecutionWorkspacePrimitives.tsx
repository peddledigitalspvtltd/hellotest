import { type ExecutionCaseInstanceView, boardStatusTooltip, ExecutionStatusIndicator } from "../../components/ExecutionRunListCard";
import { getExecutionStepKindMeta, ExecutionIconShell } from "../../components/ExecutionRunnerStep";
import { type ReactNode } from "react";
import { IconChevronRight } from "@tabler/icons-react";
import { CollapseExpandIcon, EyeIcon, TestCaseIcon, TestSuiteIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import { AutomationCodeIcon, SharedGroupLevelIcon } from "@hellotest/automation/frontend/components/StepAutomationEditor";
import { StatusBadge } from "@hellotest/platform/frontend/src/shared/components/StatusBadge";
import { resolveUserInitials, resolveUserPrimaryLabel, resolveUserSecondaryLabel } from "@hellotest/platform/frontend/src/platform/lib/userDisplay";
import { type Execution, type ExecutionResult, type TestStep } from "@hellotest/platform/frontend/src/types";
import { ExecutionCaseView } from "./executionWorkspaceModel";

export function ExecutionAccordionPanel({
  title,
  subtitle,
  isExpanded,
  onToggle,
  className = "",
  children
}: {
  title: string;
  subtitle?: string;
  isExpanded: boolean;
  onToggle: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`panel card execution-accordion-panel ${className}`.trim()}>
      <button
        aria-expanded={isExpanded}
        className="execution-accordion-toggle execution-accordion-toggle--panel"
        onClick={onToggle}
        title={isExpanded ? `Collapse ${title}` : `Expand ${title}`}
        type="button"
      >
        <div className="execution-accordion-toggle-main">
          <span aria-hidden="true" className={isExpanded ? "execution-accordion-icon is-expanded" : "execution-accordion-icon"}>
            <ExecutionAccordionChevronIcon />
          </span>
          <div className="execution-accordion-toggle-copy">
            <strong>{title}</strong>
            {subtitle ? <span>{subtitle}</span> : null}
          </div>
        </div>
        <div className="execution-accordion-toggle-meta">
          <span aria-hidden="true" className="execution-accordion-toggle-state explorer-toggle-glyph"><CollapseExpandIcon isExpanded={isExpanded} /></span>
        </div>
      </button>
      {isExpanded ? <div className="execution-accordion-panel-body">{children}</div> : null}
    </section>
  );
}

export function ExecutionAccordionSection({
  title,
  summary,
  isExpanded,
  onToggle,
  className = "",
  children
}: {
  title: string;
  summary: string;
  isExpanded: boolean;
  onToggle: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`${isExpanded ? "execution-accordion-section is-expanded" : "execution-accordion-section"} ${className}`.trim()}>
      <button
        aria-expanded={isExpanded}
        className="execution-accordion-toggle execution-accordion-toggle--section"
        onClick={onToggle}
        title={isExpanded ? `Collapse ${title}` : `Expand ${title}`}
        type="button"
      >
        <div className="execution-accordion-toggle-main">
          <span aria-hidden="true" className={isExpanded ? "execution-accordion-icon is-expanded" : "execution-accordion-icon"}>
            <ExecutionAccordionChevronIcon />
          </span>
          <div className="execution-accordion-toggle-copy">
            <strong>{title}</strong>
            <span>{summary}</span>
          </div>
        </div>
        <div className="execution-accordion-toggle-meta">
          <span aria-hidden="true" className="execution-accordion-toggle-state explorer-toggle-glyph"><CollapseExpandIcon isExpanded={isExpanded} /></span>
        </div>
      </button>
      {isExpanded ? <div className="execution-accordion-body">{children}</div> : null}
    </section>
  );
}

export function ExecutionAccordionChevronIcon() {
  return <IconChevronRight aria-hidden="true" size={18} stroke={1.8} />;
}

export function ExecutionAssigneeChip({
  user,
  className = "",
  fallback = "Unassigned",
  labelOverride
}: {
  user?: { name?: string | null; email?: string | null } | null;
  className?: string;
  fallback?: string;
  labelOverride?: string;
}) {
  const label = labelOverride || (user ? resolveUserPrimaryLabel(user) : fallback);
  const detail = user ? resolveUserSecondaryLabel(user) : null;

  return (
    <span className={["execution-card-assignee", className].filter(Boolean).join(" ")} title={detail || label}>
      <span className="execution-card-assignee-avatar" aria-hidden="true">
        {resolveUserInitials(user)}
      </span>
      <span>{label}</span>
    </span>
  );
}

export function resolveExecutionAssigneeSummary(execution?: Pick<Execution, "assigned_user" | "assigned_users"> | null) {
  const users = execution?.assigned_users?.length
    ? execution.assigned_users
    : execution?.assigned_user
      ? [execution.assigned_user]
      : [];

  if (!users.length) {
    return "Unassigned";
  }

  if (users.length <= 2) {
    return users.map((user) => resolveUserPrimaryLabel(user)).join(", ");
  }

  return `${users.slice(0, 2).map((user) => resolveUserPrimaryLabel(user)).join(", ")} +${users.length - 2}`;
}

export function ExecutionCardFact({
  title,
  ariaLabel,
  label,
  tone = "neutral",
  children
}: {
  title: string;
  ariaLabel: string;
  label?: string;
  tone?: "neutral" | "info" | "success" | "danger" | "warning";
  children: ReactNode;
}) {
  return (
    <span
      aria-label={ariaLabel}
      className={`execution-card-fact tone-${tone}`}
      title={title}
    >
      <span aria-hidden="true" className="execution-card-fact-icon">
        {children}
      </span>
      {label ? <span className="execution-card-fact-label">{label}</span> : null}
    </span>
  );
}

export function LiveRunIcon() {
  return (
    <ExecutionIconShell>
      <rect height="10" rx="2" width="16" x="4" y="5" />
      <path d="M8 19h8" />
      <path d="M12 15v4" />
      <path d="M10 9.5 13.5 12 10 14.5z" />
    </ExecutionIconShell>
  );
}

export function ExecutionEditIcon() {
  return (
    <ExecutionIconShell>
      <path d="M4 20h4l10-10-4-4L4 16z" />
      <path d="m12 6 4 4" />
    </ExecutionIconShell>
  );
}

export function ExecutionStartIcon() {
  return (
    <ExecutionIconShell>
      <path d="m9 7 8 5-8 5z" />
    </ExecutionIconShell>
  );
}

export function ExecutionCompleteIcon() {
  return (
    <ExecutionIconShell>
      <path d="M6 12.5 10 16l8-8" />
    </ExecutionIconShell>
  );
}

export function ExecutionAbortIcon() {
  return (
    <ExecutionIconShell>
      <circle cx="12" cy="12" r="8" />
      <rect height="5" rx="0.8" width="5" x="9.5" y="9.5" />
    </ExecutionIconShell>
  );
}

export function ExecutionRerunIcon() {
  return (
    <ExecutionIconShell>
      <path d="M20 12a8 8 0 1 1-2.3-5.6" />
      <path d="M20 4v6h-6" />
    </ExecutionIconShell>
  );
}

export function ExecutionScheduleIcon() {
  return (
    <ExecutionIconShell>
      <rect height="15" rx="2" width="16" x="4" y="5" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
      <path d="M4 10h16" />
      <path d="m10 15 1.5 1.5L15 13" />
    </ExecutionIconShell>
  );
}

export function ExecutionReleaseIcon() {
  return (
    <ExecutionIconShell>
      <path d="M5 5h14v14H5z" />
      <path d="M8 9h8" />
      <path d="M8 13h5" />
      <path d="M15 15h2" />
    </ExecutionIconShell>
  );
}

export function ExecutionBuildIcon() {
  return (
    <ExecutionIconShell>
      <path d="M8 7h8" />
      <path d="M7 12h10" />
      <path d="M9 17h6" />
      <path d="M5 9v6" />
      <path d="M19 9v6" />
    </ExecutionIconShell>
  );
}

export function ExecutionAssigneeIcon() {
  return (
    <ExecutionIconShell>
      <path d="M4 20v-1.2A4.8 4.8 0 0 1 8.8 14h6.4a4.8 4.8 0 0 1 4.8 4.8V20" />
      <circle cx="12" cy="8.2" r="3.2" />
    </ExecutionIconShell>
  );
}

export function ExecutionDeleteIcon() {
  return (
    <ExecutionIconShell>
      <path d="M4 7h16" />
      <path d="M9 7V5.8A1.8 1.8 0 0 1 10.8 4h2.4A1.8 1.8 0 0 1 15 5.8V7" />
      <path d="M7 7l.8 11.1A2 2 0 0 0 9.8 20h4.4a2 2 0 0 0 2-1.9L17 7" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </ExecutionIconShell>
  );
}

export function TestCaseBoardIcon() {
  return <TestCaseIcon size={14} strokeWidth={1.8} />;
}

export function ExecutionSuiteIcon() {
  return <TestSuiteIcon size={14} />;
}

export function ExecutionScopeIcon() {
  return (
    <TestCaseBoardIcon />
  );
}

export function ExecutionProgressFactsIcon() {
  return (
    <ExecutionIconShell>
      <path d="M4 16h16" />
      <path d="M7 13 10 10l3 2 4-5" />
    </ExecutionIconShell>
  );
}

export function ExecutionRiskIcon() {
  return (
    <ExecutionIconShell>
      <path d="m12 4 8 14H4z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </ExecutionIconShell>
  );
}

export function ExecutionRequirementImpactIcon() {
  return (
    <ExecutionIconShell>
      <path d="M5 5h14v14H5z" />
      <path d="M8 9h8" />
      <path d="M8 13h5" />
      <path d="m15 14 2 2 3-4" />
    </ExecutionIconShell>
  );
}

export function ExecutionReferenceIcon() {
  return (
    <ExecutionIconShell>
      <path d="M10 13a4 4 0 0 0 5.7.1l2-2a4 4 0 0 0-5.6-5.6l-1.1 1.1" />
      <path d="M14 11a4 4 0 0 0-5.7-.1l-2 2a4 4 0 0 0 5.6 5.6l1.1-1.1" />
    </ExecutionIconShell>
  );
}

export function ExecutionTimeIcon() {
  return (
    <ExecutionIconShell>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v5l3 2" />
    </ExecutionIconShell>
  );
}

export function ExecutionPriorityIcon() {
  return (
    <ExecutionIconShell>
      <path d="M7 20V5" />
      <path d="M7 5h10l-2 4 2 4H7" />
    </ExecutionIconShell>
  );
}

export function ExecutionStepsIcon() {
  return (
    <ExecutionIconShell>
      <path d="M8 7h10" />
      <path d="M8 12h10" />
      <path d="M8 17h10" />
      <circle cx="5" cy="7" r="1" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="5" cy="17" r="1" fill="currentColor" stroke="none" />
    </ExecutionIconShell>
  );
}

export function ExecutionStepPassIcon() {
  return (
    <ExecutionIconShell>
      <path d="m7.5 12.5 3 3 6-7" />
    </ExecutionIconShell>
  );
}

export function ExecutionStepFailIcon() {
  return (
    <ExecutionIconShell>
      <path d="m8 8 8 8" />
      <path d="m16 8-8 8" />
    </ExecutionIconShell>
  );
}

export function ExecutionOverviewOrb({
  passedCount,
  failedCount,
  blockedCount,
  totalCount,
  passPercent
}: {
  passedCount: number;
  failedCount: number;
  blockedCount: number;
  totalCount: number;
  passPercent: number;
}) {
  const safeTotal = Math.max(totalCount, 1);
  const pendingCount = Math.max(totalCount - passedCount - failedCount - blockedCount, 0);
  const passedStop = (passedCount / safeTotal) * 100;
  const failedStop = passedStop + (failedCount / safeTotal) * 100;
  const blockedStop = failedStop + (blockedCount / safeTotal) * 100;
  const orbBackground = `conic-gradient(
    #1aa96b 0% ${passedStop}%,
    #d04668 ${passedStop}% ${failedStop}%,
    #2d66e6 ${failedStop}% ${blockedStop}%,
    rgba(94, 116, 146, 0.16) ${blockedStop}% 100%
  )`;

  return (
    <div className="execution-overview-orb-shell">
      <div className="execution-overview-orb" style={{ background: orbBackground }}>
        <div className="execution-overview-orb-core">
          <strong>{passPercent}%</strong>
          <span>Pass rate</span>
        </div>
      </div>
      <div className="execution-overview-legend">
        <span className="execution-legend-item tone-total">{totalCount} total</span>
        <span className="execution-legend-item tone-passed">{passedCount} passed</span>
        <span className="execution-legend-item tone-failed">{failedCount} failed</span>
        <span className="execution-legend-item tone-blocked">{blockedCount} blocked</span>
        <span className="execution-legend-item tone-pending">{pendingCount} queued</span>
      </div>
    </div>
  );
}

export function ExecutionSuiteCaseCard({
  testCase,
  suiteName,
  stepCount,
  durationLabel,
  caseStatus,
  assignedUser,
  isActive,
  isNext,
  onSelect,
  getInstanceStatus,
  onSelectInstance,
  selectedInstanceKey
}: {
  testCase: ExecutionCaseView;
  suiteName: string;
  stepCount: number;
  durationLabel: string;
  caseStatus: ExecutionResult["status"] | "queued";
  assignedUser?: Execution["assigned_user"];
  isActive: boolean;
  isNext: boolean;
  onSelect: () => void;
  getInstanceStatus: (instance: ExecutionCaseInstanceView) => ExecutionResult["status"] | "queued";
  onSelectInstance: (instanceKey: string) => void;
  selectedInstanceKey: string;
}) {
  const dataSetInstances = testCase.data_set_instances.filter((instance) => Boolean(instance.test_data_set_id));

  return (
    <div
      aria-pressed={isActive}
      className={[
        "record-card tile-card test-case-card execution-case-card execution-board-case-card",
        isActive ? "is-active" : "",
        !isActive && isNext ? "is-next" : ""
      ].filter(Boolean).join(" ")}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) {
          return;
        }

        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      role="button"
      tabIndex={0}
    >
      <button
        aria-label={`View ${testCase.title}`}
        className="ghost-button test-case-card-eye-action execution-case-eye-action"
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
        title="View test case"
        type="button"
      >
        <EyeIcon size={16} />
      </button>
      <div className="tile-card-main">
        <div className="tile-card-header">
          <div
            aria-hidden="true"
            className={`record-card-icon execution-board-icon status-${caseStatus}`}
            title={boardStatusTooltip(caseStatus)}
          >
            <TestCaseBoardIcon />
          </div>
          <div className="tile-card-title-group">
            <strong title={testCase.title}>{testCase.title}</strong>
            <div className="execution-case-card-meta">
              <span className="tile-card-kicker">{isNext ? "Next recommended case" : suiteName || "Suite case"}</span>
              <ExecutionAssigneeChip className="execution-card-assignee--compact" user={assignedUser} />
            </div>
          </div>
          <ExecutionStatusIndicator status={caseStatus} />
        </div>
        {dataSetInstances.length ? (
          <div className="execution-case-instance-list" aria-label={`${testCase.title} Data Set row instances`} role="list">
            <div className="execution-case-instance-list-header">
              <span>
                <strong>{dataSetInstances[0].test_data_set_name || "Data Set"}</strong>
                <small>{dataSetInstances[0].data_set_source === "test_case" ? "Linked to test case" : dataSetInstances[0].data_set_source === "suite" ? "Inherited suite data" : "Run data set"}</small>
              </span>
              <span>{dataSetInstances.length} instance{dataSetInstances.length === 1 ? "" : "s"}</span>
            </div>
            <div className="execution-case-instance-scroll">
              {dataSetInstances.map((instance) => {
                const instanceStatus = getInstanceStatus(instance);
                const rowValues = Object.entries(instance.data_set_row_snapshot || {});
                const rowNumber = (instance.data_set_iteration_index ?? 0) + 1;
                return (
                  <button
                    aria-current={selectedInstanceKey === instance.instance_key ? "true" : undefined}
                    className={selectedInstanceKey === instance.instance_key ? "execution-case-instance-row is-active" : "execution-case-instance-row"}
                    key={instance.instance_key}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectInstance(instance.instance_key);
                    }}
                    role="listitem"
                    type="button"
                  >
                    <span className="execution-case-instance-identity">
                      <strong>Row {rowNumber}</strong>
                      <StatusBadge value={instanceStatus} />
                    </span>
                    <span className="execution-case-instance-values">
                      {rowValues.length ? rowValues.map(([key, value]) => (
                        <span className="execution-case-instance-value" key={`${instance.instance_key}-${key}`}>
                          <small>{key}</small>
                          <b>{value || "—"}</b>
                        </span>
                      )) : <small>No row values were captured.</small>}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        <div className="execution-card-facts" aria-label={`${testCase.title} facts`}>
          <ExecutionCardFact
            ariaLabel={`Priority P${testCase.priority || 3}`}
            label={`P${testCase.priority || 3}`}
            title={`Priority P${testCase.priority || 3}`}
          >
            <ExecutionPriorityIcon />
          </ExecutionCardFact>
          <ExecutionCardFact
            ariaLabel={`${stepCount} steps`}
            label={String(stepCount)}
            title={`${stepCount} steps`}
          >
            <ExecutionStepsIcon />
          </ExecutionCardFact>
          <ExecutionCardFact
            ariaLabel={`Case duration ${durationLabel}`}
            label={durationLabel}
            title={`Case duration ${durationLabel}`}
            tone={caseStatus === "blocked" ? "warning" : "neutral"}
          >
            <ExecutionTimeIcon />
          </ExecutionCardFact>
        </div>
      </div>
    </div>
  );
}

export function ExecutionStepGroupRow({
  canPreviewAutomation,
  name,
  kind,
  isExpanded,
  stepCount,
  onPreviewCode,
  onToggle
}: {
  canPreviewAutomation: boolean;
  name: string;
  kind: TestStep["group_kind"];
  isExpanded: boolean;
  stepCount: number;
  onPreviewCode: () => void;
  onToggle: () => void;
}) {
  const stepKind = getExecutionStepKindMeta(kind || "local");

  return (
    <div className={["execution-step-group-row", kind === "reusable" ? "is-shared-group" : "is-local-group"].join(" ")} role="listitem">
      <div className="execution-step-group-toggle-button">
        <button
          aria-expanded={isExpanded}
          className="execution-step-group-button-main"
          onClick={onToggle}
          type="button"
        >
          <span className="execution-step-group-label">
            <span className="execution-step-group-label-main">
              <span className="execution-step-group-toggle">
                <span aria-hidden="true" className={isExpanded ? "execution-step-group-chevron is-expanded" : "execution-step-group-chevron"}>
                  <ExecutionAccordionChevronIcon />
                </span>
                <span aria-hidden="true" className={kind === "reusable" ? "step-group-icon is-shared" : "step-group-icon is-local"}>
                  <SharedGroupLevelIcon kind={kind} />
                </span>
                <strong>{name}</strong>
              </span>
            </span>
            <span>{stepKind.detail} · {isExpanded ? "Expanded" : "Collapsed"}</span>
          </span>
        </button>
        <span className="execution-step-group-meta">
          <span className="execution-step-group-count">{stepCount} step{stepCount === 1 ? "" : "s"}</span>
          {canPreviewAutomation ? (
            <button
              aria-label={`Preview automation for ${name}`}
              className="step-inline-tool is-active"
              onClick={onPreviewCode}
              title="Preview group automation"
              type="button"
            >
              <AutomationCodeIcon />
            </button>
          ) : null}
        </span>
      </div>
    </div>
  );
}

export function ExecutionMinimizedRail({
  label,
  count,
  onExpand
}: {
  label: string;
  count?: number;
  onExpand: () => void;
}) {
  return (
    <button aria-label={`Expand ${label}`} className="execution-panel-rail" onClick={onExpand} type="button">
      <span className="execution-panel-rail-label">{label}</span>
      <span className="execution-panel-rail-meta">{typeof count === "number" ? count : "Show"}</span>
    </button>
  );
}
