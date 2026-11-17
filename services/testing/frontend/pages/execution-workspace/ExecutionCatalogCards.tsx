import { type BoardStatusTone, ExecutionStatusIndicator, ExecutionRunIcon } from "../../components/ExecutionRunListCard";
import { ActivityIcon, OpenIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import { EntityIdBadge } from "@hellotest/platform/frontend/src/shared/components/EntityIdBadge";
import { TileCardMetric, TileCardProgress } from "@hellotest/platform/frontend/src/shared/components/TileCardPrimitives";
import { type ExecutionSchedule, type WorkspaceTransaction } from "@hellotest/platform/frontend/src/types";
import { formatScheduleCadence, toTimestamp, formatExecutionTimestamp, formatCountLabel, describeWorkspaceTransaction, resolveWorkspaceTransactionSummary, formatWorkspaceTransactionActionLabel } from "./executionWorkspaceModel";
import { resolveExecutionAssigneeSummary, ExecutionCardFact, ExecutionScheduleIcon, ExecutionScopeIcon, ExecutionTimeIcon } from "./ExecutionWorkspacePrimitives";

export function ExecutionScheduleCard({
  schedule,
  isActive,
  isSelected,
  liveNow,
  onSelect,
  onToggleSelected,
  resolvedCaseCount
}: {
  schedule: ExecutionSchedule;
  isActive: boolean;
  isSelected: boolean;
  liveNow: number;
  onSelect: () => void;
  onToggleSelected: () => void;
  resolvedCaseCount: number;
}) {
  const assigneeLabel = resolveExecutionAssigneeSummary(schedule);
  const cadenceLabel = formatScheduleCadence(schedule.cadence);
  const assigneeCount = new Set([
    ...(schedule.assigned_to_ids || []),
    ...(schedule.assigned_to ? [schedule.assigned_to] : [])
  ].filter(Boolean)).size;
  const contextAttachedCount = [
    schedule.test_environment_id,
    schedule.test_configuration_id,
    schedule.test_data_set_id
  ].filter(Boolean).length;
  const nextRunTimestamp = toTimestamp(schedule.next_run_at);
  const launchSignals = [
    { label: "active schedule", ready: schedule.is_active },
    { label: "test scope", ready: resolvedCaseCount > 0 },
    { label: "upcoming run time", ready: nextRunTimestamp !== null && nextRunTimestamp >= liveNow }
  ];
  const completedLaunchCount = launchSignals.filter((signal) => signal.ready).length;
  const launchPercent = Math.round((completedLaunchCount / launchSignals.length) * 100);
  const contextPercent = Math.round((contextAttachedCount / 3) * 100);
  const missingLaunchLabels = launchSignals.filter((signal) => !signal.ready).map((signal) => signal.label);
  const launchTitle = missingLaunchLabels.length
    ? `Still needed: ${missingLaunchLabels.join(", ")}`
    : "The schedule is active with resolved scope and an upcoming run time.";

  return (
    <article
      aria-label={`Open Scheduled Run ${schedule.id}: ${schedule.name}`}
      className={isActive ? "record-card tile-card execution-card execution-schedule-tile-card virtual-card is-active" : "record-card tile-card execution-card execution-schedule-tile-card virtual-card"}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("a, button, input, label, select, textarea")) return;
        onSelect();
      }}
    >
      <div className="tile-card-select-row" onClick={(event) => event.stopPropagation()}>
        <label className="checkbox-field">
          <input
            aria-label={`Select ${schedule.name}`}
            checked={isSelected}
            onChange={onToggleSelected}
            type="checkbox"
          />
          <span className="sr-only">Select schedule</span>
        </label>
        <EntityIdBadge icon={<ExecutionScheduleIcon />} value={schedule.id} />
      </div>
      <div className="tile-card-main execution-schedule-card-main">
        <div className="tile-card-header">
          <div aria-hidden="true" className={`record-card-icon execution status-${schedule.is_active ? "queued" : "aborted"}`}>
            <ExecutionScheduleIcon />
          </div>
          <button aria-current={isActive ? "page" : undefined} className="tile-card-title-group tile-card-open-button" onClick={onSelect} type="button">
            <strong>{schedule.name}</strong>
            <span className="execution-card-assignee">{schedule.is_active ? `${cadenceLabel} cadence` : `Inactive · ${cadenceLabel} cadence`}</span>
          </button>
          <ExecutionStatusIndicator status={schedule.is_active ? "queued" : "aborted"} />
        </div>

        <div className="tile-card-progress-stack execution-schedule-progress-stack">
          <TileCardProgress
            breakdown={{ total: launchSignals.length, segments: [
              { key: "passed", label: "Ready", count: completedLaunchCount },
              { key: "pending", label: "Not ready", count: launchSignals.length - completedLaunchCount }
            ] }}
            displayValue={`${completedLaunchCount}/${launchSignals.length} ready`}
            label="Launch readiness"
            title={launchTitle}
            tone={launchPercent === 100 ? "success" : launchPercent >= 67 ? "info" : "warning"}
            value={launchPercent}
          />
          <TileCardProgress
            breakdown={{ total: 3, segments: [
              { key: "covered", label: "Attached", count: contextAttachedCount },
              { key: "uncovered", label: "Not attached", count: 3 - contextAttachedCount }
            ] }}
            displayValue={`${contextAttachedCount}/3 attached`}
            label="Run context"
            title={`${contextAttachedCount} of 3 run context resources attached: environment, configuration, and test data`}
            tone={contextPercent === 100 ? "success" : contextAttachedCount ? "info" : "warning"}
            value={contextPercent}
          />
        </div>

        <div className="tile-card-metric-grid execution-schedule-tile-metrics" aria-label={`${schedule.name} schedule metrics`}>
          <TileCardMetric
            label="Suites"
            title={`${schedule.suite_ids.length} suite${schedule.suite_ids.length === 1 ? "" : "s"} in schedule scope`}
            tone={schedule.suite_ids.length ? "info" : "neutral"}
            value={schedule.suite_ids.length}
          />
          <TileCardMetric
            label="Cases"
            title={`${resolvedCaseCount} unique test case${resolvedCaseCount === 1 ? "" : "s"} resolved across direct and Suite scope`}
            tone={resolvedCaseCount ? "info" : "warning"}
            value={resolvedCaseCount}
          />
          <TileCardMetric
            label="Assignees"
            title={`Assigned to ${assigneeLabel}`}
            tone={assigneeCount ? "success" : "warning"}
            value={assigneeCount}
          />
          <TileCardMetric
            label="Context"
            title={`${contextAttachedCount} of 3 run context resources attached`}
            tone={contextPercent === 100 ? "success" : contextAttachedCount ? "info" : "warning"}
            value={`${contextAttachedCount}/3`}
          />
        </div>

      </div>

    </article>
  );
}

export function WorkspaceTransactionCard({
  transaction,
  isActive,
  isSelected,
  onSelect,
  onToggleSelected,
  appTypeNameById,
  projectNameById
}: {
  transaction: WorkspaceTransaction;
  isActive: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onToggleSelected: () => void;
  appTypeNameById: Record<string, string>;
  projectNameById: Record<string, string>;
}) {
  const presentation = describeWorkspaceTransaction(transaction, {
    appTypeNameById,
    projectNameById
  });
  const summary = resolveWorkspaceTransactionSummary(transaction, presentation);
  const scopeLabel = transaction.app_type_id
    ? appTypeNameById[transaction.app_type_id] || "App type scope"
    : transaction.project_id
      ? projectNameById[transaction.project_id] || "Project scope"
      : "Workspace scope";
  const statusTone: BoardStatusTone =
    transaction.status === "queued" || transaction.status === "running" || transaction.status === "failed"
      ? transaction.status
      : "completed";
  const latestActivityLabel = formatExecutionTimestamp(
    transaction.latest_event_at || transaction.updated_at || transaction.created_at,
    "Timestamp unavailable"
  );
  const actionLabel = formatWorkspaceTransactionActionLabel(transaction.action);

  return (
    <div className={isActive ? "record-card tile-card execution-card workspace-transaction-card virtual-card is-active" : "record-card tile-card execution-card workspace-transaction-card virtual-card"}>
      <div className="tile-card-select-row">
        <label className="checkbox-field">
          <input
            aria-label={`Select ${transaction.title}`}
            checked={isSelected}
            onChange={onToggleSelected}
            type="checkbox"
          />
          <span className="sr-only">Select batch process</span>
        </label>
      </div>
      <button className="tile-card-main execution-schedule-card-button workspace-transaction-card-button" onClick={onSelect} type="button">
        <div className="tile-card-header">
          <div aria-hidden="true" className={`record-card-icon execution status-${statusTone}`}>
            {presentation.icon}
          </div>
          <div className="tile-card-title-group">
            <strong>{transaction.title}</strong>
            <span className="execution-card-assignee execution-card-assignee--wrap">{presentation.eyebrow}</span>
          </div>
          <ExecutionStatusIndicator status={statusTone} />
        </div>

        <div className="execution-card-facts" aria-label="Batch process facts">
          <ExecutionCardFact ariaLabel={`Scope ${scopeLabel}`} label={scopeLabel} title={`Scope ${scopeLabel}`}>
            <ActivityIcon />
          </ExecutionCardFact>
          <ExecutionCardFact ariaLabel={`Action ${actionLabel}`} label={actionLabel} title={`Action ${actionLabel}`}>
            <ExecutionRunIcon />
          </ExecutionCardFact>
          <ExecutionCardFact ariaLabel={`${transaction.event_count || 0} logged events`} label={formatCountLabel(transaction.event_count || 0, "event")} title={`${transaction.event_count || 0} logged events`}>
            <ExecutionScopeIcon />
          </ExecutionCardFact>
          <ExecutionCardFact ariaLabel={`Last activity ${latestActivityLabel}`} label={latestActivityLabel} title={`Last activity ${latestActivityLabel}`}>
            <ExecutionTimeIcon />
          </ExecutionCardFact>
        </div>

        <p className="tile-card-description workspace-transaction-card-summary">{summary}</p>
      </button>

      <div className="action-row execution-schedule-actions workspace-transaction-card-actions">
        <button className="ghost-button" onClick={onSelect} type="button">
          <OpenIcon />
          <span>Open details</span>
        </button>
      </div>
    </div>
  );
}
